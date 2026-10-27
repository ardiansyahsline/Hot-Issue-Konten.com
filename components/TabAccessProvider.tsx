"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { closedRedirect, normalizeTabs, tabForPath, type TabId } from "@/lib/tabs";

type Ctx = { closed: TabId[]; check: () => Promise<TabId[] | null> };
const TabCtx = createContext<Ctx>({ closed: [], check: async () => null });

/** Tab yang ditutup admin untuk user ini (versi terbaru di browser) — dipakai menu, chat melayang, bunyi notifikasi */
export const useClosedTabs = () => useContext(TabCtx).closed;
/** Cek ulang ke server sekarang; hasil null = gagal dicek (daftar lama tetap dipakai) */
export const useTabCheck = () => useContext(TabCtx).check;

const GAP = 5_000; // pindah halaman / kembali ke tab: cek ulang paling cepat tiap 5 detik
const EVERY = 60_000; // cadangan: tiap 60 detik selama tab browser terlihat
const LEAVE_DELAY = 800; // jeda sebelum memindah halaman yang ditutup (beri kesempatan pengalihan dari server lebih dulu)

/**
 * Menyimpan daftar tab yang ditutup di browser + memperbaruinya tanpa muat ulang halaman.
 * Layout hanya dirender sekali (pindah halaman tidak merender ulang layout), jadi kalau admin menutup tab saat user
 * sedang membuka web, daftar ini yang membuat menu, chat melayang & bunyi ikut berubah. Halaman yang sedang dibuka
 * ternyata ditutup -> dipindah ke tab yang boleh (+ pesan). Saat halaman pertama dimuat TIDAK ikut memindah:
 * itu tugas server (dua pengalihan bersamaan saat halaman baru dimuat bikin router Next error).
 */
export default function TabAccessProvider({ initial, children }: { initial: TabId[]; children: React.ReactNode }) {
  const key = initial.join(",");
  const [st, setSt] = useState({ key, closed: initial });
  // layout dirender ulang (muat ulang / refresh dari server) -> ikut data server terbaru
  if (st.key !== key) setSt({ key, closed: initial });
  const closed = st.key === key ? st.closed : initial;

  const path = usePathname();
  const router = useRouter();
  const last = useRef(0);
  const closedNow = useRef(closed);
  useEffect(() => {
    closedNow.current = closed;
  }, [closed]);

  // halaman yang sedang dibuka ada di daftar tutup -> pindah ke tab yang boleh (+ ?tutup= untuk pesan).
  // Ditunda sebentar & dicek ulang: kalau server sudah mengalihkan duluan (mis. klik menu basi), tidak dobel.
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const leaveIfClosed = useCallback(
    (list: TabId[]) => {
      const tab = tabForPath(window.location.pathname);
      if (!tab || !list.includes(tab)) return;
      clearTimeout(leaveTimer.current);
      leaveTimer.current = setTimeout(() => {
        if (tabForPath(window.location.pathname) === tab) router.replace(closedRedirect(list, tab));
      }, LEAVE_DELAY);
    },
    [router]
  );
  useEffect(() => () => clearTimeout(leaveTimer.current), []);

  const check = useCallback(async (): Promise<TabId[] | null> => {
    last.current = Date.now();
    try {
      const r = await fetch("/api/tabs", { cache: "no-store", headers: { accept: "application/json" } });
      if (!r.ok) return null;
      const j = (await r.json()) as { closed?: unknown; sure?: boolean };
      if (!j.sure) return null;
      const next = normalizeTabs(j.closed);
      setSt((s) => (s.closed.join(",") === next.join(",") ? s : { ...s, closed: next }));
      leaveIfClosed(next);
      return next;
    } catch {
      return null; // offline / sesi habis -> daftar lama tetap dipakai
    }
  }, [leaveIfClosed]);

  // kembali ke tab browser + cadangan berkala
  useEffect(() => {
    last.current = Date.now(); // daftar awal baru saja dari server
    const soon = () => document.visibilityState === "visible" && Date.now() - last.current >= GAP && void check();
    const iv = setInterval(() => document.visibilityState === "visible" && void check(), EVERY);
    window.addEventListener("focus", soon);
    document.addEventListener("visibilitychange", soon);
    return () => {
      clearInterval(iv);
      window.removeEventListener("focus", soon);
      document.removeEventListener("visibilitychange", soon);
    };
  }, [check]);

  // pindah halaman (layout tidak dirender ulang) -> cek ulang; halaman dari cache browser yang tabnya
  // sudah diketahui ditutup (mis. tombol Kembali) ikut dipindah. Halaman pertama dilewati (urusan server).
  const prevPath = useRef(path);
  useEffect(() => {
    if (prevPath.current === path) return;
    prevPath.current = path;
    leaveIfClosed(closedNow.current);
    if (Date.now() - last.current >= GAP) void check();
  }, [path, check, leaveIfClosed]);

  const value = useMemo(() => ({ closed, check }), [closed, check]);
  return <TabCtx.Provider value={value}>{children}</TabCtx.Provider>;
}
