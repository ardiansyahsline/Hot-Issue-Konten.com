"use client";

import { useLayoutEffect, useRef } from "react";
import { personaOf, personaTagline } from "@/lib/aiPersona";

const BASE = 11.5; // ukuran huruf normal (px)
const MIN = 4; // batas pengaman saja — teks selalu dikecilkan sampai muat 1 baris (tidak dipotong / menabrak)

/**
 * Keterangan siapa yang menjawab, di atas jawaban: "👋 Kamu dibantu oleh Yve · INTJ Si Perencana — strategis, rapi, …".
 * Selalu SATU baris & utuh: kalau tidak muat (HP), hurufnya otomatis diperkecil sampai pas — tidak dipotong, tidak menabrak.
 */
export default function HelperLine({ hero, via }: { hero: string; via?: string | null }) {
  const ref = useRef<HTMLSpanElement>(null);
  const t = personaTagline(hero);
  // mode otomatis: Layla si tuan rumah yang memilihkan hero penjawab
  const picker = via && via !== t.name ? personaOf(via) : null;
  const lead = picker ? `${picker.hero} si ${picker.label.replace(/^Si\s+/i, "").toLowerCase()} milihin` : "Kamu dibantu oleh";
  const tail = picker ? " buat kamu" : "";

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
      for (let i = 0; i < 40 && size > MIN && el.offsetWidth > room; i++) el.style.fontSize = `${(size = Math.max(MIN, size - 0.1))}px`;
    };
    fit();
    // ukur ulang setelah font selesai dimuat (lebar teks berubah)
    document.fonts?.ready.then(fit).catch(() => {});
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
  }, [t.name, t.kind, t.sifat, lead]);

  return (
    <div className="mb-1.5 min-w-0 overflow-hidden">
      <span
        ref={ref}
        title={`${lead} ${t.name}${tail} · ${t.kind} — ${t.sifat}`}
        className="inline-block whitespace-nowrap rounded-xl border border-zinc-800 bg-zinc-900 px-2 py-1 sm:px-2.5 leading-tight text-zinc-400"
        style={{ fontSize: BASE, boxShadow: "var(--shadow-sm)" }}
      >
        👋 {lead} <b className="font-semibold text-zinc-100">{t.name}</b>
        {tail} · {t.kind} — {t.sifat}
      </span>
    </div>
  );
}
