"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { heardDiff, spellSuggestions } from "@/lib/studio/heard";
import { LEX_FROM_MAX, LEX_TO_MAX, MAX_LEXICON, normLexicon, type LexEntry } from "@/lib/studio/pronounce";

const lexKey = (s: string) => s.toLowerCase().replace(/[\s-]+/g, "");

/**
 * tambah / ganti satu kata di kamus ejaan proyek (kata yang sama diganti di tempatnya). Kamus penuh (60) & kata baru → null.
 */
export function upsertLexicon(lex: readonly LexEntry[] | undefined, e: LexEntry): LexEntry[] | null {
  const cur = normLexicon(lex ?? []);
  const k = lexKey(e.from);
  const at = cur.findIndex((x) => lexKey(x.from) === k);
  if (at < 0 && cur.length >= MAX_LEXICON) return null;
  const next = at >= 0 ? cur.map((x, i) => (i === at ? e : x)) : [...cur, e];
  return normLexicon(next);
}

/**
 * 👂 Terdengar: teks yang didengar pengecek ucapan (ASR) di laptop untuk suara bank adegan ini, dengan kata yang beda dari naskah
 * disorot. Klik kata → isian "Perbaiki ejaan" (isi awal = saran bunyi luncur / suku kata) → masuk 📖 Kamus ejaan proyek
 * (`onFix`) → tombol "Buat ulang kalimat ini" (`onRebuild`). Angka vs kata ("16.800" / "enam belas ribu…") & ejaan kamus yang
 * sudah dipakai ("PPT" / "pepete") tidak dianggap salah (lib/studio/heard.ts).
 */
