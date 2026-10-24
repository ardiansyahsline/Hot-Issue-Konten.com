"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { decimalsFor, fmtPrice, pctFrom, rescalePlan, rr, type TradePlan } from "@/lib/tradePlan";
import TradingChart from "./TradingChart";
import { autoLevels } from "@/lib/chartLevels";
import { detectPatterns } from "@/lib/chartPatterns";

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
/**
 * Titik pola dari AI ditempel ke candle asli. Kalau tanggal di luar data chart atau harganya tidak
 * cocok dengan candle di tanggal itu, pola tidak digambar (lebih baik tidak ada daripada ngarang).
 */
function snapPattern(points: [number, number][] | undefined, candles: Candle[] | null): { time: number; value: number }[] | null {
  if (!points || points.length < 2 || !candles || candles.length < 3) return null;
  const step = Math.max(60, candles[candles.length - 1].time - candles[candles.length - 2].time);
  const out: { time: number; value: number }[] = [];
  for (const [t, v] of points) {
    const win = t % 86400 === 0 ? Math.max(86400, step) : step; // tanggal tanpa jam = satu hari penuh
    const cand = candles.filter((c) => c.time < t + win && c.time + step > t);
    if (!cand.length) return null;
    const near = (c: Candle) => Math.min(Math.abs(c.high - v), Math.abs(c.low - v));
    const best = cand.reduce((a, b) => (near(b) < near(a) ? b : a));
    if (v > best.high * 1.015 || v < best.low * 0.985) return null;
    if (out.length && best.time <= out[out.length - 1].time) continue;
    out.push({ time: best.time, value: v });
  }
  return out.length >= 2 ? out : null;
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
  const fitRef = useRef<(() => void) | null>(null);
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
  // garis analisa: support/resistance otomatis dari candle + pola dari AI (dicek ke candle asli)
  const [showLines, setShowLines] = useState(true);
  const srLevels = useMemo(() => (candles?.length ? autoLevels(candles) : []), [candles]);
  const patternPts = useMemo(() => snapPattern(plan.pattern?.points, candles), [plan.pattern, candles]);
  // pola yang digambar: garis/titik dari AI kalau cocok dengan candle; kalau tidak ada -> deteksi otomatis
  // (mirip indikator Auto Chart Patterns) dari candle timeframe yang sedang dibuka
  const patternView = useMemo(() => {
    if (!candles?.length) return null;
    const step = Math.max(60, candles.length > 1 ? candles[candles.length - 1].time - candles[candles.length - 2].time : 86400);
    const tA = candles[0].time - step;
    const tZ = candles[candles.length - 1].time + step;
    const lo = Math.min(...candles.map((c) => c.low)) * 0.8;
    const hi = Math.max(...candles.map((c) => c.high)) * 1.2;
    const snapT = (t: number) => candles.reduce((b, c) => (Math.abs(c.time - t) < Math.abs(b - t) ? c.time : b), candles[0].time);
    const conv = (ln: [number, number][]) => {
      if (ln.length !== 2 || ln.some(([t, v]) => t < tA || t > tZ || v < lo || v > hi)) return null;
      const a = ln.map(([t, v]) => ({ time: snapT(t), value: v }));
      return a[0].time < a[1].time ? a : null;
    };
    const ok = <T,>(x: T | null): x is T => x !== null;
    const ai = plan.pattern;
    const aiLines = (ai?.lines ?? []).map(conv).filter(ok);
    if (ai && (aiLines.length || patternPts)) return { name: ai.name, auto: false, dots: patternPts ?? [], lines: aiLines };
    const det = detectPatterns(candles)[0];
    if (!det) return null;
    return { name: det.name, auto: true, dots: det.points.slice(-6).map(([t, v]) => ({ time: t, value: v })), lines: det.lines.map(conv).filter(ok) };
  }, [plan.pattern, candles, patternPts]);

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
          // ruang tambahan sebanding dengan lebar trade plan (bukan % harga), biar kotak tidak gepeng
          const pad = (hi - lo) * 0.12;
          return { ...r, priceRange: { minValue: Math.min(r.priceRange.minValue, lo - pad), maxValue: Math.max(r.priceRange.maxValue, hi + pad) } };
        },
      });
      series.setData(candles.map((c) => ({ ...c, time: c.time as import("lightweight-charts").UTCTimestamp })));
      // HP: tampilkan ±60 candle terakhir + ruang kotak posisi; layar lebar: semua candle
      // tampilan awal: fokus ke candle terbaru + kotak trade plan (skala harga ikut menyesuaikan), user bebas geser/zoom setelahnya
      const fit = () => {
        chart.priceScale("right").applyOptions({ autoScale: true });
        chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, candles.length - (narrow ? 40 : 70)), to: candles.length - 1 + boxBars + 2 });
      };
      fit();
      fitRef.current = fit;
      const lines: [number, string, string][] = [
        [plan.entry, "#3b82f6", "Entry"],
        [plan.sl, "#ef4444", "SL"],
        ...plan.tp.map((t, i): [number, string, string] => [t, "#16a34a", plan.tp.length > 1 ? `TP${i + 1}` : "TP"]),
      ];
      for (const [price, color, title] of lines) series.createPriceLine({ price, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title });

      // garis analisa: support (hijau toska) & resistance (ungu), garis pola (oranye)
      const PURPLE = "#9333ea";
      const TEAL = "#0d9488";
      const ORANGE = "#ea580c";
      const lvShown = showLines ? srLevels : [];
      for (const l of lvShown)
        series.createPriceLine({ price: l.price, color: l.kind === "resistance" ? PURPLE : TEAL, lineWidth: 1, lineStyle: 3, axisLabelVisible: false, title: "" });
      const pv = showLines ? patternView : null;
      const pat = pv ? (pv.dots.length ? pv.dots : pv.lines.map((l) => l[0])) : null;
      const lineOf = (pts: { time: number; value: number }[]) => {
        const ln = chart.addSeries(LC.LineSeries, {
          color: ORANGE,
          lineWidth: 2,
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
          autoscaleInfoProvider: () => null,
        });
        ln.setData(pts.map((x) => ({ time: x.time as import("lightweight-charts").UTCTimestamp, value: x.value })));
      };
      // garis pola (atas & bawah wedge/triangle/channel, neckline …); pola dari AI tanpa garis -> sambungkan titiknya
      if (pv) {
        if (pv.lines.length) pv.lines.forEach(lineOf);
        else if (pv.dots.length >= 2) lineOf(pv.dots);
      }

      // kotak posisi di kanan candle terakhir
      // lapisan kotak posisi: seukuran area candle (tidak menimpa skala harga/waktu), isi yang keluar area dipotong
      const layer = document.createElement("div");
      layer.style.cssText = "position:absolute;left:0;top:0;overflow:hidden;pointer-events:none;z-index:3";
      el.appendChild(layer);
      const mk = (bg: string) => {
        const z = document.createElement("div");
        z.style.cssText = `position:absolute;pointer-events:none;background:${bg}`;
        layer.appendChild(z);
        return z;
      };
      const risk = mk("rgba(239,68,68,.18)");
      const reward = mk("rgba(34,197,94,.18)");
      const lbl = (bg: string) => {
        const x = mk(bg);
        x.style.cssText += ";z-index:4;color:#fff;font-size:11px;font-weight:700;padding:2px 6px;border-radius:5px;white-space:nowrap";
        return x;
      };
      const lStop = lbl("#ef4444");
      const lTarget = lbl("#16a34a");
      const lEntry = lbl("#3b82f6");
      lStop.textContent = `Stop ${fmtPrice(plan.sl, d)} (${pct(pctFrom(plan.entry, plan.sl))})`;
      lTarget.textContent = `Target ${fmtPrice(last, d)} (${pct(pctFrom(plan.entry, last))})`;
      lEntry.textContent = `${short ? "SHORT" : "LONG"} · R:R ${rr(plan).toLocaleString("id-ID", { maximumFractionDigits: 1 })}`;
      const lvTags = lvShown.map((l) => {
        const t = lbl(l.kind === "resistance" ? PURPLE : TEAL);
        t.style.fontSize = "10.5px";
        t.textContent = `${l.name} ${fmtPrice(l.price, d)}${l.touches >= 2 ? ` · ${l.touches}x` : ""}`;
        return t;
      });
      const patDots = (pv?.dots ?? []).map(() => {
        const z = mk("#fff");
        z.style.cssText += `;width:9px;height:9px;border-radius:50%;border:2px solid ${ORANGE};z-index:4`;
        return z;
      });
      const patTag = pat ? lbl(ORANGE) : null;
      if (patTag) patTag.textContent = `Pola: ${pv?.name ?? ""}${pv?.auto ? " (otomatis)" : ""}`;
      let alive = true;
      let prevKey = "";
      /**
       * Hitung ulang posisi kotak dari harga entry/SL/TP setiap frame, jadi ikut nempel saat chart
       * digeser, di-zoom, atau skala harganya berubah (bukan cuma saat rentang waktu berubah).
       */
      const draw = () => {
        if (!alive) return;
        const ts = chart.timeScale();
        const n = candles.length - 1;
        const x1 = ts.logicalToCoordinate(n as import("lightweight-charts").Logical);
        const x2 = ts.logicalToCoordinate((n + boxBars) as import("lightweight-charts").Logical);
        const y = (v: number) => series.priceToCoordinate(v);
        const [ye, ys, yt] = [y(plan.entry), y(plan.sl), y(last)];
        const paneW = Math.max(0, el.clientWidth - chart.priceScale("right").width());
        const paneH = Math.max(0, el.clientHeight - ts.height());
        const lvY = lvShown.map((l) => y(l.price));
        const patXY = (pat ?? []).map((pp) => [ts.timeToCoordinate(pp.time as import("lightweight-charts").UTCTimestamp), y(pp.value)] as const);
        const key = [x1, x2, ye, ys, yt, paneW, paneH, ...lvY, ...patXY.flat()].map((v) => (v == null ? "x" : Math.round(v))).join(",");
        if (key === prevKey) return;
        prevKey = key;
        Object.assign(layer.style, { width: `${paneW}px`, height: `${paneH}px` });
        // label support/resistance di kiri, digeser supaya tidak saling tumpuk
        const lvWant = lvTags.flatMap((t, i): [HTMLDivElement, number][] => (lvY[i] == null ? [] : [[t, Number(lvY[i])]]));
        lvTags.forEach((t, i) => (t.style.display = lvY[i] == null || lvY[i]! < 0 || lvY[i]! > paneH ? "none" : "block"));
        lvWant.sort((a, b) => a[1] - b[1]);
        let prevTop = -99;
        for (const [t, yy] of lvWant) {
          const top = Math.max(yy - 9, prevTop + 20);
          prevTop = top;
          Object.assign(t.style, { left: "6px", top: `${top}px` });
        }
        // titik pola + nama pola di atas titik pertama
        patXY.forEach(([px, py], i) => {
          const dot = patDots[i];
          if (!dot) return;
          if (px == null || py == null) return void (dot.style.display = "none");
          Object.assign(dot.style, { display: "block", left: `${px - 4.5}px`, top: `${py - 4.5}px` });
        });
        if (patTag) {
          const [px, py] = patXY[0] ?? [null, null];
          const tops = patXY.map((q) => q[1]).filter((v) => v != null).map(Number);
          if (px == null || py == null) patTag.style.display = "none";
          else
            Object.assign(patTag.style, {
              display: "block",
              left: `${Math.max(2, Math.min(px - 10, paneW - patTag.offsetWidth - 4))}px`,
              top: `${Math.max(2, Math.min(...tops) - 28)}px`,
            });
        }
        if (x1 == null || x2 == null || ye == null || ys == null || yt == null) {
          layer.style.visibility = "hidden";
          return;
        }
        layer.style.visibility = "visible";
        const w = Math.max(24, x2 - x1);
        Object.assign(risk.style, { left: `${x1}px`, width: `${w}px`, top: `${Math.min(ye, ys)}px`, height: `${Math.abs(ys - ye)}px` });
        Object.assign(reward.style, { left: `${x1}px`, width: `${w}px`, top: `${Math.min(ye, yt)}px`, height: `${Math.abs(yt - ye)}px` });
        // label hanya tampil kalau kotaknya kelihatan; nempel di sisi kiri kotak, tidak keluar area candle
        const boxSeen = x1 + w > 0 && x1 < paneW;
        const fit = (lb: HTMLDivElement) => `${Math.max(2, Math.min(x1, paneW - lb.offsetWidth - 4))}px`;
        // posisi tiap label (stop di sisi SL, target di sisi TP), digeser supaya tidak saling tumpuk (jarak min 22px)
        const want: [HTMLDivElement, number][] = [
          [lStop, short ? ys - 20 : ys + 4],
          [lTarget, short ? yt + 4 : yt - 20],
          [lEntry, short ? ye + 4 : ye - 20],
        ];
        want.sort((a, b) => a[1] - b[1]);
        for (let i = 1; i < want.length; i++) if (want[i][1] < want[i - 1][1] + 22) want[i][1] = want[i - 1][1] + 22;
        for (const [lb, top] of want) Object.assign(lb.style, { display: boxSeen ? "block" : "none", left: fit(lb), top: `${top}px` });
      };
      // jalan tiap frame hanya selama chart kelihatan di layar (hemat baterai)
      let seen = true;
      let raf = 0;
      const loop = () => {
        if (!alive) return;
        if (seen && !document.hidden) draw();
        raf = requestAnimationFrame(loop);
      };
      const io = new IntersectionObserver((es) => (seen = es.some((e) => e.isIntersecting)));
      io.observe(el);
      raf = requestAnimationFrame(loop);
      dispose = () => {
        alive = false;
        fitRef.current = null;
        cancelAnimationFrame(raf);
        io.disconnect();
        chart.remove();
        el.innerHTML = "";
      };
    })();
    return () => {
      cancelled = true;
      dispose();
    };
  }, [candles, live, plan, d, short, last, meta.interval, mismatch, showLines, srLevels, patternView]);

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
      {!!candles?.length && !mismatch && (srLevels.length > 0 || !!patternView) && (
        <button
          type="button"
          onClick={() => setShowLines((v) => !v)}
          title="Tampilkan / sembunyikan garis support-resistance & pola"
          className={`ml-auto shrink-0 rounded-md px-2 py-0.5 font-semibold ${showLines ? "bg-purple-500/15 text-purple-500" : "text-zinc-400 hover:bg-zinc-800"}`}
        >
          📏 Garis analisa
        </button>
      )}
      {!!candles?.length && !mismatch && (
        <button
          type="button"
          onClick={() => fitRef.current?.()}
          title="Kembalikan tampilan ke trade plan"
          className={`${srLevels.length || patternView ? "" : "ml-auto "}shrink-0 rounded-md px-2 py-0.5 font-semibold text-zinc-400 hover:bg-zinc-800`}
        >
          🎯 Fokus plan
        </button>
      )}
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
      {showLines && !live && !mismatch && !!candles?.length && (srLevels.length > 0 || !!patternView) && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 px-3 pb-2 text-[11.5px] text-zinc-500">
          <span>📏</span>
          {srLevels.some((l) => l.kind === "support") && (
            <span>
              <b className="text-teal-600">Support</b>{" "}
              {srLevels
                .filter((l) => l.kind === "support")
                .map((l) => `${fmtPrice(l.price, d)}${l.touches >= 2 ? ` (${l.touches}x)` : ""}`)
                .join(" · ")}
            </span>
          )}
          {srLevels.some((l) => l.kind === "resistance") && (
            <span>
              <b className="text-purple-500">Resistance</b>{" "}
              {srLevels
                .filter((l) => l.kind === "resistance")
                .map((l) => `${fmtPrice(l.price, d)}${l.touches >= 2 ? ` (${l.touches}x)` : ""}`)
                .join(" · ")}
            </span>
          )}
          {patternView && (
            <span>
              <b className="text-orange-600">Pola</b> {patternView.name}
              {patternView.auto && <span className="text-zinc-600"> (deteksi otomatis)</span>}
            </span>
          )}
          <span className="text-zinc-600">· S/R dihitung otomatis dari candle {meta.interval ?? ""}</span>
        </div>
      )}
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
