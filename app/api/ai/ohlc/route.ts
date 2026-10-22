import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { coinId } from "@/lib/aiWeb.server";
import { stockCandles, stockCode } from "@/lib/stockData.server";

export const dynamic = "force-dynamic";

type Candle = { time: number; open: number; high: number; low: number; close: number };
const cache = new Map<string, { at: number; body: unknown }>();

/**
 * Data candle untuk chart trade plan.
 * - crypto (mis. PUMPUSDT): CoinGecko, candle 4 jam selama 30 hari (gratis)
 * - forex/emas (OANDA:XAUUSD, FX:EURUSD, FX_IDC:USDIDR): Twelve Data harian 120 hari — kalau TWELVEDATA_API_KEY diisi
 * - saham BEI (IDX:BBCA) & saham luar (AAPL): EODHD harian (kalau EODHD_API_KEY diisi), kalau tidak -> kosong (chart live TradingView)
 */
export async function GET(req: NextRequest) {
  await getCurrentUser();
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").toUpperCase().slice(0, 40);
  if (!symbol) return NextResponse.json({ candles: [] });
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < 300_000) return NextResponse.json(hit.body);

  let body: { candles: Candle[]; interval?: string; source?: string } = { candles: [] };
  try {
    if (symbol.startsWith("IDX:")) {
      const candles = await stockCandles(stockCode(symbol), "saham_id");
      body = { candles: candles.slice(-150), interval: "1D", source: "EODHD" };
    } else if (!symbol.includes(":") && !/USDT$/.test(symbol)) {
      // saham luar negeri (chart symbol polos, mis. AAPL)
      const candles = await stockCandles(stockCode(symbol), "saham_global");
      body = { candles: candles.slice(-150), interval: "1D", source: "EODHD" };
    } else if (!symbol.includes(":")) {
      // crypto
      const id = await coinId(symbol);
      if (id) {
        const demo = (process.env.COINGECKO_API_KEY ?? "").trim();
        const cg = (process.env.COINGECKO_BASE_URL ?? "https://api.coingecko.com").trim().replace(/\/+$/, "");
        const r = await fetch(`${cg}/api/v3/coins/${encodeURIComponent(id)}/ohlc?vs_currency=usd&days=30`, {
          headers: demo ? { "x-cg-demo-api-key": demo } : {},
          signal: AbortSignal.timeout(8000),
          cache: "no-store",
        });
        if (r.ok) {
          const raw = (await r.json()) as [number, number, number, number, number][];
          body = {
            candles: (Array.isArray(raw) ? raw : []).map(([t, o, h, l, c]) => ({ time: Math.floor(t / 1000), open: o, high: h, low: l, close: c })),
            interval: "4H",
            source: "CoinGecko",
          };
        }
      }
    } else if (/^(OANDA|FX|FX_IDC):/.test(symbol)) {
      const key = (process.env.TWELVEDATA_API_KEY ?? "").trim();
      const flat = symbol.split(":")[1];
      const pair = `${flat.slice(0, 3)}/${flat.slice(3, 6)}`;
      if (key && /^[A-Z]{3}\/[A-Z]{3}$/.test(pair)) {
        const td = (process.env.TWELVEDATA_BASE_URL ?? "https://api.twelvedata.com").trim().replace(/\/+$/, "");
        const r = await fetch(`${td}/time_series?symbol=${encodeURIComponent(pair)}&interval=1day&outputsize=120&apikey=${encodeURIComponent(key)}`, {
          signal: AbortSignal.timeout(8000),
          cache: "no-store",
        });
        const j = await r.json();
        const vals = (j?.values ?? []) as { datetime: string; open: string; high: string; low: string; close: string }[];
        body = {
          candles: vals
            .map((v) => ({ time: Math.floor(Date.parse(`${v.datetime.slice(0, 10)}T00:00:00Z`) / 1000), open: +v.open, high: +v.high, low: +v.low, close: +v.close }))
            .filter((c) => Number.isFinite(c.time) && c.close > 0)
            .sort((a, b) => a.time - b.time),
          interval: "1D",
          source: "Twelve Data",
        };
      }
    }
  } catch {
    body = { candles: [] };
  }
  // buang duplikat waktu (lightweight-charts butuh urut & unik)
  const seen = new Set<number>();
  body.candles = body.candles.filter((c) => (seen.has(c.time) ? false : (seen.add(c.time), true))).sort((a, b) => a.time - b.time);
  cache.set(symbol, { at: Date.now(), body });
  return NextResponse.json(body);
}
