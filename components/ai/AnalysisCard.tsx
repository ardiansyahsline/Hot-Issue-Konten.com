"use client";

import type { Analysis } from "@/lib/analysisCard";

const BIAS: Record<Analysis["bias"], string> = { bullish: "BULLISH", bearish: "BEARISH", netral: "NETRAL" };
const ICON = { good: "✓", warn: "⚠", bad: "▼" };

/**
 * Kartu analisa ringkas: bias + keyakinan, kalimat utama khas karakter, 4–6 kartu metrik terpenting,
 * dan 3 sinyal penting. Warna mengikuti mode website (gelap: navy + emas, terang: aksen lembut) — gaya di globals.css (.ai-card).
 * Trade plan tampil di chart di bawahnya.
 */
export default function AnalysisCard({ card, onDetail }: { card: Analysis; onDetail?: () => void }) {
  return (
    <div className="ai-card">
      <div className="ai-band">
        <div className="flex flex-wrap items-center gap-2">
          {card.symbol && (
            <span className="ai-sym">
              {card.symbol.replace(/USDT$/, "/USDT")}
              {card.timeframe ? ` · ${card.timeframe}` : ""}
            </span>
          )}
          <span className={`ai-pill ai-${card.bias}`}>{BIAS[card.bias]}</span>
          {card.confidence && <span className="ai-pill ai-conf">Keyakinan {card.confidence}</span>}
        </div>
        {card.lead && <p className="ai-lead">{card.lead}</p>}
      </div>

      <div className="ai-body">
        {!!card.metrics.length && (
          <div className="ai-tiles">
            {card.metrics.map((m, i) => (
              <div key={i} className={`ai-tile ${m.tone ?? "neutral"}`}>
                <span className="ai-k">{m.label}</span>
                <b className="ai-v">{m.value}</b>
                {m.note && <span className="ai-n">{m.note}</span>}
              </div>
            ))}
          </div>
        )}

        {!!card.signals.length && (
          <>
            <div className="ai-sec">Sinyal penting</div>
            {card.signals.map((s, i) => (
              <div key={i} className={`ai-sig ${s.tone ?? "warn"}`}>
                <span className="ai-ic">{ICON[s.tone ?? "warn"]}</span>
                <span>{s.text}</span>
              </div>
            ))}
          </>
        )}
      </div>

      {onDetail && (
        <div className="ai-foot">
          Mau versi lengkap (derivatif/fundamental, berita, skenario)?{" "}
          <button type="button" onClick={onDetail} className="hover:underline">
            Detail lengkap →
          </button>
        </div>
      )}
    </div>
  );
}
