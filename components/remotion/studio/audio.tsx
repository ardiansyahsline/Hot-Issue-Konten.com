"use client";

/**
 * Audio komposisi Studio: VO, SFX, dan musik (file musik atau "trailer bed" dari SFX).
 * Pakai <Audio> dari @remotion/media (bukan dari "remotion") supaya ikut terender di browser (renderMediaOnWeb).
 *
 * Gain staging (target mix akhir ±-14 LUFS, true peak ≤ -1 dBTP; VO Edge yang di-boost +1,5 dB bisa sedikit lewat di render
 * browser / CLI mentah — render laptop lewat worker menyamakan akhir ke -14 LUFS / -1 dBTP, loudnorm_2pass):
 * - VO ke TARGET_LUFS.vo, SFX lewat sfxGain (target kategori + batas puncak per file),
 *   musik ke TARGET_LUFS.music + level adegan, turun DUCK_DB saat VO bicara.
 * - SFX keras maks 2 yang pukulannya berdekatan; SFX keras yang jatuh saat VO bicara diturunkan 3 dB.
 * - Puncak gabungan (SFX + VO + musik yang puncaknya berdekatan) dijaga ≤ -1 dBTP dengan menurunkan SFX.
 * - Musik berhenti tepat di ketukan terakhir (ekor pendek) lalu hening ±0,3–0,5 dtk sebelum video habis.
 * - Limiter dihitung di muka: selubung puncak tiap SFX per frame (lib/studio/sfxEnv) dijumlah bersama musik & VO;
 *   kalau melewati -1,2 dBFS, musik & SFX diturunkan sebentar (VO tidak) — renderer browser tidak punya limiter.
 *   Decoder render tidak membuang jeda awal mp3 (±25 ms), jadi puncak SFX sekali-putar sebagian besar terdengar SATU frame sesudah
 *   selubungnya: perkiraan puncak frame f memakai selubung frame f−1 (oneShotPk; lihat-depan limiter menutup sisa awalnya) —
 *   kalau tidak, limiter sudah lepas tepat di frame klik / pukulan benar-benar berbunyi.
 * - Mixer (tl.mix, scene.gain, scene.vo.gainDb — lihat usesMixer): rencana tanpa mixer dihitung dulu (persis cara lama), lalu
 *   volume dikalikan SESUDAH limiter: musik (file & trailer bed) ikut campuran + adegan, VO per kalimat, SFX per adegan — jadi
 *   menurunkan musik saat VO bicara tetap terdengar turun (limiter tidak menaikkannya lagi). Pengaman puncak per jalur (applyMixer):
 *   bagian yang tanpa mixer pun sudah ≥ -2 dBFS ("panas", hampir semua saat VO bicara) tidak boleh lebih keras dari tanpa mixer,
 *   bagian lain boleh naik sampai -2 dBFS (perkiraan).
 *   · VO hanya ditahan oleh kenaikannya SENDIRI, satu angka per kalimat (tidak dipompa): menaikkan musik / SFX tidak pernah
 *     menurunkan VO (VO tetap paling jelas, sama dengan limiter lama).
 *   · Musik & SFX menyerap sisanya per frame: di bagian panas dibagi kenaikan terbesar yang bunyi (yang dinaikkan menonjol karena
 *     yang lain dikecilkan), dan ikut turun sebanyak VO ditahan (imbangan VO : musik tetap seperti yang diatur).
 *   Jadi mixer tidak membuat puncak lebih tinggi dari tanpa mixer, dan mengubah sedikit satu jalur tidak menurunkan VO.
 *   VO yang sudah dekat puncak tidak bisa lebih keras: musik & SFX yang turun (keterangan di editor, voGuardDb). Musik / SFX yang
 *   dinaikkan tidak terdengar naik di bagian panas (mis. drop, saat VO bicara): editor menampilkan kenaikan nyatanya (planAudioLift).
 *   Aksen trailer bed (boom/braam/riser) ikut volume musik adegan tempat pukulannya jatuh (tanpa penghalusan); loop tetap halus.
 *   Mixer tidak dipakai → hasilnya persis sama dengan sebelum ada mixer.
 * - Offset musik (tl.music.offset, detik lagu yang dilewati): putaran pertama mulai dari detik ke-offset (trimBefore), habis itu
 *   lagu diulang DARI AWAL (bukan potongan sisa) — ketukan ikut (musicFileBeats, musicHeadSec, musicCycleSec). Tiap putaran mulai
 *   MUSIC_XFADE_SEC sebelum putaran sebelumnya habis dan disilang-pudar (musicParts): hening encoder mp3 di awal & ujung file
 *   tidak lagi membuat musik putus sesaat di titik ulang.
 */
