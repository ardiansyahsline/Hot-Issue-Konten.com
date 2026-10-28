"use client";

/**
 * Efek akhir komposisi Studio: grain film, vignette, light sweep, glow, depth of field, motion blur,
 * RGB-split (glitch) dan garis zona aman. Cahaya bulat selalu pakai SVG radialGradient
 * (CSS radial-gradient tidak didukung renderer browser).
 */
import { createContext, useContext, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AbsoluteFill, continueRender, delayRender, Img, random, useCurrentFrame, useRemotionEnvironment, useVideoConfig } from "remotion";
import { clamp01, rgba, svgId, useStudio } from "./theme";

/** id SVG unik per komponen */
export const useSvgId = (p: string) => `${p}${svgId(useId())}`;

// ---------------------------------------------------------------------------------------------
// Grain & vignette
// ---------------------------------------------------------------------------------------------
/** petak pola grain (px). stitchTiles membuat noise-nya bersambung → petak diulang tanpa garis sambungan */
const GRAIN_TILE = 1024;
/** isi filter grain dalam bentuk teks untuk petak — HARUS sama dengan filter di Grain() (versi per frame) */
const GRAIN_FILTER_SVG =
  '<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/>' +
  '<feComponentTransfer><feFuncR type="linear" slope="1.6" intercept="-0.3"/><feFuncG type="linear" slope="1.6" intercept="-0.3"/>' +
  '<feFuncB type="linear" slope="1.6" intercept="-0.3"/></feComponentTransfer>';
let grainReady: string | null = null;
let grainJob: Promise<string> | null = null;

/** petak grain dirender SEKALI per tab / halaman: SVG feTurbulence (1 satuan = 2 px, sama dengan versi per frame) → canvas → PNG blob URL */
function grainTile(): Promise<string> {
  if (grainReady) return Promise.resolve(grainReady);
  if (grainJob) return grainJob;
  const t = GRAIN_TILE;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${t}" height="${t}" viewBox="0 0 ${t / 2} ${t / 2}" preserveAspectRatio="none"><filter id="g" x="0" y="0" width="100%" height="100%" filterUnits="userSpaceOnUse">${GRAIN_FILTER_SVG}</filter><rect width="${t / 2}" height="${t / 2}" filter="url(#g)"/></svg>`;
  const job = new Promise<string>((resolve, reject) => {
    setTimeout(() => reject(new Error("pola grain terlalu lama dibuat")), 10_000); // jangan sampai menahan render (delayRender 30 dtk)
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = t;
        c.height = t;
        const g = c.getContext("2d");
        if (!g) throw new Error("canvas 2D tidak tersedia");
        g.drawImage(img, 0, 0, t, t);
        c.toBlob((b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error("pola grain gagal dibuat"))), "image/png");
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error("pola grain gagal dimuat"));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
  grainJob = job;
  job.then(
    (u) => {
      grainReady = u;
    },
    () => {
      grainJob = null;
    },
  );
  return job;
}

/** URL petak grain: string = siap, null = sedang dibuat (render ditahan delayRender), false = tidak dipakai / gagal */
function useGrainTile(on: boolean): string | false | null {
  const [tile, setTile] = useState<string | false | null>(() => (on ? grainReady : false));
  const wait = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (!on || grainReady) return;
    let live = true;
    const h = delayRender("Menyiapkan pola grain");
    wait.current = h;
    grainTile().then(
      (u) => live && setTile(u),
      () => live && setTile(false),
    );
    return () => {
      live = false;
      if (wait.current === h) {
        continueRender(h);
        wait.current = null;
      }
    };
  }, [on]);
  // dilepas SESUDAH petak terpasang (Img sudah menahan render sampai gambarnya siap) → frame pertama tidak tanpa grain
  useLayoutEffect(() => {
    if (tile !== null && wait.current !== null) {
      continueRender(wait.current);
      wait.current = null;
    }
  }, [tile]);
  return on ? tile : false;
}

/**
 * grain film tipis, pola berganti tiap 2 frame. Pola noise dibuat SEKALI (feTurbulence yang sama dengan versi lama, lihat grainTile)
 * lalu petaknya digeser acak tiap 2 frame (random() Remotion → deterministik) — dulu feTurbulence dihitung ulang di resolusi penuh
 * tiap frame. Opacity per petak (petak tidak bertumpuk = sama dengan opacity grup; lapisan & kecerahan sama dengan versi lama, TANPA
 * will-change: lapisan compositor terpisah membuat grain lebih redup). Petak HANYA untuk render CLI (laptop, skala 1:1 = hasil sama
 * per piksel). Player website / Studio: feTurbulence seperti dulu — Player diperkecil di layar, petak raster ikut diperkecil &
 * butirnya melembut (grain di HP jadi lebih samar). Render browser (@remotion/web-renderer) & petak gagal dibuat: feTurbulence juga.
 */
