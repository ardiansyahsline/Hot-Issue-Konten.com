"use client";

/**
 * Alat bantu layar website mini (di dalam mockup HP/laptop) untuk video Studio.
 * Warna tetap mode gelap (tidak ikut tema website), semua gerak dari frame, style inline.
 * Ukuran px = ukuran CSS layar perangkat: HP 390×844, laptop 1280×800.
 */
import { useId, type CSSProperties, type ReactNode } from "react";
import { Easing, interpolate, spring } from "remotion";
import HeroArt from "@/components/ai/HeroArt";
import type { Brand, ScreenKind } from "@/lib/studio/timeline";
import { DISPLAY, FONT } from "../../ugc/kit";

export { DISPLAY, FONT };
export const TIGHT = '"Inter Tight Variable", "Inter Variable", ui-sans-serif, system-ui, sans-serif';
export const fontOf = (b: Pick<Brand, "font">) => (b.font === "interTight" ? TIGHT : b.font === "inter" ? FONT : DISPLAY);

export type ScreenProps = {
  kind: ScreenKind;
  brand: Brand;
  /** teks pengganti contoh (judul issue, isi chat, nama adegan, dst — arti tiap jenis layar ada di screens.tsx) */
  items?: string[];
  title?: string;
  /** gambar / klip (layar "media", juga dipakai sebagai gambar di beberapa layar) */
  src?: string | null;
  /** frame mulai animasi, relatif ke awal Sequence (bawaan 0) */
  start?: number;
  /** durasi animasi (frame); bawaan = sisa durasi Sequence */
  dur?: number;
  /** paksa tampilan HP (true) / layar lebar (false); bawaan ikut perangkat */
  compact?: boolean;
};

// ------------------------------------------------------------------ warna ------------------------------------------------------------------
export const Z = {
  950: "#09090b",
  925: "#0e0e11",
  900: "#18181b",
  850: "#1f1f23",
  800: "#27272a",
  700: "#3f3f46",
  600: "#52525b",
  500: "#71717a",
  400: "#a1a1aa",
  300: "#d4d4d8",
  200: "#e4e4e7",
  100: "#f4f4f5",
  50: "#fafafa",
} as const;
/** [terang (teks / angka), utama] — sama dengan StatCard website */
export const TONE = {
  red: ["#fca5a5", "#ef4444"],
  orange: ["#fdba74", "#f97316"],
  sky: ["#7dd3fc", "#0ea5e9"],
  amber: ["#fcd34d", "#f59e0b"],
  emerald: ["#6ee7b7", "#10b981"],
  violet: ["#c4b5fd", "#8b5cf6"],
  blue: ["#93c5fd", "#3b82f6"],
  zinc: ["#d4d4d8", "#71717a"],
} as const;
export type Tone = keyof typeof TONE;
export const ORANGE_GRAD = "linear-gradient(180deg, #fb8a3c 0%, #ea580c 100%)";

/** rgba dari hex (#rgb / #rrggbb / #rrggbbaa); selain hex dikembalikan apa adanya */
export function rgba(hex: string, a: number) {
  let h = hex.trim().replace("#", "");
  if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6,8}$/i.test(h)) return hex;
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}
/** id unik aman untuk url(#id) di SVG */
export const useSid = (p: string) => p + useId().replace(/[^a-zA-Z0-9_-]/g, "");

// ------------------------------------------------------------------ waktu ------------------------------------------------------------------
/**
 * Jam layar: f = frame relatif ke awal animasi, d = durasi, L = panjang "cerita" (maks 8 dtk; sisanya gerak santai),
 * k = pengali waktu masuk (adegan pendek -> elemen muncul lebih cepat).
 */
export type Clock = { f: number; d: number; fps: number; L: number; k: number };
export const mkClock = (f: number, d: number, fps: number): Clock => ({
  f,
  d,
  fps,
  L: Math.max(1, Math.min(d, fps * 8)),
  k: Math.max(0.35, Math.min(1, d / (fps * 4))),
});

const CL = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const outE = Easing.out(Easing.cubic);
export const inOutE = Easing.inOut(Easing.cubic);
/** frame masuk elemen (dipercepat di adegan pendek) */
export const en = (t: Clock, fr: number) => fr * t.k;
/** frame momen cerita di pecahan `frac` dari panjang cerita */
export const bt = (t: Clock, frac: number) => t.L * frac;
/** pegas 0 → 1 mulai frame `at` (sedikit memantul) */
export const pop = (t: Clock, at: number, cfg: { damping?: number; stiffness?: number; mass?: number } = {}) =>
  spring({ frame: t.f - at, fps: t.fps, config: { damping: 15, stiffness: 170, mass: 0.7, ...cfg } });
