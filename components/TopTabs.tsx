"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TopCard, type Segment } from "./TopIssues";
import type { Tone } from "./StatCard";

export type TopCardData = {
  title: string;
  count: number;
  diff: number;
  segments: Segment[];
  summary: string;
  href: string;
};

const TONES: Record<"vr" | "agent", Tone[]> = {
  vr: ["orange", "red", "violet"],
  agent: ["sky", "indigo", "emerald"],
};
const KEY = "cs-top-tab";

/** Dashboard: Top 3 issue 7 hari terakhir, satu bagian dengan tab Video Review / Dari agent */
export default function TopTabs({
  vr,
  agent,
  range,
  vrMore,
  agentMore,
}: {
  vr: TopCardData[];
  agent: TopCardData[];
  range: string;
  vrMore: string;
  agentMore: string;
}) {
  const [tab, setTab] = useState<"vr" | "agent">("vr");
  useEffect(() => {
    try {
      if (localStorage.getItem(KEY) === "agent") setTab("agent");
    } catch {}
  }, []);
  const pick = (t: "vr" | "agent") => {
    setTab(t);
    try {
      localStorage.setItem(KEY, t);
    } catch {}
  };
  const items = tab === "vr" ? vr : agent;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-[19px] font-bold">🔥 Top 3 issue — 7 hari terakhir</h2>
          <p className="text-[13px] text-zinc-500">
            {range} · dibanding 7 hari sebelumnya ·{" "}
            <Link href={tab === "vr" ? vrMore : agentMore} className="font-semibold text-orange-400 hover:underline">
              {tab === "vr" ? "Lihat report →" : "Lihat semua issue →"}
            </Link>
          </p>
        </div>
        <div role="tablist" className="flex rounded-full border border-zinc-800/80 bg-zinc-900 p-1 text-[13px] font-semibold" style={{ boxShadow: "var(--shadow-sm)" }}>
          {(
            [
              ["vr", "Video Review"],
              ["agent", "Dari agent"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => pick(k)}
              className={`rounded-full px-3.5 py-1.5 transition ${tab === k ? "text-white" : "text-zinc-400 hover:text-zinc-100"}`}
              style={tab === k ? { backgroundImage: "linear-gradient(180deg,#fb8a3c,#ea580c)", boxShadow: "var(--shadow-primary)" } : undefined}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="card p-6 text-center text-sm text-zinc-400">
          {tab === "vr" ? "Belum ada kasus Video Review dalam 7 hari terakhir." : "Belum ada Hot Issue baru dari agent dalam 7 hari terakhir."}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {items.map((t, i) => (
            <TopCard
              key={`${tab}-${t.title}`}
              rank={i + 1}
              tone={TONES[tab][i]}
              title={t.title}
              count={t.count}
              unit={tab === "vr" ? "kasus" : "issue"}
              diff={t.diff}
              segments={t.segments}
              summary={t.summary}
              href={t.href}
            />
          ))}
        </div>
      )}
    </section>
  );
}
