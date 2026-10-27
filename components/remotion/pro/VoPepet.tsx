"use client";

import { useMemo, useState } from "react";
import type { LexEntry } from "@/lib/studio/pronounce";
import { pepetSegments } from "@/lib/studio/spellTry";
import type { Timeline } from "@/lib/studio/timeline";
import VoSpellTry from "./VoSpellTry";

/**
 * 🎧 Coba ejaan huruf e (panel Suara VO): naskah VO tiap adegan dengan kata ber-e pepet yang YAKIN diberi garis bawah titik-titik
 * halus (lib/studio/pepet.ts). Ketuk kata (juga kata ber-e lain) → popover VoSpellTry: dengar beberapa ejaan di laptop, pilih
 * pakai telinga. Mode Edge: hanya keterangan (suara cadangan biasanya sudah benar), fitur nonaktif.
 */
export default function VoPepet({ timeline, onLexicon, disabled }: { timeline: Timeline; onLexicon: (lex: LexEntry[] | undefined) => void; disabled?: boolean }) {
  const mode = timeline.voice.mode;
  const lex = timeline.voice.lexicon;
  const [open, setOpen] = useState<{ sceneId: string; word: string; at: number } | null>(null);
  const rows = useMemo(
    () => timeline.scenes.filter((s) => s.vo?.text).map((s) => ({ s, segs: pepetSegments(s.vo!.text, lex) })),
    [timeline.scenes, lex],
  );
  const n = useMemo(() => new Set(rows.flatMap((r) => r.segs.filter((x) => x.tok?.pepet).map((x) => x.text.toLowerCase()))).size, [rows]);
  if (mode !== "bank" && mode !== "edge") return null;
  if (!rows.length) return null;

  return (
    <details className="group rounded-xl border border-zinc-800 px-3 py-2" data-vo-pepet>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        <span>
          🎧 Coba ejaan huruf e{mode === "bank" && n ? <span className="ml-1 text-xs font-normal text-zinc-500">({n} kata e pepet)</span> : null}
        </span>
        <span aria-hidden className="text-[11px] text-zinc-500 transition group-open:rotate-90">
          ▶
        </span>
      </summary>
      {mode === "edge" ? (
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-500" data-vo-pepet-edge>
          🛟 Suara cadangan (Edge) biasanya sudah membaca huruf e dengan benar (bareng, enak). 🎧 Coba ejaan khusus untuk 🎙️ Bank suara laptop — pilih Bank suara di atas
          kalau mau memakainya.
        </p>
      ) : (
        <div className="mt-2 space-y-2.5">
          <p className="text-[11px] leading-relaxed text-zinc-500">
            Huruf e punya 2 bunyi: <b className="font-semibold text-zinc-400">ə</b> (bareng, dengan) dan <b className="font-semibold text-zinc-400">é</b> (enak, sore). Kata bergaris
            titik-titik = e dibaca ə. Kalau mesin bank salah baca, ketuk katanya → dengar beberapa ejaan → pilih yang pas. Kata lain yang ada huruf e juga bisa diketuk.
          </p>
          {rows.map(({ s, segs }) => (
            <div key={s.id} className="min-w-0" data-pepet-scene={s.id}>
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-zinc-500">{s.name}</div>
              <p className="break-words text-[13px] leading-[1.9] text-zinc-300" data-pepet-text>
                {segs.map((x, k) => {
                  if (!x.tok) return <span key={k}>{x.text}</span>;
                  const t = x.tok;
                  const active = open?.sceneId === s.id && open.at === t.start;
                  const tone = active
                    ? "bg-orange-500/20 text-orange-200"
                    : t.fixed
                      ? "underline decoration-dotted decoration-emerald-400 decoration-[1.5px] underline-offset-[4px] hover:bg-emerald-500/10"
                      : t.pepet
                        ? "underline decoration-dotted decoration-zinc-500 decoration-[1.5px] underline-offset-[4px] hover:bg-zinc-800"
                        : "hover:bg-zinc-800";
                  return (
                    <button
                      key={k}
                      type="button"
                      disabled={disabled}
                      className={`inline rounded px-[1px] text-left align-baseline transition disabled:cursor-default ${tone}`}
                      title={t.fixed ? `Dieja “${t.fixed}” (khusus bank suara)` : t.pepet ? "e dibaca ə — ketuk untuk coba ejaan" : "Ketuk untuk coba ejaan"}
                      aria-label={`Coba ejaan “${x.text}”${t.fixed ? `, sekarang dieja ${t.fixed}` : t.pepet ? ", e dibaca ə" : ""}`}
                      aria-expanded={active}
                      onClick={() => setOpen(active ? null : { sceneId: s.id, word: x.text, at: t.start })}
                      data-pepet-word={x.text.toLowerCase()}
                      data-pepet={t.pepet ? "1" : "0"}
                      {...(t.fixed ? { "data-pepet-fixed": t.fixed } : {})}
                    >
                      {x.text}
                    </button>
                  );
                })}
              </p>
              {open?.sceneId === s.id && (
                <VoSpellTry key={`${open.word}-${open.at}`} scene={s} timeline={timeline} word={open.word} onLexicon={onLexicon} onClose={() => setOpen(null)} />
              )}
            </div>
          ))}
        </div>
      )}
    </details>
  );
}
