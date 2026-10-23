import "server-only";

/**
 * Data "ala analis profesional" untuk AI (semua gratis):
 * - Crypto: derivatif Binance Futures (funding, open interest, long/short, taker buy/sell) -> cadangan OKX,
 *   Fear & Greed (alternative.me, wajib disebut sumbernya), dominasi BTC & total market cap (CoinGecko).
 * - Forex/emas: posisi spekulan COT (CFTC, mingguan) + makro AS dari FRED (kalau FRED_API_KEY diisi).
 * Semua fungsi tidak pernah melempar error: gagal -> array kosong.
 */
type Source = { title: string; url: string };
export type MarketBlock = { lines: string[]; sources: Source[] };

const empty = (): MarketBlock => ({ lines: [], sources: [] });
const base = (env: string, def: string) => (process.env[env] ?? def).trim().replace(/\/+$/, "");
const cache = new Map<string, { at: number; v: unknown }>();
async function cached<T>(key: string, ms: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ms) return hit.v as T;
  const v = await fn();
  cache.set(key, { at: Date.now(), v });
  return v;
}
async function getJson(url: string, ms = 7000, headers: Record<string, string> = {}): Promise<unknown> {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms), cache: "no-store", headers });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
const n = (v: unknown) => Number(v);
const pct = (v: number, d = 2) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;
const usd = (v: number) =>
  v >= 1e12 ? `$${(v / 1e12).toFixed(2)} T` : v >= 1e9 ? `$${(v / 1e9).toFixed(2)} M` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)} jt` : `$${Math.round(v).toLocaleString("en-US")}`;
const wib = (t: number) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(t));

/* ---------------- crypto ---------------- */

/** derivatif futures perpetual: Binance -> cadangan OKX */
export async function cryptoDerivatives(baseSym: string): Promise<MarketBlock> {
  const sym = baseSym.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym) return empty();
  return cached(`deriv:${sym}`, 5 * 60_000, async () => {
    const b = base("BINANCE_FAPI_BASE_URL", "https://fapi.binance.com");
    const pair = `${sym}USDT`;
    try {
      const [prem, fund, oi, ls, top, taker] = await Promise.all([
        getJson(`${b}/fapi/v1/premiumIndex?symbol=${pair}`),
        getJson(`${b}/fapi/v1/fundingRate?symbol=${pair}&limit=21`).catch(() => []),
        getJson(`${b}/futures/data/openInterestHist?symbol=${pair}&period=4h&limit=43`).catch(() => []),
        getJson(`${b}/futures/data/globalLongShortAccountRatio?symbol=${pair}&period=4h&limit=7`).catch(() => []),
        getJson(`${b}/futures/data/topLongShortPositionRatio?symbol=${pair}&period=4h&limit=7`).catch(() => []),
        getJson(`${b}/futures/data/takerlongshortRatio?symbol=${pair}&period=1h&limit=24`).catch(() => []),
      ]);
      const p = prem as { markPrice?: string; lastFundingRate?: string; nextFundingTime?: number };
      if (!p?.markPrice) throw new Error("no data");
      const lines = [`DERIVATIF ${pair} PERPETUAL (Binance Futures, data publik, diambil ${wib(Date.now())} WIB):`];
      const fr = n(p.lastFundingRate) * 100;
      const fh = (fund as { fundingRate: string }[]).map((x) => n(x.fundingRate) * 100);
      const favg = fh.length ? fh.reduce((a, c) => a + c, 0) / fh.length : NaN;
      lines.push(`- Funding rate sekarang ${pct(fr, 4)} per 8 jam${Number.isFinite(favg) ? ` · rata-rata 7 hari ${pct(favg, 4)}` : ""} (positif = posisi long membayar short)`);
      const ois = (oi as { sumOpenInterestValue: string; timestamp: number }[]).map((x) => ({ v: n(x.sumOpenInterestValue), t: x.timestamp }));
      if (ois.length >= 2) {
        const last = ois[ois.length - 1].v;
        const d1 = ois.length > 6 ? ois[ois.length - 7].v : ois[0].v;
        const d7 = ois[0].v;
        lines.push(`- Open interest ${usd(last)} · 24 jam ${pct(((last - d1) / d1) * 100, 1)} · 7 hari ${pct(((last - d7) / d7) * 100, 1)}`);
      }
      const lsl = (ls as { longShortRatio: string; longAccount: string }[]).at(-1);
      if (lsl) lines.push(`- Rasio long/short semua akun ${n(lsl.longShortRatio).toFixed(2)} (${(n(lsl.longAccount) * 100).toFixed(0)}% akun long)`);
      const tpl = (top as { longShortRatio: string }[]).at(-1);
      if (tpl) lines.push(`- Rasio long/short posisi trader besar (top trader) ${n(tpl.longShortRatio).toFixed(2)}`);
      const tk = taker as { buySellRatio: string; buyVol: string; sellVol: string }[];
      if (tk.length) {
        const buy = tk.reduce((a, x) => a + n(x.buyVol), 0);
        const sell = tk.reduce((a, x) => a + n(x.sellVol), 0);
        if (sell > 0) lines.push(`- Taker buy/sell 24 jam ${(buy / sell).toFixed(2)} (>1 = pembeli agresif lebih banyak)`);
      }
      return { lines, sources: [{ title: `Binance Futures — data derivatif ${pair}`, url: `https://www.binance.com/en/futures/${pair}` }] };
    } catch {
      // cadangan OKX (funding + open interest)
      try {
        const o = base("OKX_BASE_URL", "https://www.okx.com");
        const inst = `${sym}-USDT-SWAP`;
        const [f, oi] = await Promise.all([
          getJson(`${o}/api/v5/public/funding-rate?instId=${inst}`) as Promise<{ data?: { fundingRate: string }[] }>,
          getJson(`${o}/api/v5/public/open-interest?instType=SWAP&instId=${inst}`).catch(() => ({})) as Promise<{ data?: { oiUsd?: string }[] }>,
        ]);
        const fr = f.data?.[0]?.fundingRate;
        if (fr === undefined) return empty();
        const lines = [`DERIVATIF ${inst} (OKX, data publik, diambil ${wib(Date.now())} WIB):`, `- Funding rate sekarang ${pct(n(fr) * 100, 4)} per 8 jam`];
        const ou = n(oi.data?.[0]?.oiUsd);
        if (ou > 0) lines.push(`- Open interest ${usd(ou)}`);
        return { lines, sources: [{ title: `OKX — data derivatif ${inst}`, url: "https://www.okx.com/trade-swap" }] };
      } catch {
        return empty();
      }
    }
  }).catch(() => empty());
}

