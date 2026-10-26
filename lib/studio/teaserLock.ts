/**
 * Kunci adegan premium teaser (layout "teaser", buatan tangan di components/remotion/studio/teaser).
 * Aman dipakai di server & browser: route chat (mergeRevision → salinan DB), Studio Pro (rencana Harley, editor rencana & timeline).
 */
import { teaserTimelineRaw } from "./teaser";
import { FORMATS, MAX_DUR, MAX_TOTAL, MIN_DUR, nearestBeat, sceneStartSecs, snapScenesToBeats, totalSec, type Ratio, type Scene, type SfxCue, type TeaserShot, type Timeline } from "./timeline";

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

/**
 * Ukuran huruf Caption (px) persis seperti di file shot: team.tsx `size={78}`, montage.tsx `size={112}`, train.tsx tanpa size
 * (kit: portrait 92 / lainnya 78; portrait = H > W·1,2 seperti StudioVideo).
 */
const CAPTION_SIZE: Partial<Record<TeaserShot, (portrait: boolean) => number>> = { chat: () => 78, montage: () => 112, trainAi: (p) => (p ? 92 : 78) };

/** muat teks layar shot teaser yang bisa diubah: baris yang tampil, ukuran huruf, dan lebar kotak aman (px, kamera adegan teaser "none") */
export type CaptionFit = { lines: number; size: number; maxW: number };
export function teaserCaptionFit(s: Pick<Scene, "layout">, ratio: Ratio): CaptionFit | null {
  const lines = teaserTextLines(s);
  if (!lines) return null;
  const f = FORMATS[ratio] ?? FORMATS["9:16"];
  const size = CAPTION_SIZE[s.layout.shot ?? "hook"]?.(f.h > f.w * 1.2) ?? 78;
  return { lines, size, maxW: f.w - f.safe.left - f.safe.right };
}

/**
 * Lebar satu baris Caption (px) seperti digambar kit: maks 6 kata (sixWords), tiap kata inline-block berjarak 0,24em,
 * letter-spacing -0,035em per huruf. `measure` = lebar kata di font tebal 800 ukuran itu (canvas measureText = sama dengan DOM).
 * Lebih lebar dari `maxW` → Caption turun ke baris berikut dan menabrak UI animasi.
 */
export function captionLineWidth(line: string, size: number, measure: (word: string) => number): number {
  const words = line.split(/\s+/).filter(Boolean).slice(0, 6);
  if (!words.length) return 0;
  return words.reduce((a, w) => a + measure(w) - 0.035 * size * [...w].length, 0) + (words.length - 1) * size * 0.24;
}
/**
 * cadangan tanpa canvas / font belum termuat (pengukur utama = canvas measureText di SceneCard): rata-rata huruf Plus Jakarta
 * Sans 800 ±0,55em (teks bawaan chat "Satu tempat, real-time" 78px: asli 837 px, perkiraan 841 px, kotak 866 px)
 */
export const roughWordWidth = (size: number) => (w: string) => [...w].length * size * 0.55;
/** perkiraan huruf maks per baris untuk petunjuk (rata-rata ±0,5em per huruf termasuk spasi; ukuran sebenarnya dicek lewat lebar) */
export const captionMaxChars = (fit: CaptionFit) => Math.floor(fit.maxW / (fit.size * 0.5));

/**
 * Teks VO diubah → ejaan untuk mesin suara (`vo.spell`) ikut disesuaikan supaya suara tidak membaca kalimat lama.
 * Kalau jumlah kata ejaan = jumlah kata teks lama (pemetaan kata ke kata), kata yang tidak berubah memakai ejaannya, kata baru
 * memakai teks barunya. Kalau tidak bisa dipetakan, ejaan dikosongkan (mesin suara membaca teks VO).
 */
