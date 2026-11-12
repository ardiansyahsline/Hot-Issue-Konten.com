"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Hasil baru dari laptop (realtime review_results) → tombol kecil "N hasil baru — tampilkan".
 * Tidak memuat ulang sendiri supaya kartu yang sedang dibaca / diisi catatannya tidak melompat.
 */
export default function LiveBaru() {
  const router = useRouter();
  const [n, setN] = useState(0);
  const [pending, start] = useTransition();
  const seen = useRef(new Set<number>());
  useEffect(() => {
    const sb = createClient();
    const ch = sb
      .channel(`asisten-review-hasil-${Math.random().toString(36).slice(2, 9)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "review_results" }, (p) => {
        const id = Number((p.new as { id?: unknown })?.id);
        if (!Number.isFinite(id) || seen.current.has(id)) return;
        seen.current.add(id);
        setN((x) => x + 1);
      })
      .subscribe();
    return () => {
      sb.removeChannel(ch);
    };
  }, []);
  if (!n) return null;
  return (
    <button
      type="button"
      className="btn-ghost w-full border-violet-500/40 py-2 text-sm text-violet-300 sm:w-auto"
      aria-disabled={pending || undefined}
      onClick={() =>
        start(() => {
          router.refresh();
          setN(0);
        })
      }
    >
      {pending ? "Memuat…" : `🔔 ${n} hasil baru — tampilkan`}
    </button>
  );
}
