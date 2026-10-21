"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fmtSize, isViewableImage, type AttachmentView } from "@/lib/attachments";
import { deleteAttachment } from "@/lib/attachmentActions";
import { DocIcon } from "./AttachmentPicker";

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "baru saja";
  if (m < 60) return `${m} menit lalu`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} jam lalu`;
  return new Date(iso).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric" });
};

function useDelete(page: string) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const del = (a: AttachmentView) => {
    start(async () => {
      const r = await deleteAttachment(a.id, page);
      if (r?.error) setErr(r.error);
      else router.refresh();
    });
  };
  return { del, pending, err };
}

/**
 * Galeri lampiran: gambar sebagai thumbnail (klik = perbesar), dokumen sebagai daftar dengan tombol Unduh.
 * `compact` untuk lampiran di update issue / tanggapan.
 */
export default function AttachmentGallery({
  items,
  meId,
  isAdmin,
  page,
  compact = false,
}: {
  items: AttachmentView[];
  meId: string;
  isAdmin: boolean;
  page: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const { del, pending, err } = useDelete(page);
  const images = items.filter((a) => isViewableImage(a.mime) && a.url);
  const docs = items.filter((a) => !(isViewableImage(a.mime) && a.url));
  const canDel = (a: AttachmentView) => a.created_by === meId || isAdmin;

  if (!items.length) return null;

  const DelBtn = ({ a, overlay }: { a: AttachmentView; overlay?: boolean }) =>
    !canDel(a) ? null : confirmId === a.id ? (
      <span className={`inline-flex items-center gap-1 ${overlay ? "rounded-full bg-zinc-950/90 px-1.5 py-0.5 ring-1 ring-zinc-700" : ""}`}>
        <button type="button" disabled={pending} onClick={() => del(a)} className="text-[11.5px] font-semibold text-red-400 hover:underline">
          {pending ? "…" : "Hapus?"}
        </button>
        <button type="button" onClick={() => setConfirmId(null)} className="text-[11.5px] text-zinc-500">batal</button>
      </span>
    ) : (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setConfirmId(a.id);
        }}
        aria-label={`Hapus ${a.name}`}
        className={
          overlay
            ? "flex h-6 w-6 items-center justify-center rounded-full bg-zinc-950/85 text-[11px] text-zinc-300 opacity-0 ring-1 ring-zinc-700 transition hover:text-red-400 group-hover:opacity-100 focus:opacity-100"
            : "text-[12px] text-zinc-500 hover:text-red-400"
        }
      >
        {overlay ? "✕" : "Hapus"}
      </button>
    );

  return (
    <div className={compact ? "mt-2 space-y-2" : "space-y-3"}>
      {err && <p className="text-xs text-red-400">{err}</p>}

      {images.length > 0 && (
        <div className={`grid gap-2.5 ${compact ? "grid-cols-4 sm:grid-cols-6" : "auto-rows-[120px] grid-cols-3 sm:auto-rows-[170px]"}`}>
          {images.map((a, i) => {
            const big = !compact && images.length >= 3 && i === 0;
            return (
              <div
                key={a.id}
                className={`group relative overflow-hidden rounded-xl bg-zinc-950 ring-1 ring-zinc-800 ${big ? "col-span-2 row-span-2" : compact ? "aspect-square" : ""}`}
              >
                <button type="button" onClick={() => setOpen(i)} className="block h-full w-full" title={a.name}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.url!} alt={a.name} loading="lazy" className="h-full w-full object-cover object-top transition duration-200 group-hover:scale-[1.02]" />
                </button>
                <span className="absolute right-1.5 top-1.5">
                  <DelBtn a={a} overlay />
                </span>
              </div>
            );
          })}
        </div>
      )}

      {docs.length > 0 && (
        <div className={compact ? "flex flex-wrap gap-2" : "space-y-2"}>
          {docs.map((a) =>
            compact ? (
              <span key={a.id} className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/60 py-1.5 pl-1.5 pr-3">
                <DocIcon name={a.name} mime={a.mime} size={26} />
                <a href={a.url ?? undefined} target="_blank" rel="noreferrer" className="max-w-[200px] truncate text-[12.5px] hover:text-orange-400">
                  {a.name}
                </a>
                {a.downloadUrl && <a href={a.downloadUrl} className="text-[11.5px] font-semibold text-orange-400">Unduh</a>}
                <DelBtn a={a} />
              </span>
            ) : (
              <div key={a.id} className="flex items-center gap-3 rounded-xl border border-zinc-800 px-3 py-2">
                <DocIcon name={a.name} mime={a.mime} />
                <div className="min-w-0 flex-1">
                  <a href={a.url ?? undefined} target="_blank" rel="noreferrer" className="block truncate text-[13px] font-medium hover:text-orange-400">
                    {a.name}
                  </a>
                  <div className="text-[11.5px] text-zinc-500">
                    {fmtSize(a.size)} · {a.created_by_name ?? "-"} · {ago(a.created_at)}
                  </div>
                </div>
                <DelBtn a={a} />
                {a.downloadUrl && <a href={a.downloadUrl} className="btn-ghost px-3 py-1.5 text-xs">Unduh</a>}
              </div>
            )
          )}
        </div>
      )}

      {open !== null && images[open] && (
        <Lightbox images={images} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

function Lightbox({
  images,
  index,
  onIndex,
  onClose,
}: {
  images: AttachmentView[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const a = images[index];
  const n = images.length;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") onIndex((index + 1) % n);
      if (e.key === "ArrowLeft") onIndex((index - 1 + n) % n);
    };
    window.addEventListener("keydown", key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", key);
      document.body.style.overflow = prev;
    };
  }, [index, n, onIndex, onClose]);

  const Nav = ({ dir }: { dir: -1 | 1 }) => (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onIndex((index + dir + n) % n);
      }}
      className={`absolute top-1/2 -translate-y-1/2 ${dir < 0 ? "left-3 sm:left-6" : "right-3 sm:right-6"} flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-xl text-white backdrop-blur transition hover:bg-white/20`}
      aria-label={dir < 0 ? "Sebelumnya" : "Berikutnya"}
    >
      {dir < 0 ? "‹" : "›"}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/85 backdrop-blur-sm" onClick={onClose} role="dialog" aria-label={a.name}>
      <div className="flex items-center gap-3 px-4 py-3 text-white sm:px-6" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold">{a.name}</div>
          <div className="text-[12px] text-white/60">
            {index + 1} / {n} · {fmtSize(a.size)} · {a.created_by_name ?? "-"} · {ago(a.created_at)}
          </div>
        </div>
        <a href={a.url!} target="_blank" rel="noreferrer" className="rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-white/80 hover:bg-white/10">
          Buka asli
        </a>
        {a.downloadUrl && (
          <a href={a.downloadUrl} className="rounded-lg bg-white/15 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-white/25">
            Unduh
          </a>
        )}
        <button type="button" onClick={onClose} className="rounded-lg px-2.5 py-1.5 text-lg text-white/80 hover:bg-white/10" aria-label="Tutup">
          ✕
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-6 sm:px-20">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={a.url!} alt={a.name} onClick={(e) => e.stopPropagation()} className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" />
        {n > 1 && <Nav dir={-1} />}
        {n > 1 && <Nav dir={1} />}
      </div>
    </div>
  );
}
