"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toggleReaction } from "@/lib/reactionActions";
import { whoText, type ReactionSummary, type ReactionTarget } from "@/lib/reactions";
import { EmojiPanel, QuickBar } from "./EmojiPicker";

/** Terapkan klik emoji ke ringkasan (untuk tampilan langsung sebelum server selesai) */
export function applyToggle(list: ReactionSummary[], emoji: string): ReactionSummary[] {
  const found = list.find((r) => r.emoji === emoji);
  if (!found) return [...list, { emoji, count: 1, mine: true, names: ["Kamu"] }];
  if (found.mine) {
    const next = { ...found, count: found.count - 1, mine: false, names: found.names.filter((n) => n !== "Kamu") };
    return next.count > 0 ? list.map((r) => (r.emoji === emoji ? next : r)) : list.filter((r) => r.emoji !== emoji);
  }
  return list.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1, mine: true, names: ["Kamu", ...r.names] } : r));
}

export function ReactionPills({
  list,
  onToggle,
  size = "md",
}: {
  list: ReactionSummary[];
  onToggle: (emoji: string) => void;
  size?: "sm" | "md";
}) {
  return (
    <>
      {list.map((r) => (
        <button
          key={r.emoji}
          type="button"
          onClick={() => onToggle(r.emoji)}
          title={whoText(r.names, r.count)}
          className={`inline-flex items-center gap-1 rounded-full border transition ${
            size === "sm" ? "px-1.5 py-0 text-[11.5px]" : "px-2 py-0.5 text-[12.5px]"
          } ${r.mine ? "border-orange-500/60 bg-orange-500/10 text-orange-400" : "border-zinc-800 bg-zinc-950/60 text-zinc-300 hover:border-zinc-700"}`}
        >
          <span className={size === "sm" ? "text-[13px] leading-5" : "text-[14px] leading-5"}>{r.emoji}</span>
          <b className="font-semibold tabular-nums">{r.count}</b>
        </button>
      ))}
    </>
  );
}

/**
 * Baris reaksi emoji: pill per emoji (klik = ikut / batal) + tombol tambah reaksi.
 * Disimpan lewat server; tampilan langsung berubah tanpa menunggu.
 */
export default function Reactions({
  target,
  initial,
  page,
  showWho = false,
  children,
}: {
  target: ReactionTarget;
  initial: ReactionSummary[];
  page: string;
  /** tampilkan "Alif, Fatir & 1 lainnya" di samping */
  showWho?: boolean;
  children?: React.ReactNode;
}) {
  const [list, setList] = useState(initial);
  const [menu, setMenu] = useState<"none" | "quick" | "all">("none");
  const [, start] = useTransition();

  const root = useRef<HTMLDivElement>(null);

  useEffect(() => setList(initial), [initial]);
  // klik di luar -> tutup deretan emoji cepat
  useEffect(() => {
    if (menu !== "quick") return;
    const out = (e: MouseEvent | TouchEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setMenu("none");
    };
    document.addEventListener("mousedown", out);
    document.addEventListener("touchstart", out);
    return () => {
      document.removeEventListener("mousedown", out);
      document.removeEventListener("touchstart", out);
    };
  }, [menu]);

  const toggle = (emoji: string) => {
    setMenu("none");
    const before = list;
    setList((l) => applyToggle(l, emoji));
    start(async () => {
      const r = await toggleReaction(target, emoji, page);
      if (r.error) setList(before);
    });
  };

  const total = list.reduce((n, r) => n + r.count, 0);
  const names = [...new Set(list.flatMap((r) => r.names))];

  return (
    <div ref={root} className="relative flex flex-wrap items-center gap-1.5">
      <ReactionPills list={list} onToggle={toggle} />
      <button
        type="button"
        onClick={() => setMenu(menu === "none" ? "quick" : "none")}
        aria-label="Tambah reaksi"
        title="Tambah reaksi"
        className={`inline-flex h-[26px] items-center gap-0.5 rounded-full border border-dashed px-2 text-[12px] transition ${
          menu !== "none" ? "border-orange-500/60 text-orange-400" : "border-zinc-700 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
        }`}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M8.5 14.5s1.2 1.5 3.5 1.5 3.5-1.5 3.5-1.5M9 9.5h.01M15 9.5h.01" />
        </svg>
        +
      </button>
      {children}
      {showWho && total > 0 && <span className="ml-1 text-[12px] text-zinc-500">{whoText(names, names.length || total)}</span>}

      {menu === "quick" && (
        <div className="absolute left-0 top-full z-40 mt-1.5">
          <QuickBar onPick={toggle} onMore={() => setMenu("all")} />
        </div>
      )}
      {menu === "all" && <EmojiPanel onPick={toggle} onClose={() => setMenu("none")} className="absolute left-0 top-full mt-1.5" />}
    </div>
  );
}
