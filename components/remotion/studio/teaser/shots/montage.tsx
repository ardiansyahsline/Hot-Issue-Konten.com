"use client";

/**
 * Adegan 10 — Montage + Studio (4,8 dtk). VO: "Dan video ini… juga dibikin di sini."
 * 0,0 bass drop → potongan cepat di tiap ketukan (setengah ketukan untuk potongan 0,3 dtk) berisi momen terbaik adegan lain:
 * komponen adegan ASLI diputar ulang di frame yang dibekukan (SceneFreeze) + kamera close-up + transisi sesuai SFX
 * (snap + guncang, spin, glitch, whip). 3,0 snap-spin → Studio Pro (UI asli, timeline teaser ini, preview memutar ulang montage ini,
 * tombol Download MP4) dengan teks "Dibikin di sini": pesan meta — video ini dibuat di Studio.
 */
import { useContext } from "react";
import { AbsoluteFill, random } from "remotion";
import { sceneStartSecs, type TeaserShot } from "@/lib/studio/timeline";
import { SceneBg } from "../../backgrounds";
import { blurCss } from "../../fx";
import { useScene, useStudio } from "../../theme";
import { BEAT, Cam, Caption, clamp01, EASE, Flash, rgba, springAt, Sweep, useShot, type CamKey } from "../kit";
import { GlitchBands, MontageDepth, SceneFreeze, StudioUi, UI, UI_W } from "./montage-parts";

type Enter = "drop" | "whip" | "shake" | "spin" | "glitch";
/**
 * potongan montage: `from` = detik mulai di adegan ini (titik pukulan SFX), `at` = detik momen terbaik di adegan sumber,
 * `z/x/y` = bidikan close-up (zoom, geser px), `drift` = gerak lambat (frame sumber per frame montage).
 */
type Cut = { shot: TeaserShot; from: number; at: number; enter: Enter; z: number; x: number; y: number; drift: number };

const CUTS: Cut[] = [
  // 0,0 bass-drop-jumpstart → HOT naik ke #1 (dashboard)
  { shot: "dashboard", from: 0, at: 3.5, enter: "drop", z: 1.0, x: 0, y: 0, drift: 0.6 },
  // 0,3 (setengah ketukan) → status Disetujui (video review)
  { shot: "videoReview", from: BEAT * 0.5, at: 3.62, enter: "whip", z: 1.0, x: 0, y: 0, drift: 0.5 },
  // 0,6 transisi-shaker-snap → reaksi chat tim
  { shot: "chat", from: BEAT, at: 4.45, enter: "shake", z: 1.0, x: 0, y: 0, drift: 0.8 },
  // 1,2 transisi-snap-spin → AI: chart BTC / analisa
  { shot: "ai", from: BEAT * 2, at: 10.5, enter: "spin", z: 1.0, x: 0, y: 0, drift: 0.5 },
  // 1,8 transisi-shaker-snap → TWS: angka 3D slam
  { shot: "tws", from: BEAT * 3, at: 1.7, enter: "shake", z: 1.0, x: 0, y: 0, drift: 0.5 },
  // 2,1 (setengah ketukan) → Train AI: tipe muncul
  { shot: "trainAi", from: BEAT * 3.5, at: 3.4, enter: "whip", z: 1.0, x: 0, y: 0, drift: 0.5 },
  // 2,4 glitch-tinggi → musik + laporan/PPT
  { shot: "musicReport", from: BEAT * 4, at: 1.5, enter: "glitch", z: 1.0, x: 0, y: 0, drift: 0.5 },
];
/** 3,0 transisi-snap-spin → Studio */
const STUDIO_AT = BEAT * 5;
/** frame anticipation sebelum pukulan (keluar) & sesudah (masuk) per jenis transisi */
const PRE: Record<Enter, number> = { drop: 0, whip: 1, shake: 0, spin: 3, glitch: 1 };

type Fx = { x: number; y: number; s: number; r: number; blur: number; op: number };
const NONE: Fx = { x: 0, y: 0, s: 1, r: 0, blur: 0, op: 1 };
const add = (a: Fx, b: Partial<Fx>): Fx => ({ x: a.x + (b.x ?? 0), y: a.y + (b.y ?? 0), s: a.s * (b.s ?? 1), r: a.r + (b.r ?? 0), blur: a.blur + (b.blur ?? 0), op: a.op * (b.op ?? 1) });
const outC = EASE.out;

