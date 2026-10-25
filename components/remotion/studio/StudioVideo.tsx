"use client";

/**
 * Komposisi utama Studio Pro: membaca TIMELINE JSON (lib/studio/timeline.ts) lalu menyusun adegan,
 * transisi, kamera, latar, tata letak, subtitle, efek akhir, dan audio. Tidak ada kode dari AI —
 * semua isi berasal dari data timeline yang sudah dinormalisasi.
 *
 * Dipakai di <Player component={StudioVideo} inputProps={{ timeline }} />, renderMediaOnWeb (browser),
 * dan remotion/Root.tsx (render di laptop).
 */
import { useMemo, type FC } from "react";
import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import type { SfxMeta } from "@/lib/studio/sfxMeta";
import { FORMATS, FPS, normalizeTimeline, sceneStarts, secToFrames, totalFrames, type Scene, type Timeline } from "@/lib/studio/timeline";
import { StudioAudio } from "./audio";
import { SceneBg } from "./backgrounds";
import { Grain, SafeZoneOverlay, Vignette } from "./fx";
import { dofFor, SceneLayout } from "./layouts";
import { subsOn, subsReserve, Subtitles } from "./text";
import { BODY, clamp, fontOf, SceneCtx, StudioCtx, useStudio, type Box, type SceneCtxValue, type StudioCtxValue } from "./theme";
import { CameraRig, Layer, SceneTransition, trFrames, type Tr } from "./transitions";

export type StudioVideoProps = {
  timeline: Timeline;
  showSafeZone?: boolean;
  /** "vo" = hanya suara VO (download VO .mp3), "novo" = musik + SFX tanpa VO (versi cadangan) */
  audio?: "all" | "vo" | "novo";
  /** SFX tambahan dari katalog (bukan bawaan) */
  sfxExtra?: SfxMeta[];
};

/** ekor hening di akhir video (detik) */
export const TAIL_SEC = 0.5;

/** timeline yang aman dipakai: kalau strukturnya rusak (mis. props.json dari luar), dinormalisasi dulu */
export function safeTimeline(t: unknown): Timeline {
  const o = t as Partial<Timeline> | null;
  const ok = !!o && typeof o === "object" && Array.isArray(o.scenes) && o.scenes.length > 0 && !!o.ratio && !!FORMATS[o.ratio] && !!o.brand && typeof o.brand === "object" && !!o.voice && !!o.music
    && o.scenes.every((s) => !!s && typeof s === "object" && typeof s.dur === "number" && !!s.layout && !!s.bg && !!s.transition && Array.isArray(s.text) && Array.isArray(s.sfx));
  return ok ? (o as Timeline) : normalizeTimeline(t);
}

const fpsOf = (tl: Timeline) => (tl.fps > 0 && tl.fps <= 120 ? Math.round(tl.fps) : FPS);

/** ukuran, fps & durasi komposisi dari timeline (totalFrames + 0,5 dtk ekor hening) */
export const studioMeta = (timeline: Timeline) => {
  const tl = safeTimeline(timeline);
  const fps = fpsOf(tl);
  const f = FORMATS[tl.ratio];
  return { width: f.w, height: f.h, fps, durationInFrames: Math.max(1, totalFrames({ scenes: tl.scenes, fps }) + Math.round(TAIL_SEC * fps)) };
};

type Plan = { start: number; dur: number; len: number; inT: Tr | null; outT: Tr | null };