/** Fear & Greed Index (alternative.me) — sumbernya wajib disebut di samping angkanya */
export async function fearGreed(): Promise<MarketBlock> {
  return cached("fng", 30 * 60_000, async () => {
    const j = (await getJson(`${base("FNG_BASE_URL", "https://api.alternative.me")}/fng/?limit=7`)) as { data?: { value: string; value_classification: string }[] };
    const d = j.data ?? [];
    if (!d.length) return empty();
    const week = d.length > 6 ? ` · 7 hari lalu ${d[6].value} (${d[6].value_classification})` : "";
    return {
      lines: [`- Crypto Fear & Greed Index (sumber: alternative.me): ${d[0].value}/100 — ${d[0].value_classification}${week}. WAJIB tulis "(sumber: alternative.me)" tepat di samping angka ini kalau dipakai.`],
      sources: [{ title: "alternative.me — Crypto Fear & Greed Index", url: "https://alternative.me/crypto/fear-and-greed-index/" }],
    };
  }).catch(() => empty());
}

/** dominasi BTC & total market cap (CoinGecko /global) */
export async function cryptoGlobal(): Promise<MarketBlock> {
  return cached("cg-global", 15 * 60_000, async () => {
    const demo = (process.env.COINGECKO_API_KEY ?? "").trim();
    const j = (await getJson(`${base("COINGECKO_BASE_URL", "https://api.coingecko.com")}/api/v3/global`, 7000, demo ? { "x-cg-demo-api-key": demo } : {})) as {
      data?: { market_cap_percentage?: Record<string, number>; total_market_cap?: Record<string, number>; market_cap_change_percentage_24h_usd?: number };
    };
    const d = j.data;
    if (!d?.market_cap_percentage) return empty();
    const btc = d.market_cap_percentage.btc;
    const eth = d.market_cap_percentage.eth;
    const stable = (d.market_cap_percentage.usdt ?? 0) + (d.market_cap_percentage.usdc ?? 0);
    return {
      lines: [
        `- Pasar crypto (CoinGecko): total market cap ${usd(d.total_market_cap?.usd ?? 0)} (${pct(d.market_cap_change_percentage_24h_usd ?? 0, 1)} 24 jam) · dominasi BTC ${btc?.toFixed(1)}% · ETH ${eth?.toFixed(1)}% · stablecoin USDT+USDC ${stable.toFixed(1)}%`,
      ],
      sources: [{ title: "CoinGecko — global crypto market", url: "https://www.coingecko.com/en/global-charts" }],
    };
  }).catch(() => empty());
}