/** nilai berjalan a → b (dikunci di ujung) */
export const ramp = (t: Clock, a: number, b: number, from = 0, to = 1, ease: (x: number) => number = inOutE) =>
  interpolate(t.f, [a, b > a ? b : a + 0.001], [from, to], { ...CL, easing: ease });
/** teks diketik: `cps` = huruf per detik */
export const typeOut = (t: Clock, text: string, at: number, cps = 30) => {
  const chars = Array.from(text);
  return chars.slice(0, Math.max(0, Math.floor(((t.f - at) / t.fps) * cps))).join("");
};
/** frame selesai mengetik */
export const typeEnd = (t: Clock, text: string, at: number, cps = 30) => at + (Array.from(text).length / cps) * t.fps;
/** urutan frame yang dijamin naik (syarat interpolate) */
export const asc = (fs: number[]) => fs.reduce<number[]>((a, v, i) => (a.push(i ? Math.max(v, a[i - 1] + 0.01) : v), a), []);

// ------------------------------------------------------------------ angka & teks ------------------------------------------------------------------
/** format angka gaya Indonesia: 12.500 / 5,75 */
export function fmtNum(n: number, dec = 0) {
  const [i, f] = Math.abs(n).toFixed(dec).split(".");
  return `${n < 0 ? "-" : ""}${i.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}${f ? `,${f}` : ""}`;
}
/** pecah "Rp1,2 T" / "+54%" / "5,75%" jadi awalan + angka + akhiran (untuk angka berjalan) */
export function parseFigure(s: string): { pre: string; n: number; dec: number; suf: string } | null {
  const m = s.trim().match(/^([^\d]*?)(\d+(?:[.,]\d+)*)(.*)$/);
  if (!m) return null;
  const raw = m[2];
  let n: number;
  let dec = 0;
  if (raw.includes(",")) {
    const [a, b = ""] = raw.split(",");
    n = Number(`${a.replace(/\./g, "")}.${b}`);
    dec = b.length;
  } else if (raw.includes(".")) {
    const parts = raw.split(".");
    if (parts.slice(1).every((p) => p.length === 3)) n = Number(parts.join(""));
    else (n = Number(raw)), (dec = parts[parts.length - 1].length);
  } else n = Number(raw);
  return Number.isFinite(n) ? { pre: m[1], n, dec: Math.min(dec, 3), suf: m[3] } : null;
}
/** angka di akhir teks: "Hot aktif 12" / "Resolved: 94%" -> {label, n, suf} */
export function splitStat(s: string): { label: string; n: number; suf: string } | null {
  const m = s.trim().match(/^(.*?)[\s:=–-]+(\d[\d.,]*)\s*(%|x|×)?$/i);
  if (!m || !m[1].trim()) return null;
  const f = parseFigure(m[2]);
  return f ? { label: m[1].trim(), n: f.n, suf: m[3] ?? "" } : null;
}
/** isi daftar: teks dari user dulu, sisanya contoh bawaan */
export const fill = (items: string[], defs: string[], n = defs.length) => [...items, ...defs.slice(items.length)].slice(0, Math.max(n, 0));
/** inisial nama: 2 kata -> huruf depan masing-masing, 1 kata -> 2 huruf pertama ("Alif" -> "AL") */
export const initials = (name: string) => {
  const w = name.split(/\s+/).map((x) => x.replace(/^[^A-Za-z0-9]+/, "")).filter(Boolean);
  const s = w.length > 1 ? w.slice(0, 2).map((x) => Array.from(x)[0]).join("") : Array.from(w[0] ?? "").slice(0, 2).join("");
  return s.toUpperCase() || "?";
};
const hash = (s: string) => Array.from(s).reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

// ------------------------------------------------------------------ lingkungan layar ------------------------------------------------------------------
export type Env = {
  t: Clock;
  wide: boolean;
  brand: Brand;
  /** warna aksen (brand) */
  acc: string;
  /** aksen terang (teks link / sorotan) */
  acc2: string;
  /** gradasi tombol utama */
  grad: string;
  items: string[];
  title: string;
  src: string | null;
  /** ukuran layar & ruang tertutup status bar / bilah browser */
  w: number;
  h: number;
  top: number;
  bottom: number;
};

