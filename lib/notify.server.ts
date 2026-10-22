import "server-only";
import webpush from "web-push";
import nodemailer from "nodemailer";
import { createAdminClient } from "@/lib/supabase/admin";
import { isOnline } from "@/components/UserAvatar";

/**
 * Pengiriman notifikasi (push browser + email lewat Resend).
 * Butuh env di Vercel:
 *   SUPABASE_SERVICE_ROLE_KEY            (sudah ada untuk halaman Admin)
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY   -> push browser
 *   SMTP_USER + SMTP_PASS (Gmail / Google Workspace App Password)  -> email
 *   atau RESEND_API_KEY + EMAIL_FROM (domain terverifikasi di Resend)
 * Kalau salah satu belum diisi, jenis notifikasi itu dilewati saja (aplikasi tetap jalan).
 */

type Prefs = {
  push_issue: boolean; push_dm: boolean; push_room: boolean; push_mention: boolean;
  email_issue: boolean; email_dm: boolean; email_mention: boolean;
};
const DEFAULT_PREFS: Prefs = { push_issue: true, push_dm: true, push_room: true, push_mention: true, email_issue: true, email_dm: true, email_mention: true };
type Payload = { title: string; body: string; url: string; tag: string };

const log = (...a: unknown[]) => console.log("[notif]", ...a);

function admin() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    return createAdminClient();
  } catch {
    return null;
  }
}
type Admin = NonNullable<ReturnType<typeof admin>>;

export function appOrigin(fallback?: string) {
  const env = process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  return (env || fallback || "").replace(/\/$/, "");
}

async function prefsFor(db: Admin, ids: string[]) {
  const map = new Map<string, Prefs>(ids.map((id) => [id, { ...DEFAULT_PREFS }]));
  if (!ids.length) return map;
  const { data } = await db.from("notification_prefs").select("*").in("user_id", ids);
  for (const p of (data ?? []) as (Prefs & { user_id: string })[]) map.set(p.user_id, { ...DEFAULT_PREFS, ...p });
  return map;
}

