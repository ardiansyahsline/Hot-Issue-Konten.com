"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { personaOf, personaTagline } from "@/lib/aiPersona";

const BASE = 11.5; // ukuran huruf normal (px)
const MIN = 7; // batas terkecil supaya tetap terbaca; kalau masih tidak muat -> bisa digeser ke samping (tidak dipotong)

/**
 * Keterangan siapa yang menjawab, di atas jawaban: "👋 Kamu dibantu oleh Yve · INTJ Si Perencana — strategis, rapi, …".
 * Selalu SATU baris & utuh (tidak dipotong): kalau tidak muat (HP), hurufnya otomatis diperkecil;
 * kalau sudah sekecil batas terbaca tapi masih panjang, barisnya bisa digeser ke samping (ujung kanan memudar sebagai tanda).
 */
export default function HelperLine({ hero, via }: { hero: string; via?: string | null }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [more, setMore] = useState(false); // masih ada teks di kanan (perlu digeser)
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
      setMore(false);
      if (!room || el.offsetWidth <= room) return;
      // padding & border tidak ikut mengecil -> hitung skala dari lebar teksnya saja, lalu rapikan sampai benar-benar muat
      const cs = getComputedStyle(el);
      const fixed = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
      let size = Math.max(MIN, (BASE * (room - fixed)) / (el.offsetWidth - fixed));
      el.style.fontSize = `${size}px`;
      for (let i = 0; i < 12 && size > MIN && el.offsetWidth > room; i++) el.style.fontSize = `${(size = Math.max(MIN, size - 0.2))}px`;
      setMore(el.offsetWidth > room + 1 && box.scrollLeft < box.scrollWidth - room - 2);
    };
    fit();
    // ukur ulang setelah font selesai dimuat (lebar teks berubah)
    document.fonts?.ready.then(fit).catch(() => {});
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
  }, [t.name, t.kind, t.sifat, lead]);

  return (
    <div
      className="mb-1.5 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      onScroll={(e) => {
        const b = e.currentTarget;
        setMore(b.scrollLeft < b.scrollWidth - b.clientWidth - 2);
      }}
      style={more ? { maskImage: "linear-gradient(to right, #000 85%, transparent)", WebkitMaskImage: "linear-gradient(to right, #000 85%, transparent)" } : undefined}
    >
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
