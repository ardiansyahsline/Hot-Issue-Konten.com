"use client";

import { useEffect, useState } from "react";

const MINE = process.env.NEXT_PUBLIC_BUILD_ID ?? "";

/**
 * Tab yang dibuka sebelum web di-update masih memakai kode lama (mis. kartu desain TWS tampil sebagai teks JSON).
 * Cek versi tiap balik ke tab & tiap 5 menit; kalau sudah ada versi baru, tampilkan tombol muat ulang.
 */
export default function UpdateNotice() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (!MINE) return;
    const check = async () => {
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        const { v } = (await r.json()) as { v?: string };
        if (v && v !== MINE) setStale(true);
      } catch {
        /* offline: cek lagi nanti */
      }
    };
    const onVis = () => document.visibilityState === "visible" && check();
    const iv = setInterval(check, 5 * 60_000);
    document.addEventListener("visibilitychange", onVis);
    check();
    return () => {
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
  if (!stale) return null;
  return (
    <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div className="card flex items-center gap-3 px-4 py-2.5 text-[13px]">
        <span>🔄 Ada versi baru CS Tracker</span>
        <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={() => location.reload()}>
          Muat ulang
        </button>
      </div>
    </div>
  );
}
