import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { getCurrentUser, getProfile } from "@/lib/auth";
import type { Profile } from "@/lib/types";

/**
 * Akses tab "Asisten Review (Uji)": admin, atau user yang dibuka admin (user_tab_blocks.granted berisi 'asisten_review').
 * Sumber kebenaran = fungsi database can_use_asisten_review() (migration-23) — sama dengan RLS semua tabel review_*.
 * Fungsi belum ada (migration-23 belum dijalankan) → hanya admin (supaya admin bisa melihat pesan "jalankan migration-23").
 * Pemilik perubahan: web-lain. Dipakai juga web-hasil (halaman Hasil & Ringkasan).
 */

type DB = Awaited<ReturnType<typeof getCurrentUser>>["supabase"];

export type ArCtx = {
  supabase: DB;
  user: { id: string; email: string };
  profile: Profile | null;
  admin: boolean;
  /** false = migration-23 belum dijalankan (fungsi / tabel belum ada) */
  ready: boolean;
};

const missing = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "42883" || e.code === "PGRST202" || e.code === "42P01" || e.code === "PGRST205" || /schema cache|does not exist/i.test(e.message ?? ""));

/** cek akses sekali per request (React cache) */
export const getArAccess = cache(async (): Promise<{ ok: boolean; ctx: ArCtx }> => {
  const [{ supabase, user }, profile] = await Promise.all([getCurrentUser(), getProfile()]);
  const admin = profile?.role === "admin";
  let ok = admin;
  let ready = true;
  try {
    const { data, error } = await supabase.rpc("can_use_asisten_review");
    if (error) {
      if (missing(error)) ready = false;
      else console.error("[asisten-review] gagal cek akses:", error.code, error.message);
    } else ok = admin || data === true;
  } catch (e) {
    console.error("[asisten-review] gagal cek akses:", e);
  }
  return { ok, ctx: { supabase, user, profile, admin, ready } };
});

/** untuk halaman (server component): tidak boleh → kembali ke beranda dengan pesan */
export async function requireAsisten(): Promise<ArCtx> {
  const a = await getArAccess();
  if (!a.ok) redirect("/?tutup=asisten_review");
  return a.ctx;
}

/** untuk server action & route API: { ok:false } berisi pesan awam + Response 403 JSON */
export async function asistenGuard(): Promise<({ ok: true } | { ok: false; error: string; res: Response }) & { ctx: ArCtx }> {
  const a = await getArAccess();
  if (a.ok) return { ok: true, ctx: a.ctx };
  const error = "Tab Asisten Review (Uji) belum dibuka admin untuk akunmu.";
  return { ok: false, error, ctx: a.ctx, res: NextResponse.json({ error }, { status: 403, headers: { "Cache-Control": "no-store" } }) };
}
