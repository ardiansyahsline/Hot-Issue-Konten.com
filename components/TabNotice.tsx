"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { isTabId, tabClosedText, type TabId } from "@/lib/tabs";
import { useClosedTabs, useTabCheck } from "./TabAccessProvider";

/**
 * Pesan kecil sesudah dialihkan dari tab yang ditutup admin (alamat berisi ?tutup=<tab>).
 * ?tutup=semua ditangani halaman /akun sendiri. Param dibuang dari alamat, lalu daftar tab dicek ulang ke server:
 * menu & chat melayang langsung ikut (lewat TabAccessProvider, tanpa refresh), dan pesan hanya muncul kalau tab itu
 * memang ditutup (link ?tutup= buatan orang lain tidak memunculkan pesan palsu).
 */
export default function TabNotice() {
  const sp = useSearchParams();
  const path = usePathname();
  const closed = useClosedTabs();
  const check = useTabCheck();
  const [shown, setShown] = useState<{ tab: TabId; path: string } | null>(null);
  const tutup = sp.get("tutup");

  // nilai terbaru untuk efek di bawah (efek sengaja tidak diulang saat daftar berubah)
  const closedRef = useRef(closed);
  const alive = useRef(true);
  useEffect(() => {
    closedRef.current = closed;
  }, [closed]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!tutup) return;
    const here = window.location.pathname;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("tutup");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    } catch {}
    const tab = isTabId(tutup) ? tutup : null;
    const known = !!tab && closedRef.current.includes(tab);
    if (known) setShown({ tab, path: here });
    // selalu cek ulang: menu basi (layout tidak dirender ulang saat dialihkan) ikut diperbarui
    void check().then((fresh) => {
      if (tab && !known && alive.current && fresh?.includes(tab)) setShown({ tab, path: here });
    });
  }, [tutup, check]);

  // pindah halaman -> pesan hilang sendiri
  if (!shown || shown.path !== path) return null;
  return (
    <div
      role="status"
      className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-200"
    >
      <span aria-hidden className="leading-5">🔒</span>
      <p className="min-w-0 flex-1 leading-5">
        <span className="font-semibold">{tabClosedText(shown.tab)}</span> Hubungi admin kalau perlu akses.
      </p>
      <button
        type="button"
        onClick={() => setShown(null)}
        className="-my-1 -mr-1.5 shrink-0 rounded-lg px-2 py-1 text-amber-200 transition hover:bg-amber-500/15"
        aria-label="Tutup pesan"
      >
        ✕
      </button>
    </div>
  );
}
