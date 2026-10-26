/**
 * Kunci adegan premium teaser (layout "teaser", buatan tangan di components/remotion/studio/teaser).
 * Aman dipakai di server & browser: route chat (mergeRevision → salinan DB), Studio Pro (rencana Harley, editor rencana & timeline).
 */
import { teaserTimelineRaw } from "./teaser";
import { MAX_DUR, MAX_TOTAL, MIN_DUR, nearestBeat, sceneStartSecs, snapScenesToBeats, totalSec, type Scene, type SfxCue, type TeaserShot, type Timeline } from "./timeline";

/** adegan premium teaser (layout "teaser") */
export const isTeaserScene = (s: Pick<Scene, "layout"> | null | undefined) => s?.layout?.kind === "teaser";

/**
 * Shot teaser yang teks layarnya benar-benar membaca `scene.text` (Caption dari useShot().text) → berapa baris yang tampil
 * (tiap baris maks 6 kata, lihat sixWords di kit). Shot lain menggambar teks layarnya sendiri sebagai bagian dari animasi.
 * Cek: team.tsx (chat, `text[0]`), train.tsx (trainAi, `lines={text}` → Caption maks 2 baris), montage.tsx (`text[0]`).
 */
export const TEASER_TEXT_LINES: Partial<Record<TeaserShot, number>> = { chat: 1, trainAi: 2, montage: 1 };

/** jumlah baris teks layar yang tampil di adegan teaser (0 = teks layar bagian dari animasi); null kalau bukan adegan teaser */
export function teaserTextLines(s: Pick<Scene, "layout">): number | null {
  if (!isTeaserScene(s)) return null;
  return TEASER_TEXT_LINES[s.layout.shot ?? "hook"] ?? 0;
}

/** SFX bawaan tiap shot (lib/studio/teaser.ts): detik pukulannya sinkron dengan gerakan di animasi */
let canon: Map<TeaserShot, { id: string; at: number }[]> | null = null;
function canonCues(shot: TeaserShot): { id: string; at: number }[] {
  if (!canon) {
    canon = new Map();
    const scenes = (teaserTimelineRaw().scenes ?? []) as { layout: { shot: TeaserShot }; sfx: SfxCue[] }[];
    for (const s of scenes) canon.set(s.layout.shot, s.sfx.map((c) => ({ id: c.id, at: c.at })));
  }
  return canon.get(shot) ?? [];
}

/** cue SFX bawaan adegan teaser (id + detik sama dengan cue sheet) → detiknya dikunci di editor (nyala/mati & hapus tetap boleh) */
export function isTeaserBeatCue(s: Pick<Scene, "layout">, c: Pick<SfxCue, "id" | "at">): boolean {
  if (!isTeaserScene(s)) return false;
  return canonCues(s.layout.shot ?? "hook").some((x) => x.id === c.id && Math.abs(x.at - c.at) < 0.005);
}

/** detik mulai VO (`vo.at`, dari naskah) kalau timeline menyimpannya — ikut dikunci, tanpa bergantung pada bentuk tipe Scene */
const voAtOf = (vo: Scene["vo"]): number | undefined => {
  const at = (vo as { at?: unknown } | null)?.at;
  return typeof at === "number" ? at : undefined;
};

/**
 * Adegan premium teaser: batasnya di ketukan musik (0,6 dtk) & visualnya buatan tangan, jadi durasi, jenis tampilan (kind + shot),
 * latar, kamera, catatan visual, detik mulai VO, dan teks layar shot yang teksnya bagian dari animasi TIDAK boleh berubah — baik
 * lewat editor rencana/timeline (tombol "Pas-kan ke ketukan", tarik tepi blok) maupun lewat revisi Harley (mergeRevision).
 * Teks VO, SFX, transisi & level musik tetap bebas. VO yang lebih panjang dari adegan (VoPanel) lewat jalur lain dan tetap boleh
 * memanjangkan adegan supaya suara tidak terpotong (versi lama itulah yang kemudian dipertahankan).
 * Adegan dicocokkan lewat id; adegan teaser yang id-nya ditulis ulang (id lama hilang) dicocokkan lewat shot-nya.
 */
export function keepTeaserVisual(prev: Timeline | null, next: Timeline): Timeline {
  if (!prev || prev === next) return next;
  const olds = prev.scenes.filter(isTeaserScene);
  if (!olds.length) return next;
  const byId = new Map(olds.map((s) => [s.id, s] as const));
  // cadangan: id ditulis ulang tapi shot sama (dan id lamanya sudah tidak ada di versi baru) → itu adegan yang sama
  const nextIds = new Set(next.scenes.map((s) => s.id));
  const byShot = new Map<TeaserShot, Scene>();
  for (const o of olds) if (!nextIds.has(o.id) && o.layout.shot && !byShot.has(o.layout.shot)) byShot.set(o.layout.shot, o);
  let changed = false;
  const used = new Set<string>();
  const scenes = next.scenes.map((s) => {
    let o = byId.get(s.id);
    if (!o && isTeaserScene(s) && s.layout.shot) {
      const c = byShot.get(s.layout.shot);
      if (c && !used.has(c.id)) o = c;
    }
    if (!o) return s;
    used.add(o.id);
    const id = byId.has(s.id) ? s.id : o.id;
    const textLocked = !TEASER_TEXT_LINES[o.layout.shot ?? "hook"];
    const oldAt = voAtOf(o.vo);
    const vo = s.vo && oldAt !== undefined && voAtOf(s.vo) !== oldAt ? ({ ...s.vo, at: oldAt } as Scene["vo"]) : s.vo;
    const text = textLocked ? o.text : s.text;
    if (id === s.id && s.dur === o.dur && s.layout === o.layout && s.bg === o.bg && s.camera === o.camera && s.visual === o.visual && vo === s.vo && text === s.text) return s;
    changed = true;
    return { ...s, id, dur: o.dur, layout: o.layout, bg: o.bg, camera: o.camera, visual: o.visual, vo, text };
  });
  return changed ? { ...next, scenes } : next;
}

