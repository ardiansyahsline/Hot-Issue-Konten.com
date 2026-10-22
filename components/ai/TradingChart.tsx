"use client";

import { memo, useEffect, useRef } from "react";

/** tanda chart di akhir jawaban AI: [[chart:BINANCE:PUMPUSDT]] */
export const CHART_RE = /\n*\[\[chart:([A-Za-z0-9:_.!/-]{1,40})\]\]\s*$/;
export const splitChart = (text: string) => {
  const m = text.match(CHART_RE);
  return m ? { text: text.replace(CHART_RE, ""), chart: m[1] } : { text, chart: null as string | null };
};

/**
 * Chart live TradingView (widget gratis resmi, bisa zoom & ganti timeframe).
 * Dimuat lewat skrip embed resmi TradingView; tema ikut tema website.
 */
function TradingChart({ symbol }: { symbol: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.innerHTML = "";
    const inner = document.createElement("div");
    inner.className = "tradingview-widget-container__widget";
    inner.style.height = "100%";
    inner.style.width = "100%";
    el.appendChild(inner);
    const light = document.documentElement.classList.contains("light");
    const s = document.createElement("script");
    s.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    s.async = true;
    s.type = "text/javascript";
    s.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval: "D",
      timezone: "Asia/Jakarta",
      theme: light ? "light" : "dark",
      style: "1",
      locale: "id",
      allow_symbol_change: true,
      hide_side_toolbar: true,
      calendar: false,
      support_host: "https://www.tradingview.com",
    });
    el.appendChild(s);
    return () => {
      el.innerHTML = "";
    };
  }, [symbol]);

  return (
    <div className="my-2 overflow-hidden rounded-xl border border-zinc-800">
      <div ref={box} className="tradingview-widget-container h-[360px] w-full" />
      <div className="flex items-center justify-between border-t border-zinc-800 px-3 py-1.5 text-[11px] text-zinc-500">
        <span>📈 Chart live {symbol}</span>
        <a href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`} target="_blank" rel="noreferrer noopener" className="hover:text-orange-400">
          Chart oleh TradingView ↗
        </a>
      </div>
    </div>
  );
}

export default memo(TradingChart);
