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
  // icon + short = tampilan HP (semua menu kelihatan sebagai ikon + label kecil, tanpa geser)
  const links = [
    { href: "/", label: "Dashboard", icon: "🏠", short: "Home", show: true },
    { href: "/issues/new", label: "+ Issue Baru", icon: "➕", short: "Issue", show: canWriteIssues(role) },
    { href: "/video-review", label: "Video Review", icon: "🎬", short: "Video", show: true },
    { href: "/catatan", label: "Catatan & Saran", icon: "📝", short: "Saran", show: true },
    { href: "/chat", label: "Chat", icon: "💬", short: "Chat", show: true },
    { href: "/ai", label: "✨ AI", icon: "✨", short: "AI", show: true },
    { href: "/admin", label: "Admin", icon: "⚙️", short: "Admin", show: role === "admin" },
  ].filter((l) => l.show);
  // pemutar musik cukup SATU di halaman (kalau dua, perintah "putar" diterima dua pemutar -> suara dobel):
  // dipasang di menu HP atau menu layar lebar sesuai ukuran layar
  const [narrow, setNarrow] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const badge = (cls: string) =>
    vrPending > 0 && (
      <span
        className={`absolute flex h-[16px] min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none text-white ring-2 ring-zinc-900 ${cls}`}
        style={{ background: "#ef4444" }}
        title={`${vrPending} video review masih menunggu dicek`}
        aria-label={`${vrPending} video review menunggu`}
      >
        {vrPending > 99 ? "99+" : vrPending}
      </span>
    );

  return (
    <>
    {/* HP: semua menu tampil sejajar sebagai ikon + label kecil (proporsional, tidak perlu digeser) */}
    <nav className="grid w-full auto-cols-fr grid-flow-col gap-0.5 rounded-2xl border border-zinc-800/80 bg-zinc-900 p-1 sm:hidden" style={{ boxShadow: "var(--shadow-sm)" }}>
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          title={l.label}
          className={`relative flex min-w-0 flex-col items-center gap-0.5 rounded-xl px-0.5 py-1 transition ${isActive(l.href) ? "bg-zinc-800 text-zinc-50" : "text-zinc-400"}`}
          style={isActive(l.href) ? { boxShadow: "var(--shadow-pop)" } : undefined}
        >
          <span className="text-[16px] leading-none">{l.icon}</span>
          <span className="w-full truncate text-center text-[10px] font-semibold leading-tight">{l.short}</span>
          {l.href === "/video-review" && badge("right-0.5 top-0")}
        </Link>
      ))}
      <span className="flex min-w-0 items-center justify-center [&>button]:px-1 [&>button]:text-[16px]">
        {narrow === true && <MusicButton />}
      </span>
    </nav>
    <nav className="hidden max-w-full gap-1 overflow-x-auto rounded-full sm:flex border border-zinc-800/80 bg-zinc-900 p-1 [scrollbar-width:none]" style={{ boxShadow: "var(--shadow-sm)" }}>
      {links.map((l) => {
        const active = isActive(l.href);
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
            {l.href === "/video-review" && badge("-right-0.5 -top-0.5")}
          </Link>
        );
      })}
      {narrow === false && <MusicButton />}
    </nav>
    </>
  );
}
