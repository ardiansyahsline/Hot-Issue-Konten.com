/**
 * Laporan / presentasi dari AI (blok ```deck JSON) → PowerPoint bergaya laporan Konten.com
 * (latar hitam, angka utama hijau, kartu aksen oranye, warna platform resmi).
 */

export type Tone = "green" | "orange" | "neutral" | "red";
export type DeckKpi = { label: string; value: string; note?: string; tone?: Tone };
export type DeckChart = { kind: "bar" | "barh" | "line" | "pie" | "doughnut"; labels: string[]; series: { name: string; values: number[] }[]; unit?: string };
export type DeckTable = { columns: string[]; rows: (string | number)[][] };
export type DeckSlide = {
  type: "cover" | "section" | "kpi" | "chart" | "table" | "bullets";
  title: string;
  subtitle?: string;
  kpis?: DeckKpi[];
  chart?: DeckChart;
  table?: DeckTable;
  bullets?: string[];
  source?: string;
  note?: string;
};
export type Deck = { title: string; subtitle?: string; period?: string; label?: string; slides: DeckSlide[] };

export const C = {
  bg: "0A0A0A",
  panel: "101010",
  panel2: "141414",
  border: "242424",
  text: "FFFFFF",
  soft: "CFCFCF",
  muted: "8A8A8A",
  muted2: "6A6A6A",
  green: "2FE34A",
  greenDark: "1C5C28",
  orange: "FF6A00",
  orange2: "FF8A00",
  red: "FF3B30",
  violet: "A78BFA",
};
/** urutan warna seri grafik (warna platform Konten.com dulu) */
export const SERIES = ["2FE34A", "FF8A00", "33C9D6", "A78BFA", "FF1A1A", "B0B0B0", "FFD166", "EC4899"];
const PLATFORM: Record<string, string> = { tiktok: "33C9D6", instagram: "FF8A00", ig: "FF8A00", youtube: "FF1A1A", yt: "FF1A1A", threads: "B0B0B0" };
export const colorFor = (label: string, i: number) => PLATFORM[label.trim().toLowerCase()] ?? SERIES[i % SERIES.length];

/* ---------- parse blok ```deck ---------- */
const str = (v: unknown, max = 300) => (typeof v === "string" ? v : v == null ? "" : String(v)).slice(0, max);
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export function parseDeck(raw: unknown): Deck | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const slides = Array.isArray(d.slides) ? d.slides : [];
  const out: DeckSlide[] = [];
  for (const s0 of slides.slice(0, 40)) {
    if (!s0 || typeof s0 !== "object") continue;
    const s = s0 as Record<string, unknown>;
    const type = (["cover", "section", "kpi", "chart", "table", "bullets"].includes(String(s.type)) ? s.type : "bullets") as DeckSlide["type"];
    const slide: DeckSlide = { type, title: str(s.title, 120), subtitle: str(s.subtitle, 200) || undefined, source: str(s.source, 200) || undefined, note: str(s.note, 400) || undefined };
    if (Array.isArray(s.kpis))
      slide.kpis = s.kpis.slice(0, 6).map((k: Record<string, unknown>) => ({
        label: str(k?.label, 40),
        value: str(k?.value, 24),
        note: str(k?.note, 60) || undefined,
        tone: (["green", "orange", "neutral", "red"].includes(String(k?.tone)) ? k.tone : "neutral") as Tone,
      }));
    if (s.chart && typeof s.chart === "object") {
      const c = s.chart as Record<string, unknown>;
      const labels = Array.isArray(c.labels) ? c.labels.slice(0, 24).map((x) => str(x, 40)) : [];
      const series = Array.isArray(c.series)
        ? c.series.slice(0, 6).map((x: Record<string, unknown>) => ({ name: str(x?.name, 40) || "Nilai", values: (Array.isArray(x?.values) ? x.values : []).slice(0, labels.length).map(num) }))
        : [];
      if (labels.length && series.length)
        slide.chart = { kind: (["bar", "barh", "line", "pie", "doughnut"].includes(String(c.kind)) ? c.kind : "bar") as DeckChart["kind"], labels, series, unit: str(c.unit, 20) || undefined };
    }
    if (s.table && typeof s.table === "object") {
      const t = s.table as Record<string, unknown>;
      const columns = Array.isArray(t.columns) ? t.columns.slice(0, 8).map((x) => str(x, 40)) : [];
      const rows = Array.isArray(t.rows) ? t.rows.slice(0, 14).map((r) => (Array.isArray(r) ? r.slice(0, columns.length).map((x) => str(x, 60)) : [])) : [];
      if (columns.length) slide.table = { columns, rows };
    }
    if (Array.isArray(s.bullets)) slide.bullets = s.bullets.slice(0, 7).map((x) => str(x, 220));
    out.push(slide);
  }
  if (!out.length) return null;
  return { title: str(d.title, 120) || "Laporan", subtitle: str(d.subtitle, 200) || undefined, period: str(d.period, 60) || undefined, label: str(d.label, 40) || undefined, slides: out };
}