import { Audio } from "@remotion/media";
import { useMemo } from "react";
import { Sequence, useVideoConfig } from "remotion";
import { SFX_BUILTIN, sfxById, type SfxMeta } from "@/lib/studio/sfxMeta";
import {
  beatGrid,
  dbOf,
  dbToGain,
  DUCK_DB,
  isLoudSfx,
  musicCycleSec,
  musicFileBeats,
  musicHeadSec,
  musicOffsetOf,
  MUSIC_LEVEL_DB,
  MUSIC_XFADE_SEC,
  sceneStarts,
  secToFrames,
  sfxDbOf,
  sfxGain,
  TARGET_LUFS,
  totalFrames,
  usesMixer,
  voDbOf,
  voStartOf,
  type MusicLevel,
  type Timeline,
  type VoTrack,
} from "@/lib/studio/timeline";
import { SFX_ENV_FPS, sfxEnv } from "@/lib/studio/sfxEnv";
import { sfxSrc } from "@/lib/studio/urls";
import { clamp, clamp01, useSrc } from "./theme";

export type AudioMode = "all" | "vo" | "novo";

/**
 * `bus: "vo"` = klip VO. `tag` = catatan untuk mixer & perkiraan puncak (tidak dipakai pemutar): adegan pemilik klip, id SFX,
 * frame pukulan, aksen trailer bed (ikut volume musik), `hold` = pengali pengaman puncak yang sudah dikalikan ke VO (< 1 = ditahan).
 */
type Clip = { key: string; src: string; from: number; trim: number; dur: number; vol: number; gate: boolean; name: string; bus?: "vo"; tag?: ClipTag };
type ClipTag = { scene?: string; sfx?: string; hit?: number; bed?: boolean; hold?: number };
/**
 * loopFrames = panjang potongan yang diulang (kosong = seluruh file). Offset musik (frame, boleh pecahan → akurat sampel): `trim` =
 * awal file yang dilewati di putaran pertama, `head` = frame video tempat putaran ulang pertama mulai (lagu dari awal), `cycle` =
 * jarak antar putaran ulang, `xf` = panjang crossfade di tiap titik ulang (lihat musicParts).
 */
type Loop = { key: string; src: string; vol: Float32Array; end: number; name: string; loopFrames?: number; trim?: number; head?: number; cycle?: number; xf?: number };
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
/** plafon bagian yang dinaikkan mixer (cadangan 0,8 dB di bawah LIM_CEIL, lihat applyMixer) */
const MIX_CEIL = dbToGain(-2);
/** penurunan maksimal limiter */
const LIM_FLOOR = dbToGain(-12);
/** penyesuaian akhir musik & SFX supaya mix mendekati -14 LUFS (VO tetap); puncaknya tetap dijaga limiter di bawah */
const MASTER_TRIM = dbToGain(2.3);
/** penjumlahan puncak beberapa suara: jumlah linear (boom/braam/pulse dominan bass & sefase — terukur cocok dengan hasil render) */
const PNORM = 1;

const BUILTIN_IDS = new Set(SFX_BUILTIN.map((s) => s.id));
/** alamat file SFX: bawaan → route aset repo, tambahan → src dari katalog */
const srcOf = (m: SfxMeta): string | null => (BUILTIN_IDS.has(m.id) ? sfxSrc(m.file) : m.src || null);

/**
 * bahan trailer bed (lihat assets/audio/music/BACA-INI.md & assets/audio/teaser/cue-sheet.md).
 * pulse = pukulan sub tanpa nada (turunan trailer-pulse-sedang, hanya < 150 Hz): versi lama berbunyi seperti alarm/sirene berulang
 * (nada ±340-450 Hz + sapuan naik tiap 1,2 dtk) di sepanjang video. trailer-pulse-sedang tetap ada di pustaka SFX (pilih manual).
 */
const BED = { pulse: "trailer-groove-perkusi", sustain: "trailer-pulse-panjang", riser: "riser-blastoff", braam1: "braam-epik-1", braam2: "braam-epik-2", booms: ["boom-trailer-1", "boom-trailer-3", "boom-trailer-2"] };
export const BED_BPM = 100;
/** file trailer-pulse: groove/pukulan hanya 32 ketukan (19,2 dtk) pertama, sisanya ekor sunyi -> yang diulang hanya bagian itu
 *  (trailer-groove-perkusi panjangnya pas 32 ketukan, ekornya sudah dilipat ke awal -> sambungan loop mulus) */
