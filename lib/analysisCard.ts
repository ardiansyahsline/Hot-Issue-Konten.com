/** Kartu analisa ringkas yang ditulis AI sebagai blok ```analisa {json}``` + kotak pertanyaan [[ask:{json}]] */
export type Metric = { label: string; value: string; note?: string; tone?: "up" | "down" | "neutral" };
export type Signal = { text: string; tone?: "good" | "warn" | "bad" };
export type Analysis = {
  symbol?: string;
  timeframe?: string;
  bias: "bullish" | "bearish" | "netral";
  confidence?: string;
  lead?: string;
  metrics: Metric[];
  signals: Signal[];
};
export type AskInfo = { sym: string; label: string; market: string; tf?: string; hero?: string; rec?: string; v?: number; x?: number; goal?: "entry" | "kondisi" | "berita" };

const DONE = /```analisa\s*([\s\S]*?)```\s*/i;
const PARTIAL = /```analisa[\s\S]*$/i;
const str = (v: unknown, max: number) => (v === undefined || v === null ? "" : String(v).trim().slice(0, max));

/** pisahkan blok analisa dari teks jawaban (blok yang belum selesai saat streaming disembunyikan) */
export function splitAnalysis(text: string): { text: string; card: Analysis | null } {
  const m = text.match(DONE);
  if (!m) return { text: text.replace(PARTIAL, "").trimEnd(), card: null };
  const rest = text.replace(DONE, "").trim();
  try {
    const j = JSON.parse(m[1].trim()) as Record<string, unknown>;
    const b = str(j.bias, 20).toLowerCase();
    const bias: Analysis["bias"] = /bull|naik|long/.test(b) ? "bullish" : /bear|turun|short/.test(b) ? "bearish" : "netral";
    const tone = (t: unknown) => (/up|naik|bagus|pos/i.test(String(t)) ? "up" : /down|turun|buruk|neg/i.test(String(t)) ? "down" : "neutral") as Metric["tone"];
    const stone = (t: unknown) => (/good|bagus|hijau|pos/i.test(String(t)) ? "good" : /bad|buruk|merah|neg/i.test(String(t)) ? "bad" : "warn") as Signal["tone"];
    const metrics = (Array.isArray(j.metrics) ? j.metrics : [])
      .map((x) => x as Record<string, unknown>)
      .filter((x) => str(x.label, 30) && str(x.value, 40) && !/^(-|—|n\/a|tidak ada|belum tersedia)$/i.test(str(x.value, 40)))
      .slice(0, 6)
      .map((x) => ({ label: str(x.label, 30), value: str(x.value, 40), note: str(x.note, 60) || undefined, tone: tone(x.tone) }));
    const signals = (Array.isArray(j.signals) ? j.signals : [])
      .map((x) => (typeof x === "string" ? { text: x } : (x as Record<string, unknown>)))
      .filter((x) => str(x.text, 160))
      .slice(0, 4)
      .map((x) => ({ text: str(x.text, 160), tone: stone(x.tone) }));
    if (!metrics.length && !signals.length) return { text: rest, card: null };
    return {
      text: rest,
      card: { symbol: str(j.symbol, 30) || undefined, timeframe: str(j.timeframe, 10) || undefined, bias, confidence: str(j.confidence, 20) || undefined, lead: str(j.lead, 400) || undefined, metrics, signals },
    };
  } catch {
    return { text: rest, card: null };
  }
}

/** versi teks kartu (untuk tombol Salin) */
export function analysisText(c: Analysis): string {
  return [
    `${c.symbol ?? ""}${c.timeframe ? ` · ${c.timeframe}` : ""} — ${c.bias.toUpperCase()}${c.confidence ? ` (keyakinan ${c.confidence})` : ""}`,
    c.lead ?? "",
    ...c.metrics.map((m) => `• ${m.label}: ${m.value}${m.note ? ` (${m.note})` : ""}`),
    ...c.signals.map((s) => `- ${s.text}`),
  ]
    .filter(Boolean)
    .join("\n");
}

const ASK = /\[\[ask:(\{[\s\S]*?\})\]\]/;
/** kotak pertanyaan pendekatan analisa */
export function splitAsk(text: string): { text: string; ask: AskInfo | null } {
  const m = text.match(ASK);
  if (!m) return { text, ask: null };
  try {
    const j = JSON.parse(m[1]) as AskInfo;
    return { text: text.replace(ASK, "").trim(), ask: j?.sym ? j : null };
  } catch {
    return { text: text.replace(ASK, "").trim(), ask: null };
  }
}
