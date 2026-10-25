"use client";

/**
 * Latar adegan: gradient bergerak, partikel melayang, grid perspektif, warna polos, atau foto/video.
 * Semua gerak deterministik (random(seed) dari remotion + frame) supaya render selalu sama.
 */
import { Video } from "@remotion/media";
import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Img, random, useCurrentFrame, useVideoConfig } from "remotion";
import type { Background, Brand } from "@/lib/studio/timeline";
import { storagePathOf } from "@/lib/studio/urls";
import { blurCss, Glow, Scrim, useSvgId } from "./fx";
import { mix, rgba } from "./theme";

const VIDEO_EXT = new Set(["mp4", "webm", "mov", "m4v", "mkv", "ogv"]);

/** true kalau src mengarah ke file video (dilihat dari ekstensi path storage / URL) */
export function isVideoSrc(src: string | null | undefined): boolean {
  if (!src) return false;
  const path = storagePathOf(src) ?? src;
  const ext = path.split(/[?#]/)[0].split(".").pop()?.toLowerCase() ?? "";
  return VIDEO_EXT.has(ext);
}

/** foto / video yang menutupi kotak induk (video selalu tanpa suara: suara diatur lewat mix Studio) */
export function MediaFill({ src, fit = "cover", style }: { src: string; fit?: "cover" | "contain"; style?: CSSProperties }) {
  const css: CSSProperties = { width: "100%", height: "100%", objectFit: fit, display: "block", ...style };
  return isVideoSrc(src) ? <Video src={src} muted loop objectFit={fit} style={css} /> : <Img src={src} style={css} />;
}

const palette = (bg: Background, brand: Brand) => {
  const c = (bg.colors ?? []).filter(Boolean);
  return [c[0] ?? brand.primary, c[1] ?? brand.accent, c[2] ?? mix(c[1] ?? brand.accent, "#8b5cf6", 0.45)];
};

/** latar adegan + depth of field (blur lapisan latar) */
export function SceneBg({ bg, brand, blur = 0 }: { bg: Background; brand: Brand; blur?: number }) {
  const cols = palette(bg, brand);
  let el: ReactNode;
  switch (bg.kind) {
    case "particles":
      el = <ParticlesBg base={brand.bg} cols={cols} />;
      break;
    case "grid":
      el = <GridBg base={brand.bg} cols={cols} />;
      break;
    case "solid":
      el = <SolidBg base={bg.colors?.[0] ?? brand.bg} glow={brand.primary} />;
      break;
    case "media":
      el = bg.media ? <MediaBg src={bg.media} /> : <GradientBg base={brand.bg} cols={cols} />;
      break;
    default:
      el = <GradientBg base={brand.bg} cols={cols} />;
  }
  // overscan 8% supaya tepi tidak terlihat saat kamera bergeser
  return (
    <AbsoluteFill style={{ background: brand.bg, overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: "scale(1.08)", filter: blurCss(blur) }}>{el}</AbsoluteFill>
    </AbsoluteFill>
  );
}

/** gradient linear yang sudutnya bergerak pelan + cahaya bulat melayang */
export function GradientBg({ base, cols, strength = 1 }: { base: string; cols: string[]; strength?: number }) {
  const f = useCurrentFrame();
  const { width: W, height: H } = useVideoConfig();
  const a = 155 + Math.sin(f / 95) * 20;
  const big = Math.max(W, H);
  return (
    <AbsoluteFill style={{ background: base }}>
      <AbsoluteFill style={{ background: `linear-gradient(${a.toFixed(1)}deg, ${rgba(cols[0], 0.3 * strength)} 0%, ${rgba(base, 0)} 45%, ${rgba(cols[1], 0.2 * strength)} 100%)` }} />
      <Glow x={W * (0.18 + 0.1 * Math.sin(f / 70))} y={H * (0.16 + 0.05 * Math.cos(f / 83))} r={big * 0.55} color={cols[0]} opacity={0.42 * strength} />
      <Glow x={W * (0.9 + 0.06 * Math.cos(f / 77))} y={H * (0.78 + 0.06 * Math.sin(f / 64))} r={big * 0.5} color={cols[1]} opacity={0.3 * strength} />
      <Glow x={W * (0.55 + 0.18 * Math.sin(f / 120))} y={H * (0.5 + 0.1 * Math.cos(f / 101))} r={big * 0.32} color={cols[2]} opacity={0.16 * strength} />
      {/* garis halus diagonal biar tidak "datar" */}
      <AbsoluteFill style={{ background: `linear-gradient(180deg, ${rgba("#ffffff", 0.035)} 0%, rgba(255,255,255,0) 30%, rgba(0,0,0,0) 70%, ${rgba("#000000", 0.35)} 100%)` }} />
    </AbsoluteFill>
  );
}

/** titik & garis halus melayang naik (deterministik), di atas gradient redup */
function ParticlesBg({ base, cols }: { base: string; cols: string[] }) {
  const f = useCurrentFrame();
  const { width: W, height: H } = useVideoConfig();
  const N = 64;
  const dots = Array.from({ length: N }, (_, i) => {
    const z = 0.35 + random(`pz${i}`) * 0.65; // kedalaman: dekat = besar, cepat, terang
    const x0 = random(`px${i}`) * W;
    const y0 = random(`py${i}`) * H;
    const sp = (0.4 + random(`ps${i}`) * 1.1) * z;
    const y = (((y0 - f * sp) % (H + 60)) + H + 60) % (H + 60) - 30;
    const x = x0 + Math.sin(f / (40 + i) + i) * 14 * z;
    const r = (1.4 + random(`pr${i}`) * 3.4) * z;
    const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(f / (14 + (i % 9)) + i * 1.7));
    const c = i % 4 === 0 ? "#ffffff" : i % 4 === 1 ? cols[1] : cols[0];
    return <circle key={i} cx={x} cy={y} r={r} fill={c} opacity={(0.18 + 0.55 * z) * tw} />;
  });
  const streaks = Array.from({ length: 10 }, (_, i) => {
    const len = 60 + random(`sl${i}`) * 140;
    const sp = 2 + random(`ss${i}`) * 3;
    const x = random(`sx${i}`) * W;
    const y = ((((random(`sy${i}`) * H - f * sp) % (H + len)) + H + len) % (H + len)) - len;
    return <line key={i} x1={x} y1={y} x2={x} y2={y + len} stroke={i % 2 ? cols[0] : "#ffffff"} strokeOpacity={0.12 + 0.12 * random(`so${i}`)} strokeWidth={2} strokeLinecap="round" />;
  });
  return (
    <AbsoluteFill>
      <GradientBg base={base} cols={cols} strength={0.7} />
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        {streaks}
        {dots}
      </svg>
    </AbsoluteFill>
  );
}

/** grid lantai perspektif yang mengalir pelan ke arah penonton + cahaya cakrawala */
function GridBg({ base, cols }: { base: string; cols: string[] }) {
  const f = useCurrentFrame();
  const { width: W, height: H } = useVideoConfig();
  const id = useSvgId("grid");
  const hz = H * (H > W ? 0.6 : 0.56);
  const cx = W / 2;
  const line = mix(cols[0], "#ffffff", 0.35);
  const verticals = Array.from({ length: 25 }, (_, k) => {
    const bx = cx + (k - 12) * W * 0.17;
    return <line key={k} x1={cx + (k - 12) * W * 0.012} y1={hz} x2={bx} y2={H * 1.04} stroke={`url(#${id}v)`} strokeWidth={2} />;
  });
  const phase = (f * 0.01) % 1;
  const rows = Array.from({ length: 16 }, (_, j) => {
    const z = (j + phase) / 16;
    const y = hz + (H - hz) * Math.pow(z, 2.3);
    return <line key={j} x1={0} y1={y} x2={W} y2={y} stroke={line} strokeOpacity={0.05 + 0.32 * z} strokeWidth={1 + 1.5 * z} />;
  });
  const ceil = Array.from({ length: 8 }, (_, j) => {
    const z = (j + phase) / 8;
    const y = hz * 0.62 - hz * 0.62 * Math.pow(z, 2.3);
    return <line key={j} x1={0} y1={y} x2={W} y2={y} stroke={line} strokeOpacity={0.03 + 0.06 * z} strokeWidth={1} />;
  });
  return (
    <AbsoluteFill style={{ background: base }}>
      <GradientBg base={base} cols={cols} strength={0.55} />
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <linearGradient id={`${id}v`} gradientUnits="userSpaceOnUse" x1="0" y1={hz} x2="0" y2={H}>
            <stop offset="0%" stopColor={line} stopOpacity={0} />
            <stop offset="100%" stopColor={line} stopOpacity={0.42} />
          </linearGradient>
        </defs>
        {ceil}
        {rows}
        {verticals}
      </svg>
      <Glow x={cx} y={hz} r={Math.max(W, H) * 0.42} color={cols[0]} opacity={0.38} />
      <div style={{ position: "absolute", left: 0, right: 0, top: hz - 1, height: 2, background: `linear-gradient(90deg, ${rgba(line, 0)} 0%, ${rgba(line, 0.7)} 50%, ${rgba(line, 0)} 100%)` }} />
    </AbsoluteFill>
  );
}

function SolidBg({ base, glow }: { base: string; glow: string }) {
  const { width: W, height: H } = useVideoConfig();
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: base }}>
      <Glow x={W * 0.5} y={H * (0.3 + 0.02 * Math.sin(f / 60))} r={Math.max(W, H) * 0.45} color={glow} opacity={0.14} />
    </AbsoluteFill>
  );
}

/** foto / video latar + ken burns pelan + lapisan gelap supaya teks tetap terbaca */
function MediaBg({ src }: { src: string }) {
  const t = Math.min(1, useCurrentFrame() / 300);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <AbsoluteFill style={{ transform: `scale(${1.02 + 0.06 * t}) translateY(${-10 * t}px)` }}>
        <MediaFill src={src} />
      </AbsoluteFill>
      <Scrim from={0.35} mid={0.18} to={0.62} />
    </AbsoluteFill>
  );
}
