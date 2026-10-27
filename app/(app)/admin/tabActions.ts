"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { normalizeTabs, tabErrorText, type TabId } from "@/lib/tabs";

export type TabSaveState = { ok?: true; error?: string; blocked?: TabId[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Simpan daftar tab yang DITUTUP untuk satu user (Admin → Akses tab per user). Dipanggil tiap klik chip.
 * Kosong = semua dibuka -> barisnya dihapus (sama dengan bawaan). Admin tidak bisa dibatasi.
 */
export async function saveTabBlocks(userId: string, blocked: string[]): Promise<TabSaveState> {
  const { supabase, user } = await requireAdmin();
  if (typeof userId !== "string" || !UUID.test(userId)) return { error: "User tidak valid. Muat ulang halaman." };
  const list = normalizeTabs(blocked);

  const { data: target, error: tErr } = await supabase.from("profiles").select("id, role").eq("id", userId).maybeSingle();
  if (tErr) return { error: tabErrorText(tErr) };
  if (!target) return { error: "User tidak ditemukan. Muat ulang halaman." };
  if (target.role === "admin") return { error: "Admin selalu bisa membuka semua tab." };

  const { error } = list.length
    ? // updated_at & updated_by juga diisi trigger database
      await supabase.from("user_tab_blocks").upsert({ user_id: userId, blocked: list, updated_by: user.id }, { onConflict: "user_id" })
    : await supabase.from("user_tab_blocks").delete().eq("user_id", userId);
  if (error) return { error: tabErrorText(error) };
  // cache halaman Admin di browser (staleTimes 30 dtk) ikut dibuang -> buka lagi tidak menampilkan isi lama
  revalidatePath("/admin");
  return { ok: true, blocked: list };
}
