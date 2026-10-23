import "server-only";
import { autoLevels, levelsLine } from "./chartLevels";

/**
 * Data saham untuk tab AI (opsional, gratis):
 * - EODHD (EODHD_API_KEY): candle harian 1 tahun + harga terkini (telat ±15 menit) untuk saham BEI (.JK) & saham luar.
 *   Paket gratis: 20 request/hari -> semua hasil disimpan sementara (cache) supaya hemat.
 * - SerpApi Google Finance (SERPAPI_API_KEY): harga terkini seperti kartu harga di Google. Gratis 250 pencarian/bulan.
 */
export type Candle = { time: number; open: number; high: number; low: number; close: number };
type Source = { title: string; url: string };

const eodKey = () => (process.env.EODHD_API_KEY ?? "").trim();
const eodBase = () => (process.env.EODHD_BASE_URL ?? "https://eodhd.com").trim().replace(/\/+$/, "");
const serpKey = () => (process.env.SERPAPI_API_KEY ?? "").trim();
export const hasStockData = () => !!(eodKey() || serpKey());

const cache = new Map<string, { at: number; v: unknown }>();
async function cached<T>(key: string, ms: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ms) return hit.v as T;
  const v = await fn();
  cache.set(key, { at: Date.now(), v });
  return v;
}

/** kode saham polos (BBRI) dari IDX:BBRI / BBRI.JK / AAPL */
export const stockCode = (sym: string) => sym.toUpperCase().replace(/^[A-Z_]+:/, "").replace(/\.(JK|US)$/, "").replace(/[^A-Z0-9.-]/g, "");
const eodSymbol = (code: string, market: "saham_id" | "saham_global") => `${code}.${market === "saham_id" ? "JK" : "US"}`;

/** candle harian ±1 tahun dari EODHD (cache 6 jam) */
export async function stockCandles(code: string, market: "saham_id" | "saham_global", period: "d" | "w" = "d"): Promise<Candle[]> {
  const key = eodKey();
  if (!key || !code) return [];
  const sym = eodSymbol(code, market);
  return cached(`eod:${sym}:${period}`, 6 * 3600_000, async () => {
    const from = new Date(Date.now() - (period === "w" ? 365 : 200) * 86400_000).toISOString().slice(0, 10);
    const r = await fetch(`${eodBase()}/api/eod/${encodeURIComponent(sym)}?api_token=${encodeURIComponent(key)}&fmt=json&period=${period}&from=${from}`, {
      signal: AbortSignal.timeout(9000),
      cache: "no-store",
    });
    if (!r.ok) return [];
    const rows = (await r.json()) as { date: string; open: number; high: number; low: number; close: number }[];
    return (Array.isArray(rows) ? rows : [])
      .map((x) => ({ time: Math.floor(Date.parse(`${x.date}T00:00:00Z`) / 1000), open: +x.open, high: +x.high, low: +x.low, close: +x.close }))
      .filter((c) => Number.isFinite(c.time) && c.close > 0);
  }).catch(() => []);
}

type Quote = { price: number; changeP?: number; at?: string; source: Source };

