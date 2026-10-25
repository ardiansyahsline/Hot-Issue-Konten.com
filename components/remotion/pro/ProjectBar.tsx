"use client";

import { useEffect, useRef, useState } from "react";
import { timeAgo } from "@/lib/utils";

export type ProjectRow = { id: string; title: string; updated_at: string };
export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

const SAVE_TEXT: Record<SaveState, string> = {
  idle: "",
  dirty: "Belum tersimpan…",
  saving: "Menyimpan…",
  saved: "✓ Tersimpan",
  error: "⚠️ Gagal simpan",
};

/** bar proyek: pilih proyek, ganti judul, proyek baru, hapus, status simpan otomatis */
export default function ProjectBar({
  projects,
  activeId,
  title,
  save,
  loading,
  error,
  onPick,
  onNew,
  onRename,
  onDelete,
  onRetrySave,
}: {
  projects: ProjectRow[];
  activeId: string | null;
  title: string;
  save: SaveState;
  loading: boolean;
  error?: string | null;
  onPick: (id: string) => void;
  onNew: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  onRetrySave: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [askDel, setAskDel] = useState(false);
  const [draft, setDraft] = useState(title);
  const box = useRef<HTMLDivElement>(null);
  const active = projects.find((p) => p.id === activeId);

  // tutup daftar kalau klik di luar / tekan Esc
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", off);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", off);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  useEffect(() => setAskDel(false), [activeId]);

  const startEdit = () => {
    setDraft(title);
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    const t = draft.replace(/\s+/g, " ").trim().slice(0, 120);
    if (t && t !== title) onRename(t);
  };

  return (
    <div className="card flex flex-wrap items-center gap-2 p-2.5 sm:p-3">
      <div ref={box} className="relative min-w-0 flex-1 basis-[220px]">
        {editing ? (
          <input
            autoFocus
            className="input py-2 text-[14px] font-semibold"
            aria-label="Judul proyek"
            value={draft}
            maxLength={120}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(false);
            }}
          />
        ) : (
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="flex w-full min-w-0 items-center gap-2 rounded-xl px-2 py-1.5 text-left transition hover:bg-zinc-800/60"
          >
            <span aria-hidden className="text-[18px]">
              📁
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[14px] font-semibold text-zinc-100">{activeId ? title || "Tanpa judul" : "Proyek baru"}</span>
              <span className="block truncate text-[11.5px] text-zinc-500">
                {loading ? "Memuat proyek…" : active ? `Diubah ${timeAgo(active.updated_at)}` : activeId ? "Proyek terbuka" : "Belum disimpan — mulai dari chat"}
                {projects.length > 0 && ` · ${projects.length} proyek`}
              </span>
            </span>
            <span aria-hidden className="text-[11px] text-zinc-500">
              ▾
            </span>
          </button>
        )}
        {open && (
          <ul role="listbox" aria-label="Daftar proyek" className="absolute left-0 top-full z-30 mt-1.5 max-h-[50vh] w-full min-w-[240px] overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-900 p-1" style={{ boxShadow: "var(--shadow-pop)" }}>
            {projects.length === 0 && <li className="px-3 py-2 text-[12.5px] text-zinc-500">Belum ada proyek.</li>}
            {projects.map((p) => (
              <li key={p.id} role="option" aria-selected={p.id === activeId}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    if (p.id !== activeId) onPick(p.id);
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${p.id === activeId ? "bg-orange-500/10 text-orange-400" : "text-zinc-200 hover:bg-zinc-800"}`}
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{p.title || "Tanpa judul"}</span>
                  <span className="shrink-0 text-[11px] text-zinc-500">{timeAgo(p.updated_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {save !== "idle" && (
          <span role="status" aria-live="polite" className={`px-1 text-[11.5px] ${save === "error" ? "text-red-400" : save === "saved" ? "text-emerald-400" : "text-zinc-500"}`}>
            {SAVE_TEXT[save]}
            {save === "error" && (
              <button type="button" className="ml-1 font-semibold underline" onClick={onRetrySave}>
                Coba lagi
              </button>
            )}
          </span>
        )}
        {activeId && !editing && (
          <button type="button" className="btn-ghost px-2.5 py-1.5 text-[12px]" onClick={startEdit} aria-label="Ganti judul proyek">
            ✏️ <span className="hidden sm:inline">Judul</span>
          </button>
        )}
        <button type="button" className="btn-ghost px-2.5 py-1.5 text-[12px]" onClick={onNew}>
          ＋ Proyek baru
        </button>
        {activeId && (
          <button type="button" className="btn-ghost px-2.5 py-1.5 text-[12px] hover:text-red-400" onClick={() => setAskDel(true)} aria-label="Hapus proyek">
            🗑
          </button>
        )}
      </div>

      {askDel && (
        <div role="alert" className="flex w-full flex-wrap items-center gap-2 rounded-xl bg-red-500/10 px-3 py-2 text-[12.5px] text-red-300">
          Hapus proyek “{title || "Tanpa judul"}” beserta chat-nya? Tidak bisa dibatalkan.
          <button
            type="button"
            className="font-semibold text-red-400 underline"
            onClick={() => {
              setAskDel(false);
              onDelete();
            }}
          >
            Ya, hapus
          </button>
          <button type="button" className="font-semibold text-zinc-400" onClick={() => setAskDel(false)}>
            Batal
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="w-full px-1 text-[12px] text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
