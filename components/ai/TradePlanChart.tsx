"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { decimalsFor, fmtPrice, pctFrom, rescalePlan, rr, type TradePlan } from "@/lib/tradePlan";
import TradingChart from "./TradingChart";

type Candle = { time: number; open: number; high: number; low: number; close: number };

const TFS = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"] as const;
type TF = (typeof TFS)[number];
const tfLabel = (t: string) => t.toUpperCase().replace("M", "m");
/** "4H", "H4", "15 menit", "daily", "1D", "mingguan" -> kode timeframe */
function normTf(raw?: string): TF {
  const s = (raw ?? "").toLowerCase().replace(/\s+/g, "");
  if (!s) return "1d";
  if (/^(1w|w1|week|weekly|mingguan|1minggu)/.test(s)) return "1w";
  if (/^(1d|d1|d|day|daily|harian|1hari)$/.test(s)) return "1d";
  const m = s.match(/^(\d+)(m|min|menit|h|hour|jam)$/) || s.match(/^(m|h)(\d+)$/)?.slice(0).reverse();
  if (m) {
    const n = Number(/^\d+$/.test(m[1]) ? m[1] : m[2]);
    const u = /^\d+$/.test(m[1]) ? m[2] : m[1];
    const t = `${n}${/^(h|hour|jam)$/.test(u) ? "h" : "m"}`;
    if ((TFS as readonly string[]).includes(t)) return t as TF;
  }
  return "1d";
}
/** saham (BEI / luar negeri) = bukan forex & bukan crypto */
export const isStockSymbol = (sym: string) => !/^(OANDA|FX|FX_IDC|BINANCE|OKX):/.test(sym) && !/USDT?$/.test(sym);

