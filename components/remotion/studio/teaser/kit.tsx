"use client";

/**
 * Alat bantu adegan premium teaser CS Tracker (layout.kind "teaser").
 * - jam adegan + ketukan musik (trailer bed 100 BPM → 1 ketukan = 0,6 dtk; semua batas adegan teaser jatuh di ketukan)
 * - kamera virtual berbasis keyframe + motion blur sebanding kecepatan kamera
 * - depth of field, light sweep, kilatan, jejak gerak (motion trail)
 * - caption kinetik ≤ 6 kata di dalam zona aman
 * Semua animasi dihitung dari useCurrentFrame() (deterministik, aman untuk render browser & laptop).
 */
import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Phone } from "../devices";
import { blurCss, Shine, TextShine } from "../fx";
import { mkClock, type Clock } from "../screens/ui";
import { clamp, clamp01, EASE, rgba, useScene, useStudio, type Box } from "../theme";

/** detik per ketukan trailer bed (100 BPM) */
export const BEAT = 0.6;
/** detik ketukan ke-n dari awal adegan (adegan teaser selalu mulai di ketukan) */
export const beat = (n: number) => n * BEAT;

const CL = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** progres 0..1 dari detik a ke b (dikunci di ujung) */
export const prog = (f: number, fps: number, a: number, b: number, ease: (x: number) => number = EASE.inOut) =>
  interpolate(f, [a * fps, Math.max(a * fps + 0.001, b * fps)], [0, 1], { ...CL, easing: ease });

/** pegas 0 → 1 mulai detik `at` */
export const springAt = (f: number, fps: number, at: number, cfg: { damping?: number; stiffness?: number; mass?: number } = {}) =>
  spring({ frame: f - at * fps, fps, config: { damping: 14, stiffness: 150, mass: 0.8, ...cfg } });

export type Shot = {
  /** frame relatif ke awal adegan */
  f: number;
  fps: number;
  /** durasi adegan (frame, tanpa perpanjangan transisi) */
  dur: number;
  /** detik → frame */
  sec: (s: number) => number;
  /** detik sekarang dalam adegan */
  s: number;
  /** jam untuk helper screens/ui (pop, ramp, typeOut) mulai detik 0 adegan */
  t: Clock;
  /** kotak isi aman (zona aman − ruang subtitle) */
  box: Box;
  W: number;
  H: number;
  brand: ReturnType<typeof useStudio>["brand"];
  display: string;
  portrait: boolean;
  /** teks layar adegan (Scene.text) */
  text: string[];
};

export function useShot(): Shot {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { brand, display, portrait, W, H } = useStudio();
  const { dur, box, scene } = useScene();
  return { f, fps, dur, sec: (s) => Math.round(s * fps), s: f / fps, t: mkClock(f, dur, fps), box, W, H, brand, display, portrait, text: scene.text };
}

/** jam screens/ui yang mulai di detik `start` adegan selama `len` detik (untuk animasi UI di dalam layar) */
export function clockAt(f: number, fps: number, start: number, len: number): Clock {
  return mkClock(f - start * fps, Math.max(1, Math.round(len * fps)), fps);
}

// ---------------------------------------------------------------------------------------------
// Kamera virtual
// ---------------------------------------------------------------------------------------------
/**
 * keyframe kamera: t = detik adegan, z = zoom (1 = utuh), x/y = geser (px kanvas, positif = isi bergeser kanan/bawah),
 * r = putar (derajat). Nilai yang tidak diisi ikut keyframe sebelumnya. `ease` = easing MENUJU keyframe ini.
 */
export type CamKey = { t: number; z?: number; x?: number; y?: number; r?: number; ease?: (x: number) => number };
type CamVal = { z: number; x: number; y: number; r: number };

function filled(keys: CamKey[]): (CamVal & { t: number; ease: (x: number) => number })[] {
  let prev: CamVal = { z: 1, x: 0, y: 0, r: 0 };
  return [...keys]
    .sort((a, b) => a.t - b.t)
    .map((k) => {
      prev = { z: k.z ?? prev.z, x: k.x ?? prev.x, y: k.y ?? prev.y, r: k.r ?? prev.r };
      return { ...prev, t: k.t, ease: k.ease ?? EASE.inOut };
    });
}

