import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { getCurrentUser, getProfile } from "@/lib/auth";
import type { Profile } from "@/lib/types";
import { closedRedirect, normalizeTabs, tabClosedText, type TabId } from "@/lib/tabs";

/**
 * Akses tab per user (diatur admin). Cek di SERVER: halaman (requireTab / startTab), server action & route API (assertTab / tabDenied).
 * Batas data juga dijaga database (RLS migration-22), jadi ini lapisan menu, halaman & pesan ramah.
 * Tabel belum ada (migration-22 belum dijalankan) -> tidak ada yang ditutup (perilaku lama).
 */

export type TabAccess = {
  admin: boolean;
  blocked: ReadonlySet<TabId>;
  /** profile user (sekalian diambil, supaya action/route tidak perlu ambil lagi) */
  profile: Profile | null;
  /** false = daftar tab gagal dicek (error sementara) -> dianggap terbuka; browser tidak memakai hasil ini */
  sure: boolean;
};

type DB = Awaited<ReturnType<typeof getCurrentUser>>["supabase"];

/** tabel user_tab_blocks belum dibuat (migration-22 belum dijalankan) */
const missingTable = (e: { code?: string; message?: string }) =>
  e.code === "42P01" || e.code === "PGRST205" || /schema cache|does not exist/i.test(e.message ?? "");

/** Daftar tab yang ditutup untuk user ini. Tabel belum ada -> []. Error lain -> coba sekali lagi, tetap gagal -> null (+ log). */
async function fetchBlocked(supabase: DB, uid: string): Promise<TabId[] | null> {
  for (let i = 0; i < 2; i++) {
    try {
      // RLS: user hanya bisa membaca barisnya sendiri
      const r = await supabase.from("user_tab_blocks").select("blocked").eq("user_id", uid).maybeSingle();
      if (!r.error) return normalizeTabs((r.data as { blocked?: unknown } | null)?.blocked);
      if (missingTable(r.error)) return [];
      if (i) console.error("[akses-tab] gagal cek tab yang ditutup:", r.error.code, r.error.message);
    } catch (e) {
      if (i) console.error("[akses-tab] gagal cek tab yang ditutup:", e);
    }
  }
  return null;
}

/**
 * Tab yang ditutup untuk user yang login. Di-cache per render halaman (layout + halaman cukup 1x).
 * Catatan: React cache TIDAK berlaku di server action & route API — di sana panggil sekali lalu pakai ulang hasilnya.
 */
export const getTabAccess = cache(async (): Promise<TabAccess> => {
  const { supabase, user } = await getCurrentUser();
  const [profile, blocked] = await Promise.all([getProfile(), fetchBlocked(supabase, user.id)]);
  // admin selalu semua tab (baris lama milik admin diabaikan)
  if (profile?.role === "admin") return { admin: true, blocked: new Set(), profile, sure: true };
  // gagal dicek -> dianggap terbuka (aturan proyek); data tetap dijaga RLS di database
  return { admin: false, blocked: new Set(blocked ?? []), profile, sure: blocked !== null };
});

/**
 * Untuk halaman (server component): tab ditutup -> pindah ke tab pertama yang boleh (+ ?tutup=<tab> untuk pesan),
 * semua ditutup -> /akun?tutup=semua. `quiet` = tanpa pesan (dipakai beranda "/", mis. sesudah login).
 * Juga dipakai server action tanpa pesan (mis. ganti status): halaman basi ikut pindah, bukan diam saja.
 */
export async function requireTab(tab: TabId, opts?: { quiet?: boolean }): Promise<TabAccess> {
  const access = await getTabAccess();
  if (access.blocked.has(tab)) redirect(closedRedirect(access.blocked, opts?.quiet ? null : tab));
  return access;
}

/**
 * Seperti requireTab, tapi mulai sekarang dan ditunggu nanti BARENG query halaman (taruh di Promise.all),
 * supaya cek tab tidak menambah satu putaran ke Supabase. Pengalihan tetap terjadi saat di-await.
 */
export function startTab(tab: TabId, opts?: { quiet?: boolean }): Promise<TabAccess> {
  const p = requireTab(tab, opts);
  p.catch(() => {}); // ditangani saat di-await (hanya supaya tidak dianggap "unhandled rejection")
  return p;
}

/**
 * Untuk server action yang sudah memegang `access`: null = boleh, selain itu = pesan ramah.
 * `redirect: true` = aksi tanpa pesan (void) -> langsung dipindah ke tab yang boleh.
 */
export function tabDenied(access: TabAccess, tab: TabId, opts?: { redirect?: boolean }): string | null {
  if (!access.blocked.has(tab)) return null;
  if (opts?.redirect) redirect(closedRedirect(access.blocked, tab));
  return tabClosedText(tab);
}

export type TabCheck = ({ ok: true } | { ok: false; error: string; res: Response }) & { access: TabAccess };

/**
 * Untuk server action & route API (tanpa redirect). Pakai:
 *   const t = await assertTab("video_review"); if (!t.ok) return { error: t.error };   // server action
 *   const t = await assertTab("ai"); if (!t.ok) return t.res;                           // route API (JSON 403)
 * `t.access` bisa dipakai ulang (jangan panggil getTabAccess lagi di action/route yang sama).
 */
export async function assertTab(tab: TabId, access?: TabAccess): Promise<TabCheck> {
  const a = access ?? (await getTabAccess());
  const error = tabDenied(a, tab);
  if (!error) return { ok: true, access: a };
  return { ok: false, error, access: a, res: NextResponse.json({ error }, { status: 403, headers: { "Cache-Control": "no-store" } }) };
}
