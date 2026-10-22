"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ATTACH_BUCKET, ATTACH_MAX_BYTES, ATTACH_MAX_FILES, ATTACH_MIMES, extOf, isViewableImage, mimeOf, type AttachmentInput } from "@/lib/attachments";

export type UploadItem = {
  key: string;
  name: string;
  size: number;
  mime: string;
  preview: string | null;
  status: "uploading" | "done" | "error";
  path?: string;
  error?: string;
};

const COMPRESS_FROM = 1.5 * 1024 * 1024;

/** Screenshot besar dikecilkan dulu (maks sisi 2560px, WebP) supaya upload cepat & hemat kuota. Teks tetap tajam. */
async function shrinkImage(file: File, mime: string): Promise<{ blob: Blob; name: string; mime: string }> {
  if (!/^image\/(jpeg|png|webp)$/.test(mime) || file.size < COMPRESS_FROM) return { blob: file, name: file.name, mime };
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2560 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.9));
    if (!blob || blob.size >= file.size || blob.type !== "image/webp") return { blob: file, name: file.name, mime };
    return { blob, name: file.name.replace(/\.[a-z0-9]+$/i, "") + ".webp", mime: "image/webp" };
  } catch {
    return { blob: file, name: file.name, mime };
  }
}

const friendlyError = (msg: string) =>
  /size|too large|413/i.test(msg)
    ? "File lebih dari 10 MB"
    : /mime|type|415/i.test(msg)
      ? "Tipe file tidak didukung"
      : /bucket not found/i.test(msg)
        ? "Penyimpanan belum aktif (migration-07 belum dijalankan)"
        : /row-level|unauthorized|403/i.test(msg)
          ? "Tidak punya akses upload"
          : "Upload gagal, coba lagi";

/** Upload file lampiran langsung ke Storage (dipakai kotak lampiran & chat) */
export function useUploads(userId: string) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const patch = (key: string, p: Partial<UploadItem>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)));

  const addFiles = useCallback(
    async (files: File[]) => {
      setNotice(null);
      const room = ATTACH_MAX_FILES - itemsRef.current.length;
      if (room <= 0) return setNotice(`Maksimal ${ATTACH_MAX_FILES} file sekali kirim.`);
      if (files.length > room) setNotice(`Hanya ${room} file pertama yang diambil (maks ${ATTACH_MAX_FILES}).`);

      for (const file of files.slice(0, room)) {
        const key = Math.random().toString(36).slice(2);
        // screenshot hasil Ctrl+V biasanya bernama "image.png" — beri nama yang jelas
        const baseName = /^image\.(png|jpe?g)$/i.test(file.name)
          ? `screenshot-${new Date().toLocaleString("sv-SE", { timeZone: "Asia/Jakarta" }).replace(/[: ]/g, "-")}.${extOf(file.name)}`
          : file.name;
        const mime = mimeOf(baseName, file.type);
        const preview = isViewableImage(mime) ? URL.createObjectURL(file) : null;
        const item: UploadItem = { key, name: baseName, size: file.size, mime, preview, status: "uploading" };

        if (!ATTACH_MIMES.has(mime)) {
          setItems((l) => [...l, { ...item, status: "error", error: "Tipe file tidak didukung" }]);
          continue;
        }
        setItems((l) => [...l, item]);

        const shrunk = await shrinkImage(new File([file], baseName, { type: mime }), mime);
        if (shrunk.blob.size > ATTACH_MAX_BYTES) {
          patch(key, { status: "error", error: "File lebih dari 10 MB" });
          continue;
        }
        const path = `${userId}/${crypto.randomUUID()}.${extOf(shrunk.name) || "bin"}`;
        const { error } = await supabase.storage
          .from(ATTACH_BUCKET)
          .upload(path, await shrunk.blob.arrayBuffer(), { contentType: shrunk.mime, upsert: false });
        if (error) patch(key, { status: "error", error: friendlyError(error.message) });
        else patch(key, { status: "done", path, name: shrunk.name, size: shrunk.blob.size, mime: shrunk.mime });
      }
    },
    [supabase, userId]
  );

  /** buang satu file (kalau sudah ter-upload tapi belum dipakai -> hapus juga dari Storage) */
  const remove = useCallback(
    (it: UploadItem) => {
      setItems((l) => l.filter((i) => i.key !== it.key));
      if (it.preview) URL.revokeObjectURL(it.preview);
      if (it.path) supabase.storage.from(ATTACH_BUCKET).remove([it.path]);
    },
    [supabase]
  );

  /** kosongkan daftar setelah berhasil disimpan / dikirim (file tetap di Storage) */
  const clear = useCallback(() => setItems([]), []);

  const uploading = items.filter((i) => i.status === "uploading").length;
  const done: AttachmentInput[] = items
    .filter((i) => i.status === "done")
    .map((i) => ({ path: i.path!, name: i.name, size: i.size, mime: i.mime }));

  return { items, setItems, addFiles, remove, clear, uploading, done, notice };
}
