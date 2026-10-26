"use client";

/**
 * Transisi antar adegan + gerak kamera.
 * Transisi = transisi MASUK adegan ini; adegan sebelumnya diperpanjang selama durasi transisi dan
 * ikut "keluar" (push / zoom / whip) di bawahnya supaya perpindahan menumpuk mulus.
 * Kamera: push / pull / pan / tilt halus + parallax (latar bergerak lebih lambat dari isi).
 */
import { createContext, useContext, useMemo, type CSSProperties, type ReactNode } from "react";
import { AbsoluteFill, random, useCurrentFrame, useVideoConfig } from "remotion";
import { DEFAULT_TRANSITION_SEC, type Camera, type Dir, type Ease, type Scene, type TransitionKind } from "@/lib/studio/timeline";
import { blurCss, mblur, SplitCtx } from "./fx";
import { clamp, clamp01, EASE, ease, rgba } from "./theme";

export type Tr = { kind: TransitionKind; dir: Dir; frames: number; ease: Ease };

/** lama transisi masuk (frame). cut = 0. whip & glitch dibuat cepat. */
export function trFrames(sc: Scene, ownFrames: number, fps: number): number {
  const kind = sc.transition?.kind ?? "cut";
  if (kind === "cut") return 0;
  let f = Math.round((sc.transition.dur ?? DEFAULT_TRANSITION_SEC) * fps);
  if (kind === "whip") f = Math.min(f, Math.round(fps * 0.4));
  if (kind === "glitch") f = Math.min(f, Math.round(fps * 0.34));
  return clamp(f, 3, Math.max(3, ownFrames - 1));
}

const VEC: Record<Dir, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

type Look = { style: CSSProperties; split: number; overlay: ReactNode };

/** progres transisi 0..1 untuk frame relatif `f` */
function prog(t: Tr, f: number, fps: number, role: "in" | "out"): number {
  if (f <= 0) return 0;
  if (f >= t.frames) return 1;
  switch (t.kind) {
    case "slide":
      // pegas mengikuti easing adegan (spring / overshoot / smooth)
      return ease(t.ease, f, fps, t.frames);
    case "whip":
      return EASE.whip(clamp01(f / t.frames));
    case "glitch":
      return clamp01(f / t.frames);
    case "zoom":
      return role === "in" ? EASE.out(clamp01(f / t.frames)) : EASE.inOut(clamp01(f / t.frames));
    default:
      return EASE.inOut(clamp01(f / t.frames));
  }
}

/** tampilan adegan yang MASUK pada frame relatif f (0..frames) */
function lookIn(t: Tr, f: number, fps: number, W: number, H: number, accent: string): Look {
  const p = prog(t, f, fps, "in");
  const [vx, vy] = VEC[t.dir] ?? VEC.left;
  const none: Look = { style: {}, split: 0, overlay: null };
  if (t.kind === "cut" || f >= t.frames) return none;
  switch (t.kind) {
    case "fade": {
      const b = (1 - p) * 6;
      return { style: { opacity: p, filter: blurCss(b), transform: `scale(${1.03 - 0.03 * p})` }, split: 0, overlay: null };
    }
    case "slide": {
      const p0 = prog(t, f - 1, fps, "in");
      const vel = (p - p0) * (vx ? W : H);
      const tx = -vx * W * (1 - p);
      const ty = -vy * H * (1 - p);
      return { style: { transform: `translate(${tx}px, ${ty}px)`, filter: blurCss(mblur(vel, 0.035, 8)) }, split: 0, overlay: null };
    }
    case "zoom": {
      const s = 1.3 - 0.3 * p;
      return { style: { opacity: clamp01(p * 1.5), transform: `scale(${s})`, filter: blurCss((1 - p) * 12) }, split: 0, overlay: null };
    }
    case "mask": {
      if (vy) {
        // atas/bawah: tirai inset membuka searah gerakan + garis cahaya warna brand di tepinya
        const edge = vy < 0 ? H * (1 - p) : H * p;
        const clip = vy < 0 ? `inset(${edge.toFixed(1)}px 0 0 0)` : `inset(0 0 ${(H - edge).toFixed(1)}px 0)`;
        const line = p < 1 ? (
          <div style={{ position: "absolute", left: 0, right: 0, top: edge - 3, height: 6, background: accent, opacity: 0.9 * (1 - p), boxShadow: `0 0 40px ${rgba(accent, 0.8)}` }} />
        ) : null;
        return { style: { clipPath: clip, transform: `scale(${1.06 - 0.06 * p})` }, split: 0, overlay: line };
      }
      // kiri/kanan: lingkaran membesar dari sisi asal gerakan + cincin warna brand di tepinya
      const cx = W * (0.5 - vx * 0.3);
      const cy = H * (0.5 - vy * 0.3);
      const R = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy)) * 1.02;
      const r = R * p;
      const ring = p < 1 ? (
        <svg width={W} height={H} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <circle cx={cx} cy={cy} r={Math.max(0, r)} fill="none" stroke={accent} strokeOpacity={0.9 * (1 - p)} strokeWidth={10 + 26 * (1 - p)} />
        </svg>
      ) : null;
      return { style: { clipPath: `circle(${r.toFixed(1)}px at ${cx.toFixed(1)}px ${cy.toFixed(1)}px)`, transform: `scale(${1.08 - 0.08 * p})` }, split: 0, overlay: ring };
    }
    case "whip": {
      const p0 = prog(t, f - 1, fps, "in");
      const size = vx ? W : H;
      const vel = (p - p0) * size;
      const tx = -vx * W * (1 - p);
      const ty = -vy * H * (1 - p);
      const sk = clamp(Math.abs(vel) * 0.018, 0, 10) * (vx || vy);
      const st = 1 + clamp(Math.abs(vel) * 0.00035, 0, 0.12);
      const tr = vx ? `translate(${tx}px, 0) skewX(${-sk}deg) scaleX(${st})` : `translate(0, ${ty}px) skewY(${-sk}deg) scaleY(${st})`;
      return { style: { transform: tr, filter: blurCss(mblur(vel, 0.11, 26)) }, split: 0, overlay: null };
    }
    case "glitch": {
      const k = 1 - p;
      const seed = Math.floor(f);
      const on = random(`gi${seed}`) > 0.28 || f >= t.frames - 1;
      const jx = (random(`gx${seed}`) - 0.5) * 46 * k;
      const jy = (random(`gy${seed}`) - 0.5) * 10 * k;
      return {
        // kedip "mati" = lapisan hitam, bukan opacity wadah (render browser menerapkan opacity per elemen → adegan tembus berlapis)
        style: { transform: `translate(${jx}px, ${jy}px) skewX(${(random(`gs${seed}`) - 0.5) * 5 * k}deg)` },
        split: 14 * k + 4 * random(`gr${seed}`) * k,
        overlay: (
          <>
            {!on && <AbsoluteFill style={{ background: "#000", opacity: 0.6 }} />}
            <GlitchBars f={f} k={k} W={W} H={H} />
          </>
        ),
      };
    }
    default:
      return none;
  }
}

