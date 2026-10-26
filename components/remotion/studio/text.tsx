"use client";

/**
 * Tipografi Studio: KineticText (kata muncul berirama, kata penting disorot warna brand) dan subtitle VO.
 * Ukuran huruf dihitung otomatis supaya muat di zona aman (maks ±6–7 kata per baris).
 */
import { useMemo, type CSSProperties } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { alignWords, sceneStartSecs, subtitleCues, voStartOf, type Ease, type Timeline } from "@/lib/studio/timeline";
import { splitShadow, useSplit } from "./fx";
import { clamp, clamp01, ease, ink, rgba, textEm, useScene, useStudio } from "./theme";

// ---------------------------------------------------------------------------------------------
// Kata penting (emphasis)
// ---------------------------------------------------------------------------------------------
const norm = (w: string) => w.toLowerCase().replace(/[.,!?…:;"'“”‘’()[\]{}*_~`]/g, "").trim();

/** pencocok kata penting: cocok persis, atau kata diawali kata kunci (mis. "manual" ↔ "manualnya") */
export function emphasisMatcher(list: string[] | undefined): (word: string) => boolean {
  const keys = (list ?? []).flatMap((e) => e.split(/\s+/)).map(norm).filter(Boolean);
  if (!keys.length) return () => false;
  return (word: string) => {
    const n = norm(word);
    return !!n && keys.some((k) => n === k || (k.length >= 4 && n.startsWith(k)));
  };
}

// ---------------------------------------------------------------------------------------------
// KineticText
// ---------------------------------------------------------------------------------------------
export type KStyle = "punch" | "stack" | "type" | "rise";

export type KineticProps = {
  lines: string[];
  emphasis?: string[];
  style?: KStyle;
  /** kotak tempat teks harus muat */
  w: number;
  h: number;
  max?: number;
  min?: number;
  /** frame mulai (relatif awal adegan) */
  start?: number;
  /** jatah frame sampai semua kata tampil */
  span?: number;
  align?: "center" | "left";
  color?: string;
  accent?: string;
  weight?: number;
  lh?: number;
  ease?: Ease;
  font?: string;
  /** false = jangan pecah baris otomatis (baris sudah diatur sendiri) */
  wrap?: boolean;
};

/** ukuran huruf KineticText untuk kotak w × h (dipakai juga untuk mengatur tata letak) */
export function kineticSize(lines: string[], w: number, h: number, max = 150, min = 30, lh = 1.12, emph?: (w: string) => boolean): number {
  const widest = Math.max(1, ...lines.map((l) => textEm(l) + (emph ? l.split(/\s+/).filter(emph).length * 0.3 : 0)));
  return Math.round(clamp(Math.min(w / widest, h / Math.max(1, lines.length * lh), max), min, max));
}

/** belah satu baris jadi dua, masing-masing ≥ 2 kata, dengan baris terpanjang sesempit mungkin (null kalau < 4 kata) */
function split2(line: string): [string, string] | null {
  const w = line.split(/\s+/).filter(Boolean);
  if (w.length < 4) return null;
  let best: [string, string] | null = null;
  let bw = Infinity;
  for (let k = 2; k <= w.length - 2; k++) {
    const a = w.slice(0, k).join(" ");
    const b = w.slice(k).join(" ");
    const m = Math.max(textEm(a), textEm(b));
    if (m < bw) {
      bw = m;
      best = [a, b];
    }
  }
  return best;
}

/**
 * Pecah baris panjang supaya huruf lebih besar (gaya kinetic: 2–4 kata per baris, tidak ada baris 1 kata hasil pecahan).
 * Baris terlebar dibelah dua selama ukuran huruf bertambah jelas (≥ 8%), maks `maxLines` baris.
 */
export function rewrap(lines: string[], w: number, h: number, max = 150, min = 30, lh = 1.12, emph?: (w: string) => boolean, maxLines = 4): string[] {
  let cur = lines.filter(Boolean);
  let size = kineticSize(cur, w, h, max, min, lh, emph);
  while (cur.length < maxLines && size < max) {
    let wi = -1;
    let ww = 0;
    let parts: [string, string] | null = null;
    for (let i = 0; i < cur.length; i++) {
      const e = textEm(cur[i]);
      const sp = e > ww ? split2(cur[i]) : null;
      if (sp) {
        ww = e;
        wi = i;
        parts = sp;
      }
    }
    if (wi < 0 || !parts) break;
    const next = [...cur.slice(0, wi), ...parts, ...cur.slice(wi + 1)];
    const ns = kineticSize(next, w, h, max, min, lh, emph);
    if (ns < size * 1.08) break;
    cur = next;
    size = ns;
  }
  return cur;
}

export function KineticText(p: KineticProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { brand, display, beat } = useStudio();
  const { scene, dur } = useScene();
  const split = useSplit();
  const mode = p.style ?? "punch";
  const ez = p.ease ?? scene.ease;
  const color = p.color ?? brand.text;
  const accent = p.accent ?? brand.primary;
  const lh = p.lh ?? 1.12;
  const isEmph = useMemo(() => emphasisMatcher(p.emphasis), [p.emphasis]);
  const max = p.max ?? 150;
  const min = p.min ?? 30;
  const src = useMemo(() => (p.wrap === false ? p.lines : rewrap(p.lines, p.w, p.h, max, min, lh, isEmph)), [p.lines, p.wrap, p.w, p.h, max, min, lh, isEmph]);
  const lines = src.map((l) => l.split(/\s+/).filter(Boolean)).filter((l) => l.length);
  const size = kineticSize(lines.map((l) => l.join(" ")), p.w, p.h, max, min, lh, isEmph);
  const start = p.start ?? 0;
  const N = lines.reduce((a, l) => a + l.length, 0);
  const total = Math.max(6, p.span ?? Math.round(dur * 0.45));
  // irama: setengah ketukan per kata, dipercepat kalau jatah waktunya kurang
  let step = beat / 2;
  if (N * step > total) step = beat / 4;
  if (N * step > total) step = total / Math.max(1, N);
  step = clamp(step, 2, 12);
  const lineStep = clamp(total / Math.max(1, lines.length), 4, beat);
  const chars = lines.reduce((a, l) => a + l.join(" ").length, 0);
  const cpf = clamp(chars / total, 0.7, 3.5);
  const typedN = Math.max(0, Math.floor((frame - start) * cpf));

  // follow-through: blok sedikit "mengayun" saat kata penting mendarat
  let bump = 0;
  let wi = 0;
  const emphAt: number[] = [];
  lines.forEach((l) => l.forEach((w) => {
    if (isEmph(w)) emphAt.push(start + wi * step);
    wi++;
  }));
  if (mode === "punch") for (const at of emphAt) {
    const k = frame - at - 2;
    if (k > 0 && k < 24) bump += Math.exp(-k / 5) * Math.sin(k * 0.7) * 0.022;
  }

  const baseShadow = `0 ${(size * 0.04).toFixed(1)}px ${(size * 0.4).toFixed(1)}px rgba(0,0,0,.35)`;
  const shadow = splitShadow(split, baseShadow);
  const caretIdx = mode === "type" ? findCaretWord(lines, typedN) : -1;
  let gi = 0;
  let ci = 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: p.align === "left" ? "flex-start" : "center",
        gap: size * (lh - 1) * 0.6,
        fontFamily: p.font ?? display,
        fontWeight: p.weight ?? 800,
        fontSize: size,
        lineHeight: lh,
        letterSpacing: "-0.02em",
        color,
        textAlign: p.align === "left" ? "left" : "center",
        textShadow: shadow,
        transform: bump ? `scale(${1 + bump})` : undefined,
        maxWidth: p.w,
      }}
    >
      {lines.map((words, li) => {
        const lAt = start + li * lineStep;
        const lp = mode === "stack" ? ease(ez, frame - lAt, fps, 12) : 1;
        const row = (
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: p.align === "left" ? "flex-start" : "center", columnGap: "0.26em", rowGap: 0 }}>
            {words.map((w, k) => {
              const idx = gi++;
              const at = start + idx * step;
              const emph = isEmph(w);
              let style: CSSProperties = { display: "inline-block", position: "relative", whiteSpace: "nowrap" };
              let text = w;
              let q = 0; // progres kotak sorot
              if (mode === "punch") {
                const kf = frame - at;
                const pp = ease(ez, kf, fps, 9);
                style = { ...style, opacity: clamp01(kf / 2.5), transform: kf <= 0 ? "scale(1.6)" : `translateY(${((1 - pp) * size * 0.14).toFixed(1)}px) scale(${(1 + (1 - pp) * 0.6).toFixed(4)})`, filter: kf > 0 && pp < 0.9 ? `blur(${((1 - pp) * 8).toFixed(2)}px)` : undefined };
                q = emph ? ease("smooth", kf - 3, fps, 8) : 0;
              } else if (mode === "stack") {
                q = emph ? ease("smooth", frame - lAt - 7 - k, fps, 9) : 0;
              } else if (mode === "rise") {
                const kf = frame - at;
                const pp = ease("smooth", kf, fps, 12);
                style = { ...style, opacity: pp, transform: `translateY(${((1 - pp) * size * 0.4).toFixed(1)}px)`, filter: pp < 0.95 ? `blur(${((1 - pp) * 6).toFixed(2)}px)` : undefined };
                q = emph ? ease("smooth", kf - 8, fps, 10) : 0;
              } else {
                // type: huruf diketik satu per satu
                const from = ci;
                ci += w.length + 1;
                const shown = clamp(typedN - from, 0, w.length);
                text = Array.from(w).slice(0, shown).join("");
                const done = shown >= w.length;
                const doneAt = start + Math.ceil((from + w.length) / cpf);
                q = emph && done ? ease("smooth", frame - doneAt, fps, 8) : 0;
                style = { ...style, opacity: shown > 0 || idx === caretIdx ? 1 : 0 };
              }
              const caret = idx === caretIdx && frame >= start ? <Caret size={size} color={accent} frame={frame} /> : null;
              return (
                <span key={k} style={style}>
                  {emph && q > 0 && (
                    <span
                      style={{
                        position: "absolute",
                        left: "-0.12em",
                        right: "-0.12em",
                        top: "0.04em",
                        bottom: "0.02em",
                        borderRadius: "0.14em",
                        background: `linear-gradient(180deg, ${accent} 0%, ${rgba(accent, 0.92)} 100%)`,
                        boxShadow: `0 ${(size * 0.08).toFixed(1)}px ${(size * 0.35).toFixed(1)}px ${rgba(accent, 0.45)}`,
                        transform: `scaleX(${clamp01(q).toFixed(4)})`,
                        transformOrigin: "0 50%",
                      }}
                    />
                  )}
                  <span style={{ position: "relative", color: emph ? (q > 0.45 ? ink(accent) : accent) : undefined, textShadow: emph && q > 0.45 ? "none" : undefined }}>{text}</span>
                  {caret}
                </span>
              );
            })}
          </div>
        );
        if (mode !== "stack") return <div key={li}>{row}</div>;
        // stack: baris naik dari balik "mask"
        return (
          <div key={li} style={{ overflow: "hidden", padding: "0.06em 0.22em 0.12em", margin: "-0.06em -0.22em -0.12em" }}>
            <div style={{ transform: `translateY(${((1 - lp) * 115).toFixed(2)}%) skewY(${((1 - lp) * 5).toFixed(2)}deg)`, opacity: clamp01(lp * 2) }}>{row}</div>
          </div>
        );
      })}
    </div>
  );
}

