"use client";

import { useState } from "react";
import { personaIntro, personaOf, stepLabel } from "@/lib/aiPersona";
import type { AiStep } from "./AiChat";

/**
 * Proses "lagi mikir" ala Claude, dengan kalimat sesuai karakter hero:
 * langkah asli dari server (pahami pertanyaan, cari internet, ambil harga, tulis jawaban) muncul satu per satu.
 * Setelah jawaban mulai keluar, dilipat jadi "Lihat proses".
 */
export default function ThinkingSteps({
  hero,
  steps,
  live,
  startedAt,
  doneAt,
}: {
  hero: string;
  steps: AiStep[];
  live: boolean;
  startedAt?: number;
  doneAt?: number;
}) {
  const [open, setOpen] = useState(false);
  const p = personaOf(hero);
  const shown = steps.filter((s) => s.s !== "skip");
  const secs = startedAt && doneAt ? Math.max(1, Math.round((doneAt - startedAt) / 1000)) : null;

  const list = (
    <ul className="mt-1 space-y-1">
      {shown.map((s) => (
        <li key={s.id} className="flex items-start gap-2 text-[12.5px] text-zinc-300">
          <span className="mt-[1px] w-4 shrink-0 text-center">
            {s.k === "switch" ? "↪" : s.s === "done" ? <span className="font-bold text-emerald-400">✓</span> : <span className="inline-block animate-spin">⏳</span>}
          </span>
          <span className="min-w-0 flex-1">{stepLabel(hero, s, s.s === "done")}</span>
          {s.s === "done" && s.n !== undefined && s.k === "search" && <span className="shrink-0 text-[11px] text-zinc-500">{s.n} sumber</span>}
          {s.s === "done" && s.src && <span className="shrink-0 text-[11px] text-zinc-500">{s.src}</span>}
        </li>
      ))}
      {live && !shown.length && <li className="text-[12.5px] text-zinc-500">⏳ …</li>}
    </ul>
  );

  if (live) {
    return (
      <div className="rounded-xl border border-zinc-800 px-3 py-2">
        <div className="text-[12.5px] font-bold text-orange-400">
          {hero} ({p.type}): “{personaIntro(hero)}”
        </div>
        {list}
      </div>
    );
  }
  if (!shown.length) return null;
  return (
    <div className="mb-1.5">
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-[11.5px] font-semibold text-zinc-500 hover:text-zinc-300">
        ⚙️ {open ? "Sembunyikan proses ▾" : "Lihat proses ▸"} <span className="font-normal">({shown.length} langkah{secs ? ` · ${secs} detik` : ""})</span>
      </button>
      {open && <div className="mt-1 rounded-xl border border-zinc-800 px-3 py-2">{list}</div>}
    </div>
  );
}
