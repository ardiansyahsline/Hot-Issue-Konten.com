"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { normalizeBlocked, normalizeGranted, tabErrorText, type TabId } from "@/lib/tabs";

export type TabSaveState = { ok?: true; error?: string; blocked?: TabId[]; granted?: TabId[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** kolom granted belum ada (migration-23 belum dijalankan) */
const missingGranted = (e: { code?: string; message?: string }) =>
  (e.code === "42703" || e.code === "PGRST204") && /granted/i.test(e.message ?? "");

/**
 * Simpan akses tab satu user (Admin → Akses tab per user). Dipanggil tiap klik chip.
 * `blocked` = tab biasa yang DITUTUP; `granted` = tab khusus (optIn, mis. Asisten Review) yang DIBUKA.
 * Dua-duanya kosong = bawaan -> barisnya dihapus. Admin tidak bisa dibatasi.
 * `granted` tidak dikirim (pemanggil lama) -> nilai granted di database tidak diubah.
 */
export async function saveTabBlocks(userId: string, blocked: string[], granted?: string[]): Promise<TabSaveState> {
  const { supabase, user } = await requireAdmin();
  if (typeof userId !== "string" || !UUID.test(userId)) return { error: "User tidak valid. Muat ulang halaman." };
  const list = normalizeBlocked(blocked);

  const { data: target, error: tErr } = await supabase.from("profiles").select("id, role").eq("id", userId).maybeSingle();
  if (tErr) return { error: tabErrorText(tErr) };
  if (!target) return { error: "User tidak ditemukan. Muat ulang halaman." };
  if (target.role === "admin") return { error: "Admin selalu bisa membuka semua tab." };

  // granted tidak dikirim -> pakai nilai yang tersimpan (kolom belum ada -> anggap kosong)
  let open: TabId[];
  let hasGranted = true;
  if (granted === undefined) {
    const cur = await supabase.from("user_tab_blocks").select("granted").eq("user_id", userId).maybeSingle();
    if (cur.error && !missingGranted(cur.error)) return { error: tabErrorText(cur.error) };
    hasGranted = !cur.error;
    open = normalizeGranted((cur.data as { granted?: unknown } | null)?.granted);
  } else open = normalizeGranted(granted);

  let error: { code?: string; message?: string } | null = null;
  if (!list.length && !open.length) {
    ({ error } = await supabase.from("user_tab_blocks").delete().eq("user_id", userId));
  } else {
    // updated_at & updated_by juga diisi trigger database
    const row: { user_id: string; blocked: TabId[]; updated_by: string; granted?: TabId[] } = { user_id: userId, blocked: list, updated_by: user.id };
    if (hasGranted) row.granted = open;
    ({ error } = await supabase.from("user_tab_blocks").upsert(row, { onConflict: "user_id" }));
    // kolom granted belum ada (migration-23 belum dijalankan): tab biasa tetap bisa disimpan
    if (error && missingGranted(error) && !open.length) {
      hasGranted = false;
      ({ error } = await supabase.from("user_tab_blocks").upsert({ user_id: userId, blocked: list, updated_by: user.id }, { onConflict: "user_id" }));
    }
  }
  if (error) return { error: tabErrorText(error) };
  // cache halaman Admin di browser (staleTimes 30 dtk) ikut dibuang -> buka lagi tidak menampilkan isi lama
  revalidatePath("/admin");
  return { ok: true, blocked: list, granted: hasGranted ? open : [] };
}
