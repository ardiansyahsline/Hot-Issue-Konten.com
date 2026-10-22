import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { coinId } from "@/lib/aiWeb.server";
import { stockCandles, stockCode } from "@/lib/stockData.server";

export const dynamic = "force-dynamic";

type Candle = { time: number; open: number; high: number; low: number; close: number };
type Body = { candles: Candle[]; interval?: string; source?: string };
const cache = new Map<string, { at: number; body: Body }>();

const TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"] as const;
type TF = (typeof TIMEFRAMES)[number];
const TTL: Record<TF, number> = { "1m": 30e3, "5m": 60e3, "15m": 120e3, "30m": 180e3, "1h": 300e3, "4h": 600e3, "1d": 1800e3, "1w": 3600e3 };
const label = (tf: string) => tf.toUpperCase().replace("M", "m");

const num = (v: unknown) => Number(v);
const clean = (c: Candle[]) => {
  const seen = new Set<number>();
  return c
    .filter((x) => Number.isFinite(x.time) && x.close > 0 && (seen.has(x.time) ? false : (seen.add(x.time), true)))
    .sort((a, b) => a.time - b.time);
};

/** crypto: Binance (data publik) -> OKX -> CoinGecko */
async function cryptoCandles(base: string, tf: TF): Promise<Body> {
  // 1) Binance — endpoint data pasar publik (tanpa key)
  try {
    const r = await fetch(`${(process.env.BINANCE_BASE_URL ?? "https://data-api.binance.vision").replace(/\/+$/, "")}/api/v3/klines?symbol=${encodeURIComponent(base)}USDT&interval=${tf}&limit=300`, {
      signal: AbortSignal.timeout(7000),
      cache: "no-store",
    });
    if (r.ok) {
      const rows = (await r.json()) as unknown[][];
      const candles = clean((Array.isArray(rows) ? rows : []).map((k) => ({ time: Math.floor(num(k[0]) / 1000), open: num(k[1]), high: num(k[2]), low: num(k[3]), close: num(k[4]) })));
      if (candles.length > 10) return { candles, interval: label(tf), source: "Binance" };
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
      if (candles.length > 10) return { candles, interval: label(tf), source: "OKX" };
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
async function forexCandles(flat: string, tf: TF): Promise<Body> {
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
  return { candles, interval: label(tf), source: "Twelve Data" };
}

/**
 * Data candle untuk chart trade plan. ?symbol=PUMPUSDT|OANDA:XAUUSD|IDX:BBRI|AAPL &tf=1m..1w
 * - crypto: Binance -> OKX -> CoinGecko (gratis)
 * - forex/emas: Twelve Data (TWELVEDATA_API_KEY)
 * - saham: EODHD harian / mingguan (EODHD_API_KEY) — intraday saham butuh paket berbayar
 */
export async function GET(req: NextRequest) {
  await getCurrentUser();
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").toUpperCase().slice(0, 40);
  const tfIn = (req.nextUrl.searchParams.get("tf") ?? "1d").toLowerCase();
  const tf = (TIMEFRAMES as readonly string[]).includes(tfIn) ? (tfIn as TF) : "1d";
  if (!symbol) return NextResponse.json({ candles: [] });
  const ck = `${symbol}:${tf}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < TTL[tf]) return NextResponse.json(hit.body);

  let body: Body = { candles: [] };
  try {
    const stock = symbol.startsWith("IDX:") || (!symbol.includes(":") && !/USDT$/.test(symbol));
    if (stock) {
      const market = symbol.startsWith("IDX:") ? "saham_id" : "saham_global";
      const candles = await stockCandles(stockCode(symbol), market, tf === "1w" ? "w" : "d");
      body = { candles: candles.slice(-200), interval: tf === "1w" ? "1W" : "1D", source: "EODHD" };
    } else if (/USDT$/.test(symbol) && !symbol.includes(":")) {
      body = await cryptoCandles(symbol.replace(/USDT$/, ""), tf);
    } else if (/^(OANDA|FX|FX_IDC):/.test(symbol)) {
      body = await forexCandles(symbol.split(":")[1], tf);
    }
  } catch {
    body = { candles: [] };
  }
  cache.set(ck, { at: Date.now(), body });
  return NextResponse.json(body);
}