/* ---------------- forex / emas: COT CFTC ---------------- */

/** kode kontrak CFTC (laporan Legacy Futures-Only) per mata uang / komoditas */
const COT: Record<string, { code: string; name: string }> = {
  XAU: { code: "088691", name: "Gold (COMEX)" },
  XAG: { code: "084691", name: "Silver (COMEX)" },
  EUR: { code: "099741", name: "Euro FX (CME)" },
  JPY: { code: "097741", name: "Japanese Yen (CME)" },
  GBP: { code: "096742", name: "British Pound (CME)" },
  AUD: { code: "232741", name: "Australian Dollar (CME)" },
  CAD: { code: "090741", name: "Canadian Dollar (CME)" },
  CHF: { code: "092741", name: "Swiss Franc (CME)" },
  NZD: { code: "112741", name: "NZ Dollar (CME)" },
  USD: { code: "098662", name: "USD Index (ICE)" },
  BTC: { code: "133741", name: "Bitcoin (CME)" },
  ETH: { code: "146021", name: "Ether (CME)" },
};

/** posisi spekulan besar (non-commercial) dari laporan COT mingguan CFTC */
export async function cotPositioning(asset: string): Promise<MarketBlock> {
  const c = COT[asset.toUpperCase()];
  if (!c) return empty();
  return cached(`cot:${c.code}`, 6 * 3600_000, async () => {
    const url = `${base("CFTC_BASE_URL", "https://publicreporting.cftc.gov")}/resource/6dca-aqww.json?cftc_contract_market_code=${c.code}&$order=report_date_as_yyyy_mm_dd%20DESC&$limit=9`;
    const rows = (await getJson(url, 9000)) as Record<string, string>[];
    if (!Array.isArray(rows) || !rows.length) return empty();
    const net = (r: Record<string, string>) => n(r.noncomm_positions_long_all) - n(r.noncomm_positions_short_all);
    const r0 = rows[0];
    const now = net(r0);
    const prev = rows[1] ? net(rows[1]) : NaN;
    const old = rows.at(-1) ? net(rows.at(-1)!) : NaN;
    const oi = n(r0.open_interest_all);
    const date = String(r0.report_date_as_yyyy_mm_dd).slice(0, 10);
    const nets = rows.map(net);
    const hi = Math.max(...nets);
    const lo = Math.min(...nets);
    const fmt = (v: number) => `${v >= 0 ? "+" : ""}${Math.round(v).toLocaleString("id-ID")}`;
    return {
      lines: [
        `- COT CFTC ${c.name}, posisi per ${date} (laporan mingguan, rilis tiap Jumat): spekulan besar (non-commercial) net ${now >= 0 ? "LONG" : "SHORT"} ${fmt(now)} kontrak (${oi ? ((Math.abs(now) / oi) * 100).toFixed(0) : "-"}% dari open interest) · minggu sebelumnya ${Number.isFinite(prev) ? fmt(prev) : "-"} · ±2 bulan lalu ${Number.isFinite(old) ? fmt(old) : "-"} · rentang ${rows.length} minggu terakhir ${fmt(lo)} s/d ${fmt(hi)}`,
      ],
      sources: [{ title: `CFTC — Commitments of Traders ${c.name}`, url: "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm" }],
    };
  }).catch(() => empty());
}