/** gerak masuk (lf = frame sejak pukulan) */
function enterFx(kind: Enter, lf: number, fps: number, W: number): Partial<Fx> {
  switch (kind) {
    case "drop": {
      const p = springAt(lf, fps, 0, { damping: 13, stiffness: 210, mass: 0.7 });
      return { s: 1 + 0.34 * (1 - p), blur: Math.max(0, 5 * (1 - lf / 4)) };
    }
    case "whip": {
      const q = outC(clamp01(lf / 4));
      return { x: W * 0.62 * (1 - q), blur: 16 * (1 - q) };
    }
    case "shake": {
      const q = outC(clamp01(lf / 6));
      const amp = 26 * Math.max(0, 1 - lf / 9);
      return { s: 1 + 0.16 * (1 - q), x: amp * (random(`sx${lf}`) * 2 - 1), y: amp * (random(`sy${lf}`) * 2 - 1), r: amp * 0.05 * (random(`sr${lf}`) * 2 - 1), blur: lf < 2 ? 3 - lf * 1.5 : 0 };
    }
    case "spin": {
      const p = springAt(lf, fps, 0, { damping: 15, stiffness: 190, mass: 0.7 });
      return { r: -22 * (1 - p), s: 1 + 0.26 * (1 - p), blur: 6 * (1 - outC(clamp01(lf / 4))) };
    }
    case "glitch": {
      const q = clamp01(lf / 7);
      return { s: 1 + 0.06 * (1 - q), x: lf < 4 ? (random(`gx${lf}`) * 2 - 1) * 30 : 0 };
    }
  }
}

/** gerak keluar sebelum pukulan berikutnya (left = sisa frame sampai pukulan, 1..PRE) */
function exitFx(next: Enter, left: number, W: number): Partial<Fx> {
  const n = PRE[next];
  if (left > n || left < 1) return {};
  const q = (n + 1 - left) / n;
  switch (next) {
    case "spin":
      return { r: 28 * q * q, s: 1 + 0.22 * q * q, blur: 14 * q * q };
    case "whip":
      return { x: -W * 0.12, blur: 8 };
    case "glitch":
      return { x: 18, blur: 1.5 };
    default:
      return {};
  }
}

/** satu potongan montage dengan transformasinya */
function CutLayer({ cut, lf, fx, W }: { cut: Cut; lf: number; fx: Fx; W: number }) {
  const push = 1 + 0.035 * clamp01(lf / 18);
  const s = cut.z * push * fx.s;
  return (
    <AbsoluteFill
      style={{
        transform: `translate(${(cut.x + fx.x).toFixed(1)}px, ${(cut.y + fx.y).toFixed(1)}px) scale(${s.toFixed(4)}) rotate(${fx.r.toFixed(2)}deg)`,
        filter: blurCss(fx.blur),
        opacity: fx.op,
      }}
    >
      <SceneFreeze shot={cut.shot} at={cut.at} drift={lf * cut.drift} />
    </AbsoluteFill>
  );
}

