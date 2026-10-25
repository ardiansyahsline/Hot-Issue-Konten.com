"use client";

/**
 * Bagian adegan intro teaser (Hook / Reveal / Outro): logo Konten.com hasil jiplak vektor dari public/konten-logo.png,
 * efek cahaya (bloom, sinar, anamorphic flare, gelombang kejut, percikan, bara, bokeh) dan teks kinetik per kata.
 * Semua deterministik dari frame (random(seed) remotion), tanpa radial-gradient CSS / blend-mode / backdrop-filter.
 */
import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, random } from "remotion";
import { useSvgId } from "../../fx";
import { clamp01, EASE, rgba } from "../../theme";
import { prog, springAt } from "../kit";

export const ORANGE = "#f97316";
export const LOGO_BG = "#f54900";
export const RED = "#ef4444";

// ---------------------------------------------------------------------------------------------
// Logo Konten.com (jiplakan vektor public/konten-logo.png: kotak 256×230 rx 44, warna #f54900, dua batang chevron putih)
// ---------------------------------------------------------------------------------------------
/** rasio lebar/tinggi kotak logo asli */
export const MARK_AR = 256 / 230;
const UPPER = "M110.5 64.5H155.5L104 122L107.5 127.5H52.5Z";
const LOWER = "M98.5 127.5H146L202 187L201.5 190.5H157.5Z";

/**
 * Logo Konten.com tajam di ukuran besar. `split` (0..1) = batang chevron masih terpisah (masuk dari kanan atas/bawah),
 * `shine` (0..1) = kilau miring lewat di dalam kotak, `glow` = cahaya oranye di sekeliling.
 */
export function KontenMark({ w, split = 0, shine = -1, glow = 0.6, style }: { w: number; split?: number; shine?: number; glow?: number; style?: CSSProperties }) {
  const clip = useSvgId("kmclip");
  const grad = useSvgId("kmgrad");
  const band = useSvgId("kmband");
  const h = w / MARK_AR;
  const sx = split * 70;
  const bx = -140 + clamp01(shine) * 520;
  return (
    <svg
      width={w}
      height={h}
      viewBox="0 13 256 230"
      style={{ display: "block", overflow: "visible", filter: glow > 0 ? `drop-shadow(0 ${(w * 0.05).toFixed(1)}px ${(w * 0.12).toFixed(1)}px ${rgba(LOGO_BG, 0.55 * glow)})` : undefined, ...style }}
      aria-hidden
    >
      <defs>
        <clipPath id={clip}>
          <rect x="0" y="13" width="256" height="230" rx="44" />
        </clipPath>
        <linearGradient id={grad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.16" />
          <stop offset="0.45" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.14" />
        </linearGradient>
        <linearGradient id={band} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="0" y="13" width="256" height="230" rx="44" fill={LOGO_BG} />
      <rect x="0" y="13" width="256" height="230" rx="44" fill={`url(#${grad})`} />
      <g clipPath={`url(#${clip})`}>
        <path d={UPPER} fill="#ffffff" transform={`translate(${sx.toFixed(2)} ${(-sx).toFixed(2)})`} opacity={1 - split * 0.6} />
        <path d={LOWER} fill="#ffffff" transform={`translate(${sx.toFixed(2)} ${sx.toFixed(2)})`} opacity={1 - split * 0.6} />
        {shine > 0 && shine < 1 && <rect x={bx} y="-40" width="110" height="340" fill={`url(#${band})`} transform="skewX(-22)" />}
      </g>
      <rect x="0.75" y="13.75" width="254.5" height="228.5" rx="43.5" fill="none" stroke="#ffffff" strokeOpacity="0.14" strokeWidth="1.5" />
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------
// Cahaya
// ---------------------------------------------------------------------------------------------
/** cahaya bulat lembut (SVG radialGradient) berpusat di (x, y) */
export function Bloom({ x, y, r, color, opacity, sy = 1 }: { x: number; y: number; r: number; color: string; opacity: number; sy?: number }) {
  const id = useSvgId("bloom");
  if (r <= 0 || opacity <= 0.005) return null;
  return (
    <svg width={r * 2} height={r * 2} style={{ position: "absolute", left: x - r, top: y - r, pointerEvents: "none", overflow: "visible", transform: sy !== 1 ? `scaleY(${sy})` : undefined }}>
      <defs>
        <radialGradient id={id} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={color} stopOpacity={clamp01(opacity)} />
          <stop offset="35%" stopColor={color} stopOpacity={clamp01(opacity) * 0.42} />
          <stop offset="70%" stopColor={color} stopOpacity={clamp01(opacity) * 0.1} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </radialGradient>
      </defs>
      <circle cx={r} cy={r} r={r} fill={`url(#${id})`} />
    </svg>
  );
}

/** sinar cahaya (god rays) memancar dari (x, y), berputar pelan */
export function Rays({ x, y, n = 12, len = 1500, rot = 0, opacity = 0.2, color = "#ffb27a", seed = "rays" }: { x: number; y: number; n?: number; len?: number; rot?: number; opacity?: number; color?: string; seed?: string }) {
  if (opacity <= 0.005) return null;
  return (
    <div style={{ position: "absolute", left: x, top: y, width: 0, height: 0, pointerEvents: "none", filter: "blur(6px)" }}>
      {Array.from({ length: n }, (_, i) => {
        const a = (i / n) * 360 + rot + (random(`${seed}a${i}`) - 0.5) * 18;
        const th = 26 + random(`${seed}w${i}`) * 70;
        const op = opacity * (0.45 + random(`${seed}o${i}`) * 0.55);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: 0,
              top: -th / 2,
              width: len,
              height: th,
              transformOrigin: "0 50%",
              transform: `rotate(${a.toFixed(2)}deg)`,
              background: `linear-gradient(90deg, ${rgba(color, op)} 0%, ${rgba(color, op * 0.35)} 40%, ${rgba(color, 0)} 100%)`,
              clipPath: "polygon(0 45%, 100% 0, 100% 100%, 0 55%)",
            }}
          />
        );
      })}
    </div>
  );
}

