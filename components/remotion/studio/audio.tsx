"use client";

/**
 * Audio komposisi Studio: VO, SFX, dan musik (file musik atau "trailer bed" dari SFX).
 * Pakai <Audio> dari @remotion/media (bukan dari "remotion") supaya ikut terender di browser (renderMediaOnWeb).
 *
 * Gain staging (target mix akhir ±-14 LUFS, true peak ≤ -1 dBTP):
 * - VO ke TARGET_LUFS.vo, SFX lewat sfxGain (target kategori + batas puncak per file),
 *   musik ke TARGET_LUFS.music + level adegan, turun DUCK_DB saat VO bicara.
 * - SFX keras maks 2 yang pukulannya berdekatan; SFX keras yang jatuh saat VO bicara diturunkan 3 dB.
 * - Puncak gabungan (SFX + VO + musik yang puncaknya berdekatan) dijaga ≤ -1 dBTP dengan menurunkan SFX.
 * - Musik berhenti tepat di ketukan terakhir (ekor pendek) lalu hening ±0,3–0,5 dtk sebelum video habis.
 * - Limiter dihitung di muka: selubung puncak tiap SFX per frame (lib/studio/sfxEnv) dijumlah bersama musik & VO;
 *   kalau melewati -1,5 dBFS, musik & SFX diturunkan sebentar (VO tidak) — renderer browser tidak punya limiter.
 */
import { Audio } from "@remotion/media";
import { useMemo } from "react";
import { Sequence, useVideoConfig } from "remotion";
import { SFX_BUILTIN, sfxById, type SfxMeta } from "@/lib/studio/sfxMeta";
import { beatGrid, dbToGain, DUCK_DB, isLoudSfx, MUSIC_LEVEL_DB, sceneStarts, secToFrames, sfxGain, TARGET_LUFS, totalFrames, voStartOf, type MusicLevel, type Timeline, type VoTrack } from "@/lib/studio/timeline";
import { SFX_ENV_FPS, sfxEnv } from "@/lib/studio/sfxEnv";
import { sfxSrc } from "@/lib/studio/urls";
import { clamp, clamp01, useSrc } from "./theme";

export type AudioMode = "all" | "vo" | "novo";

type Clip = { key: string; src: string; from: number; trim: number; dur: number; vol: number; gate: boolean; name: string };
/** loopFrames = panjang potongan yang diulang (kosong = seluruh file) */
type Loop = { key: string; src: string; vol: Float32Array; end: number; name: string; loopFrames?: number };
/** `gate` = selubung akhir per frame (1 → 0 setelah ketukan terakhir), `stop` = frame semua musik & SFX berhenti */
export type AudioPlan = { clips: Clip[]; loops: Loop[]; gate: Float32Array; stop: number };

/** perkiraan loudness asli VO per mesin (LUFS) — worker bank suara sudah menormalkan ke -16 */
const VO_LUFS: Record<VoTrack["engine"], number> = { chatterbox: -16, pocket: -16, edge: -18, elevenlabs: -17 };
/** boost VO dibatasi +1,5 dB supaya puncaknya tidak lewat batas (TTS tidak dinormalkan dulu) */
const voGain = (engine: VoTrack["engine"] | undefined) => dbToGain(clamp(TARGET_LUFS.vo - (VO_LUFS[engine ?? "edge"] ?? -16), -6, 1.5));
/** perkiraan puncak VO setelah gain (ucapan -16 LUFS ≈ puncak -3 dBTP) */
const VO_PEAK = dbToGain(-3);
/** batas puncak gabungan */
const CEIL = dbToGain(-1);
/** perkiraan puncak file musik user (master komersial ≈ -1 dBTP) */
const TRACK_PEAK = dbToGain(-1);
/** batas limiter (sisakan ruang untuk encoder AAC/MP3 & puncak antar-sampel) */
const LIM_CEIL = dbToGain(-1.2);
/** penurunan maksimal limiter */
const LIM_FLOOR = dbToGain(-12);
/** penyesuaian akhir musik & SFX supaya mix mendekati -14 LUFS (VO tetap); puncaknya tetap dijaga limiter di bawah */
const MASTER_TRIM = dbToGain(2.3);
/** penjumlahan puncak beberapa suara: jumlah linear (boom/braam/pulse dominan bass & sefase — terukur cocok dengan hasil render) */
const PNORM = 1;