export function splitDeck(text: string): { text: string; deck: Deck | null; partial: boolean } {
  const m = text.match(/```deck\s*\n([\s\S]*?)```/);
  if (!m) {
    const i = text.indexOf("```deck");
    return i >= 0 ? { text: text.slice(0, i).trimEnd(), deck: null, partial: true } : { text, deck: null, partial: false };
  }
  let deck: Deck | null = null;
  try {
    deck = parseDeck(JSON.parse(m[1]));
  } catch {}
  return { text: (text.slice(0, m.index) + text.slice(m.index! + m[0].length)).trim(), deck, partial: false };
}

/* ---------- PowerPoint ---------- */
const W = 13.333;
const H = 7.5;
const FONT = "Arial";
const toneColor = (t?: Tone) => (t === "green" ? C.green : t === "orange" ? C.orange2 : t === "red" ? C.red : C.text);

async function logoData(): Promise<string | null> {
  try {
    const b = await (await fetch("/konten-logo-report.png")).blob();
    return await new Promise((r) => {
      const fr = new FileReader();
      fr.onload = () => r(String(fr.result));
      fr.readAsDataURL(b);
    });
  } catch {
    return null;
  }
}

export async function deckToPptx(deck: Deck): Promise<Blob> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = deck.title;
  pptx.company = "Konten.com";
  const logo = await logoData();
  const total = deck.slides.length;

  const frame = (s: ReturnType<typeof pptx.addSlide>, i: number, src?: string) => {
    s.background = { color: C.bg };
    if (logo) s.addImage({ data: logo, x: 0.55, y: 0.38, w: 2.9, h: 0.267 });
    s.addText((deck.label || "LAPORAN").toUpperCase(), { x: W - 5.55, y: 0.3, w: 5, h: 0.42, align: "right", fontFace: FONT, fontSize: 15, color: C.soft, charSpacing: 2 });
    s.addShape(pptx.ShapeType.line, { x: 0.55, y: 0.9, w: W - 1.1, h: 0, line: { color: C.border, width: 1 } });
    s.addText(src ? `Sumber: ${src}` : deck.period ?? "", { x: 0.55, y: H - 0.5, w: W - 2.5, h: 0.3, fontFace: FONT, fontSize: 9, color: C.muted2 });
    s.addText(`${i + 1} / ${total}`, { x: W - 1.55, y: H - 0.5, w: 1, h: 0.3, align: "right", fontFace: FONT, fontSize: 9, color: C.muted2 });
  };
  const heading = (s: ReturnType<typeof pptx.addSlide>, title: string, sub?: string) => {
    s.addText(title, { x: 0.55, y: 1.1, w: W - 1.1, h: 0.6, fontFace: FONT, fontSize: 26, bold: true, color: C.text });
    if (sub) s.addText(sub, { x: 0.55, y: 1.68, w: W - 1.1, h: 0.36, fontFace: FONT, fontSize: 13, color: C.muted });
  };
  const kpiTiles = (s: ReturnType<typeof pptx.addSlide>, kpis: DeckKpi[], x: number, y: number, w: number, h: number, cols: number) => {
    const gap = 0.22;
    const rows = Math.ceil(kpis.length / cols);
    const tw = (w - gap * (cols - 1)) / cols;
    const th = (h - gap * (rows - 1)) / rows;
    kpis.forEach((k, i) => {
      const cx = x + (i % cols) * (tw + gap);
      const cy = y + Math.floor(i / cols) * (th + gap);
      const accent = k.tone === "orange";
      const hero = k.tone === "green";
      s.addShape(pptx.ShapeType.roundRect, {
        x: cx,
        y: cy,
        w: tw,
        h: th,
        rectRadius: 0.12,
        fill: { color: accent ? C.orange : hero ? "0D1A10" : C.panel },
        line: { color: accent ? C.orange : hero ? C.greenDark : C.border, width: 1 },
      });
      s.addText(k.label, { x: cx + 0.22, y: cy + 0.16, w: tw - 0.44, h: 0.34, fontFace: FONT, fontSize: 12, color: accent ? "FFFFFF" : C.muted });
      s.addText(k.value, {
        x: cx + 0.22,
        y: cy + 0.48,
        w: tw - 0.44,
        h: Math.min(0.9, th - 0.9),
        fontFace: FONT,
        fontSize: hero ? 34 : 28,
        bold: true,
        color: accent ? "FFFFFF" : toneColor(k.tone),
        fit: "shrink",
        valign: "middle",
      });
      if (k.note) s.addText(k.note, { x: cx + 0.22, y: cy + th - 0.46, w: tw - 0.44, h: 0.32, fontFace: FONT, fontSize: 10.5, color: accent ? "FFE8D6" : C.muted2 });
    });
  };
  const chart = (s: ReturnType<typeof pptx.addSlide>, c: DeckChart, x: number, y: number, w: number, h: number) => {
    const pie = c.kind === "pie" || c.kind === "doughnut";
    const type = c.kind === "line" ? pptx.ChartType.line : c.kind === "pie" ? pptx.ChartType.pie : c.kind === "doughnut" ? pptx.ChartType.doughnut : pptx.ChartType.bar;
    s.addShape(pptx.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.12, fill: { color: C.panel }, line: { color: C.border, width: 1 } });
    const data = c.series.map((sr) => ({ name: sr.name, labels: c.labels, values: sr.values }));
    const colors = pie ? c.labels.map((l, i) => colorFor(l, i)) : c.series.map((sr, i) => (c.series.length === 1 ? C.green : colorFor(sr.name, i)));
    s.addChart(type, data, {
      x: x + 0.2,
      y: y + 0.15,
      w: w - 0.4,
      h: h - 0.3,
      barDir: c.kind === "barh" ? "bar" : "col",
      chartColors: colors,
      showLegend: pie || c.series.length > 1,
      legendPos: pie ? "r" : "b",
      legendColor: C.soft,
      legendFontFace: FONT,
      legendFontSize: 11,
      catAxisLabelColor: C.muted,
      valAxisLabelColor: C.muted,
      catAxisLabelFontFace: FONT,
      valAxisLabelFontFace: FONT,
      catAxisLabelFontSize: 11,
      valAxisLabelFontSize: 10,
      valGridLine: { color: C.border, size: 0.75 },
      catGridLine: { style: "none" },
      catAxisLineShow: false,
      valAxisLineShow: false,
      showValue: !pie && c.labels.length <= 8,
      dataLabelColor: pie ? "FFFFFF" : C.soft,
      dataLabelFontSize: 10,
      dataLabelFontFace: FONT,
      dataLabelFormatCode: pie ? "0%" : "#,##0",
      showPercent: pie,
      holeSize: 62,
      lineSize: 3,
      lineDataSymbol: "circle",
      lineDataSymbolSize: 7,
      barGapWidthPct: 60,
      valAxisLabelFormatCode: "#,##0",
    });
  };

  deck.slides.forEach((sl, i) => {
    const s = pptx.addSlide();
    frame(s, i, sl.source);
    if (sl.type === "cover" || (i === 0 && sl.type !== "kpi" && !sl.chart && !sl.table)) {
      s.addShape(pptx.ShapeType.rect, { x: 0.55, y: 2.55, w: 0.12, h: 1.55, fill: { color: C.green }, line: { color: C.green } });
      s.addText(sl.title || deck.title, { x: 0.9, y: 2.4, w: W - 2, h: 1.1, fontFace: FONT, fontSize: 44, bold: true, color: C.text, fit: "shrink" });
      s.addText(sl.subtitle || deck.subtitle || "", { x: 0.9, y: 3.45, w: W - 2, h: 0.5, fontFace: FONT, fontSize: 18, color: C.soft });
      if (deck.period) s.addText(deck.period, { x: 0.9, y: 4.05, w: W - 2, h: 0.4, fontFace: FONT, fontSize: 14, color: C.green });
      return;
    }
    if (sl.type === "section") {
      s.addText(sl.title, { x: 0.55, y: 2.7, w: W - 1.1, h: 1, fontFace: FONT, fontSize: 40, bold: true, color: C.green });
      if (sl.subtitle) s.addText(sl.subtitle, { x: 0.55, y: 3.65, w: W - 1.1, h: 0.5, fontFace: FONT, fontSize: 16, color: C.muted });
      return;
    }
    heading(s, sl.title, sl.subtitle);
    const top = sl.subtitle ? 2.2 : 1.95;
    const bottom = H - 0.75 - (sl.note ? 0.55 : 0);
    const kp = sl.kpis ?? [];
    if (sl.chart && kp.length) {
      kpiTiles(s, kp.slice(0, 3), 0.55, top, 3.6, bottom - top, 1);
      chart(s, sl.chart, 4.4, top, W - 4.95, bottom - top);
    } else if (sl.chart) chart(s, sl.chart, 0.55, top, W - 1.1, bottom - top);
    else if (sl.table) {
      const cols = sl.table.columns.length;
      const numeric = sl.table.columns.map((_, ci) => sl.table!.rows.filter((r) => /^[-+]?(rp\s*)?[\d.,]+\s*(%|x|jt|rb|k|m)?$/i.test(String(r[ci] ?? "").trim())).length > sl.table!.rows.length / 2);
      const rows = [
        sl.table.columns.map((h, ci) => ({ text: h.toUpperCase(), options: { bold: true, color: C.muted, fill: { color: C.panel2 }, align: (numeric[ci] ? "right" : "left") as "right" | "left", fontSize: 10.5 } })),
        ...sl.table.rows.map((r, ri) =>
          sl.table!.columns.map((_, ci) => ({
            text: String(r[ci] ?? ""),
            options: { color: ci === 0 ? C.text : C.soft, bold: ci === 0, fill: { color: ri % 2 ? C.panel : C.bg }, align: (numeric[ci] ? "right" : "left") as "right" | "left", fontSize: 12 },
          }))
        ),
      ];
      const tw = W - 1.1 - (kp.length ? 3.85 : 0);
      if (kp.length) kpiTiles(s, kp.slice(0, 3), W - 0.55 - 3.6, top, 3.6, bottom - top, 1);
      s.addTable(rows, {
        x: 0.55,
        y: top,
        w: tw,
        colW: Array.from({ length: cols }, (_, ci) => (ci === 0 ? tw * (cols > 2 ? 0.32 : 0.5) : (tw * (cols > 2 ? 0.68 : 0.5)) / (cols - 1))),
        fontFace: FONT,
        border: { type: "solid", color: C.border, pt: 0.75 },
        rowH: Math.min(0.42, (bottom - top) / rows.length),
        autoPage: false,
        margin: 0.08,
      });
    } else if (kp.length) {
      const cols = kp.length <= 3 ? kp.length : kp.length === 4 ? 2 : 3;
      kpiTiles(s, kp, 0.55, top, W - 1.1, Math.min(bottom - top, kp.length > 3 ? 4.2 : 2.3), cols);
      if (sl.bullets?.length && kp.length <= 3)
        s.addText(
          sl.bullets.map((b) => ({ text: b, options: { bullet: { code: "25CF" }, paraSpaceAfter: 8 } })),
          { x: 0.55, y: top + 2.55, w: W - 1.1, h: bottom - top - 2.6, fontFace: FONT, fontSize: 15, color: C.soft, valign: "top" }
        );
    }
    if (sl.type === "bullets" || (!sl.chart && !sl.table && !kp.length)) {
      s.addText(
        (sl.bullets ?? []).map((b) => ({ text: b, options: { bullet: { code: "25CF" }, paraSpaceAfter: 12 } })),
        { x: 0.75, y: top, w: W - 1.5, h: bottom - top, fontFace: FONT, fontSize: 18, color: C.soft, valign: "top" }
      );
    }
    if (sl.note) {
      s.addShape(pptx.ShapeType.roundRect, { x: 0.55, y: H - 1.25, w: W - 1.1, h: 0.45, rectRadius: 0.08, fill: { color: "1A1206" }, line: { color: "5A3410", width: 1 } });
      s.addText(`💡 ${sl.note}`, { x: 0.7, y: H - 1.25, w: W - 1.4, h: 0.45, fontFace: FONT, fontSize: 12, color: "FFC48A", valign: "middle" });
    }
  });
  return (await pptx.write({ outputType: "blob" })) as Blob;
}

export const deckFileName = (d: Deck) =>
  `${(d.title || "Laporan").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80)}${d.period ? ` - ${d.period.replace(/[\\/:*?"<>|]+/g, "-")}` : ""}.pptx`;