/** indeks kata tempat kursor ketik berada */
function findCaretWord(lines: string[][], typed: number): number {
  let c = 0;
  let idx = 0;
  for (const l of lines) for (const w of l) {
    if (typed < c + w.length) return idx;
    c += w.length + 1;
    idx++;
  }
  return idx - 1;
}

function Caret({ size, color, frame }: { size: number; color: string; frame: number }) {
  const on = Math.floor(frame / 8) % 2 === 0;
  return <span style={{ display: "inline-block", width: Math.max(3, size * 0.06), height: size * 0.9, marginLeft: size * 0.05, verticalAlign: "-0.1em", borderRadius: 3, background: color, opacity: on ? 1 : 0.15 }} />;
}

// ---------------------------------------------------------------------------------------------
// Subtitle VO
// ---------------------------------------------------------------------------------------------
type SubWord = { w: string; s: number; e: number };
export type SubCue = { s: number; e: number; end: number; text: string; scene: number; words: SubWord[] | null };

/** baris VO yang benar-benar diputar untuk adegan i (null kalau VO mati / belum dibuat) */
export function voLineFor(tl: Timeline, i: number, audio: "all" | "vo" | "novo" = "all") {
  const sc = tl.scenes[i];
  if (!sc || audio === "novo" || tl.muteVo || tl.voice?.mode === "none" || !sc.vo?.text) return null;
  return tl.vo?.lines.find((l) => l.sceneId === sc.id) ?? null;
}