const BED_LOOP_BEATS = 32;
/** groove bed (mid/high/drop) jauh di bawah target kategori trailer-pulse: file-nya hanya sub (LUFS kecil, puncak besar),
 *  -15 dB = level sub yang sama dengan bed lama -> bobot bass tetap, tidak jadi suara latar yang menonjol */
const BED_PULSE_DB = -15;

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
 * Puncak selubung SFX sekali-putar yang terdengar di frame ke-`idx` klip. Decoder render tidak membuang jeda awal mp3 (±25 ms ≈ 0,75
 * frame): isi frame selubung idx−1 sebagian besar baru berbunyi di frame video idx, padahal volume (& limiter) berlaku per frame →
 * pakai selubung idx−1 (`prev` = bukan frame pertama klip). Seperempat awal frame idx sendiri sudah tertutup lihat-depan limiter.
 * Tanpa geser ini limiter lepas tepat di frame klik / pukulan berbunyi (teaser tanpa VO: -0,86 dBTP, sekarang -1,14).
 */
const oneShotPk = (env: Float32Array, idx: number, prev: boolean) => (prev && idx > 0 ? env[idx - 1] : env[idx]) ?? 0;

/** gain limiter per frame dari gain mentah: lihat-depan 2 frame (turun sebelum pukulan), lepas pelan ±0,3 dtk. Selalu ≤ gain mentah */
function follow(raw: Float32Array, fps: number): Float32Array {
  const N = raw.length;
  const out = new Float32Array(N);
  const relStep = 1 / Math.max(1, Math.round(0.3 * fps));
  let g = 1;
  for (let f = 0; f < N; f++) {
    let want = raw[f];
    for (let k = 1; k <= 2 && f + k < N; k++) want = Math.min(want, raw[f + k]);
    g = want < g ? want : Math.min(want, g + relStep * (1 - g) + relStep * 0.02);
    out[f] = g;
  }
  return out;
}

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
  // file musik: ketukan lagu digeser offset (lagu mulai dari detik ke-offset)
  return tl.music ? musicFileBeats(tl.music, untilSec, 1) : [];
}

/**
 * susun semua klip audio + kurva volume per frame (dipanggil sekali per perubahan timeline).
 * Mixer tidak dipakai → persis cara hitung lama (planCore). Dipakai → rencana tanpa mixer dihitung dulu, lalu volume mixer
 * dikalikan SESUDAH limiter (applyMixer): menurunkan musik / SFX benar-benar terdengar turun walau limiter sedang bekerja
 * (kalau dikalikan sebelum limiter, limiter menaikkannya lagi), dan yang dinaikkan dijaga pengaman puncak bus.
 */
export function planAudio(tl: Timeline, mode: AudioMode, extra: SfxMeta[], fps: number, N: number): AudioPlan {
  if (!usesMixer(tl)) return planCore(tl, mode, extra, fps, N).plan;
  return applyMixer(tl, planCore(withoutMixer(tl), mode, extra, fps, N), extra, fps, N).plan;
}

/**
 * Kenaikan volume satu jalur di bagian yang DINAIKKAN mixer (dB, rata-rata energi selubung puncak, terhadap tanpa mixer): `want` =
 * yang diminta, `got` = yang benar-benar terdengar sesudah pengaman puncak (bagian yang sudah dekat puncak tidak bisa lebih keras).
 */
export type MixLift = { want: number; got: number };
/** rencana audio + kenaikan nyata musik & SFX (null = mixer tidak dipakai / jalurnya tidak bunyi) — untuk keterangan jujur di editor */
export function planAudioLift(tl: Timeline, mode: AudioMode, extra: SfxMeta[], fps: number, N: number): { plan: AudioPlan; music: MixLift | null; sfx: MixLift | null } {
  if (!usesMixer(tl)) return { plan: planCore(tl, mode, extra, fps, N).plan, music: null, sfx: null };
  return applyMixer(tl, planCore(withoutMixer(tl), mode, extra, fps, N), extra, fps, N);
}

/** timeline yang sama tanpa volume mixer (campuran, adegan, kalimat) — rencana dasar mixer */
function withoutMixer(tl: Timeline): Timeline {
  const scenes = tl.scenes.map((s) => {
    const { gain: _g, ...rest } = s;
    if (!rest.vo || rest.vo.gainDb === undefined) return rest;
    const { gainDb: _v, ...vo } = rest.vo;
    return { ...rest, vo };
  });
  const { mix: _m, ...out } = tl;
  return { ...out, scenes };
}

/**
 * perkiraan puncak musik & SFX per frame dari rencana jadi (p-norm selubung puncak, sama dengan limiter; VO tidak termasuk).
 * `bus` = hanya musik (loop + aksen trailer bed) atau hanya SFX.
 */