/** garis flare horizontal (anamorphic) melintasi titik (x, y) */
export function Flare({ y, x, k, W, color = "#ffd2b0" }: { y: number; x: number; k: number; W: number; color?: string }) {
  if (k <= 0.01) return null;
  const w = W * (0.9 + 0.8 * k);
  return (
    <>
      <div style={{ position: "absolute", left: x - w / 2, top: y - 40, width: w, height: 80, background: `linear-gradient(90deg, ${rgba(ORANGE, 0)} 0%, ${rgba(ORANGE, 0.35 * k)} 50%, ${rgba(ORANGE, 0)} 100%)`, filter: "blur(18px)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", left: x - w / 2, top: y - 2.5, width: w, height: 5, background: `linear-gradient(90deg, ${rgba(color, 0)} 0%, ${rgba("#ffffff", 0.95 * k)} 50%, ${rgba(color, 0)} 100%)`, filter: "blur(1.5px)", pointerEvents: "none" }} />
    </>
  );
}

/** gelombang kejut (cincin) dari (x, y) mulai detik `at` */
export function Shock({ f, fps, at, x, y, r0 = 120, r1 = 900, len = 0.6, color = "#ffffff", width = 14, W, H }: { f: number; fps: number; at: number; x: number; y: number; r0?: number; r1?: number; len?: number; color?: string; width?: number; W: number; H: number }) {
  const p = (f - at * fps) / (len * fps);
  if (p < 0 || p > 1) return null;
  const e = EASE.out(p);
  const r = r0 + (r1 - r0) * e;
  return (
    <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}>
      <circle cx={x} cy={y} r={r} fill="none" stroke={color} strokeOpacity={0.8 * (1 - p) * (1 - p)} strokeWidth={Math.max(0.5, width * (1 - e))} />
      <circle cx={x} cy={y} r={r * 0.9} fill="none" stroke={ORANGE} strokeOpacity={0.5 * (1 - p)} strokeWidth={Math.max(0.5, width * 2.2 * (1 - e))} style={{ filter: "blur(10px)" }} />
    </svg>
  );
}