/** subtitle tampil di adegan i? (adegan subtitles=true, ada VO, dan bukan versi tanpa VO) */
export const subsOn = (tl: Timeline, i: number, audio: "all" | "vo" | "novo" = "all") => !!tl.scenes[i]?.subtitles && !!voLineFor(tl, i, audio);

/** potongan subtitle (waktu global, dari subtitleCues) + timestamp per kata kalau ada */
export function buildSubs(tl: Timeline): SubCue[] {
  const cues = subtitleCues(tl);
  const starts = sceneStartSecs(tl);
  const timed = new Map<number, SubWord[]>();
  tl.scenes.forEach((sc, i) => {
    const line = tl.vo?.lines.find((l) => l.sceneId === sc.id);
    if (!sc.vo?.text || !line?.words?.length) return;
    const t0 = starts[i] + voStartOf(sc, line);
    const tw = sc.vo.text.split(/\s+/).filter(Boolean);
    // sama dengan pemetaan di subtitleCues: kata mesin → kata asli (alignWords)
    timed.set(i, alignWords(line.words, tw).map((w) => ({ w: w.w, s: t0 + w.s, e: t0 + w.e })));
  });
  return cues.map((c, k) => {
    const si = c.scene; // adegan pemilik VO, walau suaranya lewat batas adegan
    const ws = timed.get(si)?.filter((w) => w.s >= c.s - 1e-4 && w.e <= c.e + 1e-4) ?? [];
    const next = cues[k + 1]?.s ?? Infinity;
    return { ...c, end: Math.min(next, c.e + 0.3), scene: si, words: ws.length ? ws : null };
  });
}

