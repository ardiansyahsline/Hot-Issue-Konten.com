/** Trade plan yang ditulis AI di akhir jawaban sebagai blok ```tradeplan {json}``` */
/** pola chart dari AI: nama + titik [waktu unix detik, harga] */
export type Pattern = { name: string; points: [number, number][] };
export type TradePlan = { symbol?: string; side: "long" | "short"; entry: number; sl: number; tp: number[]; timeframe?: string; pattern?: Pattern };

/** "2026-10-02" / "2026-10-02 14:00" / unix (detik/milidetik) -> unix detik */
const toTime = (v: unknown): number => {
  if (typeof v === "number") return v > 1e12 ? Math.floor(v / 1000) : v;
  const s = String(v ?? "").trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/);
  if (!m) return NaN;
  // tanggal saja = candle harian (00:00 UTC); tanggal + jam = waktu WIB dari data candle intraday
  return Math.floor(Date.parse(m[2] ? `${m[1]}T${m[2]}:00+07:00` : `${m[1]}T00:00:00Z`) / 1000);
};
function parsePattern(v: unknown): Pattern | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as { name?: unknown; points?: unknown };
  const pts = (Array.isArray(o.points) ? o.points : [])
    .map((x): [number, number] => {
      const a = Array.isArray(x) ? x : [(x as { date?: unknown; time?: unknown })?.date ?? (x as { time?: unknown })?.time, (x as { price?: unknown })?.price];
      return [toTime(a[0]), num(a[1])];
    })
    .filter(([t, p]) => Number.isFinite(t) && !Number.isNaN(p))
    .sort((a, b) => a[0] - b[0])
    .slice(0, 6);
  if (pts.length < 2) return undefined;
  return { name: String(o.name ?? "Pola").slice(0, 40), points: pts };
}

const DONE = /```tradeplan\s*([\s\S]*?)```\s*/i;
const PARTIAL = /```tradeplan[\s\S]*$/i; // blok yang belum selesai saat jawaban masih mengalir

const num = (v: unknown) => {
  const n = typeof v === "string" ? Number(v.replace(/,/g, "")) : Number(v);
  return Number.isFinite(n) && n > 0 ? n : NaN;
};

/** pisahkan blok trade plan dari teks jawaban + validasi angkanya (long: SL < entry < TP, short: TP < entry < SL) */
export function splitPlan(text: string): { text: string; plan: TradePlan | null } {
  const m = text.match(DONE);
  if (!m) return { text: text.replace(PARTIAL, "").trimEnd(), plan: null };
  const rest = text.replace(DONE, "").trimEnd();
  try {
    const j = JSON.parse(m[1].trim()) as Record<string, unknown>;
    const entry = num(j.entry);
    const sl = num(j.sl ?? j.stop ?? j.stop_loss);
    const tpRaw = Array.isArray(j.tp) ? j.tp : [j.tp ?? j.target];
    let tp = tpRaw.map(num).filter((n) => !Number.isNaN(n));
    if (Number.isNaN(entry) || Number.isNaN(sl) || !tp.length) return { text: rest, plan: null };
    const sideIn = String(j.side ?? "").toLowerCase();
    const side: "long" | "short" = /short|jual|sell/.test(sideIn) ? "short" : /long|beli|buy/.test(sideIn) ? "long" : tp[0] < entry ? "short" : "long";
    if (side === "long") {
      if (!(sl < entry)) return { text: rest, plan: null };
      tp = tp.filter((t) => t > entry).sort((a, b) => a - b);
    } else {
      if (!(sl > entry)) return { text: rest, plan: null };
      tp = tp.filter((t) => t < entry).sort((a, b) => b - a);
    }
    if (!tp.length) return { text: rest, plan: null };
    return {
      text: rest,
      plan: { side, entry, sl, tp: tp.slice(0, 3), symbol: j.symbol ? String(j.symbol).slice(0, 30) : undefined, timeframe: j.timeframe ? String(j.timeframe).slice(0, 10) : undefined, pattern: parsePattern(j.pattern) },
    };
  } catch {
    return { text: rest, plan: null };
  }
}

/** jumlah angka di belakang koma yang pas untuk harga ini */
export const decimalsFor = (p: number) => (p >= 1000 ? 2 : p >= 1 ? 4 : Math.min(10, Math.max(4, 3 - Math.floor(Math.log10(p)) + 1)));
/** angka nol di belakang koma tidak ditampilkan (4.025 bukan 4.025,00; 0,00505 bukan 0,0050500) */
export const fmtPrice = (p: number, d = decimalsFor(p)) => p.toLocaleString("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: d });
export const pctFrom = (entry: number, p: number) => ((p - entry) / entry) * 100;
export const rr = (plan: TradePlan) => Math.abs(plan.tp[plan.tp.length - 1] - plan.entry) / Math.abs(plan.entry - plan.sl);

/**
 * Samakan skala angka trade plan dengan harga chart. AI kadang menulis harga Indonesia "2.560" (= 2560 rupiah)
 * yang terbaca 2,56 di JSON. Kalau angka plan meleset jauh dari harga terakhir, dikali/dibagi 10/100/1000.
 */
export function rescalePlan(p: TradePlan, ref?: number, idx = false): TradePlan {
  let f = 1;
  if (ref && ref > 0) {
    let best = 1;
    let err = Math.abs(Math.log(p.entry / ref));
    for (const k of [1000, 100, 10, 0.1, 0.01, 0.001]) {
      const e = Math.abs(Math.log((p.entry * k) / ref));
      if (e < err) [best, err] = [k, e];
    }
    if (best !== 1 && err < Math.log(2)) f = best;
  } else if (idx && p.entry < 50 && p.entry * 1000 >= 50) f = 1000;
  if (f === 1) return p;
  const r = (x: number) => Math.round(x * f * 1e6) / 1e6;
  return {
    ...p,
    entry: r(p.entry),
    sl: r(p.sl),
    tp: p.tp.map(r),
    pattern: p.pattern ? { ...p.pattern, points: p.pattern.points.map(([t, v]): [number, number] => [t, r(v)]) } : undefined,
  };
}