export function Grain({ opacity = 0.05 }: { opacity?: number }) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const { isRendering, isClientSideRendering } = useRemotionEnvironment();
  const id = useSvgId("grain");
  const [broken, setBroken] = useState(false);
  const tile = useGrainTile(isRendering && !isClientSideRendering && !broken);
  const seed = Math.floor(frame / 2);
  const o = opacity * (0.85 + 0.3 * (((seed * 7919) % 100) / 100));
  if (tile) {
    const T = GRAIN_TILE;
    const dx = Math.floor(random(`grain-x-${seed}`) * T);
    const dy = Math.floor(random(`grain-y-${seed}`) * T);
    const nx = Math.ceil(width / T) + 1;
    const ny = Math.ceil(height / T) + 1;
    const tiles = [];
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        tiles.push(
          <Img
            key={`${i}-${j}`}
            src={tile}
            alt=""
            showInTimeline={false}
            onImageError={() => setBroken(true)}
            style={{ position: "absolute", left: i * T - dx, top: j * T - dy, width: T, height: T, maxWidth: "none", opacity: o }}
          />,
        );
      }
    }
    return <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>{tiles}</AbsoluteFill>;
  }
  if (tile === null) return null; // petak sedang dibuat (render ditahan delayRender)
  const w = Math.round(width / 2);
  const h = Math.round(height / 2);
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: o }}>
      <svg width={width} height={height} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <filter id={id} x="0" y="0" width="100%" height="100%" filterUnits="userSpaceOnUse">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={seed % 1000} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncR type="linear" slope="1.6" intercept="-0.3" />
            <feFuncG type="linear" slope="1.6" intercept="-0.3" />
            <feFuncB type="linear" slope="1.6" intercept="-0.3" />
          </feComponentTransfer>
        </filter>
        <rect width={w} height={h} filter={`url(#${id})`} />
      </svg>
    </AbsoluteFill>
  );
}

/** vignette tipis di tepi (SVG radialGradient) */
export function Vignette({ strength = 0.5 }: { strength?: number }) {
  const { width, height } = useVideoConfig();
  const id = useSvgId("vig");
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <svg width={width} height={height}>
        <defs>
          <radialGradient id={id} cx="50%" cy="46%" r="72%">
            <stop offset="50%" stopColor="#000" stopOpacity={0} />
            <stop offset="82%" stopColor="#000" stopOpacity={strength * 0.45} />
            <stop offset="100%" stopColor="#000" stopOpacity={strength} />
          </radialGradient>
        </defs>
        <rect width={width} height={height} fill={`url(#${id})`} />
      </svg>
    </AbsoluteFill>
  );
}