/**
 * adegan yang perlu ruang subtitle: subtitle-nya sendiri tampil, ATAU tertimpa subtitle VO adegan lain yang suaranya
 * lewat batas adegan (subtitle ikut adegan pemilik VO, jadi tetap tampil walau adegan ini subtitle-nya mati / tanpa VO)
 */
export function subsRoom(tl: Timeline, audio: "all" | "vo" | "novo" = "all"): boolean[] {
  const on = tl.scenes.map((_, i) => subsOn(tl, i, audio));
  const cues = buildSubs(tl).filter((c) => on[c.scene]);
  const starts = sceneStartSecs(tl);
  // jendela tampil sama dengan <Subtitles>: c.s - 0,04 sampai c.end. Toleransi 0,1 dtk: ekor fade cue yang cuma lewat sedikit
  // ke adegan tetangga (fitVo memberi jeda 0,25 dtk, ekor cue 0,3 dtk) tidak membuat seluruh adegan itu menyisakan ruang subtitle
  const SPILL = 0.1;
  return on.map((b, j) => b || cues.some((c) => Math.min(c.end, starts[j] + tl.scenes[j].dur) - Math.max(c.s - 0.04, starts[j]) > SPILL));
}

/** bar subtitle di bawah, tepat di atas area caption TikTok (masih di zona aman) */
export function Subtitles({ tl, audio = "all" }: { tl: Timeline; audio?: "all" | "vo" | "novo" }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { safe, brand, display, ratio } = useStudio();
  const cues = useMemo(() => buildSubs(tl), [tl]);
  const on = useMemo(() => tl.scenes.map((_, i) => subsOn(tl, i, audio)), [tl, audio]);
  const t = frame / fps;
  const cue = cues.find((c) => t >= c.s - 0.04 && t < c.end);
  if (!cue || !on[cue.scene]) return null;
  const fs = frame - cue.s * fps;
  const pop = ease("spring", fs + 1, fps, 8);
  const out = clamp01((cue.end * fps - frame) / 4);
  const size = subSize(ratio);
  const words = cue.words ?? cue.text.split(/\s+/).map((w) => ({ w, s: -1, e: -1 }));
  // kata aktif = kata terakhir yang sudah mulai diucapkan
  let active = -1;
  if (cue.words) words.forEach((w, i) => (t >= w.s - 0.02 ? (active = i) : null));
  return (
    <div style={{ position: "absolute", left: safe.left, right: safe.right, bottom: safe.bottom + 12, display: "flex", justifyContent: "center", pointerEvents: "none", opacity: out * clamp01(pop * 1.4), transform: `translateY(${((1 - pop) * 14).toFixed(1)}px) scale(${(0.96 + 0.04 * pop).toFixed(4)})` }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          columnGap: "0.28em",
          maxWidth: "100%",
          padding: `${size * 0.3}px ${size * 0.55}px`,
          borderRadius: size * 0.5,
          background: "rgba(9,9,11,.74)",
          border: "1px solid rgba(255,255,255,.08)",
          boxShadow: "0 18px 40px -12px rgba(0,0,0,.6)",
          fontFamily: display,
          fontWeight: 800,
          fontSize: size,
          lineHeight: 1.22,
          color: "#ffffff",
          textAlign: "center",
          textShadow: "0 2px 10px rgba(0,0,0,.4)",
        }}
      >
        {words.map((w, i) => {
          const hot = i === active && t <= w.e + 0.12;
          return (
            <span key={i} style={{ display: "inline-block", color: hot ? brand.primary : i > active && active >= 0 ? "rgba(255,255,255,.82)" : "#ffffff", transform: hot ? "scale(1.06)" : undefined }}>
              {w.w}
            </span>
          );
        })}
      </div>
    </div>
  );
}

const subSize = (ratio: string) => (ratio === "9:16" ? 46 : 40);
/** tinggi ruang yang disisihkan untuk subtitle (px) supaya isi adegan tidak tertutup */
export const subsReserve = (ratio: string) => Math.round(subSize(ratio) * (1.22 * 2 + 0.6) + 36);
