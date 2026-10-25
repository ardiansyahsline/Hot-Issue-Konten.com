"use client";

/**
 * Audio komposisi Studio: VO, SFX, dan musik (file musik atau "trailer bed" dari SFX).
 * Pakai <Audio> dari @remotion/media (bukan dari "remotion") supaya ikut terender di browser (renderMediaOnWeb).
 *
 * Gain staging (target mix akhir ±-14 LUFS, true peak ≤ -1 dBTP):
 * - VO ke TARGET_LUFS.vo, SFX lewat sfxGain (target kategori + batas puncak per file),
 *   musik ke TARGET_LUFS.music + level adegan, turun DUCK_DB saat VO bicara.
 * - SFX keras maks 2 yang pukulannya berdekatan; SFX keras yang jatuh saat VO bicara diturunkan 3 dB.
 * - Musik berhenti di ketukan terakhir lalu hening ±0,3–0,5 dtk sebelum video habis.
 */
import { Audio } from "@remotion/media";
import { useMemo } from "react";
import { Sequence, useVideoConfig } from "remotion";
import { SFX_BUILTIN, sfxById, type SfxMeta } from "@/lib/studio/sfxMeta";
import { beatGrid, dbToGain, DUCK_DB, isLoudSfx, MUSIC_LEVEL_DB, sceneStarts, secToFrames, sfxGain, TARGET_LUFS, totalFrames, type MusicLevel, type Timeline, type VoTrack } from "@/lib/studio/timeline";
import { sfxSrc } from "@/lib/studio/urls";

export type AudioMode = "all" | "vo" | "novo";

type Clip = { key: string; src: string; from: number; trim: number; dur: number; vol: number; gate: boolean; name: string };
type Loop = { key: string; src: string; vol: Float32Array; end: number; name: string };
export type AudioPlan = { clips: Clip[]; loops: Loop[]; endGate: Float32Array; musicEnd: number };

/** perkiraan loudness asli VO per mesin (LUFS) — worker bank suara sudah menormalkan ke -16 */
const VO_LUFS: Record<VoTrack["engine"], number> = { chatterbox: -16, pocket: -16, edge: -19, elevenlabs: -17 };
const voGain = (engine: VoTrack["engine"] | undefined) => dbToGain(Math.max(-6, Math.min(2, TARGET_LUFS.vo - (VO_LUFS[engine ?? "edge"] ?? -16))));

const BUILTIN_IDS = new Set(SFX_BUILTIN.map((s) => s.id));
/** alamat file SFX: bawaan → route aset repo, tambahan → src dari katalog */
const srcOf = (m: SfxMeta): string | null => (BUILTIN_IDS.has(m.id) ? sfxSrc(m.file) : m.src || null);

const BED = { pulse: "trailer-pulse-sedang", sustain: "trailer-pulse-panjang", riser: "riser-blastoff", braam1: "braam-epik-1", braam2: "braam-epik-2", booms: ["boom-trailer-1", "boom-trailer-3", "boom-trailer-2"] };
const BED_BPM = 100;

/** rata-rata bergerak (jendela 2r+1) untuk menghaluskan perubahan level antar adegan */
function smooth(a: Float32Array, r: number): Float32Array {
  const n = a.length;
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + a[i];
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - r);
    const hi = Math.min(n, i + r + 1);
    out[i] = (pre[hi] - pre[lo]) / Math.max(1, hi - lo);
  }
  return out;
}

const at = (a: Float32Array, f: number) => (a.length ? a[Math.max(0, Math.min(a.length - 1, Math.floor(f)))] : 1);

/** frame berhenti musik: ketukan terakhir dekat akhir isi video, sisakan hening ≥ 0,3 dtk */
function endOnBeat(beats: number[], contentSec: number, fps: number, N: number): number {
  const c = beats.filter((b) => b >= contentSec - 1.2 && b <= contentSec + 0.2);
  const b = c.length ? c[c.length - 1] : contentSec;
  return Math.max(1, Math.min(Math.round(b * fps), N - Math.round(0.3 * fps)));
}

