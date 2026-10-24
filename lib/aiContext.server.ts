import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { HOT_THRESHOLD, REPORT_HOT_THRESHOLD } from "@/lib/constants";

type DB = Awaited<ReturnType<typeof createClient>>;

/**
 * pertanyaan yang kemungkinan butuh data CS Tracker — hanya kata benda khas website ini.
 * Kata umum (hari ini, rangkum, saran, terbanyak…) TIDAK cukup sendirian, supaya pertanyaan seperti
 * "ada saran saham hari ini?" tidak ikut membawa data internal.
 */
const ABOUT_SITE =
  /\b(hot ?issues?|isu|issue|laporan|lapor(an)? clipper|kasus|video ?review|vr|catatan|kotak saran|saran (tim|cs|clipper|user)|dashboard|pic|clipper|campaign|banding|withdraw|payout|cs tracker|tim cs|agent cs|resolved|keluhan|bug|topik issue|kategori issue)\b/i;

export const looksAboutSite = (text: string) => ABOUT_SITE.test(text);

/** buang kontak pribadi (no HP, email, @username, link) sebelum dikirim ke AI */
export function scrub(s: string | null | undefined, max = 160) {
  return String(s ?? "")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
    .replace(/https?:\/\/\S+|www\.\S+/gi, "[link]")
    .replace(/(\+?62|0)8[\d\s-]{7,14}\d/g, "[no HP]")
    .replace(/\+?\d[\d\s-]{9,}\d/g, "[nomor]")
    .replace(/(^|\s)@[\w.]{2,}/g, "$1[akun]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const wib = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }).format(new Date(iso)) : "-";
const dayWib = (ms: number) => new Date(ms + 7 * 3600 * 1000).toISOString().slice(0, 10);

/**
 * Ringkasan data CS Tracker untuk AI (memakai izin user yang login).
 * Tidak berisi kontak clipper / isi chat.
 */
export async function buildSiteContext(supabase: DB): Promise<string> {
  const now = Date.now();
  const d7 = dayWib(now - 6 * 86400000);
  const d30 = dayWib(now - 29 * 86400000);
  const iso14 = new Date(now - 14 * 86400000).toISOString();

  const [active, resolved, reports, vr, sg, activeTotal] = await Promise.all([
    supabase
      .from("issue_list")
      .select("id, title, description, category, status, priority, is_hot, report_count, max_contact_reports_30d, pic_name, campaign, created_at, updated_at")
      .neq("status", "resolved")
      .order("updated_at", { ascending: false })
      .limit(60),
    supabase
      .from("issue_list")
      .select("id, title, category, report_count, pic_name, resolved_at")
      .eq("status", "resolved")
      .order("resolved_at", { ascending: false })
      .limit(15),
    supabase.from("issue_reports").select("issue_id, note, created_at").gte("created_at", iso14).order("created_at", { ascending: false }).limit(200),
    supabase.from("video_reviews").select("report_date, category, status, explanation").gte("report_date", d30).order("report_date", { ascending: false }).limit(1500),
    supabase.from("suggestions").select("id, title, category, status, created_at").order("created_at", { ascending: false }).limit(25),
    supabase.from("issue_list").select("id", { count: "exact", head: true }).neq("status", "resolved"),
  ]);

  const out: string[] = [];
  // jam dibulatkan (bukan menit) supaya blok data sama persis antar-pesan -> bisa di-cache provider
  const asOf = new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", hour: "2-digit", timeZone: "Asia/Jakarta" }).format(new Date(now));
  out.push(`=== DATA CS TRACKER (data per ${asOf}.00 WIB; kontak clipper disensor) ===`);

  // Hot Issue aktif
  const act = (active.data ?? []) as {
    id: number; title: string; description: string | null; category: string; status: string; priority: string; is_hot: boolean;
    report_count: number | null; max_contact_reports_30d: number; pic_name: string | null; campaign: string | null; created_at: string; updated_at: string;
  }[];
  const hot = (i: (typeof act)[number]) => i.is_hot || i.max_contact_reports_30d >= HOT_THRESHOLD || (i.report_count ?? 1) >= REPORT_HOT_THRESHOLD;
  act.sort((a, b) => Number(hot(b)) - Number(hot(a)) || (b.report_count ?? 1) - (a.report_count ?? 1));
  const total = activeTotal.count ?? act.length;
  out.push(`\n## Hot Issue AKTIF (total ${total} di database, ${act.length} ditampilkan${total > act.length ? " — yang lain tidak ikut terkirim" : ""}; open + in progress; "laporan" = jumlah clipper yang melaporkan kasus yang sama)`);
  for (const i of act) {
    out.push(
      `- #${i.id} ${scrub(i.title, 120)} | ${i.category} | ${i.status} | prioritas ${i.priority} | ${i.report_count ?? 1} laporan${hot(i) ? " | HOT" : ""} | PIC ${i.pic_name ?? "-"}${i.campaign ? ` | campaign ${scrub(i.campaign, 60)}` : ""} | dibuat ${wib(i.created_at)} | update ${wib(i.updated_at)}${i.description ? ` | ${scrub(i.description, 140)}` : ""}`
    );
  }

  const res = (resolved.data ?? []) as { id: number; title: string; category: string; report_count: number | null; pic_name: string | null; resolved_at: string | null }[];
  if (res.length) {
    out.push(`\n## Hot Issue yang baru RESOLVED (15 terakhir)`);
    for (const i of res) out.push(`- #${i.id} ${scrub(i.title, 100)} | ${i.category} | ${i.report_count ?? 1} laporan | PIC ${i.pic_name ?? "-"} | selesai ${wib(i.resolved_at)}`);
  }

  // laporan tambahan 14 hari
  const reps = (reports.data ?? []) as { issue_id: number; note: string; created_at: string }[];
  if (reps.length) {
    const by = new Map<number, number>();
    for (const r of reps) by.set(r.issue_id, (by.get(r.issue_id) ?? 0) + 1);
    out.push(`\n## Laporan tambahan 14 hari terakhir (per topik): ${[...by.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => `#${id}: ${n}`).join(", ")}`);
    for (const r of reps.slice(0, 12)) if (r.note) out.push(`- #${r.issue_id} ${wib(r.created_at)}: ${scrub(r.note, 120)}`);
  }

  // Video Review
  const v = (vr.data ?? []) as { report_date: string; category: string | null; status: string; explanation: string }[];
  if (v.length) {
    const agg = (rows: typeof v) => {
      const m = new Map<string, { n: number; st: Map<string, number> }>();
      for (const r of rows) {
        const k = r.category ?? "(belum dikategorikan)";
        const e = m.get(k) ?? { n: 0, st: new Map() };
        e.n++;
        e.st.set(r.status, (e.st.get(r.status) ?? 0) + 1);
        m.set(k, e);
      }
      return [...m.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, e]) => `${k}: ${e.n} (${[...e.st.entries()].map(([s, n]) => `${s} ${n}`).join(", ")})`);
    };
    const v7 = v.filter((r) => r.report_date >= d7);
    out.push(`\n## Video Review 7 hari terakhir (${d7} s/d hari ini): total ${v7.length} kasus`);
    for (const l of agg(v7)) out.push(`- ${l}`);
    out.push(`\n## Video Review 30 hari terakhir (sejak ${d30}): total ${v.length} kasus`);
    for (const l of agg(v).slice(0, 15)) out.push(`- ${l}`);
    out.push(`\n## 20 kasus Video Review terbaru`);
    for (const r of v.slice(0, 20)) out.push(`- ${r.report_date} | ${r.category ?? "-"} | ${r.status} | ${scrub(r.explanation, 110)}`);
  }

  // Catatan & Saran
  const s = (sg.data ?? []) as { id: number; title: string; category: string; status: string; created_at: string }[];
  if (s.length) {
    out.push(`\n## Catatan & Saran terbaru (25)`);
    for (const x of s) out.push(`- #${x.id} ${scrub(x.title, 100)} | ${x.category} | ${x.status} | ${wib(x.created_at)}`);
  }

  out.push(`\n=== AKHIR DATA. Jawab pertanyaan soal CS Tracker HANYA berdasarkan data di atas; kalau datanya tidak ada, bilang tidak ada. Sebut nomor issue (#id) kalau relevan. ===`);
  return out.join("\n").slice(0, 16000);
}