export const StudioVideo: FC<StudioVideoProps> = ({ timeline, showSafeZone = false, audio = "all", sfxExtra }) => {
  const tl = useMemo(() => safeTimeline(timeline), [timeline]);
  const { width: W, height: H, fps } = useVideoConfig();
  const fmt = FORMATS[tl.ratio];
  const k = W / fmt.w;
  const brand = tl.brand;

  const ctx = useMemo<StudioCtxValue>(() => {
    const bpm = tl.music?.src === "bed" ? 100 : tl.music?.bpm && tl.music.bpm > 30 ? tl.music.bpm : 100;
    return {
      tl,
      brand,
      ratio: tl.ratio,
      W,
      H,
      fps,
      safe: { top: fmt.safe.top * k, right: fmt.safe.right * k, bottom: fmt.safe.bottom * k, left: fmt.safe.left * k },
      portrait: H > W * 1.2,
      display: fontOf(brand),
      beat: (fps * 60) / bpm,
    };
  }, [tl, brand, W, H, fps, fmt, k]);

  // jadwal adegan: adegan sebelumnya diperpanjang selama transisi adegan berikutnya (kecuali cut)
  const plan = useMemo<Plan[]>(() => {
    const starts = sceneStarts({ scenes: tl.scenes, fps });
    const durs = tl.scenes.map((s) => secToFrames(s.dur, fps));
    const tail = Math.round(TAIL_SEC * fps);
    const ins = tl.scenes.map((s, i) => trFrames(s, durs[i], fps));
    return tl.scenes.map((s, i) => {
      const next = tl.scenes[i + 1];
      const outF = next ? ins[i + 1] : 0;
      const last = i === tl.scenes.length - 1;
      return {
        start: starts[i],
        dur: durs[i],
        len: durs[i] + outF + (last ? tail : 0),
        inT: ins[i] > 0 ? { kind: s.transition.kind, dir: s.transition.dir ?? "left", frames: ins[i], ease: s.ease } : null,
        outT: next && outF > 0 ? { kind: next.transition.kind, dir: next.transition.dir ?? "left", frames: outF, ease: next.ease } : null,
      };
    });
  }, [tl, fps]);

  const subs = useMemo(() => tl.scenes.map((_, i) => subsOn(tl, i, audio)), [tl, audio]);
  // area isi per adegan = zona aman, dikurangi ruang subtitle kalau subtitle tampil
  const boxes = useMemo<Box[]>(() => {
    const reserve = subsReserve(tl.ratio) * k;
    const { safe } = ctx;
    return subs.map((on) => ({ x: safe.left, y: safe.top, w: W - safe.left - safe.right, h: H - safe.top - safe.bottom - (on ? reserve : 0) }));
  }, [subs, tl.ratio, k, ctx, W, H]);

  return (
    <StudioCtx.Provider value={ctx}>
      <AbsoluteFill style={{ background: brand.bg, overflow: "hidden", fontFamily: BODY, color: brand.text }}>
        {tl.scenes.map((sc, i) => {
          const p = plan[i];
          return (
            <Sequence key={sc.id} from={p.start} durationInFrames={Math.max(1, p.len)} name={`${i + 1}. ${sc.name}`} premountFor={Math.round(fps)}>
              <SceneShell sc={sc} i={i} n={tl.scenes.length} plan={p} box={boxes[i]} subs={subs[i]} />
            </Sequence>
          );
        })}
        {tl.vignette !== false && <Vignette strength={0.5} />}
        <Subtitles tl={tl} audio={audio} />
        {tl.grain !== false && <Grain opacity={0.05} />}
        {showSafeZone && <SafeZoneOverlay />}
        <StudioAudio tl={tl} audio={audio} sfxExtra={sfxExtra} />
      </AbsoluteFill>
    </StudioCtx.Provider>
  );
};

/** satu adegan: transisi → kamera → latar (parallax lambat + depth of field) → isi */
function SceneShell({ sc, i, n, plan, box, subs }: { sc: Scene; i: number; n: number; plan: Plan; box: Box; subs: boolean }) {
  const { tl, fps } = useStudio();
  // tempo: adegan 3 dtk = 1; adegan pendek → animasi lebih cepat, adegan panjang → lebih santai
  const value = useMemo<SceneCtxValue>(() => ({ scene: sc, i, n, dur: plan.dur, box, subs, tempo: clamp(plan.dur / (3 * fps), 0.6, 1.4) }), [sc, i, n, plan.dur, box, subs, fps]);
  return (
    <SceneCtx.Provider value={value}>
      <SceneTransition inT={plan.inT} outT={plan.outT} dur={plan.dur} accent={tl.brand.primary}>
        <CameraRig kind={sc.camera} len={plan.len}>
          <Layer depth={0.35}>
            <SceneBg bg={sc.bg} brand={tl.brand} blur={dofFor(sc.layout?.kind)} />
          </Layer>
          <Layer depth={1}>
            <SceneLayout />
          </Layer>
        </CameraRig>
      </SceneTransition>
    </SceneCtx.Provider>
  );
}
