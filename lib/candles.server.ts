import "server-only";
import { stockCandles, stockCode } from "./stockData.server";

/**
 * Candle untuk chart trade plan & data analisa AI (sumber & cache yang sama, jadi garis S/R di chart = level yang disebut AI).
 * - crypto: Binance -> OKX -> CoinGecko (gratis)
 * - forex/emas: Twelve Data (TWELVEDATA_API_KEY)
 * - saham: EODHD harian / mingguan (EODHD_API_KEY) — intraday saham butuh paket berbayar
 */
export type Candle = { time: number; open: number; high: number; low: number; close: number };
export type CandleBody = { candles: Candle[]; interval?: string; source?: string };
const cache = new Map<string, { at: number; body: CandleBody }>();

export const TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"] as const;
export type TF = (typeof TIMEFRAMES)[number];
const TTL: Record<TF, number> = { "1m": 30e3, "5m": 60e3, "15m": 120e3, "30m": 180e3, "1h": 300e3, "4h": 600e3, "1d": 1800e3, "1w": 3600e3 };
export const tfLabel = (tf: string) => tf.toUpperCase().replace("M", "m");

const num = (v: unknown) => Number(v);
const clean = (c: Candle[]) => {
  const seen = new Set<number>();
  return c
    .filter((x) => Number.isFinite(x.time) && x.close > 0 && (seen.has(x.time) ? false : (seen.add(x.time), true)))
    .sort((a, b) => a.time - b.time);
};

/** crypto: Binance (data publik) -> OKX -> CoinGecko */
async function cryptoCandles(base: string, tf: TF, coinId: (s: string) => Promise<string | null>): Promise<CandleBody> {
  // 1) Binance — endpoint data pasar publik (tanpa key)
  try {
    const r = await fetch(`${(process.env.BINANCE_BASE_URL ?? "https://data-api.binance.vision").replace(/\/+$/, "")}/api/v3/klines?symbol=${encodeURIComponent(base)}USDT&interval=${tf}&limit=300`, {
      signal: AbortSignal.timeout(7000),
      cache: "no-store",
    });
    if (r.ok) {
      const rows = (await r.json()) as unknown[][];
      const candles = clean((Array.isArray(rows) ? rows : []).map((k) => ({ time: Math.floor(num(k[0]) / 1000), open: num(k[1]), high: num(k[2]), low: num(k[3]), close: num(k[4]) })));
      if (candles.length > 10) return { candles, interval: tfLabel(tf), source: "Binance" };
    }
  } catch {}
  // 2) OKX — data pasar publik
  try {
    const bar = { "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1H", "4h": "4H", "1d": "1D", "1w": "1W" }[tf];
    const r = await fetch(`${(process.env.OKX_BASE_URL ?? "https://www.okx.com").replace(/\/+$/, "")}/api/v5/market/candles?instId=${encodeURIComponent(base)}-USDT&bar=${bar}&limit=300`, {
      signal: AbortSignal.timeout(7000),
      cache: "no-store",
    });
    if (r.ok) {
      const j = (await r.json()) as { data?: string[][] };
      const candles = clean((j.data ?? []).map((k) => ({ time: Math.floor(num(k[0]) / 1000), open: num(k[1]), high: num(k[2]), low: num(k[3]), close: num(k[4]) })));
      if (candles.length > 10) return { candles, interval: tfLabel(tf), source: "OKX" };
    }
  } catch {}
  // 3) CoinGecko — granularity tetap: 1 hari = 30 menit, ≤30 hari = 4 jam, lebih = 4 hari
  try {
    const id = await coinId(base);
    if (id) {
      const days = ["1m", "5m", "15m", "30m"].includes(tf) ? 1 : ["1h", "4h"].includes(tf) ? 30 : 180;
      const demo = (process.env.COINGECKO_API_KEY ?? "").trim();
      const cg = (process.env.COINGECKO_BASE_URL ?? "https://api.coingecko.com").trim().replace(/\/+$/, "");
      const r = await fetch(`${cg}/api/v3/coins/${encodeURIComponent(id)}/ohlc?vs_currency=usd&days=${days}`, {
        headers: demo ? { "x-cg-demo-api-key": demo } : {},
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      });
      if (r.ok) {
        const raw = (await r.json()) as [number, number, number, number, number][];
        const candles = clean((Array.isArray(raw) ? raw : []).map(([t, o, h, l, c]) => ({ time: Math.floor(t / 1000), open: o, high: h, low: l, close: c })));
        return { candles, interval: days === 1 ? "30m" : days === 30 ? "4H" : "4D", source: "CoinGecko" };
      }
    }
  } catch {}
  return { candles: [] };
}