async function sendPush(db: Admin, userIds: string[], payload: Payload) {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv || !userIds.length) return 0;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@konten.com", pub, priv);
  const { data: subs } = await db.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth").in("user_id", userIds);
  const dead: number[] = [];
  let sent = 0;
  if (process.env.NOTIFY_DRY_RUN) {
    log("push (dry run)", (subs ?? []).length, "langganan", payload.title);
    return (subs ?? []).length;
  }
  await Promise.all(
    (subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 60 * 60 * 24 });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) dead.push(s.id); // langganan kedaluwarsa / dicabut
        else log("push gagal", code, (e as Error).message);
      }
    })
  );
  if (dead.length) await db.from("push_subscriptions").delete().in("id", dead);
  return sent;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function emailHtml(heading: string, lines: string[], cta: string, url: string) {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:Inter,Segoe UI,Arial,sans-serif">
  <div style="max-width:520px;margin:24px auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e4e4e7">
    <div style="padding:16px 24px;background:linear-gradient(110deg,#b91c1c,#ef4444 45%,#f97316 85%,#fbbf24);color:#fff;font-weight:700;font-size:15px">CS Tracker · Konten.com</div>
    <div style="padding:24px">
      <h2 style="margin:0 0 12px;font-size:18px;color:#18181b">${esc(heading)}</h2>
      ${lines.map((l) => `<p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#3f3f46;white-space:pre-wrap">${esc(l)}</p>`).join("")}
      <a href="${url}" style="display:inline-block;margin-top:12px;padding:10px 18px;border-radius:10px;background:#ea580c;color:#fff;text-decoration:none;font-weight:600;font-size:14px">${esc(cta)}</a>
    </div>
    <div style="padding:12px 24px;border-top:1px solid #f4f4f5;font-size:12px;color:#a1a1aa">Atur notifikasi di halaman Akun &rarr; Notifikasi.</div>
  </div></body></html>`;
}

type Mail = { to: string; subject: string; html: string };

/** Email lewat akun Gmail / Google Workspace (SMTP + App Password) — tanpa perlu setting DNS */
async function sendViaSmtp(list: Mail[]) {
  const user = process.env.SMTP_USER!;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: { user, pass: (process.env.SMTP_PASS || "").replace(/\s+/g, "") }, // App Password boleh ditempel dengan spasi
  });
  const from = process.env.EMAIL_FROM || `CS Tracker <${user}>`;
  let sent = 0;
  for (const m of list) {
    try {
      await transporter.sendMail({ from, to: m.to, subject: m.subject, html: m.html });
      sent++;
    } catch (e) {
      log("email gagal", m.to, (e as Error).message.slice(0, 200));
      if (/Invalid login|Username and Password not accepted|535/i.test((e as Error).message)) break; // salah password: berhenti
    }
  }
  transporter.close();
  return sent;
}

/** Email lewat Resend (butuh domain terverifikasi) */
async function sendViaResend(list: Mail[]) {
  const from = process.env.EMAIL_FROM || "CS Tracker <onboarding@resend.dev>";
  let sent = 0;
  for (let i = 0; i < list.length; i += 100) {
    const batch = list.slice(i, i + 100).map((m) => ({ from, to: [m.to], subject: m.subject, html: m.html }));
    const r = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(batch),
    });
    if (r.ok) sent += batch.length;
    else log("email gagal", r.status, (await r.text()).slice(0, 300));
  }
  return sent;
}

/** Pakai Resend kalau RESEND_API_KEY diisi, kalau tidak pakai Gmail (SMTP_USER + SMTP_PASS). Tidak ada keduanya = email dilewati. */
async function sendEmails(list: Mail[]) {
  const useResend = !!process.env.RESEND_API_KEY;
  const useSmtp = !!process.env.SMTP_USER && !!process.env.SMTP_PASS;
  if ((!useResend && !useSmtp) || !list.length) return 0;
  if (process.env.NOTIFY_DRY_RUN) {
    log(`email (dry run, ${useResend ? "resend" : "smtp"})`, list.map((l) => `${l.to}: ${l.subject}`));
    return list.length;
  }
  return useResend ? sendViaResend(list) : sendViaSmtp(list);
}

/** Hot Issue baru -> semua orang (kecuali yang input) sesuai pengaturan masing-masing */
export async function notifyNewIssue(issueId: number, actorId: string, origin: string) {
  const db = admin();
  if (!db) return log("lewati: SUPABASE_SERVICE_ROLE_KEY belum di-set");
  const { data: issue } = await db.from("issues").select("id, title, category, priority, description, created_by").eq("id", issueId).maybeSingle();
  if (!issue) return;
  const { data: people } = await db.from("profiles").select("id, email, full_name");
  const actor = (people ?? []).find((p) => p.id === actorId);
  const others = (people ?? []).filter((p) => p.id !== actorId);
  const prefs = await prefsFor(db, others.map((p) => p.id));
  const url = `${appOrigin(origin)}/issues/${issue.id}`;
  const who = actor?.full_name || "Seseorang";
  const urgent = issue.priority === "urgent" || issue.priority === "high" ? " ❗" : "";

  const pushed = await sendPush(
    db,
    others.filter((p) => prefs.get(p.id)!.push_issue).map((p) => p.id),
    { title: `🔥 Hot Issue baru · ${issue.category}${urgent}`, body: `${issue.title}\noleh ${who}`, url, tag: `issue-${issue.id}` }
  );
  const emailed = await sendEmails(
    others
      .filter((p) => p.email && prefs.get(p.id)!.email_issue)
      .map((p) => ({
        to: p.email as string,
        subject: `[CS Tracker] Hot Issue baru: ${issue.title}`,
        html: emailHtml(
          issue.title,
          [`Kategori: ${issue.category} · Prioritas: ${issue.priority}`, `Diinput oleh ${who}.`, ...(issue.description ? [String(issue.description).slice(0, 600)] : [])],
          "Buka issue",
          url
        ),
      }))
  );
  log(`issue #${issueId}: push ${pushed}, email ${emailed}`);
}

/**
 * Laporan clipper baru di topik yang sudah ada:
 *  - push ke PIC + pembuat topik (sesuai pengaturan "Hot Issue baru")
 *  - kalau laporan ini membuat topik tembus batas HOT -> push + email ke semua (seperti Hot Issue baru)
 */
