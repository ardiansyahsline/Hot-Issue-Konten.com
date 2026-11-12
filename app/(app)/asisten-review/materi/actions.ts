"use server";

import { revalidatePath } from "next/cache";
import { arErrorText, type MateriKind } from "@/lib/asistenReview";
import { asistenGuard } from "@/lib/asistenReview.server";
import { CAMPAIGN_RE, MAKS_BYTE, NAMA_FILE_RE, UUID_RE, arBucket } from "@/lib/asistenReviewStorage.server";
import { MIME_PER_JENIS } from "@/components/asisten/materiAturan";

/**
 * Materi referensi per campaign (KONTRAK.md §2.3). Upload manual: browser mengunggah LANGSUNG ke bucket privat dengan sesi
 * user (RLS storage hanya materi/<campaign>/manual/<file>), lalu action ini mengecek file itu benar ada (ukuran & tipe
 * dari storage, bukan dari browser) dan mencatat barisnya (status antri_sidik → sidik jari dibuat laptop saat menganggur).
 */

type Hasil = { ok?: true; error?: string; pesan?: string };
const PATH = "/asisten-review/materi";

export async function catatUploadMateri(input: {
  campaign_id: string;
  kind: MateriKind;
  storage_path: string;
  file_name: string;
  mime: string;
  size_bytes: number;
}): Promise<Hasil> {
  const g = await asistenGuard();
  if (!g.ok) return { error: g.error };
  const sb = g.ctx.supabase;
  const cid = String(input?.campaign_id ?? "");
  const kind = String(input?.kind ?? "") as MateriKind;
  const path = String(input?.storage_path ?? "");
  if (!CAMPAIGN_RE.test(cid)) return { error: "ID campaign tidak valid." };
  if (!(kind in MIME_PER_JENIS)) return { error: "Jenis materi tidak dikenal." };
  const prefix = `materi/${cid}/manual/`;
  const nama = path.startsWith(prefix) ? path.slice(prefix.length) : "";
  if (!NAMA_FILE_RE.test(nama)) return { error: "Alamat file tidak valid. Coba upload ulang." };

  // file harus sudah ada di storage → ukuran & tipe dari metadata storage (browser bisa salah / dipalsukan)
  const { data: list, error: le } = await arBucket(sb).list(`materi/${cid}/manual`, { search: nama, limit: 10 });
  if (le) return { error: arErrorText(le, "File belum bisa dicek. Coba lagi.") };
  const obj = list?.find((o) => o.name === nama);
  if (!obj) return { error: "File belum terunggah. Coba upload ulang." };
  const meta = (obj.metadata ?? {}) as { size?: number; mimetype?: string };
  const size = Number(meta.size ?? input.size_bytes) || 0;
  const mime = String(meta.mimetype || input.mime || "").toLowerCase();
  const tolak = async (pesan: string): Promise<Hasil> => {
    await arBucket(sb).remove([path]).catch(() => null);
    return { error: pesan };
  };
  if (size <= 0 || size > MAKS_BYTE) return tolak("Ukuran file harus di bawah 50 MB.");
  if (!MIME_PER_JENIS[kind].includes(mime)) return tolak("Tipe file tidak cocok dengan jenis materi.");

  const fileName = String(input.file_name ?? nama)
    .replace(/[\u0000-\u001f@]/g, "")
    .trim()
    .slice(0, 120) || nama;
  const { error } = await sb.from("review_materials").insert({
    campaign_id: cid,
    kind,
    source: "manual",
    status: "antri_sidik",
    storage_path: path,
    file_name: fileName,
    mime,
    size_bytes: size,
    created_by: g.ctx.user.id,
  });
  if (error) {
    if (error.code === "23505") return { error: "File ini sudah tercatat." };
    return tolak(arErrorText(error, "Gagal mencatat file. Coba lagi."));
  }
  revalidatePath(PATH);
  return { ok: true, pesan: "Tersimpan. Laptop membuat sidik jarinya saat menganggur." };
}

export async function hapusMateri(id: string): Promise<Hasil> {
  const g = await asistenGuard();
  if (!g.ok) return { error: g.error };
  if (typeof id !== "string" || !UUID_RE.test(id)) return { error: "Materi tidak valid. Muat ulang halaman." };
  const sb = g.ctx.supabase;
  const { data: row, error: e1 } = await sb.from("review_materials").select("id, source, storage_path").eq("id", id).maybeSingle();
  if (e1) return { error: arErrorText(e1) };
  if (!row) return { ok: true }; // sudah terhapus
  if (row.source !== "manual") return { error: "Materi dari Google Drive diatur laptop. Yang bisa dihapus di sini hanya upload manual." };

  // file dulu (RLS storage: hanya materi/<c>/manual/) → baris; file sudah hilang = lanjut hapus baris
  if (typeof row.storage_path === "string" && /^materi\/[A-Za-z0-9_-]{1,64}\/manual\/[^/]+$/.test(row.storage_path)) {
    const { error: se } = await arBucket(sb).remove([row.storage_path]);
    if (se && !/not.?found/i.test(se.message ?? "")) return { error: arErrorText(se, "File gagal dihapus. Coba lagi.") };
  }
  const { error: e2 } = await sb.from("review_materials").delete().eq("id", id);
  if (e2) return { error: arErrorText(e2, "Gagal menghapus. Coba lagi.") };
  revalidatePath(PATH);
  return { ok: true };
}

/** antrikan pekerjaan "materi" (laptop coba unduh lagi dari Google Drive + sidik jari upload manual) */
export async function cobaUnduhMateri(campaignId: string): Promise<Hasil> {
  const g = await asistenGuard();
  if (!g.ok) return { error: g.error };
  if (typeof campaignId !== "string" || !CAMPAIGN_RE.test(campaignId)) return { error: "ID campaign tidak valid." };
  const sb = g.ctx.supabase;
  const { data: ada, error: e1 } = await sb
    .from("review_jobs")
    .select("id")
    .eq("kind", "materi")
    .in("status", ["antri", "proses"])
    .eq("params->>campaign_id", campaignId)
    .limit(1);
  if (e1) return { error: arErrorText(e1) };
  if (ada?.length) return { ok: true, pesan: "Sudah dalam antrian laptop." };
  const { error } = await sb.from("review_jobs").insert({ kind: "materi", params: { campaign_id: campaignId, paksa: true }, created_by: g.ctx.user.id });
  if (error) return { error: arErrorText(error, "Gagal mengantrikan. Coba lagi.") };
  revalidatePath(PATH);
  return { ok: true, pesan: "Masuk antrian. Laptop akan mencoba unduh dari Google Drive." };
}
