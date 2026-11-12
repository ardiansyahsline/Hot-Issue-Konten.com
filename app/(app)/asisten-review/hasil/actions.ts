"use server";

import { revalidatePath } from "next/cache";
import { arErrorText } from "@/lib/asistenReview";
import { asistenGuard } from "@/lib/asistenReview.server";

export type UmpanBalikState = { ok?: true; error?: string };

const NOTE_MAX = 1000;
const validId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

/**
 * Umpan balik reviewer atas saran AI (Setuju / Tidak setuju + catatan) — bahan memperbaiki rubrik.
 * Satu per user per hasil (unik result_id + user_id) → disimpan ulang = diganti. RLS migration-23: milik sendiri saja.
 */
export async function simpanUmpanBalik(resultId: number, agree: boolean, note: string): Promise<UmpanBalikState> {
  const g = await asistenGuard();
  if (!g.ok) return { error: g.error };
  if (!g.ctx.ready) return { error: arErrorText({ code: "42P01" }) };
  if (!validId(resultId)) return { error: "Hasil tidak valid. Muat ulang halaman." };
  if (typeof agree !== "boolean") return { error: "Pilih Setuju atau Tidak setuju." };
  const text = (typeof note === "string" ? note : "").replace(/\r\n?/g, "\n").trim();
  if (text.length > NOTE_MAX) return { error: `Catatan maksimal ${NOTE_MAX} huruf.` };
  if (!agree && !text) return { error: "Tulis singkat kenapa tidak setuju (untuk memperbaiki AI)." };

  const { supabase, user } = g.ctx;
  const { error } = await supabase
    .from("review_feedback")
    .upsert({ result_id: resultId, user_id: user.id, agree, note: text || null }, { onConflict: "result_id,user_id" });
  if (error) {
    if (error.code === "23503") return { error: "Hasil ini sudah dihapus. Muat ulang halaman." };
    return { error: arErrorText(error, "Gagal menyimpan. Coba lagi sebentar.") };
  }
  revalidatePath(`/asisten-review/hasil/${resultId}`);
  return { ok: true };
}

/** hapus umpan balik milik sendiri */
export async function hapusUmpanBalik(resultId: number): Promise<UmpanBalikState> {
  const g = await asistenGuard();
  if (!g.ok) return { error: g.error };
  if (!g.ctx.ready) return { error: arErrorText({ code: "42P01" }) };
  if (!validId(resultId)) return { error: "Hasil tidak valid. Muat ulang halaman." };
  const { supabase, user } = g.ctx;
  const { error } = await supabase.from("review_feedback").delete().eq("result_id", resultId).eq("user_id", user.id);
  if (error) return { error: arErrorText(error, "Gagal menghapus. Coba lagi sebentar.") };
  revalidatePath(`/asisten-review/hasil/${resultId}`);
  return { ok: true };
}