/** forex / emas: Twelve Data (kalau TWELVEDATA_API_KEY diisi) */
async function forexCandles(flat: string, tf: TF): Promise<CandleBody> {
  const key = (process.env.TWELVEDATA_API_KEY ?? "").trim();
  const pair = `${flat.slice(0, 3)}/${flat.slice(3, 6)}`;
  if (!key || !/^[A-Z]{3}\/[A-Z]{3}$/.test(pair)) return { candles: [] };
  const interval = { "1m": "1min", "5m": "5min", "15m": "15min", "30m": "30min", "1h": "1h", "4h": "4h", "1d": "1day", "1w": "1week" }[tf];
  const td = (process.env.TWELVEDATA_BASE_URL ?? "https://api.twelvedata.com").trim().replace(/\/+$/, "");
  const r = await fetch(`${td}/time_series?symbol=${encodeURIComponent(pair)}&interval=${interval}&outputsize=300&timezone=UTC&apikey=${encodeURIComponent(key)}`, {
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  const j = await r.json();
  const vals = (j?.values ?? []) as { datetime: string; open: string; high: string; low: string; close: string }[];
  const candles = clean(
    vals.map((v) => ({
      time: Math.floor(Date.parse(v.datetime.length <= 10 ? `${v.datetime}T00:00:00Z` : `${v.datetime.replace(" ", "T")}Z`) / 1000),
      open: +v.open,
      high: +v.high,
      low: +v.low,
      close: +v.close,
    }))
  );
  return { candles, interval: tfLabel(tf), source: "Twelve Data" };
}


export const isTf = (t: string): t is TF => (TIMEFRAMES as readonly string[]).includes(t);

/** symbol chart (PUMPUSDT | OANDA:XAUUSD | FX:EURUSD | IDX:BBRI | AAPL) + timeframe -> candle (cache per instance) */
export async function candlesFor(symbolIn: string, tf: TF, coinId: (s: string) => Promise<string | null>): Promise<CandleBody> {
  const symbol = symbolIn.toUpperCase().slice(0, 40);
  if (!symbol) return { candles: [] };
  const ck = `${symbol}:${tf}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < TTL[tf]) return hit.body;
  let body: CandleBody = { candles: [] };
  try {
    const stock = symbol.startsWith("IDX:") || (!symbol.includes(":") && !/USDT$/.test(symbol));
    if (stock) {
      const market = symbol.startsWith("IDX:") ? "saham_id" : "saham_global";
      const candles = await stockCandles(stockCode(symbol), market, tf === "1w" ? "w" : "d");
      body = { candles: candles.slice(-200), interval: tf === "1w" ? "1W" : "1D", source: "EODHD" };
    } else if (/USDT$/.test(symbol) && !symbol.includes(":")) {
      body = await cryptoCandles(symbol.replace(/USDT$/, ""), tf, coinId);
    } else if (/^(OANDA|FX|FX_IDC):/.test(symbol)) {
      body = await forexCandles(symbol.split(":")[1], tf);
    }
  } catch {
    body = { candles: [] };
  }
  if (body.candles.length) cache.set(ck, { at: Date.now(), body });
  return body;
}

/** waktu candle dalam WIB: "2026-10-23 14:15" (intraday) atau "2026-10-23" (harian ke atas) */
const wibTime = (t: number, intraday: boolean) => {
  const d = new Date(t * 1000);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(d);
  if (!intraday) return day;
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `${day} ${hm}`;
};

/**
 * Ringkasan candle timeframe yang diminta user (mis. 15m / 1H) untuk AI: perubahan, tertinggi/terendah,
 * rata-rata, titik balik, candle terakhir, plus support/resistance otomatis yang sama dengan garis di chart.
 */
export function summarizeCandles(label: string, body: CandleBody, tf: TF, levels: string): string[] {
  const all = body.candles;
  const c = all.slice(-120);
  if (c.length < 10) return [];
  const intraday = !["1d", "1w"].includes(tf);
  const dec = (n: number) => (n >= 100 ? 2 : n >= 1 ? 4 : 8);
  const px = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: dec(n) });
  const closes = c.map((x) => x.close);
  const last = closes[closes.length - 1];
  const win = (n: number) => c.slice(-n);
  const hi = (n: number) => Math.max(...win(n).map((x) => x.high));
  const lo = (n: number) => Math.min(...win(n).map((x) => x.low));
  const ma = (n: number) => closes.slice(-n).reduce((a, b) => a + b, 0) / Math.min(n, closes.length);
  const chg = (n: number) => (closes.length > n ? ((last - closes[closes.length - 1 - n]) / closes[closes.length - 1 - n]) * 100 : NaN);
  const pct = (v: number) => (Number.isNaN(v) ? "-" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`);
  const swings: string[] = [];
  for (let i = 2; i < c.length - 2; i++) {
    const around = [c[i - 2], c[i - 1], c[i + 1], c[i + 2]];
    if (around.every((x) => c[i].high >= x.high)) swings.push(`puncak ${px(c[i].high)} (${wibTime(c[i].time, intraday)})`);
    if (around.every((x) => c[i].low <= x.low)) swings.push(`lembah ${px(c[i].low)} (${wibTime(c[i].time, intraday)})`);
  }
  const L = body.interval ?? tfLabel(tf);
  return [
    `RIWAYAT HARGA ${label} — CANDLE ${L} (${body.source ?? "data pasar"}, data asli${intraday ? ", jam WIB" : ""}):`,
    `- Terakhir ${px(last)} (${wibTime(c[c.length - 1].time, intraday)}) · 4 candle ${pct(chg(4))} · 24 candle ${pct(chg(24))} · ${c.length - 1} candle ${pct(chg(c.length - 1))}`,
    `- Tertinggi/terendah 24 candle: ${px(hi(24))} / ${px(lo(24))} · ${c.length} candle: ${px(hi(c.length))} / ${px(lo(c.length))}`,
    `- Rata-rata 20 candle ${px(ma(20))} · 50 candle ${px(ma(50))} (harga ${last >= ma(20) ? "DI ATAS" : "DI BAWAH"} rata-rata 20 candle)`,
    swings.length ? `- Titik balik terakhir: ${swings.slice(-8).join("; ")}` : "",
    `- ${Math.min(16, c.length)} candle ${L} terakhir (${intraday ? "tanggal jam WIB" : "tanggal"}: open/high/low/close):`,
    ...c.slice(-16).map((x) => `  ${wibTime(x.time, intraday)}: ${px(x.open)}/${px(x.high)}/${px(x.low)}/${px(x.close)}`),
    levels,
    `Analisa struktur, pola & trade plan pakai candle ${L} ini (bukan menebak). Untuk "pattern" salin waktu candle persis seperti tertulis di atas (${intraday ? '"YYYY-MM-DD HH:mm" WIB' : '"YYYY-MM-DD"'}).`,
  ].filter(Boolean);
}