function estimateRest(p: AudioPlan, extra: SfxMeta[], fps: number, N: number, bus?: "music" | "sfx"): Float32Array {
  const rest = new Float64Array(N);
  const add = (env: Float32Array | null, tpLin: number, vol: (f: number) => number, from: number, len: number, offset: number, loop: boolean, loopLen?: number) => {
    const cycle = env ? Math.max(1, Math.min(env.length, loopLen ?? env.length)) : 1;
    for (let k = 0; k < len; k++) {
      const f = from + k;
      if (f >= N) break;
      const idx = offset + k;
      const pk = env ? (loop ? env[idx % cycle] : oneShotPk(env, idx, k > 0)) : tpLin;
      const a = pk * vol(f);
      if (a > 0) rest[f] += Math.pow(a, PNORM);
    }
  };
  for (const c of p.clips) {
    if (c.bus === "vo" || (bus && (bus === "music") !== !!c.tag?.bed)) continue;
    const meta = c.tag?.sfx ? sfxById(c.tag.sfx, extra) : undefined;
    add(meta ? sfxEnv(meta.id) : null, meta ? dbToGain(meta.tp) : TRACK_PEAK, (f) => c.vol * (c.gate ? at(p.gate, f) : 1), c.from, c.dur, c.trim, false);
  }
  for (const l of bus === "sfx" ? [] : p.loops) {
    const id = l.key.startsWith("bed-") ? l.key.slice(4) : "";
    const env = id ? sfxEnv(id) : null;
    add(env, TRACK_PEAK, (f) => l.vol[f], 0, Math.min(N, l.end), 0, true, l.loopFrames ? Math.round((l.loopFrames * SFX_ENV_FPS) / fps) : undefined);
  }
  const out = new Float32Array(N);
  for (let f = 0; f < N; f++) out[f] = Math.pow(rest[f], 1 / PNORM);
  return out;
}

/** dB energi a terhadap b (Σ puncak² di frame yang `on`); null kalau b sunyi di situ */
function energyDb(a: Float32Array, b: Float32Array, on: Uint8Array): number | null {
  let ea = 0;
  let eb = 0;
  for (let f = 0; f < b.length; f++) {
    if (!on[f]) continue;
    ea += a[f] * a[f];
    eb += b[f] * b[f];
  }
  return eb > 1e-12 ? Math.round(10 * Math.log10(Math.max(1e-12, ea) / eb) * 10) / 10 : null;
}

/**
 * Volume mixer di atas rencana tanpa mixer: musik (file & trailer bed) × campuran + adegan — loop dihaluskan ±0,15 dtk, aksen
 * (boom/braam/riser) memakai volume adegan tempat pukulannya jatuh tanpa penghalusan (pukulan selalu di batas adegan: kalau
 * dihaluskan, volume adegan sebelumnya ikut terbawa) —, SFX × campuran + adegan pemiliknya (di luar `cue.gain`, sudah di rencana
 * dasar), VO × campuran + adegan + kalimat.
 * Lalu pengaman puncak per jalur (lihat catatan di atas file):
 * 1. VO — hanya kalimat yang DINAIKKAN yang bisa ditahan, satu angka per kalimat (`tag.hold`): di frame panas maks setinggi tanpa
 *    mixer, di frame lain sampai MIX_CEIL (musik & SFX dihitung paling banyak setinggi tanpa mixer — sisanya urusan langkah 2).
 * 2. Musik & SFX — per frame: ikut turun sebanyak VO yang bunyi ditahan, di frame panas dibagi kenaikan terbesar di antara musik &
 *    SFX yang bunyi, lalu dijepit supaya perkiraan puncak ≤ plafon (frame panas: puncak tanpa mixer; lainnya MIX_CEIL).
 */