export default function VoHeard({
  text,
  heard,
  spell,
  lexicon,
  sample,
  onFix,
  onRebuild,
  rebuildBusy,
  rebuildNote,
  onTry,
}: {
  text: string;
  heard: string;
  spell?: string | null;
  lexicon?: LexEntry[];
  /** true = teks terdengar dari contoh 🔊 Dengar (belum dipakai di VO proyek) */
  sample?: boolean;
  /** simpan ejaan ke kamus proyek; balikan pesan gagal (mis. kamus penuh) atau null */
  onFix?: (e: LexEntry) => string | null;
  onRebuild?: () => void;
  rebuildBusy?: boolean;
  rebuildNote?: string | null;
  /** 🎧 Coba ejaan kata ini di laptop (beberapa ejaan sekaligus, pilih pakai telinga) — hanya mode bank suara */
  onTry?: (word: string) => void;
}) {
  const uid = useId();
  const diff = useMemo(() => heardDiff(text, heard, { spell, lexicon }), [text, heard, spell, lexicon]);
  const [open, setOpen] = useState<{ ref: number; heard: string } | null>(null);
  const [val, setVal] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<LexEntry[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // teks terdengar berganti (suara baru) → isian & catatan lama ditutup
  useEffect(() => {
    setOpen(null);
    setErr(null);
    setSaved([]);
  }, [heard]);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const refWord = open ? diff.refs[open.ref] ?? "" : "";
  const sugg = useMemo(() => (refWord ? spellSuggestions(refWord, lexicon) : []), [refWord, lexicon]);
  const fixedKeys = new Set(saved.map((e) => lexKey(e.from)));
  const pick = (ref: number, heardTxt: string) => {
    const w = diff.refs[ref];
    if (!w || !onFix) return;
    setErr(null);
    setOpen({ ref, heard: heardTxt });
    const s = spellSuggestions(w, lexicon);
    const own = lexicon?.find((e) => lexKey(e.from) === lexKey(w))?.to;
    setVal((s[0] ?? own ?? w.toLowerCase()).slice(0, LEX_TO_MAX));
  };
  const save = () => {
    if (!open || !onFix) return;
    const to = val.replace(/\s+/g, " ").trim();
    const from = refWord.slice(0, LEX_FROM_MAX);
    if (!to) return setErr("Isi dulu cara bacanya.");
    if (lexKey(to) === lexKey(from) && to.toLowerCase() === from.toLowerCase()) return setErr("Tulis cara baca yang beda dari tulisannya.");
    const e = onFix({ from, to });
    if (e) return setErr(e);
    setSaved((x) => [...x.filter((y) => lexKey(y.from) !== lexKey(from)), { from, to }]);
    setOpen(null);
  };

  const missing = diff.missing.map((i) => ({ i, w: diff.refs[i] })).filter((x) => x.w);
  const badN = diff.parts.filter((p) => !p.ok).length;

  return (
    <div className="space-y-1.5 rounded-lg border border-zinc-800/80 bg-zinc-900/50 px-2.5 py-2" data-vo-heard>
      <p className="break-words text-[11.5px] leading-relaxed text-zinc-400">
        <span className="font-semibold text-zinc-300">👂 Terdengar{sample ? " (contoh)" : ""}:</span>{" "}
        <span className="text-zinc-200" data-vo-heard-text>
          “
          {diff.parts.map((p, k) => {
            const pre = p.pre;
            if (p.ok) return <span key={k}>{pre}{p.text}</span>;
            const ref = p.ref;
            const fixed = ref !== null && fixedKeys.has(lexKey(diff.refs[ref] ?? ""));
            if (ref === null || !onFix)
              return (
                <span key={k}>
                  {pre}
                  <mark className="rounded bg-amber-500/15 px-0.5 text-amber-300" title={ref === null ? "Kata tambahan — tidak ada di naskah" : `Naskah: ${diff.refs[ref]}`} data-heard-extra>
                    {p.text}
                  </mark>
                </span>
              );
            const active = open?.ref === ref;
            return (
              <span key={k}>
                {pre}
                <button
                  type="button"
                  className={`rounded px-0.5 font-semibold underline decoration-dotted underline-offset-2 transition ${fixed ? "bg-emerald-500/15 text-emerald-300 decoration-emerald-400" : active ? "bg-orange-500/25 text-orange-200 decoration-orange-400" : "bg-amber-500/20 text-amber-200 decoration-amber-400 hover:bg-amber-500/30"}`}
                  aria-label={`Perbaiki ejaan “${diff.refs[ref]}” (terdengar “${p.text}”)`}
                  aria-expanded={active}
                  aria-controls={`${uid}-fix`}
                  onClick={() => (active ? setOpen(null) : pick(ref, p.text))}
                  data-heard-bad={diff.refs[ref]}
                >
                  {p.text}
                </button>
              </span>
            );
          })}
          {diff.tail}”
        </span>
      </p>
      {diff.clean ? (
        <p className="text-[10.5px] text-emerald-400" data-vo-heard-ok>
          ✅ Sama dengan naskah.
        </p>
      ) : (
        <p className="text-[10.5px] leading-relaxed text-zinc-500" data-vo-heard-sum>
          {badN > 0 ? `${badN} bagian terdengar beda dari naskah` : ""}
          {badN > 0 && missing.length ? " · " : ""}
          {missing.length ? `${missing.length} kata tidak terdengar` : ""}
          {onFix ? ". Klik kata yang disorot untuk perbaiki ejaannya." : "."}
        </p>
      )}
      {missing.length > 0 && (
        <p className="flex flex-wrap items-center gap-1 text-[11px] text-zinc-400" data-vo-heard-missing>
          <span>Tidak terdengar:</span>
          {missing.map(({ i, w }) =>
            onFix ? (
              <button
                key={i}
                type="button"
                className={`rounded px-1 font-semibold line-through decoration-amber-400/70 ${open?.ref === i ? "bg-orange-500/25 text-orange-200" : "bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"}`}
                aria-label={`Perbaiki ejaan “${w}” (tidak terdengar)`}
                onClick={() => (open?.ref === i ? setOpen(null) : pick(i, ""))}
                data-heard-missing={w}
              >
                {w}
              </button>
            ) : (
              <span key={i} className="rounded bg-amber-500/15 px-1 text-amber-300 line-through">
                {w}
              </span>
            ),
          )}
        </p>
      )}
      {open && onFix && (
        <div id={`${uid}-fix`} className="space-y-1.5 rounded-lg bg-zinc-950/60 px-2.5 py-2" data-vo-fix>
          <label htmlFor={`${uid}-val`} className="block text-[11.5px] font-semibold text-zinc-300">
            ✏️ Perbaiki ejaan “{refWord}”
            <span className="font-normal text-zinc-500">{open.heard ? ` — terdengar “${open.heard}”` : " — tidak terdengar"}</span>
          </label>
          <div className="flex items-center gap-1.5">
            <input
              ref={inputRef}
              id={`${uid}-val`}
              className="input min-w-0 flex-1 py-1.5 text-[12.5px]"
              value={val}
              maxLength={LEX_TO_MAX}
              placeholder="Tulis seperti diucapkan"
              onChange={(e) => setVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") setOpen(null);
              }}
              data-vo-fix-input
            />
            <button type="button" className="btn-primary flex-none px-3 py-1.5 text-[12px]" onClick={save} data-vo-fix-save>
              Simpan
            </button>
          </div>
          {sugg.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 text-[11px] text-zinc-500">
              <span>Saran:</span>
              {sugg.map((x) => (
                <button key={x} type="button" className={`rounded-md border px-1.5 py-0.5 ${val === x ? "border-orange-500 text-orange-300" : "border-zinc-700 text-zinc-300 hover:border-zinc-600"}`} onClick={() => setVal(x)} data-vo-fix-sugg>
                  {x}
                </button>
              ))}
            </div>
          )}
          {onTry && (
            <button
              type="button"
              className="text-[12px] font-semibold text-orange-400 hover:text-orange-300"
              onClick={() => {
                onTry(refWord);
                setOpen(null);
              }}
              data-vo-fix-try
            >
              🎧 Bingung ejaannya? Coba beberapa sekaligus di laptop
            </button>
          )}
          <p className="text-[10.5px] text-zinc-500">Masuk 📖 Kamus ejaan proyek — dipakai di semua adegan. Subtitle tetap tulisan asli.</p>
          {err && (
            <p className="text-[11px] text-red-400" role="alert">
              {err}
            </p>
          )}
        </div>
      )}
      {saved.length > 0 && (
        <div className="space-y-1.5 rounded-lg bg-emerald-500/10 px-2.5 py-2 text-[11.5px] text-emerald-300" role="status" data-vo-fix-done>
          <p>
            ✅ Masuk 📖 Kamus ejaan: {saved.map((e) => `${e.from} → ${e.to}`).join(" · ")}. Suaranya belum berubah sampai dibuat ulang.
          </p>
          {onRebuild && (
            <button type="button" className="btn-ghost px-2.5 py-1 text-[12px]" disabled={rebuildBusy} onClick={onRebuild} data-vo-rebuild>
              🔁 {rebuildBusy ? "Lagi dibuat ulang…" : "Buat ulang kalimat ini"}
            </button>
          )}
          {rebuildNote && <p className="text-[10.5px] text-emerald-300/80">{rebuildNote}</p>}
        </div>
      )}
    </div>
  );
}
