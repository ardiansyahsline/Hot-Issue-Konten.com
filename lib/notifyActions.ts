"use server";

import { after } from "next/server";
import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { assertTab } from "@/lib/tabs.server";
import { notifyChat, notifySelfTest } from "@/lib/notify.server";
import { normalizeSoundPrefs, type SoundPrefs } from "@/lib/sounds";

async function originFromRequest() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : "";
}

/** Dipanggil browser setelah pesan terkirim; pengiriman notifikasi berjalan di belakang (tidak bikin chat lambat) */
export async function notifyChatMessage(messageId: number) {
  if (!Number.isInteger(messageId)) return;
  if (!(await assertTab("chat")).ok) return;
  const { supabase, user } = await getCurrentUser();
  // pastikan pesan ini memang milik user yang login
  const { data } = await supabase.from("chat_messages").select("id").eq("id", messageId).eq("sender_id", user.id).maybeSingle();
  if (!data) return;
  const origin = await originFromRequest();
  after(() => notifyChat(messageId, origin).catch((e) => console.log("[notif] error", e)));
}

export type PushSub = { endpoint: string; keys: { p256dh: string; auth: string } };

export async function savePushSubscription(sub: PushSub, userAgent: string) {
  if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) return { error: "Langganan tidak valid" };
  const { supabase, user } = await getCurrentUser();
  // perangkat yang sama dipakai akun lain sebelumnya -> pindahkan ke akun ini
  await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  const { error } = await supabase.from("push_subscriptions").insert({
    user_id: user.id,
    endpoint: sub.endpoint,
    p256dh: sub.keys.p256dh,
    auth: sub.keys.auth,
    user_agent: userAgent.slice(0, 300),
  });
  if (error) return { error: /push_subscriptions/.test(error.message) ? "Notifikasi belum aktif (migration-09 belum dijalankan)." : error.message };
  return { ok: "Notifikasi browser aktif di perangkat ini." };
}

export async function removePushSubscription(endpoint: string) {
  const { supabase } = await getCurrentUser();
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  return { ok: "Notifikasi browser dimatikan di perangkat ini." };
}

export type NotifPrefs = {
  push_issue: boolean;
  push_dm: boolean;
  push_room: boolean;
  push_mention: boolean;
  email_issue: boolean;
  email_dm: boolean;
  email_mention: boolean;
};

export async function saveNotifPrefs(p: NotifPrefs) {
  const { supabase, user } = await getCurrentUser();
  const row = {
    user_id: user.id,
    push_issue: !!p.push_issue,
    push_dm: !!p.push_dm,
    push_room: !!p.push_room,
    email_issue: !!p.email_issue,
    email_dm: !!p.email_dm,
    push_mention: p.push_mention !== false,
    email_mention: p.email_mention !== false,
    updated_at: new Date().toISOString(),
  };
  let { error } = await supabase.from("notification_prefs").upsert(row, { onConflict: "user_id" });
  if (error && /mention/.test(error.message)) {
    // migration-10 belum dijalankan -> simpan tanpa pengaturan mention
    const { push_mention: _a, email_mention: _b, ...old } = row;
    ({ error } = await supabase.from("notification_prefs").upsert(old, { onConflict: "user_id" }));
  }
  if (error) return { error: /notification_prefs/.test(error.message) ? "Notifikasi belum aktif (migration-09 belum dijalankan)." : error.message };
  return { ok: "Pengaturan disimpan." };
}

export async function sendTestPush() {
  const { user } = await getCurrentUser();
  return notifySelfTest(user.id, await originFromRequest());
}

export async function saveSoundPrefs(p: SoundPrefs) {
  const { supabase, user } = await getCurrentUser();
  const s = normalizeSoundPrefs(p);
  const { error } = await supabase
    .from("notification_prefs")
    .upsert({ user_id: user.id, ...s, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error)
    return {
      error: /sound_|notification_prefs/.test(error.message)
        ? "Pilihan bunyi belum bisa disimpan — admin perlu menjalankan migration-12-bunyi-notif.sql. Untuk sementara pilihanmu tersimpan di browser ini."
        : error.message,
    };
  return { ok: "Bunyi disimpan." };
}