/** tampilan adegan yang KELUAR (sedang ditimpa adegan berikutnya), f = 0..frames */
function lookOut(t: Tr, f: number, fps: number, W: number, H: number): Look {
  const p = prog(t, f, fps, "out");
  const [vx, vy] = VEC[t.dir] ?? VEC.left;
  switch (t.kind) {
    case "fade":
      return { style: { transform: `scale(${1 + 0.02 * p})` }, split: 0, overlay: null };
    case "slide": {
      // push dengan parallax: adegan lama ikut bergeser lebih pelan & meredup
      const pp = clamp01(p);
      return { style: { transform: `translate(${vx * W * 0.3 * pp}px, ${vy * H * 0.3 * pp}px) scale(${1 - 0.04 * pp})`, opacity: 1 - 0.45 * pp }, split: 0, overlay: null };
    }
    case "zoom":
      return { style: { transform: `scale(${1 + 0.22 * p})`, opacity: 1 - p, filter: blurCss(p * 10) }, split: 0, overlay: null };
    case "mask":
      return { style: { transform: `scale(${1 - 0.06 * p})`, opacity: 1 - 0.5 * p }, split: 0, overlay: null };
    case "whip": {
      const p0 = prog(t, f - 1, fps, "out");
      const size = vx ? W : H;
      const vel = (p - p0) * size;
      const sk = clamp(Math.abs(vel) * 0.018, 0, 10) * (vx || vy);
      const tr = vx ? `translate(${vx * W * p}px, 0) skewX(${-sk}deg)` : `translate(0, ${vy * H * p}px) skewY(${-sk}deg)`;
      return { style: { transform: tr, filter: blurCss(mblur(vel, 0.11, 26)) }, split: 0, overlay: null };
    }
    case "glitch": {
      const seed = Math.floor(f) + 99;
      const jx = (random(`go${seed}`) - 0.5) * 40 * p;
      const off = random(`gf${seed}`) <= 0.3;
      return {
        style: { transform: `translate(${jx}px, 0)` },
        split: 10 * p,
        overlay: (
          <>
            {off && <AbsoluteFill style={{ background: "#000", opacity: 0.45 }} />}
            <GlitchBars f={f + 50} k={p} W={W} H={H} />
          </>
        ),
      };
    }
    default:
      return { style: {}, split: 0, overlay: null };
  }
}

/** pita horizontal merah/biru + garis scan selama glitch (halus, beberapa frame saja) */
function GlitchBars({ f, k, W, H }: { f: number; k: number; W: number; H: number }) {
  if (k < 0.05) return null;
  const seed = Math.floor(f / 2);
  const bars = Array.from({ length: 6 }, (_, i) => {
    const y = random(`gb-y-${seed}-${i}`) * H;
    const h = 6 + random(`gb-h-${seed}-${i}`) * 46;
    const x = (random(`gb-x-${seed}-${i}`) - 0.5) * 120 * k;
    const c = i % 3 === 0 ? "#ff2d55" : i % 3 === 1 ? "#00e5ff" : "#ffffff";
    return <div key={i} style={{ position: "absolute", left: x, top: y, width: W, height: h, background: rgba(c, (i % 3 === 2 ? 0.16 : 0.22) * k) }} />;
  });
  return <AbsoluteFill style={{ pointerEvents: "none" }}>{bars}</AbsoluteFill>;
}

