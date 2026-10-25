"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { uploadStudioFile } from "@/lib/studio/client";
import { numText, parseNum } from "./planUtils";

/** batas ukuran file di bucket studio */
export const MAX_UPLOAD = 200 * 1024 * 1024;

/** tombol upload satu file ke storage Studio (uploads/<uid>/<sub>/…) */
export function UploadBtn({ accept, sub, label, onDone, className = "" }: { accept: string; sub: string; label: string; onDone: (r: { path: string; src: string; name: string; type: string }) => void; className?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setErr(null);
    if (f.size > MAX_UPLOAD) return setErr("File kebesaran (maks 200 MB).");
    setBusy(true);
    try {
      const r = await uploadStudioFile(f, "uploads", sub);
      onDone({ ...r, name: f.name, type: f.type });
    } catch (e) {
      setErr(e instanceof Error && e.message.length < 120 ? e.message : "Gagal upload. Coba lagi.");
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  };
  return (
    <span className="inline-flex flex-col">
      <input ref={ref} type="file" accept={accept} className="hidden" tabIndex={-1} onChange={(e) => pick(e.target.files?.[0])} />
      <button type="button" disabled={busy} onClick={() => ref.current?.click()} className={`btn-ghost px-2.5 py-1.5 text-[12px] ${className}`}>
        {busy ? "⏳ Mengunggah…" : label}
      </button>
      {err && (
        <span role="alert" className="mt-1 text-[11px] text-red-400">
          {err}
        </span>
      )}
    </span>
  );
}

/**
 * Isian kecil untuk kartu rencana. Teks disimpan sebagai "draft" selama diketik (normalizeTimeline merapikan spasi,
 * jadi kalau langsung dipakai, spasi di akhir kata hilang saat mengetik) lalu dikirim ke timeline sedikit tertunda / saat keluar kolom.
 */
export function Txt({
  value,
  onCommit,
  onDraft,
  multiline,
  rows = 2,
  id,
  label,
  placeholder,
  maxLength,
  className = "",
  disabled,
}: {
  value: string;
  onCommit: (v: string) => void;
  /** dipanggil tiap ketikan (mis. untuk peringatan jumlah kata) */
  onDraft?: (v: string) => void;
  multiline?: boolean;
  rows?: number;
  id?: string;
  /** aria-label kalau tidak ada <label> terpisah */
  label?: string;
  placeholder?: string;
  maxLength?: number;
  className?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const focus = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cur = useRef({ draft: value, value, onCommit });
  cur.current.value = value;
  cur.current.onCommit = onCommit;

  // nilai dari luar berubah (AI revisi, undo, dll) -> ikut, kecuali sedang diketik
  useEffect(() => {
    if (!focus.current) {
      setDraft(value);
      cur.current.draft = value;
    }
  }, [value]);

  const flush = () => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    if (cur.current.draft !== cur.current.value) cur.current.onCommit(cur.current.draft);
  };
  // kartu ditutup saat masih mengetik -> simpan dulu
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => flush(), []);

  const change = (v: string) => {
    setDraft(v);
    cur.current.draft = v;
    onDraft?.(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 400);
  };
  const common = {
    id,
    value: draft,
    placeholder,
    maxLength,
    disabled,
    "aria-label": label,
    onFocus: () => (focus.current = true),
    onBlur: () => {
      focus.current = false;
      flush();
      // tampilkan versi yang sudah dirapikan
      setTimeout(() => {
        if (!focus.current) {
          setDraft(cur.current.value);
          cur.current.draft = cur.current.value;
        }
      }, 0);
    },
  };
  return multiline ? (
    <textarea {...common} rows={rows} onChange={(e) => change(e.target.value)} className={`input resize-y py-2 text-[13px] leading-relaxed ${className}`} />
  ) : (
    <input {...common} type="text" onChange={(e) => change(e.target.value)} className={`input py-2 text-[13px] ${className}`} />
  );
}

/** angka desimal (terima koma). Dikirim tiap ketikan yang valid, dibatasi min–max. */
export function Num({
  value,
  onCommit,
  min = -1e9,
  max = 1e9,
  id,
  label,
  placeholder,
  className = "",
  disabled,
}: {
  value: number | undefined | null;
  onCommit: (v: number | undefined) => void;
  min?: number;
  max?: number;
  id?: string;
  label?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(numText(value));
  const focus = useRef(false);
  useEffect(() => {
    if (!focus.current) setDraft(numText(value));
  }, [value]);
  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      aria-label={label}
      placeholder={placeholder}
      disabled={disabled}
      value={draft}
      onFocus={() => (focus.current = true)}
      onBlur={() => {
        focus.current = false;
        setDraft(numText(value));
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        if (!e.target.value.trim()) return onCommit(undefined);
        const n = parseNum(e.target.value);
        if (n !== null) onCommit(Math.min(max, Math.max(min, n)));
      }}
      className={`input py-2 text-[13px] tabular-nums ${className}`}
    />
  );
}

/** label + isian (id otomatis untuk aksesibilitas) */
export function Field({ label, hint, children, className = "" }: { label: string; hint?: ReactNode; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={`min-w-0 ${className}`}>
      <label htmlFor={id} className="mb-1 block text-xs font-semibold text-zinc-400">
        {label}
      </label>
      {children(id)}
      {hint && <div className="mt-1 text-[11px] leading-snug text-zinc-500">{hint}</div>}
    </div>
  );
}

/** pilihan berderet (segmented). `options` = [nilai, label] */
export function Seg<T extends string>({ value, options, onChange, label, size = "md" }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; label: string; size?: "sm" | "md" }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`rounded-lg border font-semibold transition ${size === "sm" ? "px-2 py-1 text-[11.5px]" : "px-2.5 py-1.5 text-[12.5px]"} ${
            value === v ? "border-orange-500 bg-orange-500/10 text-orange-400" : "border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/** saklar nyala/mati kecil */
export function Toggle({ on, onChange, label, children }: { on: boolean; onChange: (v: boolean) => void; label?: string; children?: ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer select-none items-center gap-2 text-[12.5px] text-zinc-300">
      <input type="checkbox" className="peer sr-only" checked={on} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
      <span
        aria-hidden
        className={`relative h-5 w-9 shrink-0 rounded-full transition peer-focus-visible:ring-2 peer-focus-visible:ring-orange-500/60 ${on ? "bg-orange-500" : "bg-zinc-700"}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
      </span>
      {children}
    </label>
  );
}