/** susun semua klip audio + kurva volume per frame (dipanggil sekali per perubahan timeline) */
export function planAudio(tl: Timeline, mode: AudioMode, extra: SfxMeta[], fps: number, N: number): AudioPlan {
  const scenes = tl.scenes;
  const starts = sceneStarts({ scenes, fps });
  const durs = scenes.map((s) => secToFrames(s.dur, fps));
  const content = totalFrames({ scenes, fps });
  const contentSec = content / fps;
  const clips: Clip[] = [];
  const loops: Loop[] = [];
  const ones = new Float32Array(0);

  // ---------- VO ----------
  const useVo = mode !== "novo" && !tl.muteVo && tl.voice?.mode !== "none";
  const speak = new Uint8Array(N);
  if (useVo && tl.vo) {
    const g = voGain(tl.vo.engine);
    for (const line of tl.vo.lines ?? []) {
      const i = scenes.findIndex((s) => s.id === line.sceneId);
      if (i < 0 || !line.src || !scenes[i].vo?.text) continue;
      const from = starts[i] + Math.round((line.at ?? 0.15) * fps);
      if (from >= N) continue;
      const dur = Math.max(1, Math.ceil((line.dur || 1) * fps) + 2);
      clips.push({ key: `vo-${line.sceneId}`, src: line.src, from, trim: 0, dur, vol: g, gate: false, name: `VO · ${scenes[i].name}` });
      for (let f = from; f < Math.min(N, from + dur); f++) speak[f] = 1;
    }
  }
  if (mode === "vo") return { clips, loops, endGate: ones, musicEnd: 0 };

  // ---------- ducking: selubung 0..1 (attack ±0,12 dtk dengan lihat-depan, release ±0,35 dtk) ----------
  const att = Math.max(1, Math.round(0.12 * fps));
  const rel = Math.max(1, Math.round(0.35 * fps));
  const ahead = new Int32Array(N);
  let d = 1e9;
  for (let f = N - 1; f >= 0; f--) {
    d = speak[f] ? 0 : d + 1;
    ahead[f] = d;
  }
  const duck = new Float32Array(N);
  let env = 0;
  for (let f = 0; f < N; f++) {
    const target = ahead[f] <= att ? 1 : 0;
    env = target > env ? Math.min(1, env + 1 / att) : Math.max(0, env - 1 / rel);
    duck[f] = env;
  }

  // ---------- level musik per adegan ----------
  const sceneAt = new Int16Array(N);
  scenes.forEach((_, i) => sceneAt.fill(i, Math.min(N, starts[i]), Math.min(N, starts[i] + durs[i])));
  if (content < N) sceneAt.fill(scenes.length - 1, content, N);
  const lvlRaw = new Float32Array(N);
  for (let f = 0; f < N; f++) lvlRaw[f] = MUSIC_LEVEL_DB[scenes[sceneAt[f]]?.music ?? "mid"] ?? -4;
  const lvl = smooth(lvlRaw, Math.round(0.15 * fps));
  const fadeIn = (f: number) => Math.min(1, f / Math.max(1, Math.round(0.3 * fps)));

  // ---------- titik akhir musik & gerbang akhir untuk SFX ----------
  const src = tl.music?.src ?? "bed";
  const beats = src === "bed"
    ? beatGrid(BED_BPM, 0, contentSec + 1)
    : tl.music?.beats?.length
      ? tl.music.beats
      : tl.music?.bpm
        ? beatGrid(tl.music.bpm, tl.music.offset ?? 0, contentSec + 1)
        : [];
  const musicEnd = endOnBeat(beats, contentSec, fps, N);
  const outLen = Math.max(1, Math.round(0.35 * fps));
  const endGate = new Float32Array(N);
  for (let f = 0; f < N; f++) endGate[f] = Math.max(0, Math.min(1, (musicEnd - f) / outLen));

  // ---------- SFX dari adegan ----------
  type Ev = { clip: Clip; t: number; loud: boolean; id: string; cat: string };
  const userEv: Ev[] = [];
  scenes.forEach((sc, i) => {
    (sc.sfx ?? []).forEach((cue, k) => {
      if (cue.on === false) return;
      const m = sfxById(cue.id, extra);
      const s = m ? srcOf(m) : null;
      if (!m || !s) return;
      const hit = starts[i] / fps + (cue.at ?? 0);
      let from = Math.round((hit - m.hit) * fps);
      let trim = 0;
      if (from < 0) {
        trim = -from;
        from = 0;
      }
      const dur = Math.ceil(m.dur * fps) - trim;
      if (dur <= 0 || from >= N) return;
      const loud = isLoudSfx(m);
      const hf = Math.min(N - 1, Math.round(hit * fps));
      // VO selalu paling jelas: SFX keras yang jatuh saat VO bicara turun 3 dB
      const vol = sfxGain(m, cue.gain ?? 0) * (loud && duck[hf] > 0.5 ? dbToGain(-3) : 1);
      userEv.push({ clip: { key: `sfx-${sc.id}-${k}-${m.id}`, src: s, from, trim, dur, vol, gate: true, name: `SFX · ${m.id}` }, t: hit, loud, id: m.id, cat: m.cat });
    });
  });

  // ---------- musik ----------
  const bedEv: Ev[] = [];
  if (src !== "none" && src !== "bed") {
    const baseDb = Math.min(0, TARGET_LUFS.music - (tl.music.lufs ?? -14)) + (tl.music.gain ?? 0);
    const cap = dbToGain(Math.max(0, tl.music.gain ?? 0));
    const vol = new Float32Array(N);
    for (let f = 0; f < N; f++) vol[f] = Math.min(cap, dbToGain(baseDb + lvl[f] + DUCK_DB * duck[f])) * fadeIn(f) * endGate[f];
    loops.push({ key: "music", src, vol, end: musicEnd, name: `Musik · ${tl.music.name ?? "latar"}` });
  } else if (src === "bed") {
    // trailer bed: groove (mid/high/drop) + sustain (low), loop dari frame 0 supaya tetap di grid ±100 BPM
    const layer = (id: string, on: Set<MusicLevel>) => {
      const m = sfxById(id, extra);
      const s = m ? srcOf(m) : null;
      if (!m || !s) return;
      const gate = new Float32Array(N);
      let any = false;
      for (let f = 0; f < N; f++) {
        const v = on.has(scenes[sceneAt[f]]?.music) ? 1 : 0;
        gate[f] = v;
        if (v) any = true;
      }
      if (!any) return;
      const g = smooth(gate, Math.round(0.2 * fps));
      const base = sfxGain(m, 0);
      const vol = new Float32Array(N);
      for (let f = 0; f < N; f++) vol[f] = base * dbToGain(lvl[f] + DUCK_DB * duck[f]) * g[f] * fadeIn(f) * endGate[f];
      loops.push({ key: `bed-${id}`, src: s, vol, end: musicEnd, name: `Musik cadangan · ${id}` });
    };
    layer(BED.pulse, new Set<MusicLevel>(["mid", "high", "drop"]));
    layer(BED.sustain, new Set<MusicLevel>(["low"]));

    // aksen: riser memuncak di adegan high/drop pertama, braam di reveal & adegan terakhir, boom di tiap drop
    const accent = (id: string, hitSec: number, extraDb = -3) => {
      const m = sfxById(id, extra);
      const s = m ? srcOf(m) : null;
      if (!m || !s || hitSec < 0 || hitSec >= contentSec) return;
      // jangan dobel dengan SFX pilihan user (id sama ±1 dtk atau kategori sama ±0,5 dtk)
      if (userEv.some((e) => (e.id === id && Math.abs(e.t - hitSec) < 1) || (e.cat === m.cat && Math.abs(e.t - hitSec) < 0.5))) return;
      let from = Math.round((hitSec - m.hit) * fps);
      let trim = 0;
      if (from < 0) {
        trim = -from;
        from = 0;
      }
      const dur = Math.ceil(m.dur * fps) - trim;
      if (dur <= 0) return;
      const hf = Math.min(N - 1, Math.round(hitSec * fps));
      const vol = sfxGain(m, extraDb) * dbToGain(DUCK_DB * 0.5 * duck[hf]);
      bedEv.push({ clip: { key: `bed-${id}-${hf}`, src: s, from, trim, dur, vol, gate: true, name: `Musik cadangan · ${id}` }, t: hitSec, loud: isLoudSfx(m), id, cat: m.cat });
    };
    const startSec = (i: number) => starts[i] / fps;
    const firstPeak = scenes.findIndex((s) => s.music === "high" || s.music === "drop");
    const firstHigh = scenes.findIndex((s) => s.music === "high");
    if (firstPeak >= 0 && startSec(firstPeak) >= 1) accent(BED.riser, startSec(firstPeak), -2);
    if (firstHigh >= 0) accent(BED.braam1, startSec(firstHigh));
    const last = scenes.length - 1;
    if (last > 0 && last !== firstHigh) accent(BED.braam2, startSec(last), -4);
    let b = 0;
    scenes.forEach((s, i) => {
      if (s.music === "drop") accent(BED.booms[b++ % BED.booms.length], startSec(i), -2);
    });
  }

  // ---------- maks 2 SFX keras berdekatan (pilihan user didahulukan) ----------
  const kept: Ev[] = [];
  for (const e of [...userEv.sort((a, b) => a.t - b.t), ...bedEv]) {
    if (e.loud && kept.filter((k) => k.loud && Math.abs(k.t - e.t) < 0.25).length >= 2) continue;
    kept.push(e);
  }
  clips.push(...kept.map((e) => e.clip));
  return { clips, loops, endGate, musicEnd };
}

/** semua suara video (VO, SFX, musik) */
export function StudioAudio({ tl, audio = "all", sfxExtra }: { tl: Timeline; audio?: AudioMode; sfxExtra?: SfxMeta[] }) {
  const { fps, durationInFrames } = useVideoConfig();
  const plan = useMemo(() => planAudio(tl, audio, sfxExtra ?? [], fps, durationInFrames), [tl, audio, sfxExtra, fps, durationInFrames]);
  const pre = Math.round(fps);
  return (
    <>
      {plan.loops.map((l) => (
        <Sequence key={l.key} from={0} durationInFrames={Math.max(1, l.end)} layout="none" name={l.name}>
          <Audio src={l.src} loop loopVolumeCurveBehavior="extend" volume={(f) => at(l.vol, f)} />
        </Sequence>
      ))}
      {plan.clips.map((c) => (
        <Audio
          key={c.key}
          src={c.src}
          from={c.from}
          durationInFrames={c.dur}
          trimBefore={c.trim > 0 ? c.trim : undefined}
          volume={c.gate ? (f) => c.vol * at(plan.endGate, c.from + f) : c.vol}
          premountFor={pre}
          name={c.name}
        />
      ))}
    </>
  );
}
