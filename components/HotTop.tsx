import Link from "next/link";

export type HotRow = {
  title: string;
  count: number;
  diff: number;
  href: string;
  segments: { key: string; count: number; bar: string; label: string }[];
};

// panas: #1 paling merah
const HEAT = [
  ["#ef4444", "#b91c1c"],
  ["#f97316", "#ea580c"],
  ["#fbbf24", "#f59e0b"],
];

export function Flame({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <path d="M12 2c1.2 4-3.5 5.6-3.5 10a3.5 3.5 0 0 0 7 0c0-1.2-.6-2.4-.6-2.4 3 1.8 4.6 4.6 4.6 7.4A7.5 7.5 0 0 1 4 17c0-6.5 8-8.5 8-15z" />
    </svg>
  );
}

function Trend({ d }: { d: number }) {
  return (
    <span className={`whitespace-nowrap text-[11.5px] font-bold ${d > 0 ? "text-red-500" : d < 0 ? "text-emerald-500" : "text-zinc-400"}`}>
      {d > 0 ? "▲" : d < 0 ? "▼" : "•"} {Math.abs(d)} <span className="font-medium text-zinc-500">vs minggu lalu</span>
    </span>
  );
}

/** Panel "Top 3" bergaya api: header gradasi merah-oranye, isi tetap putih bersih */
export default function HotTop({
  title,
  sub,
  rows,
  unit,
  summary,
  moreHref,
  empty,
}: {
  title: string;
  sub: string;
  rows: HotRow[];
  unit: string;
  summary: string;
  moreHref: string;
  empty: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section
      className="card card-plain relative overflow-hidden"
      style={{ boxShadow: "var(--shadow-card), 0 26px 50px -26px rgba(239,68,68,.55), 0 10px 30px -18px rgba(249,115,22,.45)" }}
    >
      <div
        className="flex items-start justify-between gap-3 px-5 pb-3 pt-4 text-white"
        style={{ background: "linear-gradient(110deg,#b91c1c 0%,#ef4444 45%,#f97316 85%,#fbbf24 100%)" }}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/20">
            <Flame size={20} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate font-display text-[17px] font-bold">{title}</h2>
              <span className="rounded-full bg-white/25 px-2 py-0.5 text-[10px] font-extrabold tracking-wider">HOT</span>
            </div>
            <p className="truncate text-[12.5px] text-white/85">{sub}</p>
          </div>
        </div>
        <Link href={moreHref} className="shrink-0 pt-1 text-[12.5px] font-semibold text-white hover:underline">
          Lihat →
        </Link>
      </div>

      <div className="space-y-2.5 px-5 pb-5 pt-4">
        {rows.length === 0 && <p className="py-6 text-center text-[13px] text-zinc-500">{empty}</p>}
        {rows.map((t, i) => {
          const [a, b] = HEAT[i] ?? HEAT[2];
          const segs = t.segments.filter((s) => s.count > 0);
          return (
            <Link
              key={t.title}
              href={t.href}
              className="relative block overflow-hidden rounded-xl border border-zinc-800/80 px-3 py-2.5 transition hover:border-zinc-700"
              title={segs.map((s) => `${s.count} ${s.label}`).join(" · ")}
            >
              {/* bar panas: seberapa ramai dibanding #1 */}
              <span className="absolute inset-y-0 left-0 opacity-[0.10]" style={{ width: `${(t.count / max) * 100}%`, background: `linear-gradient(90deg, ${a}, ${b})` }} />
              <div className="relative flex items-center gap-3">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[12.5px] font-extrabold text-white"
                  style={{ background: `linear-gradient(150deg, ${a}, ${b})`, boxShadow: `0 6px 14px -6px ${a}` }}
                >
                  {i === 0 ? <Flame size={15} /> : `#${i + 1}`}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold">{t.title}</div>
                  <div className="mt-1 flex h-1 w-full max-w-[220px] overflow-hidden rounded-full bg-zinc-800">
                    {segs.map((s) => (
                      <span key={s.key} className={s.bar} style={{ width: `${(s.count / t.count) * 100}%` }} />
                    ))}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-display text-[22px] font-extrabold leading-none tabular-nums" style={{ color: b }}>
                    {t.count} <span className="text-[12px] font-medium text-zinc-500">{unit}</span>
                  </div>
                  <Trend d={t.diff} />
                </div>
              </div>
            </Link>
          );
        })}
        {summary && (
          <p className="pt-1 text-[12.5px] leading-relaxed text-zinc-400">
            <b className="text-zinc-300">Rangkuman #1:</b> {summary}
          </p>
        )}
      </div>
    </section>
  );
}