export async function notifyNewReport(reportId: number, actorId: string, origin: string) {
  const db = admin();
  if (!db) return log("lewati: SUPABASE_SERVICE_ROLE_KEY belum di-set");
  const { data: rep } = await db.from("issue_reports").select("id, issue_id, note").eq("id", reportId).maybeSingle();
  if (!rep) return;
  const [{ data: issue }, { count }, { data: people }] = await Promise.all([
    db.from("issues").select("id, title, category, pic_id, created_by, is_hot, status").eq("id", rep.issue_id).maybeSingle(),
    db.from("issue_reports").select("id", { count: "exact", head: true }).eq("issue_id", rep.issue_id),
    db.from("profiles").select("id, email, full_name"),
  ]);
  if (!issue) return;
  const total = 1 + (count ?? 0);
  const threshold = Math.max(2, Number(process.env.NEXT_PUBLIC_REPORT_HOT_THRESHOLD) || 3);
  const becameHot = total === threshold && !issue.is_hot && issue.status !== "resolved";
  const actor = (people ?? []).find((p) => p.id === actorId);
  const who = actor?.full_name || "Seseorang";
  const url = `${appOrigin(origin)}/issues/${issue.id}#laporan`;
  const others = (people ?? []).filter((p) => p.id !== actorId);
  const prefs = await prefsFor(db, others.map((p) => p.id));
  const note = String(rep.note ?? "").slice(0, 140);

  if (becameHot) {
    const pushed = await sendPush(
      db,
      others.filter((p) => prefs.get(p.id)!.push_issue).map((p) => p.id),
      { title: `🔥 Topik jadi HOT · ${total} laporan`, body: `${issue.title}\nlaporan terbaru dari ${who}`, url, tag: `issue-${issue.id}` }
    );
    const emailed = await sendEmails(
      others
        .filter((p) => p.email && prefs.get(p.id)!.email_issue)
        .map((p) => ({
          to: p.email as string,
          subject: `[CS Tracker] 🔥 Topik jadi HOT (${total} laporan): ${issue.title}`,
          html: emailHtml(
            issue.title,
            [`Kategori: ${issue.category}`, `Sudah ${total} laporan clipper untuk kasus yang sama. Laporan terbaru dari ${who}.`, ...(note ? [note] : [])],
            "Buka topik",
            url
          ),
        }))
    );
    return log(`laporan #${reportId}: topik #${issue.id} jadi HOT · push ${pushed}, email ${emailed}`);
  }

  const owners = [...new Set([issue.pic_id, issue.created_by].filter((x): x is string => !!x && x !== actorId))];
  const pushed = await sendPush(
    db,
    owners.filter((id) => prefs.get(id)?.push_issue),
    { title: `📣 Laporan ke-${total} · ${issue.category}`, body: `${issue.title}\n${who}${note ? `: ${note}` : ""}`, url, tag: `issue-${issue.id}` }
  );
  log(`laporan #${reportId}: push ${pushed}`);
}

/**
 * Pesan chat baru:
 *  - yang di-mention / dibalas pesannya -> push khusus "@ … menyebut kamu" (walau notifikasi room dimatikan)
 *    + email kalau sedang offline (maks 1 email / 15 menit per room)
 *  - anggota lain -> push biasa sesuai pengaturan (room / pesan pribadi)
 *  - pesan pribadi + penerima offline -> email (maks 1 / 15 menit)
 */
