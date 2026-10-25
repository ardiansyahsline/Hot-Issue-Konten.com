/**
 * Alamat file Studio. Semuanya lewat route milik website (wajib login + akses Studio):
 * - aset repo (SFX / musik di assets/audio)  -> /api/studio/asset/<sfx|music>/<nama file>
 * - file di Supabase Storage bucket "studio" -> /api/studio/file?p=<path>  (dialihkan ke signed URL 1 jam)
 * Aset audio & suara TIDAK pernah ditaruh di public/.
 */
export const STUDIO_BUCKET = "studio";

export const sfxSrc = (file: string) => `/api/studio/asset/sfx/${encodeURIComponent(file)}`;
export const musicSrc = (file: string) => `/api/studio/asset/music/${encodeURIComponent(file)}`;
export const storageSrc = (path: string) => `/api/studio/file?p=${encodeURIComponent(path)}`;

/** path storage dari URL /api/studio/file?p=… (null kalau bukan file storage) */
export function storagePathOf(src: string | null | undefined): string | null {
  if (!src || !src.startsWith("/api/studio/file")) return null;
  const q = src.split("?")[1] ?? "";
  const p = new URLSearchParams(q).get("p");
  return p && !p.includes("..") ? p : null;
}

/** URL absolut (dipakai renderer di laptop yang tidak berjalan di domain website) */
export const absoluteSrc = (src: string, origin: string) => (src.startsWith("/") ? `${origin.replace(/\/+$/, "")}${src}` : src);