/** cahaya bulat lembut di titik (x, y) radius r */
export function Glow({ x, y, r, color, opacity = 0.5, style }: { x: number; y: number; r: number; color: string; opacity?: number; style?: CSSProperties }) {
  const id = useSvgId("glow");
  if (r <= 0 || opacity <= 0.005) return null;
  return (
    <svg width={r * 2} height={r * 2} style={{ position: "absolute", left: x - r, top: y - r, pointerEvents: "none", overflow: "visible", ...style }}>
      <defs>
        <radialGradient id={id} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={color} stopOpacity={clamp01(opacity)} />
          <stop offset="45%" stopColor={color} stopOpacity={clamp01(opacity) * 0.38} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </radialGradient>
      </defs>
      <circle cx={r} cy={r} r={r} fill={`url(#${id})`} />
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------
// Light sweep
// ---------------------------------------------------------------------------------------------
/** posisi kilau 0..1 → persen (mulai di luar kiri, selesai di luar kanan) */
const sweepPos = (p: number) => -30 + clamp01(p) * 160;

/** pita cahaya miring yang lewat di atas kotak (tombol, logo, kartu). Induk wajib position relative. */
export function Shine({ p, alpha = 0.32, radius = 0, angle = 105 }: { p: number; alpha?: number; radius?: number; angle?: number }) {
  if (p <= 0 || p >= 1) return null;
  const x = sweepPos(p);
  const band = `linear-gradient(${angle}deg, rgba(255,255,255,0) ${x - 14}%, rgba(255,255,255,${alpha}) ${x}%, rgba(255,255,255,0) ${x + 14}%)`;
  return <div style={{ position: "absolute", inset: 0, borderRadius: radius, overflow: "hidden", pointerEvents: "none", background: band }} />;
}

/** kilau yang hanya mengenai huruf: teks digandakan putih bercahaya lalu di-mask pita bergerak */
export function TextShine({ p, children, style, glow = "rgba(255,255,255,.85)" }: { p: number; children: ReactNode; style?: CSSProperties; glow?: string }) {
  const x = sweepPos(p);
  const mask = `linear-gradient(105deg, transparent ${x - 10}%, #000 ${x}%, transparent ${x + 10}%)`;
  return (
    <div style={{ position: "relative", ...style }}>
      {children}
      {p > 0 && p < 1 && (
        <div
          aria-hidden
          style={{ position: "absolute", inset: 0, color: "#ffffff", textShadow: `0 0 18px ${glow}, 0 0 40px ${glow}`, WebkitMaskImage: mask, maskImage: mask, pointerEvents: "none" }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Blur: depth of field & motion blur
// ---------------------------------------------------------------------------------------------
/** blur kecil sebanding kecepatan (px/frame) */
export const mblur = (v: number, k = 0.05, max = 9): number => Math.min(max, Math.abs(v) * k);
export const blurCss = (px: number) => (px > 0.25 ? `blur(${px.toFixed(2)}px)` : undefined);

/** depth of field: lapisan latar sedikit buram supaya isi di depan menonjol */
export function Dof({ blur, children }: { blur: number; children: ReactNode }) {
  return <AbsoluteFill style={{ filter: blurCss(blur) }}>{children}</AbsoluteFill>;
}

// ---------------------------------------------------------------------------------------------
// RGB split (dipakai transisi glitch → teks memberi bayangan merah/biru bergeser)
// ---------------------------------------------------------------------------------------------
export const SplitCtx = createContext(0);
export const useSplit = () => useContext(SplitCtx);
export function splitShadow(px: number, base?: string): string | undefined {
  if (Math.abs(px) < 0.4) return base;
  const s = `${px.toFixed(1)}px 0 0 rgba(255,40,90,.8), ${(-px).toFixed(1)}px 0 0 rgba(0,225,255,.8)`;
  return base ? `${s}, ${base}` : s;
}

// ---------------------------------------------------------------------------------------------
// Zona aman
// ---------------------------------------------------------------------------------------------
/** garis putus-putus zona aman + arsiran area yang tertutup tombol/caption aplikasi */
export function SafeZoneOverlay() {
  const { W, H, safe, portrait } = useStudio();
  const x = safe.left;
  const y = safe.top;
  const w = W - safe.left - safe.right;
  const h = H - safe.top - safe.bottom;
  const label: CSSProperties = { position: "absolute", fontFamily: '"Inter Variable", sans-serif', fontWeight: 700, fontSize: 26, color: "#fecdd3", background: "rgba(225,29,72,.75)", padding: "4px 12px", borderRadius: 8 };
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <svg width={W} height={H}>
        <path d={`M0 0H${W}V${H}H0Z M${x} ${y}V${y + h}H${x + w}V${y}Z`} fill="rgba(244,63,94,.10)" fillRule="evenodd" />
        <rect x={x} y={y} width={w} height={h} fill="none" stroke="#fb7185" strokeWidth={4} strokeDasharray="22 14" rx={12} />
      </svg>
      <div style={{ ...label, left: x + 12, top: y + 12 }}>Zona aman</div>
      {portrait && <div style={{ ...label, left: x + 12, top: y + h + 16, background: "rgba(63,63,70,.8)", color: "#e4e4e7" }}>Area caption & tombol aplikasi</div>}
    </AbsoluteFill>
  );
}

/** lapisan gelap tipis untuk keterbacaan teks di atas foto/video */
export function Scrim({ from = 0.25, mid = 0.1, to = 0.7, color = "#000000" }: { from?: number; mid?: number; to?: number; color?: string }) {
  return <AbsoluteFill style={{ background: `linear-gradient(180deg, ${rgba(color, from)} 0%, ${rgba(color, mid)} 42%, ${rgba(color, to)} 100%)` }} />;
}
