"use client";

import { useState } from "react";
import { CHOICE_SKIP, choiceAnswer, type Choice } from "@/lib/choiceCard";

/**
 * Kartu pertanyaan balik dari AI (blok ```ask): 1–3 pertanyaan, pilihan bisa diklik, "Lainnya", dan "Lewati".
 * Klik = langsung terkirim kalau semua pertanyaan sudah terjawab (pilihan ganda pakai tombol Kirim).
 */
export default function ChoiceCard({ choice, disabled, onSubmit }: { choice: Choice; disabled?: boolean; onSubmit: (text: string) => void }) {
  const qs = choice.questions;
  const [picked, setPicked] = useState<string[][]>(() => qs.map(() => []));
  const [other, setOther] = useState<string[]>(() => qs.map(() => ""));
  const hasMulti = qs.some((q) => q.multi);

  const answerOf = (i: number, p = picked, o = other) => {
    const a = [...p[i], ...(o[i].trim() ? [o[i].trim().slice(0, 160)] : [])];
    return a.length ? a : [qs[i].options.find((x) => x.rec)?.label ?? qs[i].options[0].label];
  };
  const submit = (p = picked, o = other) => {
    if (disabled) return;
    onSubmit(choiceAnswer(qs.map((q, i) => ({ q: q.q, a: answerOf(i, p, o) }))));
  };
  const toggle = (qi: number, label: string) => {
    if (disabled) return;
    const next = picked.map((arr, i) => (i !== qi ? arr : qs[qi].multi ? (arr.includes(label) ? arr.filter((x) => x !== label) : [...arr, label]) : [label]));
    setPicked(next);
    // semua pertanyaan pilihan tunggal & sudah terjawab -> langsung kirim
    if (!hasMulti && next.every((arr, i) => arr.length || other[i].trim())) submit(next);
  };

  return (
    <div className={`my-1 overflow-hidden rounded-2xl border border-zinc-800 ${disabled ? "opacity-60" : ""}`}>
      {choice.title && (
        <div className="border-b border-zinc-800/70 px-3.5 py-3 text-[14px] font-bold">
          {choice.title}
          <small className="mt-0.5 block text-[12px] font-medium text-zinc-500">{disabled ? "Sudah dijawab." : hasMulti ? "Boleh pilih lebih dari satu, lalu Kirim." : "Klik pilihan — langsung terkirim."}</small>
        </div>
      )}
      {qs.map((q, qi) => (
        <div key={qi} className="border-b border-zinc-800/70 last:border-b-0">
          <div className="px-3.5 pb-1 pt-2.5 text-[13px] font-semibold">
            {qs.length > 1 && <span className="mr-1 text-zinc-500">{qi + 1}.</span>}
            {q.q}
            {q.multi && <span className="ml-1.5 text-[11px] font-medium text-zinc-500">(bisa lebih dari satu)</span>}
          </div>
          {q.options.map((o) => {
            const on = picked[qi].includes(o.label);
            return (
              <button
                key={o.label}
                type="button"
                disabled={disabled}
                onClick={() => toggle(qi, o.label)}
                className={`flex w-full items-start gap-2.5 px-3.5 py-2 text-left text-[13px] ${on ? "bg-orange-500/10" : "hover:bg-zinc-800/40"}`}
              >
                <span
                  className={`mt-0.5 h-4 w-4 shrink-0 border-2 ${q.multi ? "rounded" : "rounded-full"} ${on ? (q.multi ? "border-orange-500 bg-orange-500" : "border-orange-500 bg-[radial-gradient(#ea580c_45%,transparent_50%)]") : "border-zinc-600"}`}
                />
                <span className="min-w-0">
                  <b className="block">
                    {o.label}
                    {o.rec && <span className="ml-1.5 rounded-md bg-orange-500/15 px-1.5 py-px text-[10px] font-bold text-orange-500">Disarankan</span>}
                  </b>
                  {o.desc && <span className="text-[12px] text-zinc-500">{o.desc}</span>}
                </span>
              </button>
            );
          })}
          <div className="px-3.5 pb-2.5 pt-1">
            <input
              value={other[qi]}
              disabled={disabled}
              onChange={(e) => setOther(other.map((x, i) => (i === qi ? e.target.value : x)))}
              onKeyDown={(e) => e.key === "Enter" && other[qi].trim() && submit()}
              placeholder="✍️ Lainnya… (ketik sendiri, Enter untuk kirim)"
              className="input w-full border-dashed py-1.5 text-[12.5px]"
            />
          </div>
        </div>
      ))}
      {!disabled && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800/70 px-3.5 py-2.5">
          <button type="button" onClick={() => onSubmit(CHOICE_SKIP)} className="rounded-xl border border-zinc-800 px-3 py-1.5 text-[12.5px] font-bold hover:border-zinc-600">
            {choice.skip || "Lewati, langsung kerjain"}
          </button>
          {(hasMulti || qs.length > 1) && (
            <button type="button" onClick={() => submit()} className="rounded-xl bg-orange-600 px-3.5 py-1.5 text-[12.5px] font-bold text-white hover:bg-orange-500">
              Kirim →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
