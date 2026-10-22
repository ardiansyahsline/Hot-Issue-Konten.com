"use client";

import { Children, useState } from "react";

/** List yang awalnya hanya menampilkan beberapa item teratas, sisanya lewat tombol "Load more" */
export default function LoadMoreList({
  children,
  initial = 3,
  step = 5,
  className = "space-y-2",
}: {
  children: React.ReactNode;
  initial?: number;
  step?: number;
  className?: string;
}) {
  const items = Children.toArray(children);
  const [shown, setShown] = useState(initial);
  const rest = items.length - shown;
  return (
    <>
      <ol className={className}>{items.slice(0, shown)}</ol>
      {(rest > 0 || shown > initial) && (
        <div className="flex flex-wrap justify-center gap-2 pt-1">
          {rest > 0 && (
            <button type="button" onClick={() => setShown((s) => s + step)} className="btn-ghost">
              Load more · {rest} lagi ↓
            </button>
          )}
          {shown > initial && (
            <button type="button" onClick={() => setShown(initial)} className="btn-ghost text-zinc-500">
              Tampilkan top {initial} saja ↑
            </button>
          )}
        </div>
      )}
    </>
  );
}

const RANK_BG = [
  "linear-gradient(145deg,#f87171,#dc2626)",
  "linear-gradient(145deg,#fb923c,#ea580c)",
  "linear-gradient(145deg,#fbbf24,#d97706)",
];

/** Badge peringkat #1, #2, #3 (berwarna) dan #4 dst (abu-abu) */
export function RankBadge({ rank }: { rank: number }) {
  const top = rank <= 3;
  return (
    <span
      className={`inline-flex h-6 min-w-[2.1rem] items-center justify-center rounded-lg px-1.5 text-[12px] font-bold tabular-nums ${
        top ? "text-white" : "bg-zinc-800 text-zinc-400"
      }`}
      style={top ? { background: RANK_BG[rank - 1], boxShadow: "0 6px 14px -6px rgba(220,38,38,.55)" } : undefined}
      title={`Peringkat ${rank}`}
    >
      #{rank}
    </span>
  );
}