/** percikan menyebar dari (x, y) mulai detik `at` (garis memanjang searah gerak = motion blur) */
export function Burst({ f, fps, at, x, y, n = 40, d0 = 120, d1 = 950, len = 0.8, seed = "burst", W, H, colors = ["#ffffff", "#fdba74", ORANGE] }: { f: number; fps: number; at: number; x: number; y: number; n?: number; d0?: number; d1?: number; len?: number; seed?: string; W: number; H: number; colors?: string[] }) {
  const t = (f - at * fps) / fps;
  if (t < 0 || t > len) return null;
  const p = t / len;
  return (
    <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}>
      {Array.from({ length: n }, (_, i) => {
        const a = random(`${seed}a${i}`) * Math.PI * 2;
        const sp = 0.35 + random(`${seed}s${i}`) * 0.65;
        const pp = clamp01(p / (0.55 + sp * 0.45));
        const e = 1 - Math.pow(1 - pp, 3);
        const d = d0 + (d1 - d0) * sp * e;
        const v = 3 * Math.pow(1 - pp, 2);
        const L = 8 + 90 * sp * v;
        const cx = Math.cos(a);
        const cy = Math.sin(a);
        const op = Math.pow(1 - pp, 1.3);
        if (op <= 0.01) return null;
        return (
          <line
            key={i}
            x1={x + cx * d}
            y1={y + cy * d}
            x2={x + cx * Math.max(0, d - L)}
            y2={y + cy * Math.max(0, d - L)}
            stroke={colors[i % colors.length]}
            strokeOpacity={op}
            strokeWidth={1.5 + 3.5 * (1 - pp) * sp}
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
}

/** bara halus melayang naik (partikel latar) */
export function Embers({ f, fps, W, H, n = 28, seed = "emb", color = "#fdba74", opacity = 1, rise = 1 }: { f: number; fps: number; W: number; H: number; n?: number; seed?: string; color?: string; opacity?: number; rise?: number }) {
  if (opacity <= 0.01) return null;
  const t = f / fps;
  return (
    <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}>
      {Array.from({ length: n }, (_, i) => {
        const sp = (50 + random(`${seed}v${i}`) * 140) * rise;
        const span = H + 120;
        const y = H + 60 - ((random(`${seed}y${i}`) * span + t * sp) % span);
        const x = random(`${seed}x${i}`) * W + Math.sin(t * (0.8 + random(`${seed}w${i}`)) + i) * 26;
        const r = 1.4 + random(`${seed}r${i}`) * 3.4;
        const fl = 0.55 + 0.45 * Math.sin(t * 7 + i * 1.7);
        return <circle key={i} cx={x} cy={y} r={r} fill={i % 4 === 0 ? "#ffffff" : color} fillOpacity={clamp01(opacity * fl * (0.35 + random(`${seed}o${i}`) * 0.6))} />;
      })}
    </svg>
  );
}

/** bokeh depan (lapisan dekat kamera, sangat buram) — depth of field */
export function Bokeh({ f, fps, W, H, n = 6, seed = "bok", color = ORANGE, opacity = 0.22 }: { f: number; fps: number; W: number; H: number; n?: number; seed?: string; color?: string; opacity?: number }) {
  if (opacity <= 0.01) return null;
  const t = f / fps;
  return (
    <AbsoluteFill style={{ pointerEvents: "none", filter: "blur(22px)" }}>
      {Array.from({ length: n }, (_, i) => {
        const r = 50 + random(`${seed}r${i}`) * 90;
        const x = random(`${seed}x${i}`) * W + Math.sin(t * 0.6 + i) * 40;
        const y = random(`${seed}y${i}`) * H - t * (20 + i * 6);
        return <div key={i} style={{ position: "absolute", left: x - r, top: y - r, width: r * 2, height: r * 2, borderRadius: 999, background: i % 3 === 0 ? "#fdba74" : color, opacity: opacity * (0.5 + random(`${seed}o${i}`) * 0.5) }} />;
      })}
    </AbsoluteFill>
  );
}

/** guncangan kamera yang meluruh setelah detik `at` (px & derajat) */
export function shake(f: number, fps: number, at: number, amp = 24, decay = 7, seed = "sh"): { x: number; y: number; r: number } {
  const t = (f - at * fps) / fps;
  if (t < 0) return { x: 0, y: 0, r: 0 };
  const k = amp * Math.exp(-t * decay);
  if (k < 0.3) return { x: 0, y: 0, r: 0 };
  const fr = Math.floor(f);
  return { x: (random(`${seed}x${fr}`) - 0.5) * 2 * k, y: (random(`${seed}y${fr}`) - 0.5) * 2 * k, r: (random(`${seed}r${fr}`) - 0.5) * k * 0.08 };
}

// ---------------------------------------------------------------------------------------------
// Teks kinetik
// ---------------------------------------------------------------------------------------------
const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/**
 * Satu baris teks besar: kata naik dari balik masker dengan pegas (stagger), kata di `emph` berwarna `emphColor`.
 * Dipusatkan di `cx` dengan lebar maksimum `w` (boleh membungkus ke baris kedua).
 */
export function Words({
  f,
  fps,
  text,
  at,
  out,
  cx,
  top,
  w,
  size,
  font,
  color = "#fafafa",
  emph = [],
  emphColor = ORANGE,
  stagger = 0.06,
  weight = 800,
  shadow = true,
  tracking = -0.035,
  spr,
  outLen = 0.25,
  outY = -50,
}: {
  f: number;
  fps: number;
  text: string;
  at: number;
  out?: number;
  cx: number;
  top: number;
  w: number;
  size: number;
  font: string;
  color?: string;
  emph?: string[];
  emphColor?: string;
  stagger?: number;
  weight?: number;
  shadow?: boolean;
  tracking?: number;
  /** konfigurasi pegas kata masuk (default damping 13, stiffness 190, mass 0.65) */
  spr?: { damping?: number; stiffness?: number; mass?: number };
  /** lama keluar (detik) & geser vertikal saat keluar (px) */
  outLen?: number;
  outY?: number;
}) {
  if (f < at * fps - 1) return null;
  const E = new Set(emph.map(norm));
  const leave = out === undefined ? 0 : prog(f, fps, out, out + outLen, outLen < 0.2 ? EASE.out : EASE.in);
  if (leave >= 1) return null;
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <div
      style={{
        position: "absolute",
        left: cx - w / 2,
        top,
        width: w,
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        columnGap: size * 0.24,
        fontFamily: font,
        fontWeight: weight,
        fontSize: size,
        lineHeight: 1.04,
        letterSpacing: `${tracking}em`,
        color,
        opacity: 1 - leave,
        transform: `translateY(${(leave * outY).toFixed(1)}px)`,
        filter: leave > 0 ? `blur(${(leave * 8).toFixed(1)}px)` : undefined,
        pointerEvents: "none",
      }}
    >
      {words.map((wd, i) => {
        const p = springAt(f, fps, at + i * stagger, { damping: 13, stiffness: 190, mass: 0.65, ...spr });
        const isE = E.has(norm(wd));
        return (
          <span key={i} style={{ display: "inline-block", overflow: "hidden", paddingBottom: size * 0.1, marginBottom: -size * 0.06 }}>
            <span
              style={{
                display: "inline-block",
                transform: `translateY(${((1 - p) * size * 1.1).toFixed(1)}px) rotate(${((1 - p) * 5).toFixed(2)}deg)`,
                transformOrigin: "0 100%",
                opacity: clamp01(p * 1.8),
                color: isE ? emphColor : undefined,
                textShadow: shadow ? `0 8px 40px ${rgba("#000000", 0.55)}${isE ? `, 0 0 46px ${rgba(emphColor, 0.45)}` : ""}` : undefined,
              }}
            >
              {wd}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** lapisan penuh di atas kanvas (lebih besar dari kanvas supaya aman saat dikamera) */
export function Cover({ color, opacity, children }: { color: string; opacity: number; children?: ReactNode }) {
  if (opacity <= 0.003 && !children) return null;
  return <div style={{ position: "absolute", left: "-15%", top: "-15%", width: "130%", height: "130%", background: color, opacity: clamp01(opacity), pointerEvents: "none" }}>{children}</div>;
}