/**
 * Perubahan dari editor yang HANYA menggeser durasi (id, urutan & isi adegan lain sama persis) dan ikut menggeser durasi
 * adegan teaser — itu tombol tempel ke ketukan lama (snapScenesToBeats) yang menganggap adegan teaser ikut bergeser.
 */
export function retimesTeaser(prev: Timeline | null, next: Timeline): boolean {
  if (!prev || prev === next || prev.scenes.length !== next.scenes.length) return false;
  const strip = (s: Scene) => JSON.stringify({ ...s, dur: 0 });
  let teaserMoved = false;
  for (let i = 0; i < next.scenes.length; i++) {
    const a = prev.scenes[i];
    const b = next.scenes[i];
    if (a.id !== b.id) return false;
    if (Math.abs(a.dur - b.dur) < 1e-6) continue;
    if (isTeaserScene(a)) teaserMoved = true;
    if (strip(a) !== strip(b)) return false;
  }
  return teaserMoved;
}

/**
 * Tempel batas adegan ke ketukan musik, tapi adegan premium teaser tidak digeser (durasinya tetap). Batas dihitung dari awal adegan
 * yang SEBENARNYA: adegan biasa sesudah adegan teaser ditempel ke ketukan terdekat dari posisinya setelah adegan teaser itu, jadi
 * hasilnya benar-benar di ketukan (bukan dihitung seolah adegan teaser ikut bergeser lalu dikembalikan).
 * Aturan lain sama dengan snapScenesToBeats: geser maks `maxShift`, durasi MIN_DUR..MAX_DUR, total tidak lebih panjang dari semula / MAX_TOTAL.
 */
export function snapAroundTeaser<T extends Pick<Timeline, "scenes" | "fps">>(tl: T, beats: number[], maxShift = 0.35): T {
  if (beats.length < 2) return tl;
  if (!tl.scenes.some(isTeaserScene)) return snapScenesToBeats(tl, beats, maxShift);
  const fps = tl.fps;
  const fr = (t: number) => Math.round(t * fps) / fps;
  const cap = Math.floor(Math.min(MAX_TOTAL, totalSec(tl)) * fps + 1e-6) / fps;
  const grid = beats.map(fr);
  const n = tl.scenes.length;
  // ruang minimal yang harus disisakan untuk adegan sesudah i: durasi teaser utuh + MIN_DUR per adegan biasa
  const restMin: number[] = new Array(n).fill(0);
  for (let i = n - 2; i >= 0; i--) {
    const s = tl.scenes[i + 1];
    restMin[i] = restMin[i + 1] + (isTeaserScene(s) ? s.dur : MIN_DUR);
  }
  const bounds = [0];
  let acc = 0; // batas asli (sebelum ditempel)
  let shift = 0; // geseran yang terbawa adegan teaser terakhir (batasnya tidak bisa ikut ditempel)
  tl.scenes.forEach((s, i) => {
    acc += s.dur;
    const prev = bounds[bounds.length - 1];
    if (isTeaserScene(s)) {
      const end = fr(prev + s.dur);
      bounds.push(end);
      shift = end - acc;
      return;
    }
    const hi = fr(cap - restMin[i]);
    const ok = (t: number) => t - prev >= MIN_DUR - 1e-6 && t - prev <= MAX_DUR + 1e-6 && t <= hi + 1e-6;
    const target = acc + shift;
    const a = fr(target);
    const b = nearestBeat(a, grid.filter(ok));
    bounds.push(ok(b) && Math.abs(b - target) <= maxShift + 1e-6 ? b : ok(a) ? a : Math.min(hi, fr(prev + Math.min(MAX_DUR, Math.max(MIN_DUR, s.dur)))));
  });
  const scenes = tl.scenes.map((s, i) => (isTeaserScene(s) ? s : { ...s, dur: fr(bounds[i + 1] - bounds[i]) }));
  if (scenes.some((s) => s.dur < MIN_DUR - 1e-6) || totalSec({ scenes }) > MAX_TOTAL + 1e-6) return tl;
  return scenes.every((s, i) => s.dur === tl.scenes[i].dur) ? tl : { ...tl, scenes };
}

/** ringkasan jujur posisi potongan terhadap ketukan: berapa batas adegan (akhir tiap adegan) yang pas di ketukan */
export type BeatReport = { cuts: number; onBeat: number; /** batas yang meleset di akhir adegan teaser (durasinya dikunci) */ offLocked: number; /** batas adegan biasa yang meleset (terlalu jauh dari ketukan) */ offFree: number };
export function beatReport(tl: Pick<Timeline, "scenes" | "fps">, beats: number[]): BeatReport {
  const r: BeatReport = { cuts: tl.scenes.length, onBeat: 0, offLocked: 0, offFree: 0 };
  if (beats.length < 2) return r;
  const st = sceneStartSecs(tl);
  const tol = 0.5 / tl.fps + 1e-6;
  tl.scenes.forEach((s, i) => {
    const end = i + 1 < st.length ? st[i + 1] : st[i] + Math.max(1, Math.round(s.dur * tl.fps)) / tl.fps;
    if (Math.abs(nearestBeat(end, beats) - end) <= tol) r.onBeat++;
    else if (isTeaserScene(s)) r.offLocked++;
    else r.offFree++;
  });
  return r;
}
