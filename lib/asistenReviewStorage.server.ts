import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { AR_BUCKET } from "@/lib/asistenReview";
import type { ArCtx } from "@/lib/asistenReview.server";

/**
 * Bucket PRIVAT "asisten-review" (migration-23 §14): materi/<campaign>/(auto|manual)/<file>, laporan/<run_id>.html.
 * Akses utama = sesi user (RLS storage: baca untuk yang punya akses tab; upload/hapus hanya materi/<c>/manual/).
 * Service role HANYA cadangan (mis. hapus laporan buatan laptop) — kunci tidak di-set di Vercel → fitur itu dilewati, tanpa error.
 * Pemilik: web-lain.
 */

type Sb = ArCtx["supabase"];

export const CAMPAIGN_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** nama file upload manual (dibuat browser: <waktu>-<slug>.<ext>) */
export const NAMA_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
/** batas Supabase gratis = batas bucket (52428800) */
export const MAKS_BYTE = 50 * 1024 * 1024;

/** client service role atau null (kunci tidak ada / gagal dibuat) */
export function arAdmin(): Sb | null {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || !process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  try {
    return createAdminClient() as unknown as Sb;
  } catch {
    return null;
  }
}

export type ArPath = { jenis: "materi"; path: string; campaign: string } | { jenis: "laporan"; path: string; runId: string };

/** path dari query → hanya bentuk yang dikenal (tanpa .., tanpa garis miring dobel); selain itu null */
export function cleanArPath(raw: unknown): ArPath | null {
  if (typeof raw !== "string" || raw.length > 300) return null;
  const p = raw.trim();
  if (/\\|\/\/|(^|\/)\.\.?(\/|$)|[\u0000-\u001f]/.test(p)) return null;
  const lap = /^laporan\/([0-9a-f-]{36})\.html$/i.exec(p);
  if (lap && UUID_RE.test(lap[1])) return { jenis: "laporan", path: p, runId: lap[1].toLowerCase() };
  const m = /^materi\/([A-Za-z0-9_-]{1,64})\/(auto|manual)\/([^/]{1,200})$/.exec(p);
  if (m) return { jenis: "materi", path: p, campaign: m[1] };
  return null;
}

export const arBucket = (c: Sb) => c.storage.from(AR_BUCKET);

/** signed URL (sesi user dulu, lalu service role); null = tidak ada / tidak boleh */
export async function signedArUrl(path: string, user: Sb, expires = 3600, unduh?: string): Promise<string | null> {
  for (const c of [user, arAdmin()]) {
    if (!c) continue;
    try {
      const { data, error } = await arBucket(c).createSignedUrl(path, expires, unduh ? { download: unduh } : undefined);
      if (!error && data?.signedUrl) return data.signedUrl;
    } catch {
      /* coba client berikutnya */
    }
  }
  return null;
}

/** isi file (laporan HTML) — sesi user dulu, lalu service role; null = tidak ada */
export async function readAr(path: string, user: Sb): Promise<Blob | null> {
  for (const c of [user, arAdmin()]) {
    if (!c) continue;
    try {
      const { data, error } = await arBucket(c).download(path);
      if (!error && data) return data;
    } catch {
      /* coba client berikutnya */
    }
  }
  return null;
}
