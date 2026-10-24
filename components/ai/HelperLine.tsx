"use client";

import { useState } from "react";
import { personaTagline } from "@/lib/aiPersona";

/**
 * Keterangan siapa yang menjawab, di atas jawaban: "Kamu dibantu oleh Yve · INTJ Si Perencana — strategis, rapi, …".
 * Di layar sempit teksnya dipotong rapi (…); tap untuk lihat lengkap.
 */
export default function HelperLine({ hero }: { hero: string }) {
  const [open, setOpen] = useState(false);
  const t = personaTagline(hero);
  const full = `Kamu dibantu oleh ${t.name} · ${t.kind} — ${t.sifat}`;
  return (
    <button
      type="button"
      onClick={() => setOpen((o) => !o)}
      title={full}
      aria-expanded={open}
      className={`min-w-0 max-w-full bg-orange-500/10 px-2 py-0.5 text-left text-[11px] text-zinc-400 ${open ? "whitespace-normal rounded-xl" : "truncate rounded-full"}`}
    >
      Kamu dibantu oleh <b className="font-semibold text-orange-400">{t.name}</b> · {t.kind} <span className="text-zinc-500">— {t.sifat}</span>
    </button>
  );
}