function applyMixer(tl: Timeline, base: { plan: AudioPlan; voPk: Float32Array }, extra: SfxMeta[], fps: number, N: number): { plan: AudioPlan; music: MixLift | null; sfx: MixLift | null } {
  const b = base.plan;
  const scenes = tl.scenes;
  const byId = new Map(scenes.map((s) => [s.id, s] as const));
  const starts = sceneStarts({ scenes, fps });
  const content = totalFrames({ scenes, fps });
  const sceneAt = new Int16Array(N);
  scenes.forEach((s, i) => sceneAt.fill(i, Math.min(N, starts[i]), Math.min(N, starts[i] + secToFrames(s.dur, fps))));
  if (content < N) sceneAt.fill(scenes.length - 1, content, N);
  const md = dbOf(tl.mix?.musicDb);
  const mRaw = new Float32Array(N);
  for (let f = 0; f < N; f++) mRaw[f] = md + dbOf(scenes[sceneAt[f]]?.gain?.musicDb);
  const mDb = smooth(mRaw, Math.round(0.15 * fps));
  const mG = (f: number) => dbToGain(at(mDb, f));
  /** volume musik adegan di frame f tanpa penghalusan (aksen trailer bed) */
  const mHit = (f: number) => dbToGain(at(mRaw, f));

  const clips = b.clips.map((c) => {
    if (c.bus === "vo") {
      const sc = c.tag?.scene ? byId.get(c.tag.scene) : undefined;
      return sc ? { ...c, vol: c.vol * dbToGain(voDbOf(tl, sc)) } : c;
    }
    if (c.tag?.bed) return { ...c, vol: c.vol * mHit(c.tag.hit ?? c.from) };
    const sc = c.tag?.scene ? byId.get(c.tag.scene) : undefined;
    return sc ? { ...c, vol: c.vol * dbToGain(sfxDbOf(tl, sc)) } : c;
  });
  const loops = b.loops.map((l) => ({ ...l, vol: l.vol.map((v, f) => v * mG(f)) }));
  const gate = b.gate.slice();
  const span = (c: Clip, fn: (f: number) => void) => {
    for (let f = Math.max(0, c.from); f < Math.min(N, c.from + c.dur); f++) fn(f);
  };
  // kenaikan terbesar musik & SFX per frame (× terhadap tanpa mixer) di antara yang bunyi
  const gRest = new Float32Array(N);
  clips.forEach((c, i) => {
    const v0 = b.clips[i].vol;
    if (c.bus === "vo" || !(v0 > 0)) return;
    const g = c.vol / v0;
    span(c, (f) => {
      if (g > gRest[f]) gRest[f] = g;
    });
  });
  b.loops.forEach((l) => {
    for (let f = 0; f < Math.min(N, l.end); f++) if (l.vol[f] > 0 && mG(f) > gRest[f]) gRest[f] = mG(f);
  });
  const restBase = estimateRest(b, extra, fps, N);
  const want = { clips: clips.slice(), loops, gate: b.gate, stop: b.stop };
  const restMix = estimateRest(want, extra, fps, N);
  /** puncak tanpa mixer per frame (VO + musik & SFX); ≥ MIX_CEIL = panas */
  const tot0 = new Float32Array(N);
  for (let f = 0; f < N; f++) tot0[f] = base.voPk[f] + restBase[f];
  const voRaw = new Float32Array(N);
  for (const c of clips) if (c.bus === "vo") span(c, (f) => (voRaw[f] = Math.max(voRaw[f], VO_PEAK * c.vol)));

  // 1. VO: kalimat yang dinaikkan ditahan satu angka per kalimat
  clips.forEach((c, i) => {
    const v0 = b.clips[i].vol;
    if (c.bus !== "vo" || !(v0 > 0)) return;
    const g = c.vol / v0;
    if (g <= 1 + 1e-6) return;
    let k = 1;
    span(c, (f) => {
      const want = tot0[f] >= MIX_CEIL ? 1 / g : clamp(MIX_CEIL / Math.max(1e-9, voRaw[f] + Math.min(restMix[f], restBase[f])), 1 / g, 1);
      if (want < k) k = want;
    });
    if (k < 1 - 1e-6) clips[i] = { ...c, vol: c.vol * k, tag: { ...c.tag, hold: k } };
  });
  const voFin = new Float32Array(N);
  const voHold = new Float32Array(N).fill(1);
  for (const c of clips) {
    if (c.bus !== "vo") continue;
    const k = c.tag?.hold ?? 1;
    span(c, (f) => {
      voFin[f] = Math.max(voFin[f], VO_PEAK * c.vol);
      if (k < voHold[f]) voHold[f] = k;
    });
  }

  // 2. musik & SFX per frame (lihat-depan & lepas pelan seperti limiter)
  const raw = new Float32Array(N);
  for (let f = 0; f < N; f++) {
    const hot = tot0[f] >= MIX_CEIL;
    let r = voHold[f];
    if (hot && gRest[f] > 1) r = Math.min(r, 1 / gRest[f]);
    const room = (hot ? tot0[f] : MIX_CEIL) - voFin[f];
    if (restMix[f] > 0 && restMix[f] * r > room) r = Math.max(0, room) / restMix[f];
    raw[f] = Math.min(1, r);
  }
  // kenaikan per jalur di frame yang DINAIKKAN: diminta (sebelum pengaman bus) vs terdengar (rencana jadi) — `want` dihitung
  // sebelum loop dikalikan limiter bus (kurva loopnya dipakai bersama)
  const bus = (["music", "sfx"] as const).map((k) => {
    const e0 = estimateRest(b, extra, fps, N, k);
    const e1 = estimateRest(want, extra, fps, N, k);
    const on = new Uint8Array(N);
    for (let f = 0; f < N; f++) on[f] = e1[f] > e0[f] * 1.012 ? 1 : 0;
    const w = energyDb(e1, e0, on);
    return { k, e0, on, lift: w === null ? null : ({ want: w, got: w } as MixLift) };
  });
  const lim = follow(raw, fps);
  for (let f = 0; f < gate.length; f++) gate[f] *= lim[f];
  for (const l of loops) for (let f = 0; f < N; f++) l.vol[f] *= lim[f];
  const plan = { clips, loops, gate, stop: b.stop };
  for (const x of bus) if (x.lift) x.lift.got = energyDb(estimateRest(plan, extra, fps, N, x.k), x.e0, x.on) ?? x.lift.want;
  const music = bus[0].lift;
  const sfx = bus[1].lift;
  return { plan, music, sfx };
}