/**
 * Pembungkus adegan: menerapkan transisi masuk (frame 0..inT.frames) dan keluar
 * (frame dur..dur+outT.frames, saat adegan berikutnya masuk).
 */
export function SceneTransition({ inT, outT, dur, accent, children }: { inT: Tr | null; outT: Tr | null; dur: number; accent: string; children: ReactNode }) {
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  let look: Look = { style: {}, split: 0, overlay: null };
  if (outT && frame >= dur) look = lookOut(outT, frame - dur, fps, W, H);
  else if (inT) look = lookIn(inT, frame, fps, W, H, accent);
  return (
    <SplitCtx.Provider value={look.split}>
      <AbsoluteFill style={{ overflow: "hidden", ...look.style }}>{children}</AbsoluteFill>
      {look.overlay}
    </SplitCtx.Provider>
  );
}

// ---------------------------------------------------------------------------------------------
// Kamera & parallax
// ---------------------------------------------------------------------------------------------
type Cam = { x: number; y: number; s: number; r: number };
const CamCtx = createContext<Cam>({ x: 0, y: 0, s: 1, r: 0 });

/** gerak kamera per jenis: skala awal → akhir + geser maksimal (bagian dari lebar/tinggi video). Halus ala Apple. */
const CAM: Record<Camera, { s0: number; s1: number; px: number; py: number; rot: number }> = {
  none: { s0: 1, s1: 1, px: 0, py: 0, rot: 0 },
  push: { s0: 1, s1: 1.045, px: 0, py: 0, rot: 0 },
  pull: { s0: 1.05, s1: 1, px: 0, py: 0, rot: 0 },
  pan: { s0: 1.04, s1: 1.04, px: 0.02, py: 0, rot: 0 },
  tilt: { s0: 1.035, s1: 1.035, px: 0, py: 0.016, rot: 0.35 },
};
/** goyang mikro (px) supaya gambar terasa "hidup" */
const SHAKE = 2.5;

/** posisi kamera untuk progres t (0..1 sepanjang adegan) */
export function camAt(kind: Camera, t: number, f: number, W: number, H: number): Cam {
  const c = CAM[kind];
  if (!c || kind === "none") return { x: 0, y: 0, s: 1, r: 0 };
  const e = EASE.soft(clamp01(t));
  const dx = Math.sin(f / 41) * SHAKE;
  const dy = Math.cos(f / 53) * SHAKE;
  return { x: (0.5 - e) * 2 * c.px * W + dx, y: (0.5 - e) * 2 * c.py * H + dy, s: c.s0 + (c.s1 - c.s0) * e, r: (0.5 - e) * c.rot };
}

/**
 * Kotak isi yang tetap berada di dalam `safe` walau kamera membesar / bergeser
 * (kebalikan transform kamera: titik p tampil di c + (p − c)·s + geser).
 */
export function camSafeBox(kind: Camera, box: { x: number; y: number; w: number; h: number }, W: number, H: number) {
  const c = CAM[kind];
  if (!c || kind === "none") return box;
  const s = Math.max(c.s0, c.s1);
  const rot = Math.abs(Math.sin((c.rot * Math.PI) / 360)); // miring maks ±rot/2 derajat
  const mx = c.px * W + SHAKE + (rot * H) / 2;
  const my = c.py * H + SHAKE + (rot * W) / 2;
  const cx = W / 2;
  const cy = H / 2;
  const l = cx + (box.x + mx - cx) / s;
  const r = cx + (box.x + box.w - mx - cx) / s;
  const t = cy + (box.y + my - cy) / s;
  const b = cy + (box.y + box.h - my - cy) / s;
  return { x: l, y: t, w: Math.max(1, r - l), h: Math.max(1, b - t) };
}

/** pasang kamera adegan; `len` = frame total adegan tampil (termasuk perpanjangan transisi) */
export function CameraRig({ kind, len, children }: { kind: Camera; len: number; children: ReactNode }) {
  const frame = useCurrentFrame();
  const { width: W, height: H } = useVideoConfig();
  const cam = useMemo(() => camAt(kind, frame / Math.max(1, len), frame, W, H), [kind, frame, len, W, H]);
  return <CamCtx.Provider value={cam}>{children}</CamCtx.Provider>;
}

/** lapisan dengan kedalaman: depth < 1 bergerak lebih lambat (latar), 1 = isi utama */
export function Layer({ depth = 1, children, style }: { depth?: number; children: ReactNode; style?: CSSProperties }) {
  const cam = useContext(CamCtx);
  const s = 1 + (cam.s - 1) * depth;
  const tr = cam.x || cam.y || cam.r || s !== 1 ? `translate(${(cam.x * depth).toFixed(2)}px, ${(cam.y * depth).toFixed(2)}px) scale(${s.toFixed(4)}) rotate(${(cam.r * depth).toFixed(3)}deg)` : undefined;
  return <AbsoluteFill style={{ transform: tr, ...style }}>{children}</AbsoluteFill>;
}