/** potongan-potongan cepat (dipakai juga di dalam preview Studio, kedalaman 1) */
function Cuts({ f, fps, W, H }: { f: number; fps: number; W: number; H: number }) {
  const S = CUTS.map((c) => Math.round(c.from * fps));
  const end = Math.round(STUDIO_AT * fps);
  let ci = -1;
  for (let i = 0; i < CUTS.length; i++) if (f >= S[i]) ci = i;
  if (ci < 0) return null;
  const cut = CUTS[ci];
  const E = ci + 1 < CUTS.length ? S[ci + 1] : end;
  const lf = f - S[ci];
  const nextEnter: Enter = ci + 1 < CUTS.length ? CUTS[ci + 1].enter : "spin";
  const fx = add(add(NONE, enterFx(cut.enter, lf, fps, W)), exitFx(nextEnter, E - f, W));
  // whip: potongan sebelumnya ikut tersapu keluar ke kiri selama potongan baru masuk
  const prev = ci > 0 && cut.enter === "whip" && lf < 4 ? CUTS[ci - 1] : null;
  const prevFx = prev ? add(NONE, { x: -W * 0.7 * EASE.in(clamp01((lf + 1) / 4)), blur: 16 }) : null;
  const glitch = cut.enter === "glitch" ? Math.max(0, 1 - lf / 7) : 0;
  return (
    <AbsoluteFill>
      {prev && prevFx && <CutLayer cut={prev} lf={S[ci] - S[ci - 1] + lf} fx={prevFx} W={W} />}
      <CutLayer cut={cut} lf={lf} fx={fx} W={W} />
      {glitch > 0 && <GlitchBands amt={glitch} seed={`g${lf}`} W={W} H={H} render={() => <CutLayer cut={cut} lf={lf} fx={fx} W={W} />} />}
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------------------------------------
// Studio (3,0 – akhir)
// ---------------------------------------------------------------------------------------------
/** posisi (px kanvas, kamera diam) dari koordinat UI (px CSS) */
const camOn = (px: number, py: number, z: number, tx: number, ty: number, W: number, H: number) => ({ x: tx - W / 2 - (px - W / 2) * z, y: ty - H / 2 - (py - H / 2) * z, z });

function StudioPart({ f, fps, W, H }: { f: number; fps: number; W: number; H: number }) {
  const { box, brand, text } = useShot();
  const s = f / fps;
  const k = box.w / UI_W;
  const X0 = box.x;
  const Y0 = box.y + 190;
  const wx = (x: number) => X0 + x * k;
  const wy = (y: number) => Y0 + y * k;

  // preview memutar ulang montage ini dari potongan chat; playhead ikut posisi di adegan "Montage + Studio"
  const replayF = Math.min(Math.round(STUDIO_AT * fps) - 1, Math.round(BEAT * 2 * fps) + 4 + (f - Math.round(STUDIO_AT * fps)));
  const head = useMontageStart() + replayF / fps;

  const pc = { x: wx(UI.player.x + UI.player.w / 2), y: wy(UI.player.y + UI.player.h / 2) };
  const btn = { x: wx(UI.button.x + UI.button.w / 2), y: wy(UI.button.y + UI.button.h / 2) };
  const A = STUDIO_AT;
  const close = camOn(pc.x, pc.y, 2.0, W / 2, 880, W, H);
  const settle = camOn(pc.x, pc.y, 1.86, W / 2, 900, W, H);
  // bidikan lebar: tab Studio sampai Preview, tepat di bawah teks
  const wide = camOn(W / 2, Y0, 0.94, W / 2, box.y + 182, W, H);
  // bidikan akhir: baris timeline (blok adegan) sampai tombol download, di atas 12% bawah kotak aman (ruang subtitle)
  const top = wy(UI.y.tl - 6);
  const bot = wy(UI.y.end);
  const T0 = box.y + 180;
  const T1 = box.y + box.h * 0.88;
  const zEnd = Math.max(0.78, Math.min(1.08, (T1 - T0) / (bot - top)));
  const fin = (z: number) => camOn(W / 2, (top + bot) / 2, z, W / 2, (T0 + T1) / 2, W, H);
  const keys: CamKey[] = [
    { t: A, ...close, r: -18 },
    { t: A + 0.2, ...settle, r: 0, ease: EASE.out },
    { t: A + 0.62, ...wide, ease: EASE.inOut },
    { t: A + 0.86, ...wide },
    { t: A + 1.14, ...fin(zEnd * 0.97), ease: EASE.inOut },
    { t: A + 2.3, ...fin(zEnd), ease: EASE.out },
  ];


  const tapAt = A + 1.22; // 4,2 dtk (ketukan)
  const press = s < tapAt - 0.05 ? 1 : 1 - 0.05 * Math.max(0, 1 - Math.abs(s - tapAt) / 0.12);
  const progress = s < tapAt + 0.16 ? 0 : clamp01((s - tapAt - 0.16) / 1.6) * 0.82 + 0.06;
  const sheen = clamp01((s - (A + 1.0)) / 0.5);
  const ripple = clamp01((s - tapAt) / 0.4);
  return (
    <AbsoluteFill>
      <Cam keys={keys}>
        <div style={{ position: "absolute", left: X0, top: Y0, width: UI_W, height: UI.y.end, transform: `scale(${k.toFixed(4)})`, transformOrigin: "0 0" }}>
          <StudioUi head={head} press={press} progress={progress} sheen={sheen} dim={clamp01((s - A - 0.86) / 0.3)} player={<Replay frame={replayF} W={W} H={H} />} />
        </div>
        {/* jari mengetuk Download MP4 */}
        {ripple > 0 && ripple < 1 && (
          <div style={{ position: "absolute", left: btn.x - 70, top: btn.y - 70, width: 140, height: 140, borderRadius: 999, border: `5px solid ${rgba("#ffffff", 0.85 * (1 - ripple))}`, transform: `scale(${(0.35 + ripple * 1.1).toFixed(3)})` }} />
        )}
        {s >= tapAt - 0.25 && s < tapAt + 0.35 && (
          <div style={{ position: "absolute", left: btn.x - 34 + 40 * clamp01((tapAt - s) / 0.25), top: btn.y - 34 + 60 * clamp01((tapAt - s) / 0.25), width: 68, height: 68, borderRadius: 999, background: "rgba(255,255,255,0.9)", boxShadow: "0 10px 30px rgba(0,0,0,0.45)", opacity: clamp01((s - (tapAt - 0.25)) / 0.1) * clamp01((tapAt + 0.35 - s) / 0.12), transform: `scale(${s > tapAt - 0.03 && s < tapAt + 0.1 ? 0.86 : 1})` }} />
        )}
      </Cam>
      {/* teks layar di atas (latar digelapkan supaya UI yang lewat di bawahnya tidak mengganggu) */}
      <div style={{ position: "absolute", left: 0, top: 0, width: W, height: box.y + 240, background: `linear-gradient(180deg, ${rgba(brand.bg, 0.97)} 0%, ${rgba(brand.bg, 0.9)} 55%, ${rgba(brand.bg, 0)} 100%)`, opacity: clamp01((s - A - 0.06) / 0.2) }} />
      <Caption lines={[text[0] ?? "Dibikin di sini"]} at={A + 0.22} pos="top" size={112} emphasis={["sini"]} />
      <Sweep at={A + 0.5} len={0.7} alpha={0.16} />
    </AbsoluteFill>
  );
}

/** detik awal adegan montage di timeline (untuk playhead) */
function useMontageStart() {
  const { tl } = useStudio();
  const { i } = useScene();
  return sceneStartSecs(tl)[i] ?? 0;
}

/** pemutar preview Studio: montage ini diputar ulang (kedalaman 1, tanpa Studio di dalamnya) */
function Replay({ frame, W, H }: { frame: number; W: number; H: number }) {
  const { scene } = useScene();
  const { brand, fps } = useStudio();
  const sc = UI.player.w / W;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, transform: `scale(${sc.toFixed(5)})`, transformOrigin: "0 0", overflow: "hidden", background: brand.bg }}>
      <MontageDepth.Provider value={1}>
        <SceneBg bg={scene.bg} brand={brand} blur={0} />
        <Cuts f={frame} fps={fps} W={W} H={H} />
      </MontageDepth.Provider>
    </div>
  );
}

