"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { isTabId, tabClosedText } from "@/lib/tabs";

/**
 * Pesan kecil sesudah dialihkan dari tab yang ditutup admin (alamat berisi ?tutup=<tab>).
 * ?tutup=semua ditangani halaman /akun sendiri. Param dibuang dari alamat, lalu menu dimuat ulang
 * supaya tab yang baru ditutup ikut hilang dari menu tanpa perlu refresh manual.
 */
export default function TabNotice() {
  const sp = useSearchParams();
  const path = usePathname();
  const router = useRouter();
  const [shown, setShown] = useState<{ text: string; path: string } | null>(null);
  const tutup = sp.get("tutup");

  useEffect(() => {
    if (!tutup) return;
    if (isTabId(tutup)) setShown({ text: tabClosedText(tutup), path: window.location.pathname });
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("tutup");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    } catch {}
    router.refresh();
  }, [tutup, router]);

  // pindah halaman -> pesan hilang sendiri
  if (!shown || shown.path !== path) return null;
  return (
    <div
      role="status"
      className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-300"
    >
      <span aria-hidden className="leading-5">🔒</span>
      <p className="min-w-0 flex-1 leading-5">
        {shown.text} <span className="text-amber-400/80">Hubungi admin kalau perlu akses.</span>
      </p>
      <button
        type="button"
        onClick={() => setShown(null)}
        className="-my-1 -mr-1.5 shrink-0 rounded-lg px-2 py-1 text-amber-300/80 transition hover:bg-amber-500/10 hover:text-amber-200"
        aria-label="Tutup pesan"
      >
        ✕
      </button>
    </div>
  );
}