const pct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`;
const pairName = (sym: string) => {
  const s = sym.includes(":") ? sym.split(":")[1] : sym;
  return /USDT$/.test(s) ? `${s.replace(/USDT$/, "")}/USDT` : s.length === 6 && !sym.startsWith("IDX:") ? `${s.slice(0, 3)}/${s.slice(3)}` : s;
};

/**
 * Chart trade plan: candle asli + kotak posisi (zona SL merah, TP hijau, garis entry) seperti alat Long/Short TradingView.
 * Kalau data candle tidak ada (mis. saham BEI), tampil chart live TradingView + tangga level.
 */
function TradePlanChart({ symbol, plan: planIn, persona }: { symbol: string; plan: TradePlan; persona?: string }) {
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [meta, setMeta] = useState<{ interval?: string; source?: string }>({});
  const [live, setLive] = useState(false);
  const stock = isStockSymbol(symbol);
  // saham: hanya 1D / 1W (data intraday saham berbayar)
  const [tf, setTf] = useState<TF>(() => {
    const t = normTf(planIn.timeframe);
    return stock && t !== "1w" ? "1d" : t;
  });
  const box = useRef<HTMLDivElement>(null);
  const idx = symbol.startsWith("IDX:");
  // skala angka plan disamakan dengan harga chart (mis. 2,56 -> 2.560 untuk saham BEI)
  const plan = useMemo(() => rescalePlan(planIn, candles?.length ? candles[candles.length - 1].close : undefined, idx), [planIn, candles, idx]);
  // saham BEI (atau saham berharga ribuan): rupiah bulat tanpa koma (5.320); saham luar < 1.000 tetap sen; lainnya sesuai besar harga
  const d = stock && ((idx && plan.entry >= 50) || plan.entry >= 1000) ? 0 : decimalsFor(plan.entry);
  // angka plan tetap jauh dari harga chart (mis. plan untuk aset lain) -> jangan digambar di candle
  const refPrice = candles?.length ? candles[candles.length - 1].close : 0;
  const mismatch = !!refPrice && Math.abs(Math.log(plan.entry / refPrice)) > Math.log(3);
  const short = plan.side === "short";
  const last = plan.tp[plan.tp.length - 1];

  useEffect(() => {
    let off = false;
    setCandles(null);
    fetch(`/api/ai/ohlc?symbol=${encodeURIComponent(symbol)}&tf=${tf}`)
      .then((r) => r.json())
      .then((j) => {
        if (off) return;
        setCandles(Array.isArray(j.candles) ? j.candles : []);
        setMeta({ interval: j.interval, source: j.source });
      })
      .catch(() => !off && setCandles([]));
    return () => {
      off = true;
    };
  }, [symbol, tf]);

  useEffect(() => {
    const el = box.current;
    if (!el || !candles?.length || live || mismatch) return;
    let dispose = () => {};
    let cancelled = false;
    (async () => {
      const LC = await import("lightweight-charts");
      if (cancelled) return;
      const light = document.documentElement.classList.contains("light");
      const narrow = el.clientWidth < 520;
      const boxBars = narrow ? 7 : 16;
      const ink = light ? "#374151" : "#d4d4d8";
      const gridC = light ? "#f3f4f6" : "rgba(255,255,255,.06)";
      const chart = LC.createChart(el, {
        autoSize: true,
        layout: { background: { color: "transparent" }, textColor: ink, fontSize: 11, attributionLogo: true },
        grid: { vertLines: { color: gridC }, horzLines: { color: gridC } },
        rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.08 } },
        timeScale: { borderVisible: false, rightOffset: boxBars + 2, timeVisible: !/^1[DW]$/.test(meta.interval ?? "1D") },
        localization: { locale: "id-ID", priceFormatter: (p: number) => fmtPrice(p, d) },
        crosshair: { mode: 0 },
      });
      const lo = Math.min(plan.sl, plan.entry, ...plan.tp);
      const hi = Math.max(plan.sl, plan.entry, ...plan.tp);
      const series = chart.addSeries(LC.CandlestickSeries, {
        upColor: "#16a34a",
        downColor: "#ef4444",
        borderVisible: false,
        wickUpColor: "#16a34a",
        wickDownColor: "#ef4444",
        priceFormat: { type: "price", precision: d, minMove: Math.pow(10, -d) },
        // pastikan semua level trade plan kelihatan
        autoscaleInfoProvider: (orig: () => { priceRange: { minValue: number; maxValue: number } } | null) => {
          const r = orig();
          if (!r) return r;
          return { ...r, priceRange: { minValue: Math.min(r.priceRange.minValue, lo * 0.985), maxValue: Math.max(r.priceRange.maxValue, hi * 1.015) } };
        },
      });
      series.setData(candles.map((c) => ({ ...c, time: c.time as import("lightweight-charts").UTCTimestamp })));
      // HP: tampilkan ±60 candle terakhir + ruang kotak posisi; layar lebar: semua candle
      if (narrow) chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, candles.length - 60), to: candles.length - 1 + boxBars + 2 });
      else chart.timeScale().fitContent();
      const lines: [number, string, string][] = [
        [plan.entry, "#3b82f6", "Entry"],
        [plan.sl, "#ef4444", "SL"],
        ...plan.tp.map((t, i): [number, string, string] => [t, "#16a34a", plan.tp.length > 1 ? `TP${i + 1}` : "TP"]),
      ];
      for (const [price, color, title] of lines) series.createPriceLine({ price, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title });

      // kotak posisi di kanan candle terakhir
      const mk = (cls: string, bg: string) => {
        const z = document.createElement("div");
        z.className = cls;
        z.style.cssText = `position:absolute;pointer-events:none;z-index:3;background:${bg}`;
        el.appendChild(z);
        return z;
      };
      const risk = mk("", "rgba(239,68,68,.18)");
      const reward = mk("", "rgba(34,197,94,.18)");
      const lbl = (bg: string) => {
        const x = mk("", bg);
        x.style.cssText += ";z-index:4;color:#fff;font-size:11px;font-weight:700;padding:2px 6px;border-radius:5px;white-space:nowrap";
        return x;
      };
      const lStop = lbl("#ef4444");
      const lTarget = lbl("#16a34a");
      const lEntry = lbl("#3b82f6");
      lStop.textContent = `Stop ${fmtPrice(plan.sl, d)} (${pct(pctFrom(plan.entry, plan.sl))})`;
      lTarget.textContent = `Target ${fmtPrice(last, d)} (${pct(pctFrom(plan.entry, last))})`;
      lEntry.textContent = `${short ? "SHORT" : "LONG"} · R:R ${rr(plan).toLocaleString("id-ID", { maximumFractionDigits: 1 })}`;
      let alive = true;
      const draw = () => {
        if (!alive) return;
        const ts = chart.timeScale();
        const n = candles.length - 1;
        const x1 = ts.logicalToCoordinate(n as import("lightweight-charts").Logical);
        const x2 = ts.logicalToCoordinate((n + boxBars) as import("lightweight-charts").Logical);
        const y = (v: number) => series.priceToCoordinate(v);
        const [ye, ys, yt] = [y(plan.entry), y(plan.sl), y(last)];
        if (x1 == null || x2 == null || ye == null || ys == null || yt == null) return;
        const w = Math.max(40, x2 - x1);
        Object.assign(risk.style, { left: `${x1}px`, width: `${w}px`, top: `${Math.min(ye, ys)}px`, height: `${Math.abs(ys - ye)}px` });
        Object.assign(reward.style, { left: `${x1}px`, width: `${w}px`, top: `${Math.min(ye, yt)}px`, height: `${Math.abs(yt - ye)}px` });
        // label di luar kotak: stop di sisi SL, target di sisi TP
        // label jangan keluar dari area chart (sisakan ruang skala harga di kanan)
        const scaleW = chart.priceScale("right").width();
        const fit = (lb: HTMLDivElement) => `${Math.max(0, Math.min(x1, el.clientWidth - scaleW - lb.offsetWidth - 4))}px`;
        // posisi awal tiap label, lalu digeser supaya tidak saling tumpuk (jarak minimal 22px)
        const want: [HTMLDivElement, number][] = [
          [lStop, short ? ys - 20 : ys + 4],
          [lTarget, short ? yt + 4 : yt - 20],
          [lEntry, short ? ye + 4 : ye - 20],
        ];
        want.sort((a, b) => a[1] - b[1]);
        const H = el.clientHeight - 30;
        for (let i = 1; i < want.length; i++) if (want[i][1] < want[i - 1][1] + 22) want[i][1] = want[i - 1][1] + 22;
        // kalau terdorong keluar bawah, geser semua ke atas
        const over = want[want.length - 1][1] - H;
        if (over > 0) for (const w of want) w[1] -= over;
        for (const [lb, top] of want) Object.assign(lb.style, { left: fit(lb), top: `${Math.max(2, top)}px` });
      };
      chart.timeScale().subscribeVisibleLogicalRangeChange(draw);
      const ro = new ResizeObserver(() => requestAnimationFrame(draw));
      ro.observe(el);
      requestAnimationFrame(draw);
      dispose = () => {
        alive = false;
        ro.disconnect();
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(draw);
        chart.remove();
        el.innerHTML = "";
      };
    })();
    return () => {
      cancelled = true;
      dispose();
    };
  }, [candles, live, plan, d, short, last, meta.interval, mismatch]);

  const head = (
    <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-2 text-[12.5px]">
      <b>
        {pairName(symbol)}
        {meta.interval ? ` · ${meta.interval}` : ` · ${tfLabel(tf)}`}
      </b>
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-extrabold ${short ? "bg-red-500/15 text-red-400" : "bg-emerald-500/15 text-emerald-400"}`}>{short ? "SHORT" : "LONG"}</span>
      <span className="text-zinc-500">
        Rencana {persona ? `dari ⚔️ ${persona}` : "AI"}
        {meta.source && candles?.length ? ` · data ${meta.source}` : ""}
      </span>
      {!!candles?.length && (
        <button type="button" onClick={() => setLive((v) => !v)} className="ml-auto rounded-lg border border-zinc-800 px-2 py-0.5 text-[11.5px] hover:border-orange-500/50">
          {live ? "📐 Trade plan" : "📈 Chart live"}
        </button>
      )}
    </div>
  );

  const tfBar = !live && (
    <div className="flex gap-1 overflow-x-auto border-b border-zinc-800 px-3 py-1.5 text-[11.5px]">
      {TFS.map((t) => {
        const off = stock && t !== "1d" && t !== "1w";
        return (
          <button
            key={t}
            type="button"
            disabled={off}
            onClick={() => setTf(t)}
            title={off ? "Timeframe di bawah harian untuk saham belum tersedia (data intraday saham berbayar)" : undefined}
            className={`shrink-0 rounded-md px-2 py-0.5 font-semibold ${
              t === tf ? "bg-orange-500/20 text-orange-400" : off ? "cursor-not-allowed text-zinc-700" : "text-zinc-400 hover:bg-zinc-800"
            }`}
          >
            {tfLabel(t)}
          </button>
        );
      })}
    </div>
  );

  const levels = (
    <div className={`grid grid-cols-2 gap-1.5 px-3 py-2 text-[12px] ${plan.tp.length >= 2 ? "sm:grid-cols-5" : "sm:grid-cols-4"}`}>
      <div className="rounded-lg bg-zinc-800/50 px-2 py-1.5">
        Entry<b className="block text-[13px]">{fmtPrice(plan.entry, d)}</b>
      </div>
      <div className="rounded-lg bg-zinc-800/50 px-2 py-1.5 text-red-400">
        Stop Loss<b className="block text-[13px]">
          {fmtPrice(plan.sl, d)} ({pct(pctFrom(plan.entry, plan.sl))})
        </b>
      </div>
      {plan.tp.map((t, i) => (
        <div key={i} className="rounded-lg bg-zinc-800/50 px-2 py-1.5 text-emerald-400">
          {plan.tp.length > 1 ? `TP${i + 1}` : "Take Profit"}
          <b className="block text-[13px]">
            {fmtPrice(t, d)} ({pct(pctFrom(plan.entry, t))})
          </b>
        </div>
      ))}
      <div className="rounded-lg bg-zinc-800/50 px-2 py-1.5">
        Risk:Reward<b className="block text-[13px]">1 : {rr(plan).toLocaleString("id-ID", { maximumFractionDigits: 2 })}</b>
      </div>
    </div>
  );

  // tanpa data candle -> chart live + tangga level
  const ladder = () => {
    const all = [plan.sl, plan.entry, ...plan.tp];
    const hi = Math.max(...all);
    const lo = Math.min(...all);
    const top = (v: number) => `${6 + ((hi - v) / (hi - lo || 1)) * 88}%`;
    const rows: [number, string, string][] = [
      [plan.sl, "#ef4444", `SL ${pct(pctFrom(plan.entry, plan.sl))}`],
      [plan.entry, "#3b82f6", "ENTRY"],
      ...plan.tp.map((t, i): [number, string, string] => [t, "#16a34a", `${plan.tp.length > 1 ? `TP${i + 1}` : "TP"} ${pct(pctFrom(plan.entry, t))}`]),
    ];
    return (
      <div className="relative mx-4 my-3 ml-[84px] h-[220px] border-l-2 border-zinc-800">
        <div className="absolute inset-x-0" style={{ top: top(Math.max(plan.sl, plan.entry)), height: `${(Math.abs(plan.sl - plan.entry) / (hi - lo || 1)) * 88}%`, background: "rgba(239,68,68,.12)" }} />
        <div className="absolute inset-x-0" style={{ top: top(Math.max(last, plan.entry)), height: `${(Math.abs(last - plan.entry) / (hi - lo || 1)) * 88}%`, background: "rgba(34,197,94,.12)" }} />
        {rows.map(([v, c, t]) => (
          <div key={t} className="absolute inset-x-0 border-t-2 border-dashed text-[11.5px] font-bold" style={{ top: top(v), borderColor: c, color: c }}>
            <span className="absolute -left-[80px] -top-[9px] w-[74px] text-right">{fmtPrice(v, d)}</span>
            <span className="absolute -top-[18px] right-0">{t}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="my-2 overflow-hidden rounded-xl border border-zinc-800">
      {head}
      {tfBar}
      {candles === null ? (
        <div className="flex h-[380px] items-center justify-center text-[12px] text-zinc-500">Memuat chart…</div>
      ) : candles.length && !live && !mismatch ? (
        <div ref={box} className="relative h-[340px] w-full sm:h-[400px]" />
      ) : (
        <>
          <TradingChart symbol={symbol} bare />
          {(!candles.length || mismatch) && ladder()}
        </>
      )}
      {levels}
      <div className="flex flex-wrap justify-between gap-2 border-t border-zinc-800 px-3 py-1.5 text-[11px] text-zinc-500">
        <span>⚠️ Analisa edukasi, bukan saran finansial</span>
        <a href="https://www.tradingview.com/lightweight-charts/" target="_blank" rel="noreferrer noopener" className="hover:text-orange-400">
          Charting by TradingView Lightweight Charts™
        </a>
      </div>
    </div>
  );
}

export default memo(TradePlanChart);
