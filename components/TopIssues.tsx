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
export function topIssues(rows: VrSummaryRow[], from: string, prevFrom: string): TopIssue[] {
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
    .slice(0, 3);
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
          {items.map((t, i) => {
            const tone = TONES[i];
            const [lt, md] = HEX[tone];
            const counts = (Object.keys(VR_STATUSES) as VrStatus[])
              .map((s) => [s, t.rows.filter((r) => r.status === s).length] as const)
              .filter(([, c]) => c > 0);
            return (
              <Link
                key={t.category}
                href={`/video-review?tab=daftar&category=${encodeURIComponent(t.category)}&from=${from}&to=${to}`}
                className="card card-plain relative block overflow-hidden py-5 pl-6 pr-5 transition duration-200 hover:-translate-y-0.5"
                style={{ boxShadow: `var(--shadow-card), 0 22px 44px -22px ${alpha(md, 0.45)}` }}
              >
                <span className="absolute inset-y-0 left-0 w-1" style={{ background: `linear-gradient(180deg, ${lt}, ${md})` }} />
                <span
                  className="inline-flex rounded-lg px-2 py-0.5 text-[12px] font-bold text-white"
                  style={{ background: `linear-gradient(145deg, ${lt}, ${md})`, boxShadow: `0 6px 14px -6px ${alpha(md, 0.7)}` }}
                >
                  #{i + 1}
                </span>
                <div className="mt-3 text-[16px] font-semibold leading-snug text-zinc-100">{t.category}</div>
                <div className="mt-1 flex items-baseline justify-between gap-2">
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-display text-[34px] font-bold leading-none tabular-nums" style={{ color: `rgb(var(--c-${tone}-300))` }}>
                      {t.count}
                    </span>
                    <span className="text-[14px] font-medium text-zinc-500">kasus</span>
                  </div>
                  <Trend diff={t.count - t.prev} />
                </div>
                <div className="mt-4 flex h-1.5 overflow-hidden rounded-full bg-zinc-800">
                  {counts.map(([s, c]) => (
                    <span key={s} className={VR_STATUSES[s].bar} style={{ width: `${(c / t.count) * 100}%` }} />
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-zinc-400">
                  {counts.map(([s, c]) => (
                    <span key={s} className="inline-flex items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${VR_STATUSES[s].bar}`} />
                      <b className="font-semibold text-zinc-200">{c}</b> {VR_STATUSES[s].text}
                    </span>
                  ))}
                </div>
                <p className="mt-3 text-[13px] leading-relaxed text-zinc-400">{buildRangkuman(t.rows)}</p>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