// ------------------------------------------------------------------ komponen dasar ------------------------------------------------------------------
/** panel kartu website (.card) */
export const card = (acc = "#f97316", extra?: CSSProperties): CSSProperties => ({
  background: Z[900],
  border: "1px solid rgba(39,39,42,0.9)",
  borderRadius: 16,
  boxShadow: `0 1px 2px rgba(0,0,0,0.5), 0 16px 40px -20px rgba(0,0,0,0.7), 0 16px 26px -20px ${rgba(acc, 0.3)}`,
  ...extra,
});

/** lencana kecil (.badge) */
export function Badge({ c, fg, solid, size = 11, children, style }: { c: string; fg?: string; solid?: boolean; size?: number; children: ReactNode; style?: CSSProperties }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        whiteSpace: "nowrap",
        borderRadius: 999,
        padding: `${size * 0.18}px ${size * 0.8}px`,
        fontSize: size,
        fontWeight: 650,
        lineHeight: 1.35,
        color: solid ? "#fff" : (fg ?? c),
        background: solid ? c : rgba(c, 0.15),
        border: `1px solid ${rgba(c, solid ? 0.9 : 0.32)}`,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

const AV_GRADS = [
  ["#38bdf8", "#6366f1"],
  ["#a78bfa", "#ec4899"],
  ["#34d399", "#0ea5e9"],
  ["#fbbf24", "#f97316"],
  ["#f472b6", "#a855f7"],
  ["#60a5fa", "#22d3ee"],
];
export const avatarColor = (name: string) => AV_GRADS[hash(name) % AV_GRADS.length][0];
/** foto profil inisial (warna dari nama); `me` = oranye-pink seperti akun sendiri */
export function Avatar({ name, size = 28, me, ring }: { name: string; size?: number; me?: boolean; ring?: string }) {
  const [a, b] = me ? ["#fb923c", "#ec4899"] : AV_GRADS[hash(name) % AV_GRADS.length];
  return (
    <span
      style={{
        width: size,
        height: size,
        flex: "none",
        borderRadius: 999,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: `linear-gradient(135deg, ${a} 0%, ${b} 100%)`,
        color: "#fff",
        fontWeight: 750,
        fontSize: size * 0.38,
        letterSpacing: -0.2,
        border: ring ? `2px solid ${ring}` : undefined,
        boxSizing: "border-box",
      }}
    >
      {initials(name)}
    </span>
  );
}

/** data pribadi clipper (kontak / nama / foto) selalu diburamkan */
export function Blur({ children, px = 4, style }: { children: ReactNode; px?: number; style?: CSSProperties }) {
  return <span style={{ filter: `blur(${px}px)`, display: "inline-block", ...style }}>{children}</span>;
}

/** titik "live" berdenyut */
export function LiveDot({ t, color = "#10b981", size = 8 }: { t: Clock; color?: string; size?: number }) {
  const p = ((t.f % 48) + 48) % 48 / 48;
  return (
    <span style={{ position: "relative", width: size, height: size, flex: "none", display: "inline-block" }}>
      <span style={{ position: "absolute", inset: 0, borderRadius: 999, background: color, opacity: 0.5 * (1 - p), transform: `scale(${1 + p * 1.8})` }} />
      <span style={{ position: "absolute", inset: 0, borderRadius: 999, background: color }} />
    </span>
  );
}

/** kursor ketik */
export function Caret({ t, typing, color, h = 16 }: { t: Clock; typing: boolean; color: string; h?: number }) {
  const on = typing || Math.floor(t.f / 9) % 2 === 0;
  return <span style={{ display: "inline-block", width: 2, height: h, marginLeft: 2, verticalAlign: "middle", borderRadius: 1, background: color, opacity: on ? 1 : 0 }} />;
}

/** karakter chibi hero AI (diam, digoyang halus dari frame) */
export function Hero({ name = "Harley", size, t, bob = true }: { name?: string; size: number; t: Clock; bob?: boolean }) {
  const y = bob ? Math.sin(t.f / 8) * size * 0.025 : 0;
  const r = bob ? Math.sin(t.f / 13) * 2 : 0;
  return (
    <span style={{ display: "inline-flex", width: size, height: size, flex: "none", transform: `translateY(${y}px) rotate(${r}deg)`, transformOrigin: "50% 100%" }}>
      <HeroArt hero={name} size={size} still />
    </span>
  );
}

/** logo Konten.com (ikon oranye "K") — SVG supaya tajam & tidak perlu memuat gambar */
export function KLogo({ size = 30, shadow = true }: { size?: number; shadow?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" style={{ flex: "none", borderRadius: size * 0.27, boxShadow: shadow ? "0 6px 16px -6px rgba(245,73,0,0.6)" : undefined }} aria-hidden>
      <rect width="256" height="256" rx="62" fill="#f55200" />
      <path d="M121 64h40l-60 62H51z" fill="#fff" />
      <path d="M99 128h41l66 64h-42z" fill="#fff" />
    </svg>
  );
}

/** logo TWS (ikon garis miring + teks) */
export function TwsLogo({ h = 22, color = "#fff" }: { h?: number; color?: string }) {
  return (
    <svg width={(h * 156) / 44} height={h} viewBox="0 0 156 44" aria-hidden>
      <g fill={color}>
        <path d="M14 33c4-6 9-9 14-9l10 0c-4 6-9 9-14 9z" />
        <path d="M18 23c4-6 9-9 14-9l10 0c-4 6-9 9-14 9z" />
        <path d="M22 13c4-6 9-9 14-9l10 0c-4 6-9 9-14 9z" />
      </g>
      <g fill="none" stroke={color} strokeWidth="4.6" strokeLinejoin="round" strokeLinecap="square">
        <path d="M60 10h22M71 10v25" />
        <path d="M86 10l6.5 25 7-20 7 20 6.5-25" />
        <path d="M140 13.5c-2-2.6-5-3.9-8.5-3.9-4.6 0-7.8 2.4-7.8 5.9 0 7.8 17 4.3 17 12.4 0 3.8-3.6 6.5-8.8 6.5-4 0-7.3-1.6-9.3-4.4" />
      </g>
    </svg>
  );
}

/** ikon garis StatCard website */
const ICONS: Record<string, ReactNode> = {
  flame: <path d="M12 3c1 3.5-3 5-3 9a3 3 0 0 0 6 0c0-1-.5-2-.5-2 2.5 1.5 4 4 4 6.5a6.5 6.5 0 0 1-13 0C5.5 10 12 8 12 3z" />,
  alert: (
    <>
      <path d="M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  inbox: (
    <>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  play: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m10 8.5 5 3.5-5 3.5z" />
    </>
  ),
  sparkles: <path d="M12 3l1.8 4.7L18 9.5l-4.2 1.8L12 16l-1.8-4.7L6 9.5l4.2-1.8zM19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />,
  send: <path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z" />,
  clip: <path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.6 8.6a2 2 0 0 1-2.8-2.8L15.5 7" />,
};
export type IconName = keyof typeof ICONS;
export function Icon({ name, size = 18, color = "currentColor", fill }: { name: string; size?: number; color?: string; fill?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill={fill ? color : "none"} stroke={fill ? "none" : color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flex: "none" }}>
      {ICONS[name]}
    </svg>
  );
}

