import Link from "next/link";
import { VR_STATUSES, ddmmyy, type VrStatus, type VrSummaryRow } from "@/lib/videoReview";

// Warna status (tetap sama di mode terang & gelap)
const STATUS_HEX: Record<VrStatus, string> = {
  menunggu: "#38bdf8",
  diproses: "#f59e0b",
  disetujui: "#10b981",
  ditolak: "#ef4444",
  selesai: "#a1a1aa",
};
const STATUS_KEYS = Object.keys(VR_STATUSES) as VrStatus[];
const BLN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

export const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const short = (iso: string) => `${Number(iso.slice(8))} ${BLN[Number(iso.slice(5, 7)) - 1]}`;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/** Sub-menu Report: Detail | Visualisasi | Compare */
export function ReportNav({ view }: { view: "detail" | "visual" | "compare" }) {
  const items: [typeof view, string][] = [
    ["detail", "Detail"],
    ["visual", "Visualisasi"],
    ["compare", "Compare"],
  ];
  return (
    <div className="flex flex-wrap items-center gap-6 border-b border-zinc-800/80">
      {items.map(([k, label]) => (
        <Link
          key={k}
          href={`/video-review?tab=report${k === "detail" ? "" : `&view=${k}`}`}
          className={`-mb-px border-b-2 px-1 pb-2.5 text-[14px] font-semibold transition ${
            view === k ? "border-orange-500 text-orange-400" : "border-transparent text-zinc-500 hover:text-zinc-200"
          }`}
        >
          {label}
        </Link>
      ))}
    </div>
  );
}

function Chips({ value, options, href }: { value: string; options: [string, string][]; href: (v: string) => string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(([v, label]) => (
        <Link
          key={v}
          href={href(v)}
          className={`rounded-full border px-3 py-1 text-[12.5px] font-semibold transition ${
            v === value ? "border-orange-500 bg-orange-500/10 text-orange-400" : "border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
          }`}
        >
          {label}
        </Link>
      ))}
    </div>
  );
}

/* ============================== VISUALISASI ============================== */

