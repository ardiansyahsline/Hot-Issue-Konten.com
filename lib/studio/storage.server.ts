import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { STUDIO_BUCKET } from "./urls";

/**
 * Helper bucket privat "studio" untuk route server Studio.
 * Service role (SUPABASE_SERVICE_ROLE_KEY) dipakai kalau ada: bisa menulis tts/, sfx/ dst.
 * Kalau kosong: baca/tanda-tangan URL lewat client user (RLS studio_read), tulis dilewati -> fitur tetap jalan.
 */

type Sb = SupabaseClient;

export const hasServiceRole = () => !!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() && !!process.env.NEXT_PUBLIC_SUPABASE_URL;

/** client service role, atau null kalau env kosong / gagal dibuat */
export function studioAdmin(): Sb | null {
  if (!hasServiceRole()) return null;
  try {
    return createAdminClient();
  } catch {
    return null;
  }
}

/** service role kalau ada, kalau tidak pakai client user (RLS) */
export const studioClient = (user: Sb | null | undefined): Sb | null => studioAdmin() ?? user ?? null;

const bucket = (c: Sb) => c.storage.from(STUDIO_BUCKET);

/**
 * Path file di bucket studio yang aman: tanpa "..", tanpa "/" di awal / akhir, tanpa "//" atau "\",
 * hanya huruf, angka, titik, minus, garis bawah & "/". Tidak valid -> null.
 */
export function cleanStoragePath(p: unknown): string | null {
  if (typeof p !== "string") return null;
  const s = p.trim();
  if (!s || s.length > 300) return null;
  if (s.includes("..") || s.startsWith("/") || s.endsWith("/") || s.includes("//") || s.includes("\\")) return null;
  return /^[A-Za-z0-9][A-Za-z0-9._\-/]*$/.test(s) ? s : null;
}

/** folder yang boleh dibaca semua user Studio: bank suara, SFX, cache TTS server, hasil VO worker (cache TTS worker dipakai lintas user) */
const SHARED_DIRS = new Set(["voices", "sfx", "tts", "vo"]);

/**
 * Boleh baca path ini? Aturan sama dengan RLS studio_read (migration-20), wajib dicek SEBELUM tanda tangan pakai service role:
 * admin semua; voices/ sfx/ tts/ vo/ semua user Studio; uploads/<id sendiri>/...; renders/ hanya kalau baris
 * studio_render_jobs-nya terlihat lewat client user (RLS: milik sendiri / admin). Selain itu false.
 */
export async function studioCanRead(path: string, user: Sb, uid: string, admin: boolean): Promise<boolean> {
  if (admin) return true;
  const dirs = path.split("/").slice(0, -1); // folder saja, seperti storage.foldername()
  if (!dirs.length) return false;
  if (SHARED_DIRS.has(dirs[0])) return true;
  if (dirs[0] === "uploads") return dirs[1] === uid;
  if (dirs[0] !== "renders") return false;
  try {
    const { data, error } = await user.from("studio_render_jobs").select("id").eq("result_path", path).limit(1).maybeSingle();
    return !error && !!data;
  } catch {
    return false;
  }
}

/** signed URL (default 1 jam). Coba service role dulu, lalu client user. null = file tidak ada / tidak boleh */
export async function signedStudioUrl(path: string, user?: Sb | null, expires = 3600): Promise<string | null> {
  const tried = new Set<Sb>();
  for (const c of [studioAdmin(), user ?? null]) {
    if (!c || tried.has(c)) continue;
    tried.add(c);
    try {
      const { data, error } = await bucket(c).createSignedUrl(path, expires);
      if (!error && data?.signedUrl) return data.signedUrl;
    } catch {
      /* coba client berikutnya */
    }
  }
  return null;
}

/** tulis file (butuh client yang boleh menulis path itu — biasanya service role). true = berhasil */
export async function putStudio(path: string, body: Buffer | Uint8Array | string, contentType: string, c: Sb | null = studioAdmin(), upsert = true): Promise<boolean> {
  if (!c) return false;
  try {
    const { error } = await bucket(c).upload(path, body, { contentType, upsert, cacheControl: "31536000" });
    if (error) console.error("[studio/storage] upload", path, error.message);
    return !error;
  } catch (e) {
    console.error("[studio/storage] upload", path, e instanceof Error ? e.message : e);
    return false;
  }
}

/** baca file sebagai Buffer (null = tidak ada / gagal) */
export async function readStudio(path: string, c: Sb | null = studioAdmin()): Promise<Buffer | null> {
  if (!c) return null;
  try {
    const { data, error } = await bucket(c).download(path);
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  } catch {
    return null;
  }
}

export async function readStudioJson<T>(path: string, c: Sb | null = studioAdmin()): Promise<T | null> {
  const b = await readStudio(path, c);
  if (!b) return null;
  try {
    return JSON.parse(b.toString("utf8")) as T;
  } catch {
    return null;
  }
}

export type StudioFile = { name: string; path: string; size: number | null; type: string | null; at: string | null };

/** daftar file (bukan folder) di satu folder bucket. Error / kosong -> [] */
export async function listStudio(prefix: string, c: Sb | null): Promise<StudioFile[]> {
  if (!c) return [];
  const dir = prefix.replace(/^\/+|\/+$/g, "");
  try {
    const { data, error } = await bucket(c).list(dir, { limit: 200, sortBy: { column: "name", order: "asc" } });
    if (error || !data) return [];
    return data
      .filter((f) => !!f.id && !f.name.startsWith("."))
      .map((f) => {
        const m = (f.metadata ?? {}) as { size?: number; mimetype?: string };
        return { name: f.name, path: `${dir}/${f.name}`, size: typeof m.size === "number" ? m.size : null, type: m.mimetype ?? null, at: f.created_at ?? null };
      });
  } catch {
    return [];
  }
}