/** harga terkini: EODHD real-time (telat ±15 mnt), cadangan Google Finance via SerpApi (cache 10–15 menit) */
export async function stockQuote(code: string, market: "saham_id" | "saham_global"): Promise<Quote | null> {
  const ek = eodKey();
  if (ek) {
    const sym = eodSymbol(code, market);
    const q = await cached(`rt:${sym}`, 10 * 60_000, async () => {
      const r = await fetch(`${eodBase()}/api/real-time/${encodeURIComponent(sym)}?api_token=${encodeURIComponent(ek)}&fmt=json`, {
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      });
      if (!r.ok) return null;
      const j = (await r.json()) as { close?: number | string; change_p?: number | string; timestamp?: number };
      const price = Number(j?.close);
      if (!Number.isFinite(price) || price <= 0) return null;
      return {
        price,
        changeP: Number.isFinite(Number(j.change_p)) ? Number(j.change_p) : undefined,
        at: j.timestamp ? new Date(j.timestamp * 1000).toISOString() : undefined,
        source: { title: `EODHD — harga ${sym} (telat ±15 menit)`, url: "https://eodhd.com/" },
      } as Quote;
    }).catch(() => null);
    if (q) return q;
  }
  const sk = serpKey();
  if (sk) {
    const qsym = market === "saham_id" ? `${code}:IDX` : code;
    return cached(`gf:${qsym}`, 15 * 60_000, async () => {
      const r = await fetch(`https://serpapi.com/search.json?engine=google_finance&q=${encodeURIComponent(qsym)}&hl=id&api_key=${encodeURIComponent(sk)}`, {
        signal: AbortSignal.timeout(10000),
        cache: "no-store",
      });
      if (!r.ok) return null;
      const j = (await r.json()) as { summary?: { extracted_price?: number; price_movement?: { percentage?: number; movement?: string }; date?: string } };
      const s = j?.summary;
      if (!s?.extracted_price) return null;
      const pm = s.price_movement;
      return {
        price: s.extracted_price,
        changeP: pm?.percentage !== undefined ? (pm.movement === "Down" ? -1 : 1) * pm.percentage : undefined,
        at: s.date,
        source: { title: `Google Finance — ${qsym}`, url: `https://www.google.com/finance/quote/${encodeURIComponent(qsym)}` },
      } as Quote;
    }).catch(() => null);
  }
  return null;
}

const px = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: n >= 100 ? 2 : n >= 1 ? 4 : 8 });

/** ringkasan riwayat harian untuk AI (tertinggi/terendah, perubahan, rata-rata, titik balik, candle terakhir) */
export function summarizeDaily(label: string, candles: Candle[], source: string, withLevels = true): string[] {
  const days = candles.slice(-60);
  if (days.length < 5) return [];
  const closes = days.map((d) => d.close);
  const last = closes[closes.length - 1];
  const win = (n: number) => days.slice(-n);
  const hi = (n: number) => Math.max(...win(n).map((d) => d.high));
  const lo = (n: number) => Math.min(...win(n).map((d) => d.low));
  const ma = (n: number) => closes.slice(-n).reduce((a, b) => a + b, 0) / Math.min(n, closes.length);
  const chg = (n: number) => (closes.length > n ? ((last - closes[closes.length - 1 - n]) / closes[closes.length - 1 - n]) * 100 : NaN);
  const pct = (v: number) => (Number.isNaN(v) ? "-" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
  const date = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
  const swings: string[] = [];
  for (let i = 2; i < days.length - 2; i++) {
    const d = days[i];
    const around = [days[i - 2], days[i - 1], days[i + 1], days[i + 2]];
    if (around.every((x) => d.high >= x.high)) swings.push(`puncak ${px(d.high)} (${date(d.time)})`);
    if (around.every((x) => d.low <= x.low)) swings.push(`lembah ${px(d.low)} (${date(d.time)})`);
  }
  return [
    `RIWAYAT HARGA ${label} (${source}, candle harian, data asli):`,
    `- Penutupan terakhir ${px(last)} (${date(days[days.length - 1].time)}) · 5 hari ${pct(chg(5))} · 20 hari ${pct(chg(20))} · 60 hari ${pct(chg(days.length - 1))}`,
    `- Tertinggi/terendah 20 hari: ${px(hi(20))} / ${px(lo(20))} · 60 hari: ${px(hi(60))} / ${px(lo(60))}`,
    `- Rata-rata penutupan 20 hari ${px(ma(20))} · 50 hari ${px(ma(50))} (harga ${last >= ma(20) ? "DI ATAS" : "DI BAWAH"} rata-rata 20 hari)`,
    swings.length ? `- Titik balik terakhir: ${swings.slice(-6).join("; ")}` : "",
    "- Candle 10 hari terakhir (tanggal: open/high/low/close):",
    ...days.slice(-10).map((d) => `  ${date(d.time)}: ${px(d.open)}/${px(d.high)}/${px(d.low)}/${px(d.close)}`),
    withLevels ? levelsLine(autoLevels(candles), px, "harian", true) : "",
    "Gunakan angka ini untuk support/resistance & tren.",
  ].filter(Boolean);
}