export function VrVisual({ rows, range, today }: { rows: VrSummaryRow[]; range: string; today: string }) {
  const first = rows.map((r) => r.report_date).sort()[0] ?? today;
  const from = range === "all" ? first : addDays(today, -(Number(range) - 1));
  const inRange = rows.filter((r) => r.report_date >= from && r.report_date <= today);
  const total = inRange.length;
  const span = daysBetween(from, today) + 1;
  const weekly = span > 120; // rentang panjang -> per minggu supaya batang tetap terbaca

  // batang per hari / per minggu
  const buckets: { start: string; label: string; counts: Record<VrStatus, number> }[] = [];
  const step = weekly ? 7 : 1;
  for (let d = from; d <= today; d = addDays(d, step)) {
    buckets.push({ start: d, label: short(d), counts: Object.fromEntries(STATUS_KEYS.map((k) => [k, 0])) as Record<VrStatus, number> });
  }
  for (const r of inRange) {
    const i = Math.min(buckets.length - 1, Math.floor(daysBetween(from, r.report_date) / step));
    if (i >= 0 && buckets[i]) buckets[i].counts[r.status] = (buckets[i].counts[r.status] ?? 0) + 1;
  }
  const max = Math.max(1, ...buckets.map((b) => STATUS_KEYS.reduce((n, k) => n + b.counts[k], 0)));
  const W = 640;
  const H = 200;
  const bw = W / Math.max(1, buckets.length);
  const ticks = [0, Math.floor((buckets.length - 1) / 3), Math.floor(((buckets.length - 1) * 2) / 3), buckets.length - 1].filter(
    (v, i, a) => a.indexOf(v) === i
  );

  const byStatus = STATUS_KEYS.map((k) => [k, inRange.filter((r) => r.status === k).length] as const);
  const byCat = new Map<string, number>();
  for (const r of inRange) byCat.set(r.category ?? "Belum dikategorikan", (byCat.get(r.category ?? "Belum dikategorikan") ?? 0) + 1);
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const catMax = Math.max(1, ...cats.map((c) => c[1]));
  let acc = 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Chips
          value={range}
          options={[
            ["7", "7 hari"],
            ["30", "30 hari"],
            ["90", "90 hari"],
            ["all", "Semua"],
          ]}
          href={(v) => `/video-review?tab=report&view=visual&r=${v}`}
        />
        <span className="text-[12.5px] text-zinc-500">
          {short(from)} – {short(today)} {today.slice(0, 4)} · <b className="text-zinc-300">{total}</b> kasus · rata-rata{" "}
          {(total / span).toFixed(1).replace(".", ",")}/hari
        </span>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <section className="card p-5 lg:col-span-2">
          <h3 className="font-semibold">Tren kasus {weekly ? "mingguan" : "harian"}</h3>
          <p className="text-[12.5px] text-zinc-500">warna = status · puncak {max} kasus{weekly ? "/minggu" : "/hari"}</p>
          {total === 0 ? (
            <p className="py-16 text-center text-[13px] text-zinc-500">Belum ada kasus di rentang ini.</p>
          ) : (
            <svg viewBox={`0 0 ${W} ${H + 24}`} className="mt-4 w-full" role="img" aria-label="Grafik tren kasus">
              {[0, 0.5, 1].map((g) => (
                <line key={g} x1="0" x2={W} y1={10 + g * (H - 20)} y2={10 + g * (H - 20)} stroke="currentColor" className="text-zinc-800" strokeWidth="1" />
              ))}
              {buckets.map((b, i) => {
                let y = H - 10;
                return (
                  <g key={b.start}>
                    <title>{`${weekly ? "Minggu " : ""}${b.label}: ${STATUS_KEYS.map((k) => `${b.counts[k]} ${VR_STATUSES[k].label}`).filter((t) => !t.startsWith("0 ")).join(", ") || "0 kasus"}`}</title>
                    {STATUS_KEYS.map((k) => {
                      const h = (b.counts[k] / max) * (H - 20);
                      if (!h) return null;
                      y -= h;
                      return <rect key={k} x={i * bw + bw * 0.15} y={y} width={Math.max(1, bw * 0.7)} height={Math.max(0, h - 1)} rx={Math.min(3, bw * 0.2)} fill={STATUS_HEX[k]} />;
                    })}
                  </g>
                );
              })}
              {ticks.map((i) => (
                <text key={i} x={i * bw + bw / 2} y={H + 16} textAnchor={i === 0 ? "start" : i === buckets.length - 1 ? "end" : "middle"} fontSize="11" className="fill-zinc-500">
                  {buckets[i]?.label}
                </text>
              ))}
            </svg>
          )}
        </section>

        <section className="card p-5">
          <h3 className="font-semibold">Status</h3>
          <p className="text-[12.5px] text-zinc-500">{total} kasus</p>
          <div className="mt-3 flex items-center gap-5">
            <svg viewBox="0 0 42 42" className="h-28 w-28 shrink-0 -rotate-90 sm:h-36 sm:w-36" role="img" aria-label="Proporsi status">
              <circle cx="21" cy="21" r="15.9" fill="none" stroke="currentColor" className="text-zinc-800" strokeWidth="6" />
              {total > 0 &&
                byStatus.map(([k, v]) => {
                  if (!v) return null;
                  const len = (v / total) * 100;
                  const el = (
                    <circle key={k} cx="21" cy="21" r="15.9" fill="none" stroke={STATUS_HEX[k]} strokeWidth="6" strokeDasharray={`${Math.max(0, len - 0.8)} ${100 - len + 0.8}`} strokeDashoffset={-acc}>
                      <title>{`${VR_STATUSES[k].label}: ${v}`}</title>
                    </circle>
                  );
                  acc += len;
                  return el;
                })}
            </svg>
            <ul className="min-w-0 flex-1 space-y-1.5 text-[12.5px]">
              {byStatus.map(([k, v]) => (
                <li key={k} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: STATUS_HEX[k] }} />
                  <span className="truncate text-zinc-400">{VR_STATUSES[k].label}</span>
                  <b className="ml-auto pl-2 tabular-nums">{v}</b>
                  <span className="w-9 text-right text-[11px] text-zinc-500">{total ? Math.round((v / total) * 100) : 0}%</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="card p-5 lg:col-span-3">
          <h3 className="font-semibold">Kasus per kategori</h3>
          {cats.length === 0 && <p className="py-6 text-[13px] text-zinc-500">Belum ada kasus di rentang ini.</p>}
          <div className="mt-4 space-y-2.5">
            {cats.map(([c, v]) => (
              <Link
                key={c}
                href={`/video-review?tab=daftar&category=${encodeURIComponent(c === "Belum dikategorikan" ? "__none" : c)}&from=${from}&to=${today}`}
                className="grid grid-cols-[minmax(120px,260px)_1fr_40px] items-center gap-3 rounded-lg text-[13px] transition hover:bg-zinc-800/30"
              >
                <span className="truncate text-zinc-300">{c}</span>
                <span className="h-3 rounded-full bg-zinc-800">
                  <span className="block h-3 rounded-full" style={{ width: `${(v / catMax) * 100}%`, background: "linear-gradient(90deg,#fb923c,#ea580c)" }} />
                </span>
                <b className="text-right tabular-nums">{v}</b>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/* ============================== COMPARE ============================== */

const PERIODS: [string, number | null][] = [
  ["3 hari", 3],
  ["7 hari", 7],
  ["14 hari", 14],
  ["30 hari", 30],
  ["All time", null],
];

export function VrCompare({ rows, mode, today }: { rows: VrSummaryRow[]; mode: "jumlah" | "persen"; today: string }) {
  const first = rows.map((r) => r.report_date).sort()[0];
  const fromOf = (n: number | null) => (n ? addDays(today, -(n - 1)) : first ?? today);
  const inPeriod = (n: number | null) => rows.filter((r) => r.report_date >= fromOf(n) && r.report_date <= today);
  const prevCount = (n: number) => rows.filter((r) => r.report_date >= addDays(today, -(2 * n - 1)) && r.report_date <= addDays(today, -n)).length;
  const periodRows = PERIODS.map(([, n]) => inPeriod(n));
  const totals = periodRows.map((p) => p.length);

  const catNames = new Set<string>();
  for (const r of rows) catNames.add(r.category ?? "Belum dikategorikan");
  const table = [...catNames]
    .map((c) => ({
      c,
      counts: periodRows.map((p) => p.filter((r) => (r.category ?? "Belum dikategorikan") === c).length),
    }))
    .sort((a, b) => b.counts[3] - a.counts[3] || b.counts[4] - a.counts[4]);
  const colMax = PERIODS.map((_, i) => Math.max(1, ...table.map((t) => t.counts[i])));
  const cell = (n: number, i: number) => (mode === "persen" ? `${totals[i] ? Math.round((n / totals[i]) * 100) : 0}%` : String(n));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {PERIODS.map(([label, n], i) => {
          const prev = n ? prevCount(n) : null;
          const pct = prev ? Math.round(((totals[i] - prev) / prev) * 100) : null;
          return (
            <div key={label} className="card card-plain p-4">
              <div className="text-[12.5px] font-semibold text-zinc-500">{label}</div>
              <div className="mt-1 font-display text-[30px] font-bold leading-tight tabular-nums">
                {totals[i]}
                <span className="ml-1 text-[13px] font-medium text-zinc-500">kasus</span>
              </div>
              <div
                className={`text-[12px] font-semibold ${
                  n === null || pct === null ? "text-zinc-500" : pct > 0 ? "text-red-500" : pct < 0 ? "text-emerald-500" : "text-zinc-400"
                }`}
              >
                {n === null
                  ? first
                    ? `sejak ${ddmmyy(first)}`
                    : "belum ada data"
                  : pct === null
                    ? prev === 0 && totals[i] > 0
                      ? `▲ baru · ${label} sebelumnya 0`
                      : `sama dengan ${label} sebelumnya`
                    : `${pct > 0 ? "▲" : pct < 0 ? "▼" : "•"} ${Math.abs(pct)}% vs ${label} sebelumnya`}
              </div>
            </div>
          );
        })}
      </div>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <h3 className="font-semibold">Per kategori · makin merah = makin banyak</h3>
            <p className="text-[12.5px] text-zinc-500">Periode dihitung mundur dari hari ini ({short(today)}). Klik angka untuk membuka daftar kasusnya.</p>
          </div>
          <Chips
            value={mode}
            options={[
              ["jumlah", "Jumlah"],
              ["persen", "% dari total"],
            ]}
            href={(v) => `/video-review?tab=report&view=compare${v === "persen" ? "&m=persen" : ""}`}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="m-stack m-grid w-full min-w-[720px] text-[13.5px]">
            <thead>
              <tr className="border-y border-zinc-800/80 bg-zinc-950/40 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                <th className="px-5 py-2.5 text-left">Kategori</th>
                {PERIODS.map(([label]) => (
                  <th key={label} className="w-[13%] px-3 py-2.5 text-center">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {table.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-zinc-500">
                    Belum ada data.
                  </td>
                </tr>
              )}
              {table.map(({ c, counts }) => (
                <tr key={c}>
                  <td className="px-5 py-2 font-semibold">{c}</td>
                  {counts.map((n, i) => (
                    <td key={i} data-label={PERIODS[i][0]} className="px-2 py-1.5 text-center">
                      <Link
                        href={`/video-review?tab=daftar&category=${encodeURIComponent(c === "Belum dikategorikan" ? "__none" : c)}&from=${fromOf(PERIODS[i][1])}&to=${today}`}
                        className="block rounded-lg py-1.5 text-center font-semibold tabular-nums transition hover:ring-1 hover:ring-red-500/50"
                        style={{ background: n ? `rgba(239,68,68,${0.07 + (n / colMax[i]) * 0.33})` : undefined }}
                      >
                        {cell(n, i)}
                      </Link>
                    </td>
                  ))}
                </tr>
              ))}
              {table.length > 0 && (
                <tr className="bg-zinc-950/40">
                  <td className="px-5 py-2.5 font-bold">Total</td>
                  {totals.map((n, i) => (
                    <td key={i} data-label={PERIODS[i][0]} className="px-2 py-2.5 text-center font-bold tabular-nums">
                      <span>{mode === "persen" ? "100%" : n}</span>
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