/** kotak ikon gradasi (StatCard) */
export function IconTile({ name, tone, size = 34 }: { name: string; tone: Tone; size?: number }) {
  const [lt, md] = TONE[tone];
  return (
    <span
      style={{
        width: size,
        height: size,
        flex: "none",
        borderRadius: size * 0.32,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        background: `linear-gradient(145deg, ${lt} 0%, ${md} 100%)`,
        boxShadow: `0 6px 14px -6px ${rgba(md, 0.7)}`,
      }}
    >
      <Icon name={name} size={size * 0.52} />
    </span>
  );
}

/** cahaya warna lembut di atas halaman (seperti --bg-glow website), pakai SVG radialGradient */
export function TopGlow({ color, w, h, opacity = 1 }: { color: string; w: number; h: number; opacity?: number }) {
  const id = useSid("tg");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ position: "absolute", left: 0, top: 0, opacity, pointerEvents: "none" }} aria-hidden>
      <defs>
        <radialGradient id={id} cx="50%" cy="0%" r="75%">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={w} height={h} fill={`url(#${id})`} />
    </svg>
  );
}

/** tab pil (TopTabs / sub menu): yang aktif bergradasi */
export function Tabs({ items, on, grad, size = 12.5, round = 999, full }: { items: ReactNode[]; on: number; grad: string; size?: number; round?: number; full?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 2,
        padding: 3,
        borderRadius: round,
        border: "1px solid rgba(39,39,42,0.85)",
        background: Z[900],
        fontSize: size,
        fontWeight: 650,
        width: full ? "100%" : undefined,
        boxSizing: "border-box",
      }}
    >
      {items.map((x, i) => (
        <span
          key={i}
          style={{
            flex: full ? 1 : undefined,
            textAlign: "center",
            whiteSpace: "nowrap",
            borderRadius: round,
            padding: `${size * 0.45}px ${size * 0.95}px`,
            color: i === on ? "#fff" : Z[400],
            background: i === on ? grad : undefined,
            boxShadow: i === on ? "0 8px 18px -8px rgba(234,88,12,0.6)" : undefined,
          }}
        >
          {x}
        </span>
      ))}
    </div>
  );
}

