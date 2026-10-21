import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ATTACH_BUCKET,
  ATTACH_MAX_BYTES,
  ATTACH_MAX_FILES,
  ATTACH_MIMES,
  TARGET_COLUMN,
  type AttachTarget,
  type AttachmentInput,
  type AttachmentView,
} from "@/lib/attachments";

type DB = Awaited<ReturnType<typeof createClient>>;
type Column = (typeof TARGET_COLUMN)[keyof typeof TARGET_COLUMN];

/** Baca daftar lampiran dari form (hidden input "attachments") dan buang yang tidak valid */
export function parseAttachments(fd: FormData, userId: string, field = "attachments"): AttachmentInput[] {
  let raw: unknown = [];
  try {
    raw = JSON.parse(String(fd.get(field) ?? "[]"));
  } catch {
    raw = [];
  }
  const seen = new Set<string>();
  const out: AttachmentInput[] = [];
  for (const a of Array.isArray(raw) ? raw : []) {
    const path = String(a?.path ?? "");
    const name = String(a?.name ?? "").trim().slice(0, 200) || "lampiran";
    const size = Number(a?.size ?? 0);
    const mime = String(a?.mime ?? "");
    if (!path.startsWith(`${userId}/`) || path.includes("..") || seen.has(path)) continue;
    if (!Number.isFinite(size) || size < 0 || size > ATTACH_MAX_BYTES) continue;
    if (!ATTACH_MIMES.has(mime)) continue;
    seen.add(path);
    out.push({ path, name, size, mime });
    if (out.length >= ATTACH_MAX_FILES) break;
  }
  return out;
}

/** Simpan lampiran (file sudah ada di Storage) ke issue / update / catatan / tanggapan */
export async function saveAttachments(supabase: DB, items: AttachmentInput[], target: AttachTarget): Promise<string | null> {
  if (!items.length) return null;
  const col = TARGET_COLUMN[target.kind];
  const { error } = await supabase.from("attachments").insert(items.map((a) => ({ ...a, [col]: target.id })));
  return error ? error.message : null;
}

/** kolom yang diambil dari tabel lampiran (bisa dipakai juga sebagai embed: `files:attachments(${ATTACH_SELECT})`) */
export const ATTACH_SELECT =
  "id, path, name, size, mime, created_by, created_at, issue_note_id, suggestion_comment_id, author:profiles!attachments_created_by_fkey(full_name)";

export type AttachmentRow = {
  id: number; path: string; name: string; size: number; mime: string | null; created_by: string | null;
  created_at: string; issue_note_id: number | null; suggestion_comment_id: number | null;
  author: { full_name: string | null } | null;
};

/** Buat link sementara (1 jam) untuk dibuka & diunduh — satu panggilan untuk semua file */
export async function signAttachments(supabase: DB, rows: AttachmentRow[]): Promise<AttachmentView[]> {
  if (!rows.length) return [];
  const { data: signed } = await supabase.storage.from(ATTACH_BUCKET).createSignedUrls(rows.map((r) => r.path), 3600);
  const urlByPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  return rows.map((r) => {
    const url = urlByPath.get(r.path) ?? null;
    return {
      id: r.id,
      name: r.name,
      size: Number(r.size),
      mime: r.mime,
      url,
      downloadUrl: url ? `${url}${url.includes("?") ? "&" : "?"}download=${encodeURIComponent(r.name)}` : null,
      created_by: r.created_by,
      created_by_name: r.author?.full_name ?? null,
      created_at: r.created_at,
      issue_note_id: r.issue_note_id,
      suggestion_comment_id: r.suggestion_comment_id,
    };
  });
}

/** Path file milik issue/catatan tertentu — dipakai untuk membersihkan Storage sebelum data dihapus */
export async function attachmentPaths(supabase: DB, where: { column: Column; ids: number[] }[]): Promise<string[]> {
  const parts = where.filter((w) => w.ids.length).map((w) => `${w.column}.in.(${w.ids.join(",")})`);
  if (!parts.length) return [];
  const { data } = await supabase.from("attachments").select("path").or(parts.join(","));
  return (data ?? []).map((d) => d.path as string);
}

/**
 * Hapus file dari Storage. Dipanggil SETELAH data di database berhasil dihapus (izin sudah dicek RLS),
 * jadi kalau service key tersedia dipakai supaya file lampiran orang lain di catatan yang sama ikut bersih.
 * Gagal pun diam saja — data utama tetap terhapus.
 */
export async function removeFiles(supabase: DB, paths: string[]) {
  if (!paths.length) return;
  try {
    const client = process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : supabase;
    await client.storage.from(ATTACH_BUCKET).remove(paths);
  } catch {
    // abaikan
  }
}