/** posisi kamera di detik `s` */
export function camAtTime(keys: CamKey[], s: number): CamVal {
  const k = filled(keys);
  if (!k.length) return { z: 1, x: 0, y: 0, r: 0 };
  if (s <= k[0].t) return k[0];
  for (let i = 1; i < k.length; i++) {
    if (s <= k[i].t) {
      const a = k[i - 1];
      const b = k[i];
      const p = b.ease(clamp01((s - a.t) / Math.max(1e-3, b.t - a.t)));
      return { z: a.z + (b.z - a.z) * p, x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p, r: a.r + (b.r - a.r) * p };
    }
  }
  return k[k.length - 1];
}

/**
 * Kamera virtual: isi di-zoom/geser/putar mengikuti keyframe, titik pusat = tengah kanvas (atau `origin`).
 * Motion blur: blur sebanding kecepatan kamera (px/frame) — terasa seperti kamera sungguhan saat gerak cepat.
 */
export function Cam({ keys, children, origin = "50% 50%", blur = true, style }: { keys: CamKey[]; children: ReactNode; origin?: string; blur?: boolean; style?: CSSProperties }) {
  const f = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const a = camAtTime(keys, f / fps);
  const b = camAtTime(keys, (f + 1) / fps);
  // kecepatan layar: geser + perubahan zoom diterjemahkan ke px di tepi kanvas
  const v = Math.hypot(b.x - a.x, b.y - a.y) + Math.abs(b.z - a.z) * width * 0.5 + Math.abs(b.r - a.r) * 8;
  const mb = blur ? Math.min(7, Math.max(0, v - 6) * 0.12) : 0;
  return (
    <AbsoluteFill
      style={{
        transform: `translate(${a.x.toFixed(2)}px, ${a.y.toFixed(2)}px) scale(${a.z.toFixed(4)}) rotate(${a.r.toFixed(3)}deg)`,
        transformOrigin: origin,
        filter: blurCss(mb),
        ...style,
      }}
    >
      {children}
    </AbsoluteFill>
  );
}

/** depth of field: lapisan dibuat buram (px) + sedikit diperbesar supaya tepi buram tidak terlihat */
export function Depth({ blur, children, style }: { blur: number; children: ReactNode; style?: CSSProperties }) {
  return <AbsoluteFill style={{ filter: blurCss(blur), transform: blur > 0.25 ? `scale(${(1 + blur * 0.004).toFixed(4)})` : undefined, ...style }}>{children}</AbsoluteFill>;
}

/**
 * jejak gerak (motion trail): salinan transparan di belakang benda yang bergerak cepat.
 * `dx`/`dy` = perpindahan per frame (px); makin cepat, makin panjang jejaknya.
 */
