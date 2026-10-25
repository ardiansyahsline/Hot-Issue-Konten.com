import { NextResponse } from "next/server";
import { studioGuard } from "@/lib/studio/access.server";
import { cleanStoragePath, signedStudioUrl, studioCanRead } from "@/lib/studio/storage.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * File di bucket privat "studio" -> dialihkan (302) ke signed URL 1 jam.
 * Izin dicek dulu dengan aturan RLS studio_read (admin semua; voices/ sfx/ tts/ vo/; uploads/<id sendiri>/; renders/ milik sendiri),
 * lalu service role kalau ada; kalau tidak, pakai client user (RLS studio_read).
 */
export async function GET(req: Request) {
  const g = await studioGuard();
  if (!g.ok) return g.res;

  const p = cleanStoragePath(new URL(req.url).searchParams.get("p"));
  if (!p) return NextResponse.json({ error: "Alamat file tidak valid." }, { status: 400, headers: { "Cache-Control": "no-store" } });

  const gone = () => NextResponse.json({ error: "File tidak ditemukan atau sudah dihapus." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  // file milik user lain -> 404 (service role tidak boleh menandatangani path yang tidak boleh dibaca user ini)
  if (!(await studioCanRead(p, g.supabase, g.user.id, g.profile?.role === "admin"))) return gone();

  const url = await signedStudioUrl(p, g.supabase, 3600);
  if (!url) return gone();

  // boleh di-cache browser sebentar (di bawah masa berlaku signed URL) supaya seek audio tidak minta tanda tangan baru terus
  return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "private, max-age=1800" } });
}
