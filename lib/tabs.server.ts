import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { getCurrentUser, getProfile } from "@/lib/auth";
import { closedRedirect, normalizeTabs, tabClosedText, type TabId } from "@/lib/tabs";

/**
 * Akses tab per user (diatur admin). Semua cek di SERVER: halaman (requireTab), server action & route API (assertTab).
 * Tabel belum ada (migration-22 belum dijalankan) / error -> dianggap tidak ada yang ditutup (perilaku lama).
 */

export type TabAccess = { admin: boolean; blocked: ReadonlySet<TabId> };

const OPEN: TabAccess = { admin: false, blocked: new Set() };

/** Tab yang ditutup untuk user yang login. Di-cache per request (layout + halaman + action cukup 1 query). */
export const getTabAccess = cache(async (): Promise<TabAccess> => {
  const { supabase, user } = await getCurrentUser();
  const [profile, row] = await Promise.all([
    getProfile(),
    // RLS: user hanya bisa membaca barisnya sendiri
    Promise.resolve(supabase.from("user_tab_blocks").select("blocked").eq("user_id", user.id).maybeSingle()).then(
      (r) => (r.error ? null : (r.data as { blocked?: unknown } | null)),
      () => null
    ),
  ]);
  // admin selalu semua tab (baris lama milik admin diabaikan)
  if (profile?.role === "admin") return { admin: true, blocked: new Set() };
  const blocked = normalizeTabs(row?.blocked);
  return blocked.length ? { admin: false, blocked: new Set(blocked) } : OPEN;
});

/** Daftar tab yang ditutup (untuk dikirim ke komponen client, mis. Nav) */
export async function closedTabs(): Promise<TabId[]> {
  return [...(await getTabAccess()).blocked];
}

export async function canTab(tab: TabId): Promise<boolean> {
  return !(await getTabAccess()).blocked.has(tab);
}

/**
 * Untuk halaman (server component): tab ditutup -> pindah ke tab pertama yang boleh (+ ?tutup=<tab> untuk pesan),
 * semua ditutup -> /akun?tutup=semua. `quiet` = tanpa pesan (dipakai beranda "/", mis. sesudah login).
 */
export async function requireTab(tab: TabId, opts?: { quiet?: boolean }): Promise<TabAccess> {
  const access = await getTabAccess();
  if (access.blocked.has(tab)) redirect(closedRedirect(access.blocked, opts?.quiet ? null : tab));
  return access;
}

export type TabCheck = { ok: true } | { ok: false; error: string; res: Response };

/**
 * Untuk server action & route API (tanpa redirect). Pakai:
 *   const t = await assertTab("video_review"); if (!t.ok) return { error: t.error };   // server action
 *   const t = await assertTab("ai"); if (!t.ok) return t.res;                           // route API (JSON 403)
 */
export async function assertTab(tab: TabId): Promise<TabCheck> {
  if (await canTab(tab)) return { ok: true };
  const error = tabClosedText(tab);
  return { ok: false, error, res: NextResponse.json({ error }, { status: 403, headers: { "Cache-Control": "no-store" } }) };
}