const BUILTIN_IDS = new Set(SFX_BUILTIN.map((s) => s.id));
/** alamat file SFX: bawaan → route aset repo, tambahan → src dari katalog */
const srcOf = (m: SfxMeta): string | null => (BUILTIN_IDS.has(m.id) ? sfxSrc(m.file) : m.src || null);

/** bahan trailer bed (lihat assets/audio/music/BACA-INI.md & assets/audio/teaser/cue-sheet.md) */
const BED = { pulse: "trailer-pulse-sedang", sustain: "trailer-pulse-panjang", riser: "riser-blastoff", braam1: "braam-epik-1", braam2: "braam-epik-2", booms: ["boom-trailer-1", "boom-trailer-3", "boom-trailer-2"] };
export const BED_BPM = 100;
/** file trailer-pulse: groove/pukulan hanya 32 ketukan (19,2 dtk) pertama, sisanya ekor sunyi -> yang diulang hanya bagian itu */
const BED_LOOP_BEATS = 32;

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

/**
 * Akhir musik: ketukan terakhir dekat akhir isi video tetap terdengar penuh, lalu meluruh (cosinus)
 * sampai ±0,4 dtk sebelum video habis (minimal hening 0,3 dtk). Tanpa ketukan: fade 0,35 dtk di akhir isi.
 */
export function planEnd(beats: number[], content: number, fps: number, N: number): { stop: number; gate: Float32Array } {
  const minSil = Math.round(0.3 * fps);
  const want = Math.round(0.4 * fps);
  const relMin = Math.max(1, Math.round(0.2 * fps));
  const relMax = Math.round(1 * fps);
  const gate = new Float32Array(N).fill(1);
  const hi = Math.min(N - minSil - relMin, content + Math.round(0.05 * fps));
  const lo = Math.max(Math.round(0.5 * fps), content - Math.round(1.5 * fps));
  let bf = -1;
  for (const b of beats) {
    const f = Math.round(b * fps);
    if (f >= lo && f <= hi && f > bf) bf = f;
  }
  if (bf > 0) {
    const rel = clamp(N - want - bf, relMin, Math.min(relMax, N - minSil - bf));
    const stop = bf + rel;
    for (let f = bf; f < N; f++) gate[f] = f >= stop ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * (f - bf)) / rel);
    return { stop, gate };
  }
  const stop = Math.max(1, Math.min(content, N - minSil));
  const out = Math.max(1, Math.round(0.35 * fps));
  for (let f = 0; f < N; f++) gate[f] = clamp01((stop - f) / out);
  return { stop, gate };
}