export function Trail({ dx, dy, n = 3, children }: { dx: number; dy: number; n?: number; children: ReactNode }) {
  const speed = Math.hypot(dx, dy);
  if (speed < 4) return <>{children}</>;
  const copies = Math.min(n, Math.ceil(speed / 10));
  return (
    <div style={{ position: "relative" }}>
      {Array.from({ length: copies }, (_, i) => (
        <div key={i} aria-hidden style={{ position: "absolute", inset: 0, transform: `translate(${(-dx * (i + 1) * 0.5).toFixed(1)}px, ${(-dy * (i + 1) * 0.5).toFixed(1)}px)`, opacity: 0.22 / (i + 1), pointerEvents: "none" }}>
          {children}
        </div>
      ))}
      <div style={{ position: "relative" }}>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Cahaya
// ---------------------------------------------------------------------------------------------
/** light sweep di seluruh kanvas mulai detik `at` selama `len` detik */
export function Sweep({ at, len = 0.8, alpha = 0.28, angle = 105 }: { at: number; len?: number; alpha?: number; angle?: number }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = prog(f, fps, at, at + len, EASE.inOut);
  if (p <= 0 || p >= 1) return null;
  return <Shine p={p} alpha={alpha} angle={angle} />;
}

/** kilatan putih singkat di ketukan (impact) */
export function Flash({ at, len = 0.22, color = "#ffffff", max = 0.75 }: { at: number; len?: number; color?: string; max?: number }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const k = (f - at * fps) / Math.max(1, len * fps);
  if (k < 0 || k > 1) return null;
  return <AbsoluteFill style={{ background: color, opacity: max * (1 - k) * (1 - k), pointerEvents: "none" }} />;
}

/** denyut 0..1 di tiap ketukan (puncak tepat di ketukan, turun cepat) */
export function beatPulse(f: number, fps: number, every = 1): number {
  const per = BEAT * every * fps;
  const ph = (f % per) / per;
  return Math.pow(1 - ph, 3);
}

// ---------------------------------------------------------------------------------------------
// Caption kinetik
// ---------------------------------------------------------------------------------------------
/** buang kata ke-7 dst — aturan teaser: maks 6 kata per layar */
export const sixWords = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, 6).join(" ");

/**
 * Teks layar premium: kata masuk bergantian (pegas + naik dari balik masker), kata `emphasis` berwarna brand,
 * lalu kilau lewat. Diletakkan di kotak aman (`box`): atas (bawaan), tengah, atau bawah.
 */
export function Caption({
  lines,
  at = 0.15,
  pos = "top",
  size,
  emphasis = [],
  out,
  align = "center",
}: {
  lines: string[];
  at?: number;
  pos?: "top" | "center" | "bottom";
  size?: number;
  emphasis?: string[];
  /** detik mulai keluar (kosong = tetap sampai adegan selesai) */
  out?: number;
  align?: "left" | "center";
}) {
  const { f, fps, box, brand, display, portrait } = useShot();
  const ls = lines.map(sixWords).filter(Boolean).slice(0, 2);
  if (!ls.length) return null;
  const fs = size ?? (portrait ? 92 : 78);
  const emph = new Set(emphasis.map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")));
  const leave = out === undefined ? 0 : prog(f, fps, out, out + 0.3, EASE.in);
  const justify = pos === "top" ? "flex-start" : pos === "bottom" ? "flex-end" : "center";
  let wi = 0;
  return (
    <div style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, display: "flex", flexDirection: "column", justifyContent: justify, alignItems: align === "left" ? "flex-start" : "center", pointerEvents: "none", opacity: 1 - leave, transform: `translateY(${(-leave * 40).toFixed(1)}px)` }}>
      {ls.map((line, li) => (
        <TextShine key={li} p={prog(f, fps, at + 0.55 + li * 0.12, at + 1.3 + li * 0.12)}>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: align === "left" ? "flex-start" : "center", columnGap: fs * 0.24, fontFamily: display, fontWeight: 800, fontSize: fs, lineHeight: 1.04, letterSpacing: "-0.035em", color: brand.text, textAlign: align }}>
            {line.split(/\s+/).map((w, k) => {
              const i = wi++;
              const p = springAt(f, fps, at + i * 0.06, { damping: 13, stiffness: 170, mass: 0.7 });
              const isE = emph.has(w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""));
              return (
                <span key={k} style={{ display: "inline-block", overflow: "hidden", paddingBottom: fs * 0.08 }}>
                  <span style={{ display: "inline-block", transform: `translateY(${((1 - p) * fs * 1.05).toFixed(1)}px) rotate(${((1 - p) * 4).toFixed(2)}deg)`, opacity: clamp01(p * 1.6), color: isE ? brand.primary : undefined, textShadow: `0 6px 34px ${rgba("#000000", 0.45)}` }}>{w}</span>
                </span>
              );
            })}
          </div>
        </TextShine>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Perangkat
// ---------------------------------------------------------------------------------------------
/**
 * HP besar untuk teaser (isi layar 390×844 px CSS, sama dengan mockup Studio). `scale` = pengali dari ukuran pas bawaan.
 * Taruh di dalam <Cam> untuk dorong/geser kamera ke bagian UI tertentu.
 */
export function BigPhone({ children, scale = 1.2, tilt = 0, glow, float = false }: { children: ReactNode; scale?: number; tilt?: number; glow?: string; float?: boolean }) {
  const { brand } = useStudio();
  return (
    <AbsoluteFill style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Phone scale={scale} tilt={tilt} glow={glow ?? brand.primary} shadow float={float}>
        {children}
      </Phone>
    </AbsoluteFill>
  );
}

/** placeholder sementara untuk adegan yang belum dibuat */
export function ShotTodo({ name }: { name: string }) {
  const { brand, display } = useShot();
  return (
    <AbsoluteFill style={{ display: "flex", alignItems: "center", justifyContent: "center", fontFamily: display, fontWeight: 800, fontSize: 64, color: rgba(brand.text, 0.6) }}>
      {name}
    </AbsoluteFill>
  );
}

export { clamp, clamp01, EASE, rgba };