/* ---------------- makro AS: FRED (opsional, FRED_API_KEY) ---------------- */

const FRED_SERIES: [string, string, "level" | "yoy"][] = [
  ["DFF", "Suku bunga efektif The Fed", "level"],
  ["DGS10", "Yield obligasi AS 10 tahun", "level"],
  ["DFII10", "Yield riil AS 10 tahun (TIPS) — makin naik biasanya menekan emas", "level"],
  ["DTWEXBGS", "Indeks dolar AS (broad)", "level"],
  ["CPIAUCSL", "Inflasi AS (CPI, tahunan)", "yoy"],
  ["ECBDFR", "Suku bunga deposit ECB", "level"],
];

export async function usMacro(): Promise<MarketBlock> {
  const key = (process.env.FRED_API_KEY ?? "").trim();
  if (!key) return empty();
  return cached("fred", 6 * 3600_000, async () => {
    const b = base("FRED_BASE_URL", "https://api.stlouisfed.org");
    const out = await Promise.all(
      FRED_SERIES.map(async ([id, label, kind]) => {
        try {
          const j = (await getJson(`${b}/fred/series/observations?series_id=${id}&api_key=${encodeURIComponent(key)}&file_type=json&sort_order=desc&limit=${kind === "yoy" ? 14 : 30}`)) as {
            observations?: { date: string; value: string }[];
          };
          const obs = (j.observations ?? []).filter((o) => o.value !== ".");
          if (!obs.length) return "";
          if (kind === "yoy") {
            if (obs.length < 13) return "";
            const v = (n(obs[0].value) / n(obs[12].value) - 1) * 100;
            return `- ${label}: ${v.toFixed(1)}% (${obs[0].date.slice(0, 7)})`;
          }
          const last = n(obs[0].value);
          const ago = obs.length > 20 ? n(obs[20].value) : NaN;
          const ch = Number.isFinite(ago) ? ` · ±1 bulan lalu ${ago.toFixed(2)}` : "";
          return `- ${label}: ${last.toFixed(2)}${id === "DTWEXBGS" ? "" : "%"} (${obs[0].date})${ch}`;
        } catch {
          return "";
        }
      })
    );
    const lines = out.filter(Boolean);
    if (!lines.length) return empty();
    return { lines: ["MAKRO AS (FRED — Federal Reserve Bank of St. Louis):", ...lines], sources: [{ title: "FRED — Federal Reserve Economic Data", url: "https://fred.stlouisfed.org/" }] };
  }).catch(() => empty());
}

/** aset COT untuk simbol forex/emas: XAUUSD -> [XAU, USD], EURUSD -> [EUR, USD], USDJPY -> [JPY, USD] */
export function cotAssetsFor(symbol: string): string[] {
  const s = symbol.toUpperCase().replace(/^[A-Z_]+:/, "").replace(/[^A-Z]/g, "");
  const a = s.slice(0, 3);
  const b = s.slice(3, 6);
  return [...new Set([a, b].filter((x) => COT[x]))].slice(0, 2);
}
