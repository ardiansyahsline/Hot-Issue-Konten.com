/**
 * Tema & alat bantu gerak komposisi Studio (StudioVideo).
 * Semua animasi dihitung dari frame (tanpa CSS animation/transition) supaya preview, render browser,
 * dan render laptop selalu sama persis. Ukuran teks diperkirakan tanpa mengukur DOM (deterministik).
 */
import { createContext, useContext } from "react";
import { Easing, interpolate, spring } from "remotion";
import type { Brand, Ease, FontId, Ratio, Scene, Timeline } from "@/lib/studio/timeline";

// ---------------------------------------------------------------------------------------------
// Font & warna
// ---------------------------------------------------------------------------------------------
export const BODY = '"Inter Variable", ui-sans-serif, system-ui, sans-serif';
export const FONTS: Record<FontId, string> = {
  jakarta: '"Plus Jakarta Sans Variable", "Inter Variable", ui-sans-serif, system-ui, sans-serif',
  inter: '"Inter Variable", ui-sans-serif, system-ui, sans-serif',
  interTight: '"Inter Tight Variable", "Inter Variable", ui-sans-serif, system-ui, sans-serif',
};
export const fontOf = (b: Pick<Brand, "font">) => FONTS[b.font] ?? FONTS.jakarta;

/** naik = hijau, turun = merah (grafik & angka finansial) */
export const UP = "#22c55e";
export const DOWN = "#ef4444";

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const clamp01 = (v: number) => clamp(v, 0, 1);