/** grid ketukan musik video (trailer bed = 100 BPM; file musik = hasil deteksi / BPM) */
export function musicBeats(tl: Timeline, untilSec: number): number[] {
  const src = tl.music?.src ?? "bed";
  if (src === "none") return [];
  if (src === "bed") return beatGrid(BED_BPM, 0, untilSec);
  if (tl.music?.beats?.length) return tl.music.beats;
  return tl.music?.bpm ? beatGrid(tl.music.bpm, tl.music.offset ?? 0, untilSec) : [];
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
  const toF = (sec: number) => Math.max(0, Math.min(N - 1, Math.round(sec * fps)));

  // ---------- VO ----------
  const useVo = mode !== "novo" && !tl.muteVo && tl.voice?.mode !== "none";
  const speak = new Uint8Array(N);
  if (useVo && tl.vo) {
    const g = voGain(tl.vo.engine);
    for (const line of tl.vo.lines ?? []) {
      const i = scenes.findIndex((s) => s.id === line.sceneId);
      if (i < 0 || !line.src || !scenes[i].vo?.text) continue;
      // mulai VO: posisi baris hasil generate → offset adegan (scene.vo.at, mis. waktu target naskah teaser) → 0,15 dtk
      const from = starts[i] + Math.round(voStartOf(scenes[i], line) * fps);
      if (from >= N) continue;
      const dur = Math.max(1, Math.min(N - from, Math.ceil((line.dur || 1) * fps) + 2));
      clips.push({ key: `vo-${line.sceneId}`, src: line.src, from, trim: 0, dur, vol: g, gate: false, name: `VO · ${scenes[i].name}` });
      for (let f = from; f < from + dur; f++) speak[f] = 1;
    }
  }
  if (mode === "vo") return { clips, loops, gate: new Float32Array(0), stop: N };

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

  // ---------- level musik per adegan (dihaluskan ±0,15 dtk) ----------
  const sceneAt = new Int16Array(N);
  scenes.forEach((_, i) => sceneAt.fill(i, Math.min(N, starts[i]), Math.min(N, starts[i] + durs[i])));
  if (content < N) sceneAt.fill(scenes.length - 1, content, N);
  const lvlRaw = new Float32Array(N);
  for (let f = 0; f < N; f++) lvlRaw[f] = MUSIC_LEVEL_DB[scenes[sceneAt[f]]?.music ?? "mid"] ?? -4;
  const lvl = smooth(lvlRaw, Math.round(0.15 * fps));
  const fadeLen = Math.max(1, Math.round(0.3 * fps));
  const fadeIn = (f: number) => Math.min(1, f / fadeLen);

  // ---------- akhir: musik & SFX berhenti di ketukan terakhir ----------
  const src = tl.music?.src ?? "bed";
  const { stop, gate } = planEnd(musicBeats(tl, contentSec + 1), content, fps, N);

  // ---------- SFX ----------
  type Ev = { clip: Clip; t: number; loud: boolean; id: string; cat: string; pk: number; tp: number };
  /** klip SFX yang pukulannya (`hit`) jatuh tepat di detik `hitSec` */
  const mkEv = (key: string, m: SfxMeta, s: string, hitSec: number, vol: number, name: string): Ev | null => {
    let from = Math.round((hitSec - m.hit) * fps);
    let trim = 0;
    if (from < 0) {
      trim = -from;
      from = 0;
    }
    const dur = Math.min(Math.ceil(m.dur * fps) - trim, stop - from);
    if (dur <= 0 || from >= stop) return null;
    const pkIn = Math.round(m.peak * fps);
    return { clip: { key, src: s, from, trim, dur, vol, gate: true, name }, t: hitSec, loud: isLoudSfx(m), id: m.id, cat: m.cat, pk: from + Math.max(0, pkIn - trim), tp: dbToGain(m.tp) };
  };

  const userEv: Ev[] = [];
  scenes.forEach((sc, i) => {
    (sc.sfx ?? []).forEach((cue, k) => {
      if (cue.on === false) return;
      const m = sfxById(cue.id, extra);
      const s = m ? srcOf(m) : null;
      if (!m || !s) return;
      const hit = starts[i] / fps + (cue.at ?? 0);
      // VO selalu paling jelas: SFX keras yang jatuh saat VO bicara turun 3 dB
      const vol = sfxGain(m, cue.gain ?? 0) * (isLoudSfx(m) && duck[toF(hit)] > 0.5 ? dbToGain(-3) : 1);
      const ev = mkEv(`sfx-${sc.id}-${k}-${m.id}`, m, s, hit, vol, `SFX · ${m.id}`);
      if (ev) userEv.push(ev);
    });
  });

  // ---------- musik ----------
  const musicPeak = new Float32Array(N); // perkiraan puncak musik per frame (untuk penjaga puncak)
  const bedEv: Ev[] = [];
  if (src !== "none" && src !== "bed") {
    // file musik: ke target -18 LUFS (boost maks +4 dB) + gain user + level adegan, di-duck saat VO
    const baseDb = clamp(TARGET_LUFS.music - (tl.music.lufs ?? -14), -30, 4) + clamp(tl.music.gain ?? 0, -24, 6);
    const vol = new Float32Array(N);
    for (let f = 0; f < N; f++) {
      vol[f] = dbToGain(baseDb + lvl[f] + DUCK_DB * duck[f]) * fadeIn(f) * gate[f];
      musicPeak[f] = vol[f] * TRACK_PEAK;
    }
    loops.push({ key: "music", src, vol, end: stop, name: `Musik · ${tl.music.name ?? "latar"}` });
  } else if (src === "bed") {
    trailerBed();
  }

  /** trailer bed: musik cadangan dari SFX, di grid 100 BPM, ikut level adegan & ducking */
  function trailerBed() {
    // lapisan loop dari frame 0 supaya tetap di grid: groove (mid/high/drop) + sustain (low)
    const layer = (id: string, on: Set<MusicLevel>) => {
      const m = sfxById(id, extra);
      const s = m ? srcOf(m) : null;
      if (!m || !s) return;
      const g0 = new Float32Array(N);
      let any = false;
      for (let f = 0; f < N; f++) {
        g0[f] = on.has(scenes[sceneAt[f]]?.music) ? 1 : 0;
        if (g0[f]) any = true;
      }
      if (!any) return;
      const g = smooth(g0, Math.round(0.2 * fps));
      const base = sfxGain(m, 0);
      const tp = dbToGain(m.tp);
      const vol = new Float32Array(N);
      for (let f = 0; f < N; f++) {
        vol[f] = base * dbToGain(lvl[f] + DUCK_DB * duck[f]) * g[f] * fadeIn(f) * gate[f];
        musicPeak[f] += vol[f] * tp;
      }
      loops.push({ key: `bed-${id}`, src: s, vol, end: stop, name: `Musik cadangan · ${id}`, loopFrames: Math.round(((BED_LOOP_BEATS * 60) / BED_BPM) * fps) });
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
      const vol = sfxGain(m, extraDb) * dbToGain(DUCK_DB * 0.5 * duck[toF(hitSec)]);
      const ev = mkEv(`bed-${id}-${toF(hitSec)}`, m, s, hitSec, vol, `Musik cadangan · ${id}`);
      if (ev) bedEv.push(ev);
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

  // ---------- penjaga puncak: jumlah daya klip yang puncaknya berdekatan (±0,1 dtk) + VO + musik ≤ -1 dBTP ----------
  const win = Math.max(1, Math.round(0.1 * fps));
  const amp = kept.map((e) => e.tp * e.clip.vol);
  const scale = kept.map((e, i) => {
    const pf = Math.min(N - 1, e.pk);
    let pow = 0;
    kept.forEach((o, j) => {
      if (Math.abs(o.pk - e.pk) <= win) pow += amp[j] * amp[j];
    });
    const fixed = (speak[pf] ? VO_PEAK * VO_PEAK : 0) + musicPeak[pf] * musicPeak[pf];
    if (pow + fixed <= CEIL * CEIL || amp[i] <= 0) return 1;
    return clamp(Math.sqrt(Math.max(0, CEIL * CEIL - fixed) / pow), 0.2, 1);
  });
  const sfxClips = kept.map((e, i) => ({ ...e.clip, vol: e.clip.vol * scale[i] * MASTER_TRIM }));
  for (const l of loops) for (let f = 0; f < N; f++) l.vol[f] *= MASTER_TRIM;

  // ---------- limiter dihitung di muka ----------
  const rest = new Float64Array(N); // Σ puncak^p musik + SFX
  const voPk = new Float32Array(N);
  const vg = useVo && tl.vo ? voGain(tl.vo.engine) : 0;
  for (let f = 0; f < N; f++) voPk[f] = speak[f] ? VO_PEAK * vg : 0;
  const addEnv = (env: Float32Array | null, tpLin: number, vol: (f: number) => number, from: number, len: number, offset: number, loop: boolean, loopLen?: number) => {
    const cycle = env ? Math.max(1, Math.min(env.length, loopLen ?? env.length)) : 1;
    for (let k = 0; k < len; k++) {
      const f = from + k;
      if (f >= N) break;
      const idx = offset + k;
      const pk = env ? (loop ? env[idx % cycle] : env[idx] ?? 0) : tpLin;
      const a = pk * vol(f);
      if (a > 0) rest[f] += Math.pow(a, PNORM);
    }
  };
  for (const c of sfxClips) {
    const id = c.key.split("-").pop() ?? "";
    const m = kept.find((e) => e.clip.key === c.key);
    const meta = m ? sfxById(m.id, extra) : sfxById(id, extra);
    addEnv(meta ? sfxEnv(meta.id) : null, meta ? dbToGain(meta.tp) : TRACK_PEAK, (f) => c.vol * at(gate, f), c.from, c.dur, c.trim, false);
  }
  for (const l of loops) {
    const id = l.key.startsWith("bed-") ? l.key.slice(4) : "";
    const env = id ? sfxEnv(id) : null;
    addEnv(env, TRACK_PEAK, (f) => l.vol[f], 0, Math.min(N, l.end), 0, true, l.loopFrames ? Math.round((l.loopFrames * SFX_ENV_FPS) / fps) : undefined);
  }
  const raw = new Float32Array(N);
  for (let f = 0; f < N; f++) {
    const r = Math.pow(rest[f], 1 / PNORM);
    raw[f] = r <= 0 ? 1 : clamp((LIM_CEIL - voPk[f]) / r, LIM_FLOOR, 1);
  }
  // lihat-depan 2 frame (turun sebelum pukulan), lepas pelan ±0,3 dtk
  const lim = new Float32Array(N);
  const relStep = 1 / Math.max(1, Math.round(0.3 * fps));
  let g = 1;
  for (let f = 0; f < N; f++) {
    let want = raw[f];
    for (let k = 1; k <= 2 && f + k < N; k++) want = Math.min(want, raw[f + k]);
    g = want < g ? want : Math.min(want, g + relStep * (1 - g) + relStep * 0.02);
    lim[f] = g;
  }
  for (let f = 0; f < N; f++) gate[f] *= lim[f];
  for (const l of loops) for (let f = 0; f < N; f++) l.vol[f] *= lim[f];
  clips.push(...sfxClips);
  return { clips, loops, gate, stop };
}

/** semua suara video (VO, SFX, musik) */
export function StudioAudio({ tl, audio = "all", sfxExtra }: { tl: Timeline; audio?: AudioMode; sfxExtra?: SfxMeta[] }) {
  const { fps, durationInFrames } = useVideoConfig();
  const res = useSrc();
  const plan = useMemo(() => planAudio(tl, audio, sfxExtra ?? [], fps, durationInFrames), [tl, audio, sfxExtra, fps, durationInFrames]);
  const pre = Math.round(fps);
  return (
    <>
      {plan.loops.map((l) => (
        <Sequence key={l.key} from={0} durationInFrames={Math.max(1, l.end)} layout="none" name={l.name}>
          <Audio src={res(l.src)} loop durationInFrames={l.loopFrames} loopVolumeCurveBehavior="extend" volume={(f) => at(l.vol, f)} name={l.name} />
        </Sequence>
      ))}
      {plan.clips.map((c) => (
        <Audio
          key={c.key}
          src={res(c.src)}
          from={c.from}
          durationInFrames={c.dur}
          trimBefore={c.trim > 0 ? c.trim : undefined}
          volume={c.gate ? (f) => c.vol * at(plan.gate, c.from + f) : c.vol}
          premountFor={pre}
          name={c.name}
        />
      ))}
    </>
  );
}
