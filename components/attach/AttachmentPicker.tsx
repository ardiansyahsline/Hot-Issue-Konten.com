"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  ATTACH_ACCEPT,
  ATTACH_BUCKET,
  ATTACH_MAX_BYTES,
  ATTACH_MAX_FILES,
  ATTACH_MIMES,
  docBadge,
  extOf,
  fmtSize,
  isViewableImage,
  mimeOf,
  type AttachmentInput,
} from "@/lib/attachments";

type Item = {
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

export function UploadIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
    </svg>
  );
}

export function DocIcon({ name, mime, size = 40 }: { name: string; mime: string | null; size?: number }) {
  const [label, cls] = docBadge(name, mime);
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-xl font-bold ${cls}`} style={{ width: size, height: size, fontSize: size < 32 ? 9 : 10 }}>
      {label}
    </span>
  );
}

const RemoveBtn = ({ onClick, label }: { onClick: () => void; label: string }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-950/85 text-[11px] text-zinc-300 ring-1 ring-zinc-700 transition hover:text-red-400"
  >
    ✕
  </button>
);

/**
 * Kotak lampiran bukti: tarik & lepas, pilih file, atau Ctrl+V screenshot.
 * File langsung di-upload ke Storage; yang dikirim form hanya datanya (hidden input `name`).
 */
export default function AttachmentPicker({
  userId,
  name = "attachments",
  compact = false,
  pasteGlobal = false,
  clearOnReset = false,
  onCountChange,
}: {
  userId: string;
  name?: string;
  compact?: boolean;
  /** tempel screenshot dari mana saja di halaman (bukan hanya saat kursor di form ini) */
  pasteGlobal?: boolean;
  /** kosongkan daftar saat form di-reset (form tanpa redirect, mis. tambah update / tanggapan) */
  clearOnReset?: boolean;
  onCountChange?: (done: number, uploading: number) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<Item[]>([]);
  const [drag, setDrag] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const guard = useRef<HTMLInputElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const uploading = items.filter((i) => i.status === "uploading").length;
  const done = items.filter((i) => i.status === "done");

  const countCb = useRef(onCountChange);
  countCb.current = onCountChange;
  useEffect(() => {
    guard.current?.setCustomValidity(uploading ? "Tunggu sampai upload lampiran selesai." : "");
    countCb.current?.(done.length, uploading);
  }, [uploading, done.length]);

  const patch = (key: string, p: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)));

  const addFiles = useCallback(
    async (files: File[]) => {
      setNotice(null);
      const room = ATTACH_MAX_FILES - itemsRef.current.length;
      if (room <= 0) return setNotice(`Maksimal ${ATTACH_MAX_FILES} file sekali simpan.`);
      if (files.length > room) setNotice(`Hanya ${room} file pertama yang diambil (maks ${ATTACH_MAX_FILES}).`);

      for (const file of files.slice(0, room)) {
        const key = Math.random().toString(36).slice(2);
        // screenshot hasil Ctrl+V biasanya bernama "image.png" — beri nama yang jelas
        const baseName = /^image\.(png|jpe?g)$/i.test(file.name)
          ? `screenshot-${new Date().toLocaleString("sv-SE", { timeZone: "Asia/Jakarta" }).replace(/[: ]/g, "-")}.${extOf(file.name)}`
          : file.name;
        const mime = mimeOf(baseName, file.type);
        const preview = isViewableImage(mime) ? URL.createObjectURL(file) : null;
        const item: Item = { key, name: baseName, size: file.size, mime, preview, status: "uploading" };

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

  const remove = (it: Item) => {
    setItems((l) => l.filter((i) => i.key !== it.key));
    if (it.preview) URL.revokeObjectURL(it.preview);
    if (it.path) supabase.storage.from(ATTACH_BUCKET).remove([it.path]); // belum tersimpan -> buang dari Storage
  };

  // Ctrl+V: screenshot / file dari clipboard
  useEffect(() => {
    const form = wrap.current?.closest("form");
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (!files.length) return;
      e.preventDefault();
      e.stopPropagation();
      addFiles(files);
    };
    const onGlobal = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest("form") && t.closest("form") !== form) return; // milik form lain
      if (!form?.contains(t)) onPaste(e);
    };
    // form dikosongkan (setelah simpan sukses) -> kosongkan daftar
    const onReset = () => setItems([]);
    form?.addEventListener("paste", onPaste);
    if (clearOnReset) form?.addEventListener("reset", onReset);
    if (pasteGlobal) document.addEventListener("paste", onGlobal);
    return () => {
      form?.removeEventListener("paste", onPaste);
      form?.removeEventListener("reset", onReset);
      document.removeEventListener("paste", onGlobal);
    };
  }, [addFiles, pasteGlobal, clearOnReset]);

  const value: AttachmentInput[] = done.map((i) => ({ path: i.path!, name: i.name, size: i.size, mime: i.mime }));
  const images = items.filter((i) => i.preview);
  const files = items.filter((i) => !i.preview);

  return (
    <div ref={wrap} className="space-y-3">
      <input type="hidden" name={name} value={JSON.stringify(value)} />
      {/* penahan submit selama masih upload */}
      <input ref={guard} tabIndex={-1} aria-hidden className="pointer-events-none absolute h-0 w-0 opacity-0" />
      <input
        ref={fileInput}
        type="file"
        multiple
        accept={ATTACH_ACCEPT}
        className="hidden"
        onChange={(e) => {
          addFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />

      <div
        role="button"
        tabIndex={0}
        onClick={() => fileInput.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), fileInput.current?.click())}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          addFiles(Array.from(e.dataTransfer.files));
        }}
        className={`cursor-pointer rounded-2xl border-2 border-dashed text-center transition ${
          drag ? "border-orange-500 bg-orange-500/5" : "border-zinc-700 bg-zinc-950/60 hover:border-zinc-600"
        } ${compact ? "flex items-center justify-center gap-2.5 px-3 py-3" : "px-4 py-6"}`}
      >
        {compact ? (
          <>
            <span className="text-orange-400"><UploadIcon size={16} /></span>
            <span className="text-[12.5px] text-zinc-400">
              <b className="font-semibold text-zinc-200">Lampirkan bukti</b> — tarik, <span className="text-orange-400">pilih file</span>, atau Ctrl+V
            </span>
          </>
        ) : (
          <>
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/10 text-orange-400">
              <UploadIcon />
            </div>
            <p className="mt-2 text-[13.5px] font-semibold">
              Tarik file ke sini, atau <span className="text-orange-400">pilih file</span>
            </p>
            <p className="mt-0.5 text-[12px] text-zinc-500">
              Bisa juga <b>Ctrl+V</b> untuk tempel screenshot · JPG, PNG, PDF, Word, Excel
            </p>
          </>
        )}
      </div>

      {notice && <p className="text-xs text-amber-400">{notice}</p>}

      {images.length > 0 && (
        <div className={`grid gap-2.5 ${compact ? "grid-cols-5 sm:grid-cols-6" : "grid-cols-3 sm:grid-cols-4"}`}>
          {images.map((it) => (
            <div key={it.key} className="relative aspect-square overflow-hidden rounded-xl bg-zinc-950 ring-1 ring-zinc-800">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={it.preview!} alt={it.name} className={`h-full w-full object-cover ${it.status === "uploading" ? "opacity-50" : ""}`} />
              {it.status === "uploading" && <Spinner />}
              {it.status === "error" && (
                <span className="absolute inset-x-0 bottom-0 bg-red-600/90 px-1.5 py-1 text-[10.5px] font-semibold text-white">{it.error}</span>
              )}
              <span className="absolute right-1.5 top-1.5">
                <RemoveBtn onClick={() => remove(it)} label={`Hapus ${it.name}`} />
              </span>
            </div>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((it) => (
            <div key={it.key} className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${it.status === "error" ? "border-red-500/40" : "border-zinc-800"}`}>
              <DocIcon name={it.name} mime={it.mime} size={compact ? 32 : 40} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{it.name}</div>
                <div className={`text-[11.5px] ${it.status === "error" ? "text-red-400" : "text-zinc-500"}`}>
                  {it.status === "error" ? it.error : it.status === "uploading" ? "Mengupload…" : fmtSize(it.size)}
                </div>
              </div>
              <RemoveBtn onClick={() => remove(it)} label={`Hapus ${it.name}`} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <span className="absolute inset-0 flex items-center justify-center">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/40 border-t-orange-500" />
    </span>
  );
}