export async function notifyChat(messageId: number, origin: string) {
  const db = admin();
  if (!db) return log("lewati: SUPABASE_SERVICE_ROLE_KEY belum di-set");
  const { data: m } = await db.from("chat_messages").select("*").eq("id", messageId).maybeSingle();
  if (!m) return;
  const [{ data: room }, { data: members }, { data: people }, { count: fileCount }, { data: replied }] = await Promise.all([
    db.from("chat_rooms").select("id, name, kind").eq("id", m.room_id).maybeSingle(),
    db.from("chat_members").select("user_id, last_read_at, last_emailed_at").eq("room_id", m.room_id),
    db.from("profiles").select("id, email, full_name, last_seen_at"),
    db.from("attachments").select("id", { count: "exact", head: true }).eq("chat_message_id", m.id),
    m.reply_to ? db.from("chat_messages").select("sender_id").eq("id", m.reply_to).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!room) return;
  const sender = (people ?? []).find((p) => p.id === m.sender_id);
  const senderName = sender?.full_name || "Seseorang";
  const memberSet = new Set((members ?? []).map((x) => x.user_id));
  const targets = (people ?? []).filter((p) => p.id !== m.sender_id && (room.kind === "public" || memberSet.has(p.id)));
  const prefs = await prefsFor(db, targets.map((p) => p.id));
  const direct = room.kind === "direct";
  const text = m.body?.trim() || (fileCount ? `📎 ${fileCount} lampiran` : "");
  const url = `${appOrigin(origin)}/chat?room=${room.id}`;
  const now = Date.now();
  const memOf = (id: string) => (members ?? []).find((x) => x.user_id === id);
  const canEmail = (p: (typeof targets)[number]) => {
    const mem = memOf(p.id);
    const recentlyEmailed = mem?.last_emailed_at && now - new Date(mem.last_emailed_at).getTime() < 15 * 60000;
    const alreadyRead = mem?.last_read_at && mem.last_read_at >= m.created_at;
    return !!p.email && !isOnline(p.last_seen_at as string | null) && !recentlyEmailed && !alreadyRead;
  };

  // siapa yang disebut / dibalas (khusus room; di pesan pribadi semua pesan sudah dikabari)
  const replyAuthor = (replied as { sender_id: string | null } | null)?.sender_id ?? null;
  const tagged = new Map<string, "mention" | "reply">();
  if (!direct) {
    for (const p of targets) {
      if (m.mention_all || (m.mentions ?? []).includes(p.id)) tagged.set(p.id, "mention");
      else if (p.id === replyAuthor) tagged.set(p.id, "reply");
    }
  }
  const tagWho = m.mention_all ? "semua" : "kamu";

  let pushed = 0;
  // 1) yang di-mention / dibalas
  const mentionPush = targets.filter((p) => tagged.has(p.id) && prefs.get(p.id)!.push_mention);
  for (const kind of ["mention", "reply"] as const) {
    const ids = mentionPush.filter((p) => tagged.get(p.id) === kind).map((p) => p.id);
    if (!ids.length) continue;
    pushed += await sendPush(db, ids, {
      title: kind === "mention" ? `@ ${senderName} menyebut ${tagWho} · #${room.name}` : `↩︎ ${senderName} membalas pesanmu · #${room.name}`,
      body: text.slice(0, 180),
      url,
      tag: `chat-${room.id}`,
    });
  }
  // 2) anggota lain: push biasa
  pushed += await sendPush(
    db,
    targets.filter((p) => !tagged.has(p.id) && (direct ? prefs.get(p.id)!.push_dm : prefs.get(p.id)!.push_room)).map((p) => p.id),
    {
      title: direct ? `💬 ${senderName}` : `💬 ${senderName} · #${room.name}`,
      body: text.slice(0, 180),
      url,
      tag: `chat-${room.id}`,
    }
  );

  // 3) email
  const due = direct
    ? targets.filter((p) => prefs.get(p.id)!.email_dm && canEmail(p))
    : targets.filter((p) => tagged.has(p.id) && prefs.get(p.id)!.email_mention && canEmail(p));
  const emailed = await sendEmails(
    due.map((p) => {
      const kind = tagged.get(p.id);
      const heading = direct
        ? `Pesan baru dari ${senderName}`
        : kind === "reply"
          ? `${senderName} membalas pesanmu di #${room.name}`
          : `${senderName} menyebut ${tagWho} di #${room.name}`;
      return {
        to: p.email as string,
        subject: `[CS Tracker] ${heading}`,
        html: emailHtml(heading, [text.slice(0, 1000) || "(lampiran)"], "Balas di CS Tracker", url),
      };
    })
  );
  if (due.length && emailed) {
    // catat waktu email (baris anggota dibuat kalau belum ada, mis. di room publik)
    await db.from("chat_members").upsert(
      due.map((p) => ({
        room_id: room.id,
        user_id: p.id,
        last_emailed_at: new Date().toISOString(),
        last_read_at: memOf(p.id)?.last_read_at ?? new Date(now - 3 * 86400000).toISOString(),
      })),
      { onConflict: "room_id,user_id" }
    );
  }
  log(`chat #${messageId}: push ${pushed}, email ${emailed}${tagged.size ? `, mention/balas ${tagged.size}` : ""}`);
}

/** Tes dari halaman Akun */
export async function notifySelfTest(userId: string, origin: string) {
  const db = admin();
  if (!db) return { error: "SUPABASE_SERVICE_ROLE_KEY belum di-set di Vercel." };
  if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return { error: "Kunci push (VAPID) belum di-set di Vercel." };
  const n = await sendPush(db, [userId], { title: "✅ Notifikasi CS Tracker aktif", body: "Kamu akan dapat kabar issue baru & chat di sini.", url: `${appOrigin(origin)}/akun`, tag: "test" });
  return n ? { ok: `Tes terkirim ke ${n} perangkat.` } : { error: "Belum ada perangkat yang terdaftar. Aktifkan notifikasi browser dulu." };
}