/**
 * Rencana audio TANPA mixer (cara hitung lama, persis): klip, kurva volume per frame, limiter yang dihitung di muka. `voPk` =
 * perkiraan puncak VO per frame yang dipakai limiter (patokan pengaman bus mixer).
 */
function planCore(tl: Timeline, mode: AudioMode, extra: SfxMeta[], fps: number, N: number): { plan: AudioPlan; voPk: Float32Array } {
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
      clips.push({ key: `vo-${line.sceneId}`, src: line.src, from, trim: 0, dur, vol: g, gate: false, name: `VO · ${scenes[i].name}`, bus: "vo", tag: { scene: line.sceneId } });
      for (let f = from; f < from + dur; f++) speak[f] = 1;
    }
  }
  const voPk = new Float32Array(N);
  const vg = useVo && tl.vo ? voGain(tl.vo.engine) : 0;
  for (let f = 0; f < N; f++) voPk[f] = speak[f] ? VO_PEAK * vg : 0;
  if (mode === "vo") return { plan: { clips, loops, gate: new Float32Array(0), stop: N }, voPk };

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
  const mkEv = (key: string, m: SfxMeta, s: string, hitSec: number, vol: number, name: string, tag: ClipTag): Ev | null => {
    let from = Math.round((hitSec - m.hit) * fps);
    let trim = 0;
    if (from < 0) {
      trim = -from;
      from = 0;
    }
    const dur = Math.min(Math.ceil(m.dur * fps) - trim, stop - from);
    if (dur <= 0 || from >= stop) return null;
    const pkIn = Math.round(m.peak * fps);
    return { clip: { key, src: s, from, trim, dur, vol, gate: true, name, tag: { ...tag, sfx: m.id, hit: toF(hitSec) } }, t: hitSec, loud: isLoudSfx(m), id: m.id, cat: m.cat, pk: from + Math.max(0, pkIn - trim), tp: dbToGain(m.tp) };
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
      const ev = mkEv(`sfx-${sc.id}-${k}-${m.id}`, m, s, hit, vol, `SFX · ${m.id}`, { scene: sc.id });
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
    // offset musik: putaran pertama mulai dari detik ke-offset (trimBefore) sepanjang sisa lagu, lalu lagu diulang dari awal dengan
    // crossfade di tiap titik ulang (frame pecahan → akurat sampel, lihat musicParts)
    const trim = musicOffsetOf(tl.music) * fps;
    const off = trim > 0 ? { trim, head: musicHeadSec(tl.music) * fps, cycle: musicCycleSec(tl.music) * fps, xf: MUSIC_XFADE_SEC * fps } : {};
    loops.push({ key: "music", src, vol, end: stop, name: `Musik · ${tl.music.name ?? "latar"}`, ...off });
  } else if (src === "bed") {
    trailerBed();
  }

  /** trailer bed: musik cadangan dari SFX, di grid 100 BPM, ikut level adegan & ducking */
  function trailerBed() {
    // lapisan loop dari frame 0 supaya tetap di grid: groove (mid/high/drop) + sustain (low)
    const layer = (id: string, on: Set<MusicLevel>, extraDb = 0) => {
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
      const base = sfxGain(m, extraDb);
      const tp = dbToGain(m.tp);
      const vol = new Float32Array(N);
      for (let f = 0; f < N; f++) {
        vol[f] = base * dbToGain(lvl[f] + DUCK_DB * duck[f]) * g[f] * fadeIn(f) * gate[f];
        musicPeak[f] += vol[f] * tp;
      }
      loops.push({ key: `bed-${id}`, src: s, vol, end: stop, name: `Musik cadangan · ${id}`, loopFrames: Math.round(((BED_LOOP_BEATS * 60) / BED_BPM) * fps) });
    };
    // groove = alas ritme sub (tidak bernada), bukan suara utama
    layer(BED.pulse, new Set<MusicLevel>(["mid", "high", "drop"]), BED_PULSE_DB);
    layer(BED.sustain, new Set<MusicLevel>(["low"]));

    // aksen: riser memuncak di adegan high/drop pertama, braam di reveal & adegan terakhir, boom di tiap drop
    const accent = (id: string, hitSec: number, extraDb = -3) => {
      const m = sfxById(id, extra);
      const s = m ? srcOf(m) : null;
      if (!m || !s || hitSec < 0 || hitSec >= contentSec) return;
      // jangan dobel dengan SFX pilihan user (id sama ±1 dtk atau kategori sama ±0,5 dtk)
      if (userEv.some((e) => (e.id === id && Math.abs(e.t - hitSec) < 1) || (e.cat === m.cat && Math.abs(e.t - hitSec) < 0.5))) return;
      const vol = sfxGain(m, extraDb) * dbToGain(DUCK_DB * 0.5 * duck[toF(hitSec)]);
      const ev = mkEv(`bed-${id}-${toF(hitSec)}`, m, s, hitSec, vol, `Musik cadangan · ${id}`, { bed: true });
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
  const addEnv = (env: Float32Array | null, tpLin: number, vol: (f: number) => number, from: number, len: number, offset: number, loop: boolean, loopLen?: number) => {
    const cycle = env ? Math.max(1, Math.min(env.length, loopLen ?? env.length)) : 1;
    for (let k = 0; k < len; k++) {
      const f = from + k;
      if (f >= N) break;
      const idx = offset + k;
      const pk = env ? (loop ? env[idx % cycle] : oneShotPk(env, idx, k > 0)) : tpLin;
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
  const lim = follow(raw, fps);
  for (let f = 0; f < N; f++) gate[f] *= lim[f];
  for (const l of loops) for (let f = 0; f < N; f++) l.vol[f] *= lim[f];
  clips.push(...sfxClips);
  return { plan: { clips, loops, gate, stop }, voPk };
}

/**
 * Seberapa keras pengaman puncak bus menahan VO (dB ≤ 0) — untuk keterangan di mixer: VO yang sudah hampir puncak tidak bisa
 * lebih keras lagi, yang terjadi musik & SFX ikut turun saat VO itu bicara. `sceneId` kosong = seluruh VO. 0 = tidak ditahan.
 */
export function voGuardDb(plan: AudioPlan, sceneId?: string): number {
  let m = 1;
  for (const c of plan.clips) {
    if (c.bus !== "vo" || (sceneId && c.tag?.scene !== sceneId)) continue;
    m = Math.min(m, c.tag?.hold ?? 1);
  }
  return m < 1 ? Math.round(20 * Math.log10(Math.max(1e-6, m)) * 10) / 10 : 0;
}

/**
 * Satu bagian pemutaran musik file dengan offset (frame video). `from` = frame mulai Audio, `trim` = awal file yang dilewati (boleh
 * pecahan → akurat sampel), `dur` = panjang Audio. `fadeIn` / `fadeOut` = [awal, akhir] crossfade (frame pecahan; null = tidak ada).
 */
export type MusicPart = { from: number; trim: number; dur: number; fadeIn: [number, number] | null; fadeOut: [number, number] | null };
/** lagu sangat pendek + video panjang → bagian sebanyak ini atau lebih diputar dengan loop biasa (tanpa crossfade) */
const MAX_MUSIC_PARTS = 64;
/**
 * Bagian-bagian musik file dengan offset: [0] = sisa lagu dari detik ke-offset sampai file habis; [k ≥ 1] = lagu dari awal, detik 0
 * file tepat di frame s0 = head + (k−1)·cycle (pecahan, lewat trim). Tiap bagian mulai ±`xf` frame sebelum file bagian sebelumnya
 * habis (file = cycle + xf frame) dan disilang-pudar linear dari frame pertama bagian baru sampai file lama habis (keduanya
 * berbunyi, jumlah gain = 1, puncak tidak naik) — menutup hening encoder mp3 (±25–50 ms awal + ujung file) yang tidak dibuang
 * decoder render. null = bukan musik offset / bagian terlalu banyak (StudioAudio memakai loop biasa).
 */
export function musicParts(l: Pick<Loop, "end" | "trim" | "head" | "cycle" | "xf">): MusicPart[] | null {
  const head = l.head ?? 0;
  const cycle = l.cycle ?? 0;
  const xf = Math.max(0, l.xf ?? 0);
  if (!((l.trim ?? 0) > 0) || !(head > 0) || !(cycle > 0) || !(l.end > 0)) return null;
  const parts: MusicPart[] = [{ from: 0, trim: l.trim ?? 0, dur: Math.max(1, Math.min(l.end, Math.ceil(head + xf - 1e-6))), fadeIn: null, fadeOut: null }];
  /** frame (pecahan) tempat file bagian sebelumnya habis */
  let prevEnd = head + xf;
  for (let k = 0; ; k++) {
    const s0 = head + k * cycle;
    if (s0 >= l.end) break;
    if (k >= MAX_MUSIC_PARTS) return null;
    const from = Math.ceil(s0 - 1e-6);
    const fileEnd = s0 + cycle + xf;
    const end = Math.min(l.end, Math.ceil(fileEnd - 1e-6));
    if (end <= from) break;
    // crossfade: dari frame pertama bagian baru sampai file bagian lama habis (minimal 1 frame)
    const fade: [number, number] = [from, Math.max(from + 1, prevEnd)];
    parts[parts.length - 1].fadeOut = fade;
    parts.push({ from, trim: Math.max(0, from - s0), dur: end - from, fadeIn: fade, fadeOut: null });
    prevEnd = fileEnd;
  }
  return parts;
}
/** gain crossfade bagian musik di frame video f (diukur di tengah frame) */
export function musicPartGain(p: Pick<MusicPart, "fadeIn" | "fadeOut">, f: number): number {
  const c = f + 0.5;
  const ramp = (w: [number, number]) => clamp01((c - w[0]) / Math.max(1e-6, w[1] - w[0]));
  return (p.fadeIn ? ramp(p.fadeIn) : 1) * (p.fadeOut ? 1 - ramp(p.fadeOut) : 1);
}

/** musik file dengan offset: sisa lagu dari detik ke-offset, lalu diulang dari awal (bukan potongan sisa yang diulang terus) */
function MusicOffset({ l, src, pre }: { l: Loop; src: string; pre: number }) {
  const parts = musicParts(l);
  if (!parts) {
    // cadangan (lagu sangat pendek): loop biasa sesudah putaran pertama, tanpa crossfade
    const head = Math.max(1, Math.round(l.head ?? 1));
    return (
      <>
        <Audio src={src} trimBefore={l.trim} durationInFrames={Math.max(1, Math.min(l.end, head))} volume={(f) => at(l.vol, f)} name={l.name} />
        {head < l.end && <Audio src={src} from={head} premountFor={pre} loop loopVolumeCurveBehavior="extend" volume={(f) => at(l.vol, head + f)} name={`${l.name} · diulang`} />}
      </>
    );
  }
  return (
    <>
      {parts.map((p, k) => (
        <Audio
          key={k}
          src={src}
          from={p.from}
          durationInFrames={p.dur}
          trimBefore={p.trim > 1e-9 ? p.trim : undefined}
          premountFor={k ? pre : undefined}
          volume={(f) => at(l.vol, p.from + f) * musicPartGain(p, p.from + f)}
          name={k ? `${l.name} · diulang ${k}` : l.name}
        />
      ))}
    </>
  );
}

/** semua suara video (VO, SFX, musik) */
export function StudioAudio({ tl, audio = "all", sfxExtra }: { tl: Timeline; audio?: AudioMode; sfxExtra?: SfxMeta[] }) {
  const { fps, durationInFrames } = useVideoConfig();
  const res = useSrc();
  const plan = useMemo(() => planAudio(tl, audio, sfxExtra ?? [], fps, durationInFrames), [tl, audio, sfxExtra, fps, durationInFrames]);
  const pre = Math.round(fps);
  return (
    <>
      {plan.loops.map((l) =>
        l.trim && l.head ? (
          <Sequence key={l.key} from={0} durationInFrames={Math.max(1, l.end)} layout="none" name={l.name}>
            <MusicOffset l={l} src={res(l.src)} pre={pre} />
          </Sequence>
        ) : (
          <Sequence key={l.key} from={0} durationInFrames={Math.max(1, l.end)} layout="none" name={l.name}>
            <Audio src={res(l.src)} loop durationInFrames={l.loopFrames} loopVolumeCurveBehavior="extend" volume={(f) => at(l.vol, f)} name={l.name} />
          </Sequence>
        ),
      )}
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
