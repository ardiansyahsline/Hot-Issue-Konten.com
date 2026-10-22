import Link from "next/link";
import { VR_STATUSES, buildRangkuman, type VrStatus, type VrSummaryRow } from "@/lib/videoReview";
import { HEX, alpha, type Tone } from "./StatCard";

const TONES: Tone[] = ["orange", "red", "violet"];
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const short = (iso: string) => {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${BULAN[m - 1]}`;
};

export type TopIssue = {
  category: string;
  count: number;
  prev: number;
  rows: VrSummaryRow[];
};

/** Hitung 3 kategori kasus Video Review terbanyak dalam 7 hari (dibanding 7 hari sebelumnya). */
export function topIssues(rows: VrSummaryRow[], from: string, prevFrom: string, limit = 3): TopIssue[] {
  const cur = new Map<string, VrSummaryRow[]>();
  const prev = new Map<string, number>();
  for (const r of rows) {
    if (!r.category) continue;
    if (r.report_date >= from) {
      if (!cur.has(r.category)) cur.set(r.category, []);
      cur.get(r.category)!.push(r);
    } else if (r.report_date >= prevFrom) {
      prev.set(r.category, (prev.get(r.category) ?? 0) + 1);
    }
  }
  return [...cur.entries()]
    .map(([category, list]) => ({ category, count: list.length, prev: prev.get(category) ?? 0, rows: list }))
    .sort((a, b) => b.count - a.count || a.prev - b.prev || a.category.localeCompare(b.category))
    .slice(0, limit);
}

function Trend({ diff }: { diff: number }) {
  const cls =
    diff > 0
      ? "bg-red-500/10 text-red-400"
      : diff < 0
        ? "bg-emerald-500/10 text-emerald-400"
        : "bg-zinc-500/10 text-zinc-400";
  const text = diff === 0 ? "sama dgn minggu lalu" : `${diff > 0 ? "+" : "−"}${Math.abs(diff)} vs minggu lalu`;
  return <span className={`whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold ${cls}`}>{text}</span>;
}

export type Segment = { key: string; label: string; count: number; bar: string };

/** Satu kartu Top issue (dipakai untuk Video Review & Hot Issue agent) */
export function TopCard({
  rank,
  tone,
  title,
  count,
  unit,
  diff,
  segments,
  summary,
  href,
  tag,
  compact = false,
}: {
  rank: number;
  tone: Tone;
  title: string;
  count: number;
  unit: string;
  diff: number;
  segments: Segment[];
  summary: string;
  href: string;
  tag?: string;
  compact?: boolean;
}) {
  const [lt, md] = HEX[tone];
  const segs = segments.filter((s) => s.count > 0);
  return (
    <Link
      href={href}
      className={`card card-plain relative block overflow-hidden transition duration-200 hover:-translate-y-0.5 ${compact ? "py-4 pl-5 pr-4" : "py-5 pl-6 pr-5"}`}
      style={{ boxShadow: `var(--shadow-card), 0 22px 44px -22px ${alpha(md, 0.45)}` }}
    >
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: `linear-gradient(180deg, ${lt}, ${md})` }} />
      <div className="flex items-center gap-2">
        <span
          className="inline-flex rounded-lg px-2 py-0.5 text-[12px] font-bold text-white"
          style={{ background: `linear-gradient(145deg, ${lt}, ${md})`, boxShadow: `0 6px 14px -6px ${alpha(md, 0.7)}` }}
        >
          #{rank}
        </span>
        {tag && <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{tag}</span>}
      </div>
      <div className={`mt-3 font-semibold leading-snug text-zinc-100 ${compact ? "text-[14.5px]" : "text-[16px]"}`}>{title}</div>
      <div className={`mt-1 flex justify-between gap-2 ${compact ? "flex-col items-start" : "items-baseline"}`}>
        <div className="flex items-baseline gap-1.5">
          <span className={`font-display font-bold leading-none tabular-nums ${compact ? "text-[28px]" : "text-[34px]"}`} style={{ color: `rgb(var(--c-${tone}-300))` }}>
            {count}
          </span>
          <span className="text-[14px] font-medium text-zinc-500">{unit}</span>
        </div>
        <Trend diff={diff} />
      </div>
      <div className="mt-4 flex h-1.5 overflow-hidden rounded-full bg-zinc-800">
        {segs.map((s) => (
          <span key={s.key} className={s.bar} style={{ width: `${(s.count / Math.max(1, count)) * 100}%` }} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-zinc-400">
        {segs.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${s.bar}`} />
            <b className="font-semibold text-zinc-200">{s.count}</b> {s.label}
          </span>
        ))}
      </div>
      {summary && <p className={`mt-3 text-[13px] leading-relaxed text-zinc-400 ${compact ? "line-clamp-3" : ""}`}>{summary}</p>}
    </Link>
  );
}

export const vrSegments = (t: TopIssue): Segment[] =>
  (Object.keys(VR_STATUSES) as VrStatus[]).map((s) => ({
    key: s,
    label: VR_STATUSES[s].text,
    count: t.rows.filter((r) => r.status === s).length,
    bar: VR_STATUSES[s].bar,
  }));

export const rangeLabel = (from: string, to: string) => `${short(from)} – ${short(to)} ${to.slice(0, 4)}`;

export default function TopIssues({ items, from, to }: { items: TopIssue[]; from: string; to: string }) {
  const range = `${short(from)} – ${short(to)} ${to.slice(0, 4)}`;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display text-[19px] font-bold">🔥 Top 3 issue Video Review — 7 hari terakhir</h2>
          <p className="text-[13px] text-zinc-500">{range} · dibanding 7 hari sebelumnya</p>
        </div>
        <Link href={`/video-review?tab=rekap&from=${from}&to=${to}`} className="text-[13px] font-semibold text-orange-400 hover:underline">
          Lihat rekap →
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="card p-6 text-center text-sm text-zinc-400">Belum ada kasus Video Review dalam 7 hari terakhir.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {items.map((t, i) => (
            <TopCard
              key={t.category}
              rank={i + 1}
              tone={TONES[i]}
              title={t.category}
              count={t.count}
              unit="kasus"
              diff={t.count - t.prev}
              segments={vrSegments(t)}
              summary={buildRangkuman(t.rows)}
              href={`/video-review?tab=daftar&category=${encodeURIComponent(t.category)}&from=${from}&to=${to}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