/** tombol utama (gradasi) / sekunder */
export function Btn({ children, grad, ghost, size = 13, press = 1, style }: { children: ReactNode; grad?: string; ghost?: boolean; size?: number; press?: number; style?: CSSProperties }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        whiteSpace: "nowrap",
        borderRadius: 12,
        padding: `${size * 0.7}px ${size * 1.25}px`,
        fontSize: size,
        fontWeight: 650,
        color: ghost ? Z[200] : "#fff",
        background: ghost ? Z[900] : (grad ?? ORANGE_GRAD),
        border: ghost ? "1px solid rgba(63,63,70,0.8)" : undefined,
        boxShadow: ghost ? "0 1px 2px rgba(0,0,0,0.4)" : "0 8px 20px -8px rgba(234,88,12,0.7)",
        transform: `scale(${press})`,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

// ------------------------------------------------------------------ grafik mini ------------------------------------------------------------------
const r2 = (n: number) => Math.round(n * 100) / 100;
function smoothPath(pts: [number, number][]) {
  if (pts.length < 2) return pts.length ? `M${r2(pts[0][0])} ${r2(pts[0][1])}` : "";
  return pts
    .map((p, i) => {
      if (!i) return `M${r2(p[0])} ${r2(p[1])}`;
      const p0 = pts[i - 2] ?? pts[i - 1];
      const p1 = pts[i - 1];
      const p3 = pts[i + 1] ?? p;
      const c1 = [p1[0] + (p[0] - p0[0]) / 6, p1[1] + (p[1] - p0[1]) / 6];
      const c2 = [p[0] - (p3[0] - p1[0]) / 6, p[1] - (p3[1] - p1[1]) / 6];
      return `C${r2(c1[0])} ${r2(c1[1])} ${r2(c2[0])} ${r2(c2[1])} ${r2(p[0])} ${r2(p[1])}`;
    })
    .join(" ");
}

/** grafik garis/area yang tergambar sesuai progres p (0..1), titik ujung bercahaya */
export function LineChart({ values, w, h, color, p, area = true, pad = 8, width = 2.6, grid = 0 }: { values: number[]; w: number; h: number; color: string; p: number; area?: boolean; pad?: number; width?: number; grid?: number }) {
  const id = useSid("lc");
  const vals = values.length > 1 ? values : [0, ...(values.length ? values : [1])];
  const max = Math.max(...vals);
  const min = Math.min(0, ...vals);
  const pts = vals.map((v, i): [number, number] => [pad + (i / (vals.length - 1)) * (w - pad * 2), h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2.4)]);
  const n = pts.length - 1;
  const pos = clamp01(p) * n;
  const k = Math.floor(pos);
  const fr = pos - k;
  const vis = pts.slice(0, k + 1);
  if (k < n && fr > 0) vis.push([pts[k][0] + (pts[k + 1][0] - pts[k][0]) * fr, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * fr]);
  const d = smoothPath(vis);
  const last = vis[vis.length - 1];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block", overflow: "visible" }} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.38" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {Array.from({ length: grid }, (_, i) => (
        <line key={i} x1={pad} x2={w - pad} y1={pad + ((h - pad * 2) / Math.max(1, grid - 1)) * i} y2={pad + ((h - pad * 2) / Math.max(1, grid - 1)) * i} stroke="rgba(255,255,255,0.06)" strokeDasharray="3 5" />
      ))}
      {p > 0 && vis.length > 1 && (
        <>
          {area && <path d={`${d} L${r2(last[0])} ${h} L${r2(vis[0][0])} ${h} Z`} fill={`url(#${id})`} />}
          <path d={d} stroke={color} strokeOpacity="0.25" strokeWidth={width * 3.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <path d={d} stroke={color} strokeWidth={width} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={last[0]} cy={last[1]} r={width * 3.4} fill={color} opacity="0.22" />
          <circle cx={last[0]} cy={last[1]} r={width * 1.5} fill="#fff" stroke={color} strokeWidth={width * 0.8} />
        </>
      )}
    </svg>
  );
}