export function rgb(hex: string): [number, number, number] {
  let h = (hex || "").replace("#", "").trim();
  if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split("").map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  if (!/^[0-9a-f]{6}/i.test(h) || !Number.isFinite(n)) return [249, 115, 22];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgba = (hex: string, a: number) => {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${clamp01(a).toFixed(3)})`;
};
/** campur dua warna hex (t = 0 → a, 1 → b) */
export function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * clamp01(t)));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
export function luma(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** warna teks yang kontras di atas warna `bg` */
export const ink = (bg: string) => (luma(bg) > 0.42 ? "#0a0a0b" : "#ffffff");

// ---------------------------------------------------------------------------------------------
// Easing & waktu
// ---------------------------------------------------------------------------------------------
const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** interpolate yang dikunci di ujung (+ easing) */
export const lerp = (f: number, input: number[], output: number[], easing: (t: number) => number = Easing.inOut(Easing.cubic)) =>
  interpolate(f, input, output, { ...CLAMP, easing });

export const EASE = {
  out: Easing.bezier(0.16, 1, 0.3, 1),
  back: Easing.bezier(0.34, 1.5, 0.64, 1),
  inOut: Easing.bezier(0.65, 0, 0.35, 1),
  soft: Easing.bezier(0.45, 0, 0.55, 1),
  in: Easing.bezier(0.55, 0, 1, 0.45),
  whip: Easing.bezier(0.75, 0, 0.25, 1),
};
/** pegas redaman sedang (spring) & pegas lentur (overshoot) */
export const SPRINGS = {
  spring: { damping: 15, stiffness: 140, mass: 0.8 },
  overshoot: { damping: 9, stiffness: 170, mass: 0.7 },
  soft: { damping: 20, stiffness: 110, mass: 1 },
};

/**
 * Progres masuk 0 → 1 dengan easing adegan, `f` = frame sejak mulai, `len` = lama (frame).
 * spring = pegas halus, overshoot = sedikit lewat lalu balik, smooth = bezier halus.
 */
export function ease(kind: Ease, f: number, fps: number, len: number): number {
  if (f <= 0) return 0;
  const L = Math.max(1, len);
  if (kind === "smooth") return EASE.out(Math.min(1, f / L));
  if (kind === "overshoot") return f >= L ? 1 : EASE.back(f / L);
  return spring({ frame: f, fps, config: SPRINGS.spring, durationInFrames: L });
}

/** denyut 0..1 berulang tiap `period` frame (untuk tombol, glow) */
export const pulse = (f: number, period: number) => 0.5 - 0.5 * Math.cos((2 * Math.PI * f) / Math.max(1, period));

/** angka format Indonesia (1.234,5) */
const NF = new Map<number, Intl.NumberFormat>();
export function fmtNum(n: number, d = 0): string {
  const k = clamp(Math.round(d), 0, 3);
  let f = NF.get(k);
  if (!f) {
    f = new Intl.NumberFormat("id-ID", { minimumFractionDigits: k, maximumFractionDigits: k });
    NF.set(k, f);
  }
  return f.format(Number.isFinite(n) ? n : 0);
}

// ---------------------------------------------------------------------------------------------
// Ukuran teks (perkiraan lebar dalam em untuk huruf tebal display)
// ---------------------------------------------------------------------------------------------
const NARROW = new Set("iIl.,:;!'|()[]`");
const WIDE = new Set("MWmw@%");
export function textEm(s: string): number {
  let w = 0;
  for (const ch of Array.from(s)) {
    const cp = ch.codePointAt(0) ?? 0;
    if (ch === " ") w += 0.27;
    else if (cp >= 0x1f000 || (cp >= 0x2600 && cp <= 0x27bf)) w += 1.15; // emoji
    else if (NARROW.has(ch)) w += 0.3;
    else if (WIDE.has(ch)) w += 0.88;
    else if (ch >= "A" && ch <= "Z") w += 0.7;
    else if (ch >= "0" && ch <= "9") w += 0.62;
    else w += 0.57;
  }
  return w * 1.04;
}

/** ukuran huruf terbesar supaya semua baris muat di kotak w × h */
export function fitSize(lines: string[], w: number, h: number, o: { max: number; min?: number; lh?: number; padEm?: number } = { max: 140 }): number {
  const lh = o.lh ?? 1.1;
  const widest = Math.max(1, ...lines.map((l) => textEm(l) + (o.padEm ?? 0)));
  const byW = w / widest;
  const byH = h / Math.max(1, lines.length * lh);
  return Math.round(clamp(Math.min(byW, byH, o.max), o.min ?? 24, o.max));
}

/** pecah kalimat jadi `n` baris yang seimbang (lebar baris terpanjang sekecil mungkin) */
export function balance(text: string, n: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (n <= 1 || words.length <= 1) return words.length ? [words.join(" ")] : [];
  const k = Math.min(n, words.length);
  let best: string[] = [words.join(" ")];
  let bestW = Infinity;
  const rec = (i: number, left: number, acc: string[]) => {
    if (left === 1) {
      const out = [...acc, words.slice(i).join(" ")];
      const wmax = Math.max(...out.map(textEm));
      if (wmax < bestW) {
        bestW = wmax;
        best = out;
      }
      return;
    }
    for (let j = i + 1; j <= words.length - (left - 1); j++) rec(j, left - 1, [...acc, words.slice(i, j).join(" ")]);
  };
  if (words.length <= 16) rec(0, k, []);
  else {
    const per = Math.ceil(words.length / k);
    best = Array.from({ length: k }, (_, x) => words.slice(x * per, (x + 1) * per).join(" ")).filter(Boolean);
  }
  return best;
}

/** baris judul otomatis: makin panjang teks makin banyak baris (maks `maxLines`) */
export function autoLines(text: string, charsPerLine: number, maxLines = 3): string[] {
  const n = clamp(Math.ceil(textEm(text) / (charsPerLine * 0.6)), 1, maxLines);
  return balance(text, n);
}

// ---------------------------------------------------------------------------------------------
// Konteks komposisi & adegan
// ---------------------------------------------------------------------------------------------
export type Box = { x: number; y: number; w: number; h: number };
export type Insets = { top: number; right: number; bottom: number; left: number };

export type StudioCtxValue = {
  tl: Timeline;
  brand: Brand;
  ratio: Ratio;
  W: number;
  H: number;
  fps: number;
  /** zona aman (px, sudah diskalakan ke ukuran video) */
  safe: Insets;
  portrait: boolean;
  display: string;
  /** panjang 1 ketukan (frame) — irama teks & denyut ikut musik */
  beat: number;
};
export const StudioCtx = createContext<StudioCtxValue | null>(null);
export function useStudio(): StudioCtxValue {
  const v = useContext(StudioCtx);
  if (!v) throw new Error("StudioCtx belum dipasang");
  return v;
}

export type SceneCtxValue = {
  scene: Scene;
  i: number;
  n: number;
  /** durasi adegan (frame), tanpa perpanjangan transisi */
  dur: number;
  /** area isi = zona aman dikurangi ruang subtitle */
  box: Box;
  /** subtitle tampil di adegan ini */
  subs: boolean;
  /** pengali tempo animasi (adegan pendek → animasi lebih cepat) */
  tempo: number;
};
export const SceneCtx = createContext<SceneCtxValue | null>(null);
export function useScene(): SceneCtxValue {
  const v = useContext(SceneCtx);
  if (!v) throw new Error("SceneCtx belum dipasang");
  return v;
}

/** id unik yang aman dipakai di url(#id) SVG */
export const svgId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "");

/**
 * Pengubah alamat media (audio, gambar, video). Bawaan: apa adanya (website — route /api/studio/…).
 * Render di laptop (remotion/Root.tsx) memetakan alamat website ke staticFile() karena route website tidak bisa diakses di sana.
 */
export type SrcResolver = (src: string) => string;
export const SrcCtx = createContext<SrcResolver>((s) => s);
export const useSrc = () => useContext(SrcCtx);
