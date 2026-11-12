"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ArStatus } from "./statusTypes";

const POLL_MS = 20_000; // cadangan kalau realtime putus
const DEBOUNCE_MS = 500; // beberapa event beruntun (progres tiap video) cukup diambil sekali

/**
 * Status laptop + antrian yang selalu segar di browser:
 * realtime (review_jobs / review_workers / review_runs) → ambil ulang /api/asisten-review/status (sekali per 0,5 dtk),
 * ditambah polling 20 dtk selama tab terlihat. Jam browser dikoreksi dengan jam server (`now`) → status "laptop mati" tepat.
 * `tick` = jam (ms, sudah dikoreksi) yang diperbarui tiap detik untuk hitung mundur & status hidup/mati.
 */
export function useArStatus(initial: ArStatus) {
  const [data, setData] = useState<ArStatus>(initial);
  const offset = useRef(Date.parse(initial.now) - Date.now() || 0);
  const [tick, setTick] = useState(() => Date.now() + offset.current);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const t0 = Date.now();
      const r = await fetch("/api/asisten-review/status", { cache: "no-store", headers: { accept: "application/json" } });
      if (!r.ok) return;
      const j = (await r.json()) as ArStatus;
      if (!alive.current || !j || !Array.isArray(j.jobs)) return;
      // jam server di tengah perjalanan permintaan
      const mid = t0 + (Date.now() - t0) / 2;
      const sv = Date.parse(j.now);
      if (Number.isFinite(sv)) offset.current = sv - mid;
      setData(j);
    } catch {
      // offline / sesi habis → data lama tetap ditampilkan
    }
  }, []);

  const refresh = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(load, DEBOUNCE_MS);
  }, [load]);

  useEffect(() => {
    alive.current = true;
    const sb = createClient();
    // nama kanal unik per mount: klien browser tunggal + channel() mengembalikan kanal lama bernama sama yang sedang
    // ditutup (pindah halaman / StrictMode) → realtime mati sampai muat ulang (pola sama dengan Studio)
    const ch = sb
      .channel(`asisten-review-status-${Math.random().toString(36).slice(2, 9)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "review_jobs" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "review_workers" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "review_runs" }, refresh)
      .subscribe();
    const iv = setInterval(() => document.visibilityState === "visible" && void load(), POLL_MS);
    const sec = setInterval(() => setTick(Date.now() + offset.current), 1000);
    const onVis = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
      clearInterval(iv);
      clearInterval(sec);
      document.removeEventListener("visibilitychange", onVis);
      sb.removeChannel(ch);
    };
  }, [load, refresh]);

  return { data, tick, refresh };
}