export function MontageShot() {
  const depth = useContext(MontageDepth);
  const { f, fps, W, H } = useShot();
  const studioF = Math.round(STUDIO_AT * fps);
  const showCuts = depth > 0 || f < studioF;
  return (
    <AbsoluteFill>
      {showCuts && <Cuts f={depth > 0 ? Math.min(f, studioF - 1) : f} fps={fps} W={W} H={H} />}
      {depth === 0 && f >= studioF && <StudioPart f={f} fps={fps} W={W} H={H} />}
      {depth === 0 && (
        <>
          <Flash at={0} len={0.24} max={0.7} />
          <Flash at={BEAT} len={0.12} max={0.3} />
          <Flash at={BEAT * 3} len={0.12} max={0.3} />
          <Flash at={STUDIO_AT} len={0.14} max={0.22} color="#fdba74" />
          <Sweep at={0.05} len={0.45} alpha={0.22} />
          <Sweep at={BEAT * 2 + 0.05} len={0.4} alpha={0.18} />
          <BeatEdge f={f} fps={fps} W={W} H={H} />
        </>
      )}
    </AbsoluteFill>
  );
}

/** bingkai oranye tipis berdenyut di tiap pukulan potongan (energi montage) */
function BeatEdge({ f, fps, W, H }: { f: number; fps: number; W: number; H: number }) {
  const hits = [0, ...CUTS.slice(1).map((c) => c.from), STUDIO_AT];
  let a = 0;
  for (const h of hits) {
    const d = (f - h * fps) / fps;
    if (d >= 0 && d < 0.25) a = Math.max(a, 1 - d / 0.25);
  }
  if (a <= 0.01) return null;
  const c = rgba("#f97316", 0.5 * a);
  const d = Math.round(150 * a);
  const g = (dir: string) => `linear-gradient(${dir}, ${c} 0%, ${rgba("#f97316", 0)} 100%)`;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: W, height: d, background: g("180deg") }} />
      <div style={{ position: "absolute", left: 0, top: H - d, width: W, height: d, background: g("0deg") }} />
      <div style={{ position: "absolute", left: 0, top: 0, width: d, height: H, background: g("90deg") }} />
      <div style={{ position: "absolute", left: W - d, top: 0, width: d, height: H, background: g("270deg") }} />
    </AbsoluteFill>
  );
}
