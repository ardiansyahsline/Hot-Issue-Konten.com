"use client";

import { useState } from "react";

export type PageOption = { label: string; desc?: string; rec?: boolean; off?: boolean; hint?: string };
export type PageQuestion = { q: string; multi?: boolean; options: PageOption[]; other?: boolean; skip?: (answers: string[][]) => boolean };

/**
 * Kartu pertanyaan bergaya Claude: SATU pertanyaan per halaman (1/3, 2/3 …), bukan memanjang ke bawah.
 * Pilihan tunggal: klik = simpan & lanjut ke halaman berikutnya (halaman terakhir = langsung terkirim).
 * Pilihan ganda: centang lalu "Lanjut". "Lainnya" bisa diketik di tiap halaman. Tombol ‹ › untuk bolak-balik.
 */
export default function PagedAsk({
  title,
  questions,
  disabled,
  skipLabel = "Lewati, langsung kerjain",
  onSkip,
  onDone,
}: {
  title?: string;
  questions: PageQuestion[];
  disabled?: boolean;
  skipLabel?: string;
  onSkip: () => void;
  onDone: (answers: string[][]) => void;
}) {
  const [picked, setPicked] = useState<string[][]>(() => questions.map(() => []));
  const [other, setOther] = useState<string[]>(() => questions.map(() => ""));
  const [page, setPage] = useState(0);

  // halaman yang berlaku (mis. "Pendekatan" dilewati kalau tujuannya cuma berita)
  const active = (p = picked) => questions.map((q, i) => i).filter((i) => !questions[i].skip?.(p));
  const pages = active();
  const pos = Math.max(0, pages.indexOf(page));
  const qi = pages[pos] ?? 0;
  const q = questions[qi];

  const answersOf = (p: string[][], o: string[]) =>
    questions.map((x, i) => {
      const a = [...p[i], ...(o[i].trim() ? [o[i].trim().slice(0, 160)] : [])];
      return a.length ? a : [x.options.find((y) => y.rec)?.label ?? x.options[0]?.label ?? ""];
    });
  const next = (p = picked, o = other) => {
    if (disabled) return;
    const list = active(p);
    const at = list.indexOf(qi);
    if (at < list.length - 1) setPage(list[at + 1]);
    else onDone(answersOf(p, o));
  };
  const choose = (label: string) => {
    if (disabled) return;
    const p = picked.map((arr, i) => (i !== qi ? arr : q.multi ? (arr.includes(label) ? arr.filter((x) => x !== label) : [...arr, label]) : [label]));
    setPicked(p);
    if (!q.multi) next(p);
  };
  const last = pos === pages.length - 1;

  return (
    <div className={`my-1 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 ${disabled ? "opacity-60" : ""}`} style={{ boxShadow: "var(--shadow-sm)" }}>
      <div className="flex items-start gap-2 px-3.5 pb-1 pt-3">
        <div className="min-w-0 flex-1">
          {title && <div className="mb-0.5 text-[12px] text-zinc-500">{title}</div>}
          <div className="text-[14px] font-bold leading-snug">
            {q.q}
            {q.multi && <span className="ml-1.5 text-[11px] font-medium text-zinc-500">(boleh lebih dari satu)</span>}
          </div>
        </div>
        {pages.length > 1 && (
          <div className="flex shrink-0 items-center gap-0.5 text-[12px] text-zinc-500">
            <button type="button" aria-label="Pertanyaan sebelumnya" disabled={pos === 0} onClick={() => setPage(pages[pos - 1])} className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-zinc-800 disabled:opacity-30">
              ‹
            </button>
            <span className="tabular-nums">
              {pos + 1} / {pages.length}
            </span>
            <button
              type="button"
              aria-label="Pertanyaan berikutnya"
              disabled={last || (!picked[qi].length && !other[qi].trim())}
              onClick={() => setPage(pages[pos + 1])}
              className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-zinc-800 disabled:opacity-30"
            >
              ›
            </button>
          </div>
        )}
      </div>

      <div className="px-2 pb-1 pt-1">
        {q.options.map((o, i) => {
          const on = picked[qi].includes(o.label);
          return (
            <button
              key={o.label}
              type="button"
              disabled={disabled || o.off}
              title={o.off ? o.hint : undefined}
              onClick={() => choose(o.label)}
              className={`flex w-full items-start gap-2.5 rounded-xl px-2 py-2 text-left text-[13px] transition ${on ? "bg-orange-500/10" : "hover:bg-zinc-800/50"} ${o.off ? "cursor-not-allowed opacity-40" : ""}`}
            >
              <span
                className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center text-[11px] font-bold ${q.multi ? "rounded-md" : "rounded-full"} ${on ? "bg-orange-500 text-white" : "border border-zinc-700 text-zinc-500"}`}
              >
                {q.multi && on ? "✓" : i + 1}
              </span>
              <span className="min-w-0">
                <b className="block font-semibold">
                  {o.label}
                  {o.rec && <span className="ml-1.5 rounded-md bg-orange-500/15 px-1.5 py-px text-[10px] font-bold text-orange-500">Disarankan</span>}
                </b>
                {o.desc && <span className="block text-[12px] text-zinc-500">{o.desc}</span>}
              </span>
            </button>
          );
        })}
        {q.other !== false && (
          <div className="flex items-center gap-2.5 px-2 py-1.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[12px] text-zinc-500">✍️</span>
            <input
              value={other[qi]}
              disabled={disabled}
              onChange={(e) => setOther(other.map((x, i) => (i === qi ? e.target.value : x)))}
              onKeyDown={(e) => e.key === "Enter" && other[qi].trim() && next()}
              placeholder="Lainnya… ketik sendiri, Enter"
              className="input w-full border-dashed py-1.5 text-[12.5px]"
            />
          </div>
        )}
      </div>

      {!disabled && (
        <div className="flex items-center justify-between gap-2 border-t border-zinc-800/70 px-3.5 py-2">
          <button type="button" onClick={onSkip} className="text-[12.5px] font-semibold text-zinc-500 hover:text-zinc-200">
            {skipLabel}
          </button>
          {(q.multi || other[qi].trim() || picked[qi].length > 0) && (
            <button type="button" onClick={() => next()} className="rounded-xl bg-orange-600 px-3.5 py-1.5 text-[12.5px] font-bold text-white hover:bg-orange-500">
              {last ? "Kirim →" : "Lanjut →"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