export function carrySpell(oldText: string, spell: string | undefined, newText: string): { spell: string | undefined; status: "same" | "carried" | "cleared" } {
  if (!spell?.trim() || oldText === newText) return { spell, status: "same" };
  const toks = (t: string) => t.split(/\s+/).filter(Boolean);
  const a = toks(oldText);
  const sp = toks(spell);
  const b = toks(newText);
  if (!b.length || a.length !== sp.length) return { spell: undefined, status: "cleared" };
  // LCS kata teks lama ↔ teks baru
  const n = a.length;
  const m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (j < m) {
    if (i < n && a[i] === b[j]) {
      out.push(sp[i]);
      i++;
      j++;
    } else if (i < n && L[i + 1][j] >= L[i][j + 1]) i++;
    else out.push(b[j++]);
  }
  const next = out.join(" ");
  return { spell: next === b.join(" ") ? undefined : next, status: "carried" };
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

/** detik mulai VO (`vo.at`, dari naskah) — ikut dikunci */
const voAtOf = (vo: Scene["vo"]): number | undefined => (typeof vo?.at === "number" ? vo.at : undefined);

/** detik mulai VO bawaan tiap shot (kolom voAt naskah di lib/studio/teaser.ts) */
let canonAt: Map<TeaserShot, number> | null = null;
export function teaserVoAt(shot: TeaserShot | undefined): number | undefined {
  if (!canonAt) {
    canonAt = new Map();
    const scenes = (teaserTimelineRaw().scenes ?? []) as { layout: { shot: TeaserShot }; vo?: { at?: unknown } | null }[];
    for (const s of scenes) if (typeof s.vo?.at === "number") canonAt.set(s.layout.shot, s.vo.at);
  }
  return canonAt.get(shot ?? "hook");
}

/**
 * Adegan premium teaser: batasnya di ketukan musik (0,6 dtk) & visualnya buatan tangan, jadi durasi, jenis tampilan (kind + shot),
 * latar, kamera, catatan visual, detik mulai VO, dan teks layar shot yang teksnya bagian dari animasi TIDAK boleh berubah — baik
 * lewat editor rencana/timeline (tombol "Pas-kan ke ketukan", tarik tepi blok) maupun lewat revisi Harley (mergeRevision).
 * Teks VO, SFX, transisi & level musik tetap bebas. VO yang lebih panjang dari adegan teaser TIDAK memanjangkan adegan
 * (grid ketukan harus utuh) — VoPanel hanya menampilkan peringatan.
 * Adegan dicocokkan lewat id; adegan teaser yang id-nya ditulis ulang (id lama hilang) dicocokkan lewat shot-nya, lalu sisanya
 * (id ditulis ulang DAN shot hilang/berubah — normalizeTimeline mengisi shot "hook") dipasangkan berurutan dengan adegan teaser
 * lama yang belum punya pasangan.
 */
export function keepTeaserVisual(prev: Timeline | null, next: Timeline): Timeline {
  if (!prev || prev === next) return next;
  const olds = prev.scenes.filter(isTeaserScene);
  if (!olds.length) return next;
  const pairs = teaserPairs(olds, next.scenes);
  let changed = false;
  const scenes = next.scenes.map((s, i) => {
    const o = pairs[i];
    if (!o) return s;
    const id = o.id;
    const textLocked = !TEASER_TEXT_LINES[o.layout.shot ?? "hook"];
    // adegan lama tanpa vo.at (proyek tersimpan sebelum ada offset naskah, atau teks VO sempat dikosongkan) → detik naskah shot itu
    const oldAt = voAtOf(o.vo) ?? teaserVoAt(o.layout.shot);
    const vo = s.vo && oldAt !== undefined && voAtOf(s.vo) !== oldAt ? { ...s.vo, at: oldAt } : s.vo;
    const text = textLocked ? o.text : s.text;
    if (id === s.id && s.dur === o.dur && s.layout === o.layout && s.bg === o.bg && s.camera === o.camera && s.visual === o.visual && vo === s.vo && text === s.text) return s;
    changed = true;
    return { ...s, id, dur: o.dur, layout: o.layout, bg: o.bg, camera: o.camera, visual: o.visual, vo, text };
  });
  return changed ? { ...next, scenes } : next;
}

/** pasangan adegan lama (teaser) untuk tiap adegan baru: 1) id sama, 2) shot sama (id lama hilang), 3) berurutan (adegan teaser sisa) */
function teaserPairs(olds: Scene[], scenes: Scene[]): (Scene | undefined)[] {
  const byId = new Map(olds.map((s) => [s.id, s] as const));
  const used = new Set<string>();
  const pairs = scenes.map((s) => {
    const o = byId.get(s.id);
    if (o) used.add(o.id);
    return o;
  });
  // id lama sudah tidak ada di versi baru → adegan teaser lama itu bisa jadi adegan yang id-nya ditulis ulang
  const ids = new Set(scenes.map((s) => s.id));
  const rest = () => olds.filter((o) => !used.has(o.id) && !ids.has(o.id));
  for (const [i, s] of scenes.entries()) {
    if (pairs[i] || !isTeaserScene(s)) continue;
    const c = rest().find((o) => o.layout.shot === (s.layout.shot ?? "hook"));
    if (c) {
      pairs[i] = c;
      used.add(c.id);
    }
  }
  const left = rest();
  for (const [i, s] of scenes.entries()) {
    if (!left.length) break;
    if (pairs[i] || !isTeaserScene(s)) continue;
    const c = left.shift()!;
    pairs[i] = c;
    used.add(c.id);
  }
  return pairs;
}

/** id adegan yang tidak punya pasangan adegan lama sama sekali (bukan lewat id, shot, maupun urutan) — adegan baru */
export function unpairedScenes(prev: Timeline | null, next: Pick<Timeline, "scenes">): Set<string> {
  const olds = prev?.scenes.filter(isTeaserScene) ?? [];
  const prevIds = new Set(prev?.scenes.map((s) => s.id) ?? []);
  const pairs = teaserPairs(olds, next.scenes);
  return new Set(next.scenes.filter((s, i) => !pairs[i] && !prevIds.has(s.id)).map((s) => s.id));
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
    const cand = grid.filter(ok);
    // ketukan terdekat dari `t` yang sah & tidak lebih jauh dari maxShift (null kalau tidak ada — jangan pakai nearestBeat([]) = t)
    const pick = (t: number) => {
      if (!cand.length) return null;
      const b = nearestBeat(t, cand);
      return Math.abs(b - t) <= maxShift + 1e-6 ? b : null;
    };
    // 1) posisi semula (digeser adegan teaser sebelumnya) — total & susunan tetap; 2) awal sebenarnya + durasi semula — kalau
    // batas sebelumnya sudah ditempel ke ketukan lain, ini sering masih bisa pas tanpa memanjangkan total
    const target = acc + shift;
    const a = fr(target);
    const b = pick(target) ?? pick(prev + s.dur);
    bounds.push(b ?? (ok(a) ? a : Math.min(hi, fr(prev + Math.min(MAX_DUR, Math.max(MIN_DUR, s.dur))))));
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
