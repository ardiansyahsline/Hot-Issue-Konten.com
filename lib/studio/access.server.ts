import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { UID_HEADER } from "@/lib/authHeaders";
import { getCurrentUser, getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

/**
 * Akses Studio: admin selalu boleh, user lain hanya kalau diberi akses admin (tabel studio_access, maks 3 orang).
 * Semua cek di SERVER. RLS & fungsi can_use_studio() di database menjaga lapis kedua.
 */

/** maksimal user non-admin yang boleh memakai Studio (sama dengan trigger studio_access_limit) */
export const STUDIO_MAX = 3;

export type StudioUser = { id: string; email: string };
export type StudioCtx = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: StudioUser;
  profile: Profile | null;
};

/**
 * User + profile TANPA redirect (null = belum login), jadi aman dipakai di route API.
 * Kalau middleware sudah memverifikasi (header UID ada), pakai cache lib/auth supaya tidak query dobel dengan layout.
 */
const studioCtx = cache(async (): Promise<StudioCtx | null> => {
  const h = await headers();
  if (h.get(UID_HEADER)) {
    // header ada -> getCurrentUser tidak akan redirect
    const [{ supabase, user }, profile] = await Promise.all([getCurrentUser(), getProfile()]);
    return { supabase, user, profile };
  }
  // cadangan (mis. path di luar matcher middleware): cek token sendiri
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (!sub) return null;
  const user = { id: String(sub), email: String(data?.claims?.email ?? "") };
  const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  return { supabase, user, profile: (p as Profile | null) ?? null };
});

/** baris studio_access milik user sendiri (RLS: user hanya bisa baca barisnya). Tabel belum ada / error -> false */
async function hasRow({ supabase, user }: StudioCtx) {
  try {
    const { data, error } = await supabase.from("studio_access").select("user_id").eq("user_id", user.id).maybeSingle();
    return !error && !!data;
  } catch {
    return false;
  }
}

/** Boleh pakai Studio? (admin, atau diberi akses). Di-cache per request. */
export const canUseStudio = cache(async (): Promise<boolean> => {
  const ctx = await studioCtx();
  if (!ctx) return false;
  if (ctx.profile?.role === "admin") return true;
  return hasRow(ctx);
});

/** Untuk halaman: belum login -> /login, tidak punya akses -> beranda */
export async function requireStudio(): Promise<StudioCtx> {
  const ctx = await studioCtx();
  if (!ctx) redirect("/login");
  if (!(await canUseStudio())) redirect("/");
  return ctx;
}

const deny = (status: number, error: string) =>
  NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Untuk route API (tanpa redirect). Pakai:
 *   const g = await studioGuard(); if (!g.ok) return g.res;  // lalu g.supabase, g.user, g.profile
 */
export async function studioGuard(): Promise<({ ok: true } & StudioCtx) | { ok: false; res: Response }> {
  let ctx: StudioCtx | null;
  try {
    ctx = await studioCtx();
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, res: deny(503, "Layanan login sedang bermasalah. Coba lagi sebentar.") };
  }
  if (!ctx) return { ok: false, res: deny(401, "Belum login") };
  if (!(await canUseStudio())) return { ok: false, res: deny(403, "Studio hanya untuk admin & user yang diberi akses.") };
  return { ok: true, ...ctx };
}

/** Error Supabase seputar akses Studio -> kalimat awam */
export function studioErrorText(e: { code?: string; message?: string } | null | undefined): string {
  const code = e?.code ?? "";
  const msg = e?.message ?? "";
  // pesan dari trigger studio_access_limit
  if (/maksimal/i.test(msg)) return `Akses Studio sudah penuh (maksimal ${STUDIO_MAX} orang). Cabut salah satu dulu.`;
  if (/otomatis punya akses/i.test(msg)) return "Admin sudah otomatis punya akses Studio.";
  if (code === "42501" || /row-level security|permission denied/i.test(msg)) return "Hanya admin yang boleh mengatur akses Studio.";
  if (code === "42P01" || code === "PGRST205" || /schema cache|does not exist/i.test(msg))
    return "Jalankan supabase/migration-20-studio.sql dulu di Supabase.";
  if (code === "23505") return "User ini sudah punya akses Studio.";
  if (code === "23503") return "User tidak ditemukan. Muat ulang halaman.";
  return "Gagal menyimpan. Coba lagi sebentar.";
}
