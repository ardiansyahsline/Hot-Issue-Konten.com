"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { canWriteIssues } from "@/lib/roles";
import MusicButton from "./MusicButton";
import { createClient } from "@/lib/supabase/client";

/**
 * Jumlah Video Review berstatus "menunggu" (belum dicek tim video review).
 * Realtime: berubah langsung saat review baru masuk / status diubah; cadangan: cek ulang tiap 60 detik & tiap pindah halaman.
 */
function usePendingVr(initial: number, path: string) {
  const [n, setN] = useState(initial);
  const sb = useRef<ReturnType<typeof createClient> | null>(null);
  const refresh = useRef<() => void>(() => {});
  useEffect(() => {
    const supabase = (sb.current ??= createClient());
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const { count, error } = await supabase.from("video_reviews").select("id", { count: "exact", head: true }).eq("status", "menunggu");
      if (!error && typeof count === "number") setN(count);
    };
    // beberapa perubahan beruntun (mis. impor) cukup dihitung sekali
    refresh.current = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 400);
    };
    const ch = supabase
      .channel("vr-pending")
      .on("postgres_changes", { event: "*", schema: "public", table: "video_reviews" }, () => refresh.current())
      .subscribe();
    const iv = setInterval(load, 60_000);
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(timer);
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
      supabase.removeChannel(ch);
    };
  }, []);
  useEffect(() => {
    refresh.current();
  }, [path]);
  return n;
}

export default function Nav({ role, pendingVr = 0 }: { role: string | null; pendingVr?: number }) {
  const path = usePathname();
  const vrPending = usePendingVr(pendingVr, path);
  const links = [
    { href: "/", label: "Dashboard", show: true },
    { href: "/issues/new", label: "+ Issue Baru", show: canWriteIssues(role) },
    { href: "/video-review", label: "Video Review", show: true },
    { href: "/catatan", label: "Catatan & Saran", show: true },
    { href: "/chat", label: "Chat", show: true },
    { href: "/ai", label: "✨ AI", show: true },
    { href: "/admin", label: "Admin", show: role === "admin" },
  ].filter((l) => l.show);

  return (
    <nav className="flex max-w-full gap-1 overflow-x-auto rounded-full border border-zinc-800/80 bg-zinc-900 p-1 [scrollbar-width:none]" style={{ boxShadow: "var(--shadow-sm)" }}>
      {links.map((l) => {
        const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`relative whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
              active ? "bg-zinc-800 text-zinc-50" : "text-zinc-400 hover:text-zinc-100"
            }`}
            style={active ? { boxShadow: "var(--shadow-pop)" } : undefined}
          >
            {l.label}
            {l.href === "/video-review" && vrPending > 0 && (
              <span
                className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10.5px] font-bold leading-none text-white ring-2 ring-zinc-900"
                style={{ background: "#ef4444" }}
                title={`${vrPending} video review masih menunggu dicek`}
                aria-label={`${vrPending} video review menunggu`}
              >
                {vrPending > 99 ? "99+" : vrPending}
              </span>
            )}
          </Link>
        );
      })}
      <MusicButton />
    </nav>
  );
}
