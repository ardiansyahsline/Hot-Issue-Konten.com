"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * Satu baris yang SELALU sejajar (tidak turun ke bawah): kalau isinya tidak muat (mis. di HP),
 * seluruh baris diperkecil proporsional (CSS zoom) sampai pas.
 */
export default function FitRow({ className = "", min = 0.6, children }: { className?: string; min?: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const box = el?.parentElement;
    if (!el || !box) return;
    const fit = () => {
      el.style.zoom = "1";
      const need = el.scrollWidth;
      const room = el.clientWidth;
      el.style.zoom = need > room + 1 ? String(Math.max(min, Math.floor((room / need) * 1000) / 1000)) : "1";
    };
    fit();
    document.fonts?.ready.then(fit).catch(() => {});
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
  });
  return (
    <div ref={ref} className={`flex flex-nowrap items-center ${className}`}>
      {children}
    </div>
  );
}