/** grafik batang tumbuh bergiliran; `hi` = indeks batang yang disorot */
export function BarChart({ values, labels, h, color, t, at, hi, gap = 6, radius = 6, label = 10.5, showVal = true }: { values: number[]; labels?: string[]; h: number; color: string; t: Clock; at: number; hi?: number; gap?: number; radius?: number; label?: number; showVal?: boolean }) {
  const max = Math.max(1, ...values);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap, height: h, width: "100%" }}>
      {values.map((v, i) => {
        const g = pop(t, at + i * 3, { damping: 16, stiffness: 140 });
        const on = i === hi;
        return (
          <div key={i} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 4, height: "100%" }}>
            {showVal && <span style={{ fontSize: label, fontWeight: 750, color: on ? "#fff" : Z[400], opacity: clamp01(g * 1.4) }}>{fmtNum(Math.round(v * clamp01(g)))}</span>}
            <div
              style={{
                width: "100%",
                height: Math.max(2, (v / max) * (h - (labels ? label * 2.6 : 0) - (showVal ? label * 1.8 : 0)) * g),
                borderRadius: `${radius}px ${radius}px ${radius * 0.4}px ${radius * 0.4}px`,
                background: on ? `linear-gradient(180deg, ${color} 0%, ${rgba(color, 0.65)} 100%)` : "linear-gradient(180deg, #52525b 0%, #3f3f46 100%)",
                boxShadow: on ? `0 10px 22px -8px ${rgba(color, 0.7)}` : undefined,
              }}
            />
            {labels && <span style={{ fontSize: label, color: Z[500], fontWeight: 600, whiteSpace: "nowrap" }}>{labels[i] ?? ""}</span>}
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ jari / kursor ------------------------------------------------------------------
export type PKey = { f: number; x: number; y: number; click?: boolean };
/** jari (HP) atau panah mouse (laptop) yang bergerak antar titik dan mengetuk */
export function Pointer({ t, keys, wide }: { t: Clock; keys: PKey[]; wide: boolean }) {
  if (!keys.length) return null;
  const fs = asc(keys.map((k) => k.f));
  const ease = Easing.bezier(0.45, 0, 0.2, 1);
  const val = (pick: (k: PKey) => number) => (keys.length === 1 ? pick(keys[0]) : interpolate(t.f, fs, keys.map(pick), { ...CL, easing: ease }));
  const x = val((k) => k.x);
  const y = val((k) => k.y);
  const first = fs[0];
  const last = fs[fs.length - 1];
  const op = ramp(t, first - 10, first - 2) * (1 - ramp(t, last + 16, last + 26));
  if (op <= 0.001) return null;
  const clickF = keys.map((k, i) => (k.click ? fs[i] : null)).filter((v): v is number => v !== null);
  const near = clickF.find((c) => t.f >= c - 4 && t.f < c + 22);
  const press = near !== undefined && t.f < near + 4 ? 0.82 : 1;
  const ring = near !== undefined && t.f >= near ? (t.f - near) / 22 : -1;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, opacity: op, zIndex: 60, pointerEvents: "none" }}>
      {ring >= 0 && (
        <div
          style={{
            position: "absolute",
            left: x - 18,
            top: y - 18,
            width: 36,
            height: 36,
            borderRadius: 999,
            border: `3px solid rgba(255,255,255,${0.85 * (1 - ring)})`,
            transform: `scale(${1 + ring * 1.6})`,
          }}
        />
      )}
      {wide ? (
        <svg width="26" height="30" viewBox="0 0 26 30" style={{ position: "absolute", left: x - 3, top: y - 2, transform: `scale(${press})`, transformOrigin: "3px 2px" }} aria-hidden>
          <path d="M3 2 L3 24 L9 18.5 L13 28 L17 26.3 L13 17 L21 17 Z" fill="#fff" stroke="#111" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      ) : (
        <div
          style={{
            position: "absolute",
            left: x - 17,
            top: y - 17,
            width: 34,
            height: 34,
            borderRadius: 999,
            background: "rgba(255,255,255,0.82)",
            border: "2px solid rgba(255,255,255,0.95)",
            boxShadow: "0 6px 18px rgba(0,0,0,0.45)",
            transform: `scale(${press})`,
          }}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ kerangka website CS Tracker ------------------------------------------------------------------
const NAV = [
  { k: "home", icon: "🏠", short: "Home", label: "Dashboard" },
  { k: "issue", icon: "➕", short: "Issue", label: "+ Issue Baru" },
  { k: "video", icon: "🎬", short: "Video", label: "Video Review" },
  { k: "saran", icon: "📝", short: "Saran", label: "Catatan & Saran" },
  { k: "chat", icon: "💬", short: "Chat", label: "Chat" },
  { k: "ai", icon: "✨", short: "AI", label: "✨ AI" },
  { k: "studio", icon: "🎬", short: "Studio", label: "🎬 Studio" },
] as const;
export type NavKey = (typeof NAV)[number]["k"] | "music";
export const ME = "Alif";

/** tinggi kepala website (logo + menu) */
export const headH = (wide: boolean) => (wide ? 64 : 112);
/** tinggi area isi di bawah kepala website */
export const bodyH = (e: Env) => e.h - e.top - e.bottom - headH(e.wide);
/** lebar isi setelah padding */
export const bodyW = (e: Env) => e.w - (e.wide ? 56 : 28);

function Header({ e, nav }: { e: Env; nav: NavKey | null }) {
  const { wide, top } = e;
  const H = headH(wide);
  const pending = (
    <span style={{ position: "absolute", right: wide ? -3 : 2, top: wide ? -4 : 0, minWidth: 15, height: 15, borderRadius: 999, background: "#ef4444", color: "#fff", fontSize: 9.5, fontWeight: 750, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px", boxSizing: "border-box", border: `2px solid ${Z[900]}` }}>
      3
    </span>
  );
  const brandBlock = (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <KLogo size={wide ? 34 : 30} />
      <div style={{ lineHeight: 1.15 }}>
        <div style={{ fontFamily: DISPLAY, fontSize: wide ? 15 : 14.5, fontWeight: 750, color: Z[50] }}>CS Tracker</div>
        <div style={{ fontSize: wide ? 11 : 10.5, fontWeight: 550, color: Z[500] }}>Konten.com</div>
      </div>
    </div>
  );
  const account = (
    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, borderRadius: 999, border: "1px solid rgba(39,39,42,0.85)", background: Z[900], padding: wide ? "3px 12px 3px 3px" : 3 }}>
        <Avatar name={ME} me size={wide ? 28 : 26} />
        {wide && (
          <span style={{ lineHeight: 1.15 }}>
            <span style={{ display: "block", fontSize: 12, fontWeight: 650, color: Z[100] }}>{ME}</span>
            <span style={{ display: "block", fontSize: 10, fontWeight: 650, color: "#fb923c" }}>Admin</span>
          </span>
        )}
      </div>
      <span style={{ width: wide ? 32 : 28, height: wide ? 32 : 28, borderRadius: 999, border: "1px solid rgba(39,39,42,0.85)", background: Z[900], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>🌙</span>
      <span style={{ borderRadius: 999, border: "1px solid rgba(63,63,70,0.8)", background: Z[900], padding: wide ? "6px 12px" : "5px 10px", fontSize: 11.5, fontWeight: 650, color: Z[200] }}>Keluar</span>
    </div>
  );
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: top + H, background: "rgba(9,9,11,0.86)", borderBottom: "1px solid rgba(39,39,42,0.7)", zIndex: 30 }}>
      {wide ? (
        <div style={{ position: "absolute", left: 28, right: 28, top, height: H, display: "flex", alignItems: "center", gap: 16 }}>
          {brandBlock}
          <div style={{ display: "flex", gap: 3, padding: 4, borderRadius: 999, border: "1px solid rgba(39,39,42,0.85)", background: Z[900] }}>
            {NAV.map((n) => (
              <span
                key={n.k}
                style={{
                  position: "relative",
                  whiteSpace: "nowrap",
                  borderRadius: 999,
                  padding: "6px 13px",
                  fontSize: 13,
                  fontWeight: 550,
                  color: n.k === nav ? Z[50] : Z[400],
                  background: n.k === nav ? Z[800] : undefined,
                  boxShadow: n.k === nav ? "0 8px 24px -8px rgba(0,0,0,0.6)" : undefined,
                }}
              >
                {n.label}
                {n.k === "video" && pending}
              </span>
            ))}
            <span style={{ borderRadius: 999, padding: "6px 12px", fontSize: 13, color: nav === "music" ? "#34d399" : Z[400], background: nav === "music" ? Z[800] : undefined }}>🎵</span>
          </div>
          <div style={{ flex: 1 }} />
          {account}
        </div>
      ) : (
        <div style={{ position: "absolute", left: 14, right: 14, top: top + 8, height: H - 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 36 }}>
            {brandBlock}
            {account}
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 2, padding: 4, borderRadius: 16, border: "1px solid rgba(39,39,42,0.85)", background: Z[900] }}>
            {[...NAV, { k: "music", icon: "🎵", short: "Musik", label: "" }].map((n) => (
              <span
                key={n.k}
                style={{
                  position: "relative",
                  flex: 1,
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 2,
                  borderRadius: 12,
                  padding: "5px 0 4px",
                  color: n.k === nav ? Z[50] : Z[400],
                  background: n.k === nav ? Z[800] : undefined,
                  boxShadow: n.k === nav ? "0 8px 24px -8px rgba(0,0,0,0.6)" : undefined,
                }}
              >
                <span style={{ fontSize: 15, lineHeight: 1 }}>{n.icon}</span>
                <span style={{ fontSize: 9.5, fontWeight: 650, lineHeight: 1.2 }}>{n.short}</span>
                {n.k === "video" && pending}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Kerangka halaman website (kepala + menu + isi). Isi bisa "digulir" (scroll = px ke atas).
 * `fill` = isi diletakkan absolut memenuhi area (untuk chat yang menempel ke bawah).
 */
export function Shell({ e, nav, children, scroll = 0, fill }: { e: Env; nav: NavKey | null; children: ReactNode; scroll?: number; fill?: boolean }) {
  const pad = e.wide ? { x: 28, y: 22 } : { x: 14, y: 14 };
  return (
    <div style={{ position: "absolute", inset: 0, background: Z[950], color: Z[100], fontFamily: FONT, letterSpacing: -0.08, overflow: "hidden" }}>
      <TopGlow color={e.acc} w={e.w} h={e.h * 0.55} />
      <div style={{ position: "absolute", left: 0, right: 0, top: e.top + headH(e.wide), bottom: e.bottom, overflow: "hidden" }}>
        {fill ? (
          <div style={{ position: "absolute", left: pad.x, right: pad.x, top: pad.y, bottom: pad.y }}>{children}</div>
        ) : (
          <div style={{ position: "absolute", left: pad.x, right: pad.x, top: pad.y, transform: `translateY(${-scroll}px)` }}>{children}</div>
        )}
      </div>
      <Header e={e} nav={nav} />
    </div>
  );
}

/** judul halaman (.page-title + .page-sub) */
export function PageHead({ e, title, sub, right, at = 0 }: { e: Env; title: string; sub?: string; right?: ReactNode; at?: number }) {
  const p = pop(e.t, at, { damping: 20 });
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10, opacity: p, transform: `translateY(${(1 - p) * 10}px)` }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: DISPLAY, fontSize: e.wide ? 26 : 21, fontWeight: 750, lineHeight: 1.15, color: Z[50], letterSpacing: -0.4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
        {sub && <div style={{ marginTop: 4, fontSize: e.wide ? 14 : 12.5, color: Z[400], whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
}

/** pembungkus pesan yang tumbuh dari tinggi 0 (supaya chat yang menempel ke bawah terdorong halus) */
export function Grow({ p, max = 420, children, style }: { p: number; max?: number; children: ReactNode; style?: CSSProperties }) {
  if (p <= 0.001) return null;
  return <div style={{ maxHeight: clamp01(p) * max, overflow: p < 1 ? "hidden" : "visible", flex: "none", ...style }}>{children}</div>;
}

/** notifikasi kecil yang turun dari atas */
export function Toast({ t, at, until, children, acc, top = 8 }: { t: Clock; at: number; until: number; children: ReactNode; acc: string; top?: number }) {
  const p = pop(t, at, { damping: 14, stiffness: 200 });
  const out = ramp(t, until, until + 10);
  if (t.f < at || out >= 1) return null;
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top, display: "flex", justifyContent: "center", zIndex: 40, opacity: (1 - out) * clamp01(p * 1.5), transform: `translateY(${(1 - p) * -40 - out * 20}px) scale(${0.9 + 0.1 * p})` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, borderRadius: 14, padding: "9px 14px", background: "rgba(24,24,27,0.97)", border: `1px solid ${rgba(acc, 0.5)}`, boxShadow: `0 16px 40px -12px rgba(0,0,0,0.8), 0 0 0 4px ${rgba(acc, 0.12)}`, fontSize: 12.5, fontWeight: 650, color: Z[100], whiteSpace: "nowrap" }}>
        {children}
      </div>
    </div>
  );
}
