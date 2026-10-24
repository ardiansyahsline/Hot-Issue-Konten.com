"use client";

import { useLayoutEffect, useRef } from "react";
import { personaTagline } from "@/lib/aiPersona";

const BASE = 11.5; // ukuran huruf normal (px)
const MIN = 6; // batas terkecil (HP sangat sempit) — teks tetap utuh 1 baris

/**
 * Keterangan siapa yang menjawab, di atas jawaban: "👋 Kamu dibantu oleh Yve · INTJ Si Perencana — strategis, rapi, …".
 * Selalu SATU baris & utuh (tidak dipotong): kalau tidak muat (HP), hurufnya otomatis diperkecil.
 */
export default function HelperLine({ hero }: { hero: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const t = personaTagline(hero);

  useLayoutEffect(() => {
    const el = ref.current;
    const box = el?.parentElement;
    if (!el || !box) return;
    const fit = () => {
      el.style.fontSize = `${BASE}px`;
      const room = box.clientWidth;
      if (!room || el.offsetWidth <= room) return;
      // padding & border tidak ikut mengecil -> hitung skala dari lebar teksnya saja, lalu rapikan sampai benar-benar muat
      const cs = getComputedStyle(el);
      const fixed = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
      let size = Math.max(MIN, (BASE * (room - fixed)) / (el.offsetWidth - fixed));
      el.style.fontSize = `${size}px`;
      for (let i = 0; i < 12 && size > MIN && el.offsetWidth > room; i++) el.style.fontSize = `${(size = Math.max(MIN, size - 0.2))}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
  }, [t.name, t.kind, t.sifat]);

  return (
    <div className="mb-1.5 min-w-0">
      <span
        ref={ref}
        title={`Kamu dibantu oleh ${t.name} · ${t.kind} — ${t.sifat}`}
        className="inline-block whitespace-nowrap rounded-xl border border-zinc-800 bg-zinc-900 px-2 py-1 sm:px-2.5 leading-tight text-zinc-400"
        style={{ fontSize: BASE, boxShadow: "var(--shadow-sm)" }}
      >
        👋 Kamu dibantu oleh <b className="font-semibold text-zinc-100">{t.name}</b> · {t.kind} — {t.sifat}
      </span>
    </div>
  );
}
