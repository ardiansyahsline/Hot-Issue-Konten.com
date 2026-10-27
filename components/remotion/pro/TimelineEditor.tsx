"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { planAudioLift, voGuardDb } from "@/components/remotion/studio/audio";
import { extraSfxOf, reloadStudioCatalog, useStudioCatalog } from "@/lib/studio/client";
import { sfxById, type SfxMeta } from "@/lib/studio/sfxMeta";
import {
  arrangeVo,
  beatGrid,
  cueDbView,
  cueGainFor,
  cueMaxDb,
  cueMinDb,
  dbOf,
  isLoudSfx,
  maxMusicOffset,
  musicCycleSec,
  musicFileBeats,
  musicHeadSec,
  musicOffsetOf,
  musicVolDb,
  MAX_DUR,
  MAX_TOTAL,
  MIN_DUR,
  nearestBeat,
  sceneStartSecs,
  totalFrames,
  totalSec,
  TAIL_SEC,
  VO_AT,
  VO_END_ROOM,
  voClashes,
  voCutoffs,
  voDbOf,
  voSpeechEnd,
  voStartOf,
  withMixDb,
  withSceneDb,
  withVoDb,
  type MixKey,
  type Scene,
  type Timeline,
  type VoLine,
} from "@/lib/studio/timeline";
import { beatReport, isLockedTeaser, isTeaserBeatCue, isTeaserScene, relockTeaser, snapAroundTeaser, teaserDur, teaserVoAt, type BeatReport } from "@/lib/studio/teaserLock";
import DbSlider, { fmtDb } from "./DbSlider";
import { UploadBtn } from "./fields";
import { isMusicFile, useMusicDur, withMusicOffset, withMusicSrc } from "./music";
import VoLineTools, { tempoBusy, useVoTempo } from "./VoLineTools";
import { fmtTempo, movedText } from "./VoPanel";

/** warna titik SFX per kategori (palet yang otomatis ikut mode terang) */
const CAT: Record<string, { dot: string; label: string }> = {
  whoosh: { dot: "bg-sky-400", label: "Whoosh" },
  transisi: { dot: "bg-sky-600", label: "Transisi" },
  ui: { dot: "bg-emerald-400", label: "Klik UI" },
  koin: { dot: "bg-amber-400", label: "Koin" },
  magic: { dot: "bg-violet-400", label: "Magis" },
  boom: { dot: "bg-red-500", label: "Boom" },
  braam: { dot: "bg-red-400", label: "Braam" },
  "bass-drop": { dot: "bg-orange-500", label: "Bass drop" },
  impact: { dot: "bg-orange-400", label: "Hantaman" },
  riser: { dot: "bg-indigo-400", label: "Riser" },
  glitch: { dot: "bg-blue-400", label: "Glitch" },
  "trailer-pulse": { dot: "bg-indigo-500", label: "Denyut" },
  ambience: { dot: "bg-zinc-400", label: "Suasana" },
  foley: { dot: "bg-amber-600", label: "Foley" },
};
const catOf = (c: string | undefined) => CAT[c ?? ""] ?? { dot: "bg-zinc-300", label: c || "Lainnya" };

/** samakan dengan komposisi (audio.tsx): trailer bed = 100 BPM */
const BED_BPM = 100;
const ZOOMS = [1, 1.6, 2.5, 4];
const MIN_PPS = 36;
const SNAP_PX = 10;
const LANE_GAP = 12;
const ROW = { ruler: 22, scene: 54, sfx: 44, vo: 28, music: 30 };
/** geser blok VO / titik SFX lewat keyboard & tombol: ±0,05 dtk (Shift ±0,25) */
const NUDGE = 0.05;
const NUDGE_BIG = 0.25;
/** riwayat urungkan (perubahan dari timeline ini) */
const UNDO_MAX = 30;
/** geseran slider / tombol yang sama berturut-turut (jeda < 1,5 dtk) = satu langkah urungkan */
const LIVE_MERGE_MS = 1500;
/** offset musik: geser 0,1 dtk (Shift 1 dtk) */
const OFF_STEP = 0.1;
const OFF_BIG = 1;
/** baris 🎚️ Volume terbuka / tertutup (per browser) */
const MIX_OPEN_KEY = "studio:mixOpen";

/** 2.5 -> "2,5" */
const fmt = (n: number, d = 1) => String(Number(n.toFixed(d))).replace(".", ",");
const clockLabel = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r1 = (n: number) => Math.round(n * 10) / 10;
/** 72.35 -> "1:12,4" (posisi di lagu) */
const songClock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")},${Math.floor(Math.round(t * 10) % 10)}`;

/**
 * perubahan dari luar yang hanya mengisi hasil deteksi ketukan (bpm / beats / lufs) musik yang sama → bukan perubahan user,
 * jadi riwayat urungkan timeline tidak dihapus (mis. "＋ Musik" lalu ketukannya terdeteksi laptop, tetap bisa diurungkan)
 */
function beatsOnly(a: Timeline, b: Timeline): boolean {
  if (a === b || a.music === b.music || a.music.src !== b.music.src) return false;
  const ka = Object.keys(a) as (keyof Timeline)[];
  if (ka.length !== Object.keys(b).length || ka.some((k) => k !== "music" && a[k] !== b[k])) return false;
  const strip = (m: Timeline["music"]) => JSON.stringify({ ...m, bpm: null, beats: null, lufs: null });
  return strip(a.music) === strip(b.music);
}

/** ketukan musik (detik) — sama dengan yang dipakai komposisi untuk menempel potongan */
export function musicBeats(tl: Pick<Timeline, "music">, until: number): number[] {
  const m = tl.music;
  if (!m || m.src === "none") return [];
  if (m.src === "bed") return beatGrid(BED_BPM, 0, until);
  // file musik: ketukan lagu digeser offset (lagu mulai dari detik ke-offset) — sama dengan audio.tsx
  return musicFileBeats(m, until, 2);
}

/**
 * ganti adegan; durasi berubah -> VO lengkap (.mp3 hasil worker) tidak sinkron lagi, jadi dilepas. Mulai VO & detik SFX yang lewat
 * ujung adegan yang diperpendek dijepit di StudioPro (clampToScenes di `change`).
 */
function withScenes(tl: Timeline, scenes: Scene[]): Timeline {
  const moved = scenes.some((s, i) => s.dur !== tl.scenes[i]?.dur);
  return { ...tl, scenes, vo: moved && tl.vo?.full ? { ...tl.vo, full: null } : tl.vo };
}

/** ganti mulai VO adegan `id` (baris VO hasil generate + offset adegan) tanpa membuat ulang suara; VO lengkap .mp3 dilepas */
function withVoAt(tl: Timeline, id: string, at: number): Timeline {
  if (!tl.vo) return tl;
  return {
    ...tl,
    scenes: tl.scenes.map((s) => (s.id === id && s.vo ? { ...s, vo: { ...s.vo, at } } : s)),
    vo: { ...tl.vo, full: null, lines: tl.vo.lines.map((l) => (l.sceneId === id ? { ...l, at } : l)) },
  };
}

/** laporan jujur tombol "Tempel ke ketukan": berapa potongan yang benar-benar di ketukan, dan kenapa sisanya tidak */
function snapNote(r: BeatReport, changed: boolean, locked: boolean): string {
  if (r.onBeat === r.cuts) return changed ? "🎯 Semua potongan adegan sudah nempel ke ketukan musik" : locked ? "🔒 Adegan premium teaser dikunci · semua potongan sudah pas di ketukan" : "Potongan sudah pas di ketukan";
  const why = [
    r.offLocked ? `${r.offLocked} di akhir adegan premium (durasinya dikunci, tidak ikut digeser)` : "",
    r.offFree ? `${r.offFree} di adegan biasa (ketukan terdekat lebih dari 0,35 dtk atau membuat video lebih panjang)` : "",
  ].filter(Boolean);
  return `${changed ? "🎯" : "⚠️"} ${r.onBeat} dari ${r.cuts} potongan pas di ketukan · ${r.cuts - r.onBeat} tidak: ${why.join(", ")}`;
}

type Drag = { id: string; x0: number; d0: number; dur: number; start: number; others: number; moved: boolean };
/** blok VO / titik SFX yang sedang ditekan: `can` = boleh digeser (sentuhan: hanya kalau sudah dipilih, supaya geser layar tetap bisa) */
type VoDrag = { id: string; x0: number; at0: number; at: number; max: number; can: boolean; moved: boolean };
type SfxDrag = { si: number; ci: number; x0: number; at0: number; at: number; start: number; dur: number; can: boolean; moved: boolean };
type MusicDrag = { x0: number; off0: number; off: number; max: number; can: boolean; moved: boolean };
/** yang sedang dibuka di bar bawah timeline: blok VO, titik SFX, volume adegan, musik, menu "＋ Musik", volume satu jalur */
type Picked =
  | { kind: "vo"; sceneId: string }
  | { kind: "sfx"; sceneId: string; ci: number; id: string }
  | { kind: "scene"; sceneId: string }
  | { kind: "music" }
  | { kind: "musicMenu" }
  | { kind: "lane"; lane: "voDb" | "sfxDb" };

/**
 * Timeline horizontal yang bisa diedit sendiri:
 * - blok adegan selebar durasinya (tarik tepi kanan untuk ubah durasi, nempel 0,1 dtk / ketukan musik); adegan premium teaser
 *   dikunci 🔒 kecuali kuncinya dibuka ("🔓 Buka kunci durasi", tersimpan di scene.unlocked)
 * - titik SFX: klik = pilih (nyala/mati, geser), tarik / panah ←→ = geser detiknya (cue.at); detik SFX bawaan teaser dikunci
 * - blok VO (bagian yang terdengar): klik = pilih, tarik / panah ←→ = geser mulainya (line.at & scene.vo.at, suara tidak dibuat
 *   ulang), merah kalau menabrak VO lain / terpotong di akhir video; bar VO: atur mulai, kecepatan kalimat (VoLineTools)
 * - 🪄 Susun otomatis (arrangeVo) & ↶ Urungkan (perubahan dari timeline ini, termasuk volume & musik)
 * - 🎚️ Volume (mixer): Musik / VO / SFX semua adegan (tl.mix), per adegan (klik blok adegan → scene.gain), per kalimat VO
 *   (bar VO → scene.vo.gainDb), per SFX (bar SFX → cue.gain). Slider dikirim berkala selama digeser → preview langsung terdengar
 * - jalur musik: "＋ Musik" (katalog / trailer bed / tanpa musik / upload) langsung diputar; blok musik digeser = bagian lagu
 *   yang diputar (tl.music.offset, nempel 0,1 dtk), ketukan ikut bergeser
 * Semua perubahan lewat `onChange` (changeEdit di StudioPro). Di HP: ketuk dulu untuk memilih, lalu geser.
 * `beatHint` = alasan ketukan musik belum ada (mis. laptop mati / lagi dideteksi), untuk tombol "Tempel ke ketukan".
 * `docKey` = id proyek: berganti → suara kalimat yang sedang dibuat ulang (kecepatan) untuk proyek lama dibatalkan.
 */
export default function TimelineEditor(p: {
  timeline: Timeline;
  onChange: (tl: Timeline) => void;
  selected: string | null;
  onSelect: (sceneId: string) => void;
  frame?: number;
  onSeek?: (frame: number) => void;
  beatHint?: string | null;
  docKey?: string | null;
  /** putar preview (dipakai setelah musik dipilih dari "＋ Musik") */
  onPlay?: () => void;
}) {
  const { timeline: tl, onChange, selected, onSelect, frame, onSeek, beatHint, docKey, onPlay } = p;
  const catalog = useStudioCatalog();
  const extra = useMemo<SfxMeta[]>(() => extraSfxOf(catalog), [catalog]);
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(360);
  const [zoom, setZoom] = useState(0);
  const [draft, setDraft] = useState<{ id: string; dur: number; snapped: boolean } | null>(null);
  const [voDraft, setVoDraft] = useState<{ id: string; at: number } | null>(null);
  const [sfxDraft, setSfxDraft] = useState<{ si: number; ci: number; at: number; snapped: boolean } | null>(null);
  const [pick, setPick] = useState<Picked | null>(null);
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const [askUnlock, setAskUnlock] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);
  const voDrag = useRef<VoDrag | null>(null);
  const sfxDrag = useRef<SfxDrag | null>(null);
  const musicDrag = useRef<MusicDrag | null>(null);
  const [musicDraft, setMusicDraft] = useState<number | null>(null);
  // baris 🎚️ Volume: terbuka di laptop, tertutup di HP (layar pendek) — pilihan user diingat per browser
  const [mixOpen, setMixOpen] = useState(() => {
    try {
      const v = localStorage.getItem(MIX_OPEN_KEY);
      if (v !== null) return v !== "0";
    } catch {
      /* mode privat: pakai bawaan */
    }
    return typeof window === "undefined" || window.matchMedia("(min-width: 640px)").matches;
  });
  const scrub = useRef(false);
  const tlRef = useRef(tl);
  tlRef.current = tl;

  // ---------------- urungkan: hanya perubahan yang dibuat dari timeline ini, selama tidak ada perubahan lain sesudahnya ----------------
  const hist = useRef<{ before: Timeline; after: Timeline | null }[]>([]);
  const pending = useRef<Timeline | null>(null);
  const undoing = useRef(false);
  /**
   * kontrol yang sedang digeser (slider / tombol ±, key sama, kiriman terakhir < LIVE_MERGE_MS): semua perubahan timeline
   * sesudahnya = satu langkah urungkan. Tidak bergantung urutan render — slider mengirim lewat timer, jadi di HP lambat beberapa
   * kiriman bisa sampai sebelum timeline baru tampil (dulu dianggap perubahan dari luar → riwayat urungkan terhapus).
   */
  const liveKey = useRef<{ key: string; t: number } | null>(null);
  const liveOn = () => !!liveKey.current && Date.now() - liveKey.current.t < LIVE_MERGE_MS;
  const [undoN, setUndoN] = useState(0);
  useEffect(() => {
    const h = hist.current;
    const top = h[h.length - 1];
    if (undoing.current) {
      undoing.current = false;
      if (top) top.after = tl;
    } else if (pending.current && tl !== pending.current) {
      h.push({ before: pending.current, after: tl });
      if (h.length > UNDO_MAX) h.shift();
      pending.current = null;
    } else if (top && tl !== top.after && liveOn()) {
      // kiriman berikutnya dari kontrol yang sama (masih digeser) → langkah urungkan yang sama
      top.after = tl;
    } else if (top && tl !== top.after) {
      // diubah dari luar (kartu rencana, suara, Harley) → riwayat dihapus; hasil deteksi ketukan musik yang sama tidak
      if (top.after && beatsOnly(top.after, tl)) top.after = tl;
      else hist.current = [];
    }
    setUndoN(hist.current.length);
  }, [tl]);
  /**
   * satu-satunya pintu perubahan dari timeline ini (dicatat untuk urungkan). `key` = kontrol yang sama (slider / tombol ±):
   * perubahan berturut-turut dengan key sama digabung jadi satu langkah urungkan
   */
  const commit = (next: Timeline, msg?: string, key?: string) => {
    if (next === tlRef.current) return;
    const lk = liveKey.current;
    const now = Date.now();
    // kontrol yang sama masih digeser → digabung (pending lama tetap = keadaan sebelum geseran); selain itu langkah baru
    if (!(key && lk?.key === key && now - lk.t < LIVE_MERGE_MS && (hist.current.length || pending.current))) pending.current = tlRef.current;
    liveKey.current = key ? { key, t: now } : null;
    onChange(next);
    if (msg) setNote(msg);
  };
  const undo = () => {
    const h = hist.current;
    const top = h[h.length - 1];
    if (!top || top.after !== tlRef.current) {
      hist.current = [];
      setUndoN(0);
      return;
    }
    h.pop();
    undoing.current = true;
    pending.current = null;
    liveKey.current = null;
    onChange(top.before);
    setNote("↶ Perubahan terakhir di timeline diurungkan");
  };

  // 🎚️ kecepatan per kalimat: job/permintaan dipegang di sini (per adegan), jadi menutup bar VO / pindah pilihan tidak memutusnya.
  // Selesai saat bar adegan itu tertutup → hasilnya dicatat di bawah timeline
  const tempo = useVoTempo(tl, (fn) => commit(fn(tlRef.current)), {
    docKey,
    onDone: (sid, msg) => {
      const pk = pickRef.current;
      if (pk?.kind === "vo" && pk.sceneId === sid) return;
      setNote(msg);
    },
  });

  // lebar area (supaya zoom 1 = seluruh video pas di layar)
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!note) return;
    // catatan panjang (laporan tempel ketukan) dibiarkan lebih lama supaya sempat dibaca
    const t = setTimeout(() => setNote(null), note.length > 60 ? 7000 : 3500);
    return () => clearTimeout(t);
  }, [note]);

  // adegan lain dipilih (kartu rencana / blok adegan) -> pilihan blok VO / titik SFX adegan lain ditutup
  useEffect(() => {
    setPick((pk) => (pk && "sceneId" in pk && selected && pk.sceneId !== selected ? null : pk));
    setAskUnlock(null);
  }, [selected]);
  const toggleMix = () =>
    setMixOpen((v) => {
      try {
        localStorage.setItem(MIX_OPEN_KEY, v ? "0" : "1");
      } catch {
        /* mode privat: abaikan */
      }
      return !v;
    });

  // durasi yang tampil = durasi asli, kecuali adegan yang sedang ditarik
  const scenes = useMemo(() => (draft ? tl.scenes.map((s) => (s.id === draft.id ? { ...s, dur: draft.dur } : s)) : tl.scenes), [tl.scenes, draft]);
  const fps = tl.fps || 30;
  const starts = useMemo(() => sceneStartSecs({ scenes, fps }), [scenes, fps]);
  const total = useMemo(() => totalFrames({ scenes, fps }) / fps, [scenes, fps]);
  // musik: panjang lagu (metadata browser) untuk batas offset; offset yang sedang digeser ikut menggeser ketukan
  const fileMusic = isMusicFile(tl.music?.src);
  const mDur = useMusicDur(tl.music?.src, tl.music?.dur);
  const offNow = musicOffsetOf(tl.music);
  // ketukan hanya bergantung pada musik & durasi (bukan seluruh timeline) → geser slider volume tidak menghitung / menggambar ulang ketukan
  const beatMusic = useMemo(() => (musicDraft !== null && mDur ? { ...tl.music, offset: musicDraft, dur: mDur } : tl.music), [tl.music, musicDraft, mDur]);
  const tlTotal = useMemo(() => totalFrames({ scenes: tl.scenes, fps }) / fps, [tl.scenes, fps]);
  const beatUntil = Math.max(total, tlTotal) + 2;
  const beats = useMemo(() => musicBeats({ music: beatMusic }, beatUntil), [beatMusic, beatUntil]);
  // zoom 1 = seluruh video pas di layar (sisa 24 px di kanan untuk pegangan blok terakhir)
  const pps = Math.max(MIN_PPS, (width - 24) / Math.max(1, total)) * ZOOMS[zoom];
  const inner = Math.max(width, Math.ceil(total * pps) + 24);

  // titik SFX (waktu global = awal adegan + at) + jalur supaya titik berdekatan tidak menumpuk
  const dots = useMemo(() => {
    const list = scenes.flatMap((s, si) =>
      s.sfx.map((c, ci) => {
        const at = sfxDraft && sfxDraft.si === si && sfxDraft.ci === ci ? sfxDraft.at : c.at;
        return { si, ci, cue: c, at, meta: sfxById(c.id, extra), t: starts[si] + at, locked: isTeaserBeatCue(s, c) };
      }),
    );
    list.sort((a, b) => a.t - b.t);
    const lastX = [-1e9, -1e9, -1e9];
    return list.map((d) => {
      const x = d.t * pps;
      let lane = lastX.findIndex((lx) => x - lx >= LANE_GAP);
      if (lane < 0) lane = lastX.indexOf(Math.min(...lastX));
      lastX[lane] = x;
      return { ...d, x, lane };
    });
  }, [scenes, starts, extra, pps, sfxDraft]);
  const cats = useMemo(() => [...new Set(dots.map((d) => d.meta?.cat ?? ""))], [dots]);

  const voOn = tl.voice?.mode !== "none" && !tl.muteVo;
  const voLines = useMemo(() => (voOn && tl.vo ? tl.vo.lines : []), [voOn, tl.vo]);
  const hasVoText = tl.scenes.some((s) => s.vo?.text);
  // VO yang numpuk / terpotong (ikut posisi yang sedang digeser) -> blok merah
  const voView = useMemo(() => {
    if (!voOn || !tl.vo) return null;
    const lines = voDraft ? tl.vo.lines.map((l) => (l.sceneId === voDraft.id ? { ...l, at: voDraft.at } : l)) : tl.vo.lines;
    return { scenes, fps, vo: { ...tl.vo, lines } };
  }, [voOn, tl.vo, voDraft, scenes, fps]);
  const clashes = useMemo(() => (voView ? voClashes(voView) : []), [voView]);
  const cuts = useMemo(() => (voView ? voCutoffs(voView) : []), [voView]);
  const red = useMemo(() => new Set([...clashes.flatMap((c) => [c.scene, c.next]), ...cuts.map((c) => c.scene)]), [clashes, cuts]);
  // total detik dua suara bersamaan (semua pasangan, bukan hanya tabrakan pertama per VO)
  const clashSec = clashes.reduce((a, c) => a + c.sec, 0);
  const canArrange = useMemo(() => (!voDraft && (clashes.length || cuts.length) ? arrangeVo(tl).moved.length > 0 : false), [tl, clashes, cuts, voDraft]);

  // playhead ikut terlihat saat video diputar
  const head = frame === undefined ? null : (frame / fps) * pps;
  useEffect(() => {
    const el = scroller.current;
    if (!el || head === null || drag.current || voDrag.current || sfxDrag.current || scrub.current) return;
    if (head < el.scrollLeft + 8 || head > el.scrollLeft + el.clientWidth - 24) el.scrollLeft = Math.max(0, head - 48);
  }, [head]);

  // ---------------- ubah durasi (tarik tepi kanan) ----------------
  const onHandleDown = (e: PointerEvent<HTMLDivElement>, i: number) => {
    e.stopPropagation();
    e.preventDefault();
    const s = tl.scenes[i];
    if (isLockedTeaser(s)) return; // adegan premium teaser: durasi dikunci di ketukan (kecuali kuncinya dibuka)
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: s.id, x0: e.clientX, d0: s.dur, dur: s.dur, start: starts[i], others: tl.scenes.reduce((a, x) => a + x.dur, 0) - s.dur, moved: false };
    setDraft({ id: s.id, dur: s.dur, snapped: false });
  };
  const onHandleMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x0;
    if (Math.abs(dx) > 2) d.moved = true;
    let dur = d.d0 + dx / pps;
    let snapped = false;
    if (beats.length) {
      const end = d.start + dur;
      const b = nearestBeat(end, beats);
      if (Math.abs(b - end) * pps <= SNAP_PX) {
        dur = b - d.start;
        snapped = true;
      }
    }
    if (!snapped) dur = Math.round(dur * 10) / 10;
    dur = Math.min(Math.max(dur, MIN_DUR), MAX_DUR, MAX_TOTAL - d.others);
    dur = Math.round(dur * fps) / fps;
    d.dur = dur;
    setDraft({ id: d.id, dur, snapped });
  };
  const endDrag = (doCommit: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (d && doCommit && d.moved && Math.abs(d.dur - d.d0) > 1e-6) {
      commit(withScenes(tl, tl.scenes.map((s) => (s.id === d.id ? { ...s, dur: d.dur } : s))));
    }
    setDraft(null);
  };
  /** keyboard di pegangan: panah kiri/kanan = ±0,1 dtk (Shift ±0,5) */
  const onHandleKey = (e: KeyboardEvent<HTMLDivElement>, i: number) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const s = tl.scenes[i];
    if (isLockedTeaser(s)) return;
    const step = (e.shiftKey ? 0.5 : 0.1) * (e.key === "ArrowRight" ? 1 : -1);
    const others = tl.scenes.reduce((a, x) => a + x.dur, 0) - s.dur;
    const dur = Math.round(Math.min(Math.max(s.dur + step, MIN_DUR), MAX_DUR, MAX_TOTAL - others) * fps) / fps;
    if (dur !== s.dur) commit(withScenes(tl, tl.scenes.map((x) => (x.id === s.id ? { ...x, dur } : x))));
  };

  // ---------------- lompat (klik / geser penggaris) ----------------
  const seekAt = (clientX: number, el: HTMLElement) => {
    if (!onSeek) return;
    const x = clientX - el.getBoundingClientRect().left;
    const t = Math.min(Math.max(0, x / pps), total);
    onSeek(Math.min(Math.round(t * fps), Math.max(0, Math.round(total * fps) - 1)));
  };
  const onRulerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    scrub.current = true;
    seekAt(e.clientX, e.currentTarget);
  };
  const onRulerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (scrub.current) seekAt(e.clientX, e.currentTarget);
  };

  // ---------------- blok VO: geser mulai ----------------
  const voMax = (s: Scene) => Math.max(0, r3(s.dur - VO_END_ROOM));
  /** catatan setelah VO digeser (menabrak / terpotong sudah tampil di peringatan merah & bar VO → tanpa catatan dobel) */
  const voMoveNote = (next: Timeline, id: string): string | undefined => {
    const i = next.scenes.findIndex((s) => s.id === id);
    const s = next.scenes[i];
    const line = next.vo?.lines.find((l) => l.sceneId === id);
    if (voClashes(next).some((c) => c.scene === i || c.next === i) || voCutoffs(next).some((c) => c.scene === i)) return undefined;
    return `🎙️ VO ${s.name} mulai ${fmt(voStartOf(s, line), 2)} dtk dari awal adegan`;
  };
  const setVoAt = (id: string, at: number) => {
    const s = tlRef.current.scenes.find((x) => x.id === id);
    if (!s) return;
    const a = r3(Math.min(Math.max(0, at), voMax(s)));
    const line = tlRef.current.vo?.lines.find((l) => l.sceneId === id);
    if (Math.abs(a - voStartOf(s, line)) < 5e-4) return;
    const next = withVoAt(tlRef.current, id, a);
    const msg = voMoveNote(next, id);
    if (!msg) setNote(null);
    commit(next, msg);
  };
  const onVoDown = (e: PointerEvent<HTMLDivElement>, s: Scene, l: VoLine) => {
    if (e.button !== undefined && e.button > 0) return;
    const picked = pick?.kind === "vo" && pick.sceneId === s.id;
    const can = e.pointerType !== "touch" || picked;
    if (can) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const at0 = voStartOf(s, l);
    voDrag.current = { id: s.id, x0: e.clientX, at0, at: at0, max: voMax(s), can, moved: false };
  };
  const onVoMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = voDrag.current;
    if (!d || !d.can) return;
    const dx = e.clientX - d.x0;
    if (!d.moved && Math.abs(dx) <= 3) return;
    d.moved = true;
    d.at = r3(Math.min(Math.max(0, Math.round((d.at0 + dx / pps) / NUDGE) * NUDGE), d.max));
    setVoDraft({ id: d.id, at: d.at });
  };
  const endVo = (ok: boolean) => {
    const d = voDrag.current;
    voDrag.current = null;
    setVoDraft(null);
    if (!d || !ok) return;
    if (!d.moved) {
      setPick({ kind: "vo", sceneId: d.id });
      return;
    }
    setPick({ kind: "vo", sceneId: d.id });
    setVoAt(d.id, d.at);
  };
  const onVoKey = (e: KeyboardEvent<HTMLDivElement>, s: Scene, l: VoLine) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setPick({ kind: "vo", sceneId: s.id });
    } else if (e.key === "Escape") setPick(null);
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      setPick({ kind: "vo", sceneId: s.id });
      setVoAt(s.id, voStartOf(s, l) + (e.shiftKey ? NUDGE_BIG : NUDGE) * (e.key === "ArrowRight" ? 1 : -1));
    }
  };
  const arrange = () => {
    const r = arrangeVo(tlRef.current);
    if (!r.moved.length)
      return setNote("Menggeser mulai VO tidak mengurangi suara yang numpuk (VO-nya lebih panjang dari ruangnya) — pilih kecepatan lebih cepat atau pendekkan teks VO.");
    commit(
      r.tl,
      `🪄 Disusun otomatis: ${movedText(r.tl, r.moved)}.${r.after > 1e-3 ? ` Suara numpuk berkurang ${fmt(r.before, 2)} → ${fmt(r.after, 2)} dtk, sisanya (blok merah) — pilih kecepatan lebih cepat atau pendekkan teks VO.` : " Sekarang tidak ada suara yang numpuk."}`,
    );
  };

  // ---------------- titik SFX: pilih, nyala/mati, geser ----------------
  const metaOf = (id: string) => sfxById(id, extra);
  const setSfxAt = (si: number, ci: number, at: number) => {
    const t = tlRef.current;
    const sc = t.scenes[si];
    const cue = sc?.sfx[ci];
    if (!cue) return;
    if (isTeaserBeatCue(sc, cue)) return setNote("🔒 Detik SFX ini dikunci (sinkron dengan gerakan animasi premium). Buka kunci durasi adegan ini untuk menggeser.");
    const a = r3(Math.min(Math.max(0, at), sc.dur));
    if (Math.abs(a - cue.at) < 5e-4) return;
    // maks 2 SFX keras berdekatan (±0,25 dtk) — lebih dari itu dibuang diam-diam saat dirapikan, jadi ditolak di sini
    if (isLoudSfx(metaOf(cue.id)) && sc.sfx.filter((c, k) => k !== ci && isLoudSfx(metaOf(c.id)) && Math.abs(c.at - a) < 0.25).length >= 2)
      return setNote("Tidak digeser: maks 2 SFX keras berdekatan (±0,25 dtk). Geser sedikit lebih jauh.");
    commit({ ...t, scenes: t.scenes.map((s, i) => (i === si ? { ...s, sfx: s.sfx.map((c, k) => (k === ci ? { ...c, at: a } : c)) } : s)) }, `🔊 ${cue.id} di ${fmt(a, 2)} dtk (${sc.name})`);
  };
  const toggleSfx = (si: number, ci: number) => {
    const t = tlRef.current;
    const sc = t.scenes[si];
    const cue = sc?.sfx[ci];
    if (!cue) return;
    commit({ ...t, scenes: t.scenes.map((s, i) => (i === si ? { ...s, sfx: s.sfx.map((c, k) => (k === ci ? { ...c, on: !c.on } : c)) } : s)) }, `${cue.on ? "🔇" : "🔊"} ${cue.id} ${cue.on ? "dimatikan" : "dinyalakan"} (${sc.name})`);
  };
  const pickSfx = (si: number, ci: number) => {
    const sc = tl.scenes[si];
    const cue = sc?.sfx[ci];
    if (cue) setPick({ kind: "sfx", sceneId: sc.id, ci, id: cue.id });
  };
  const onSfxDown = (e: PointerEvent<HTMLDivElement>, si: number, ci: number, locked: boolean) => {
    if (e.button !== undefined && e.button > 0) return;
    const sc = tl.scenes[si];
    const cue = sc?.sfx[ci];
    if (!cue) return;
    const picked = pick?.kind === "sfx" && pick.sceneId === sc.id && pick.ci === ci;
    const can = !locked && (e.pointerType !== "touch" || picked);
    if (can) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    sfxDrag.current = { si, ci, x0: e.clientX, at0: cue.at, at: cue.at, start: starts[si], dur: sc.dur, can, moved: false };
  };
  const onSfxMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = sfxDrag.current;
    if (!d || !d.can) return;
    const dx = e.clientX - d.x0;
    if (!d.moved && Math.abs(dx) <= 3) return;
    d.moved = true;
    let at = d.at0 + dx / pps;
    let snapped = false;
    if (beats.length) {
      const g = d.start + at;
      const b = nearestBeat(g, beats);
      if (Math.abs(b - g) * pps <= SNAP_PX) {
        at = b - d.start;
        snapped = true;
      }
    }
    if (!snapped) at = Math.round(at / NUDGE) * NUDGE;
    d.at = r3(Math.min(Math.max(0, at), d.dur));
    setSfxDraft({ si: d.si, ci: d.ci, at: d.at, snapped });
  };
  const endSfx = (ok: boolean) => {
    const d = sfxDrag.current;
    sfxDrag.current = null;
    setSfxDraft(null);
    if (!d || !ok) return;
    pickSfx(d.si, d.ci);
    if (d.moved) setSfxAt(d.si, d.ci, d.at);
  };
  const onSfxKey = (e: KeyboardEvent<HTMLDivElement>, si: number, ci: number) => {
    if (e.key === "Escape") return setPick(null);
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      return pickSfx(si, ci);
    }
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    pickSfx(si, ci);
    const cue = tl.scenes[si]?.sfx[ci];
    if (cue) setSfxAt(si, ci, cue.at + (e.shiftKey ? NUDGE_BIG : NUDGE) * (e.key === "ArrowRight" ? 1 : -1));
  };

  // ---------------- kunci durasi adegan teaser ----------------
  const unlock = (id: string) => {
    const t = tlRef.current;
    const s = t.scenes.find((x) => x.id === id);
    setAskUnlock(null);
    if (!s || !isLockedTeaser(s)) return;
    commit({ ...t, scenes: t.scenes.map((x) => (x.id === id ? { ...x, unlocked: true } : x)) }, `🔓 Kunci durasi ${s.name} dibuka — tarik tepi kanan bloknya / geser titik SFX`);
  };
  const relock = (id: string) => {
    const t = tlRef.current;
    const s = t.scenes.find((x) => x.id === id);
    if (!s || !isTeaserScene(s)) return;
    const { scene: back, sfxBack } = relockTeaser(s);
    const want = back.dur;
    const others = t.scenes.reduce((a, x) => a + x.dur, 0) - s.dur;
    if (others + want > MAX_TOTAL + 1e-6) return setNote(`Tidak bisa dikembalikan: total video jadi lewat ${MAX_TOTAL} dtk. Pendekkan adegan lain dulu.`);
    // detik SFX bawaan yang sempat digeser ikut kembali ke cue sheet (sinkron animasi, terkunci lagi) → pilihan titik SFX ditutup
    if (sfxBack && pick?.kind === "sfx" && pick.sceneId === id) setPick(null);
    const sfxMsg = sfxBack ? ` · ${sfxBack} detik SFX bawaan ikut dikembalikan` : "";
    commit(
      withScenes(t, t.scenes.map((x) => (x.id === id ? back : x))),
      Math.abs(want - s.dur) > 1e-6 ? `↺ Durasi ${s.name} kembali ${fmt(want, 2)} dtk & dikunci lagi${sfxMsg}` : `🔒 Durasi ${s.name} dikunci lagi${sfxMsg}`,
    );
  };

  const snapAll = () => {
    // adegan premium teaser yang masih dikunci tidak ikut digeser (animasinya sinkron dengan batas itu). Adegan biasa ditempel
    // dari awal yang sebenarnya (sesudah adegan teaser), jadi hasilnya benar-benar di ketukan
    const next = snapAroundTeaser(tl, beats);
    const changed = next.scenes.some((s, i) => Math.abs(s.dur - tl.scenes[i].dur) > 1e-6);
    // total lewat 3 menit -> adegan terakhir nanti dibuang diam-diam saat dirapikan, jadi ditolak
    if (changed && totalSec(next) > MAX_TOTAL + 1e-6) return setNote(`Tidak ditempel: total video jadi lewat ${MAX_TOTAL} dtk. Pendekkan adegan dulu.`);
    if (changed) commit(withScenes(tl, next.scenes));
    setNote(snapNote(beatReport(next, beats), changed, tl.scenes.some(isLockedTeaser)));
  };

  // ---------------- 🎚️ volume (mixer) ----------------
  const musicVol = musicVolDb(tl);
  // VO / musik / SFX dinaikkan → cek pengaman puncak (dihitung dari timeline tertunda supaya slider tetap ringan): VO yang sudah
  // hampir puncak tidak bisa lebih keras (musik & SFX ikut turun saat VO bicara); musik / SFX tidak dibuat lebih keras di bagian yang
  // sudah dekat puncak (mis. drop, saat VO bicara) → keterangan + kenaikan yang benar-benar terdengar
  const tlLazy = useDeferredValue(tl);
  const voOnLazy = tlLazy.voice?.mode !== "none" && !tlLazy.muteVo && !!tlLazy.vo?.lines.length;
  const voUp = voOnLazy && tlLazy.scenes.some((s) => s.vo?.text && voDbOf(tlLazy, s) > 0);
  const upLazy = (k: "musicDb" | "sfxDb") => (k === "musicDb" ? tlLazy.music.src !== "none" && musicVolDb(tlLazy) > 0 : dbOf(tlLazy.mix?.sfxDb) > 0) || tlLazy.scenes.some((s) => dbOf(s.gain?.[k]) > 0);
  const restUpLazy = upLazy("musicDb") || upLazy("sfxDb");
  const mixInfo = useMemo(() => {
    if (!voUp && !restUpLazy) return null;
    const f = tlLazy.fps || 30;
    return planAudioLift(tlLazy, "all", extra, f, Math.max(1, totalFrames({ scenes: tlLazy.scenes, fps: f }) + Math.round(TAIL_SEC * f)));
  }, [voUp, restUpLazy, tlLazy, extra]);
  const guardPlan = voUp ? (mixInfo?.plan ?? null) : null;
  const guardAll = guardPlan ? voGuardDb(guardPlan) : 0;
  const guardNote = (db: number) => `🛡️ VO sudah hampir paling keras — pengaman puncak menahannya ${fmtDb(db)} supaya tidak pecah; musik & SFX ikut turun saat VO bicara (VO tetap lebih menonjol).`;
  const voHeard = tl.voice?.mode !== "none" && !tl.muteVo && !!tl.vo?.lines.length;
  const restUp = (k: "musicDb" | "sfxDb") => (k === "musicDb" ? tl.music.src !== "none" && musicVol > 0 : dbOf(tl.mix?.sfxDb) > 0) || tl.scenes.some((s) => dbOf(s.gain?.[k]) > 0);
  /** jalur yang dinaikkan tapi terdengar naik ≥ 1 dB lebih kecil dari yang diminta (kenaikan nyata dari rencana audio) */
  const restLow = (k: "musicDb" | "sfxDb") => {
    const r = k === "musicDb" ? mixInfo?.music : mixInfo?.sfx;
    return restUp(k) && r && r.want > 0.5 && r.got < r.want - 1 ? r : null;
  };
  const restNote = (k?: "musicDb" | "sfxDb") => {
    const low = (k ? [k] : (["musicDb", "sfxDb"] as const)).flatMap((key) => {
      const r = restLow(key);
      return r ? [`${key === "musicDb" ? "Musik" : "SFX"} diminta ${fmtDb(r.want)}, rata-rata terdengar ${fmtDb(r.got)}`] : [];
    });
    return low.length ? (
      <p className="text-[11px] leading-snug text-sky-300" data-rest-guard>
        ℹ️ {low.join(" · ")}. Bagian yang sudah hampir paling keras ({voHeard ? "saat VO bicara, " : ""}mis. drop) tidak bisa lebih keras supaya tidak pecah — di situ yang lain dikecilkan supaya tetap menonjol.
      </p>
    ) : null;
  };
  const laneDb: Record<MixKey, number> = { musicDb: musicVol, voDb: dbOf(tl.mix?.voDb), sfxDb: dbOf(tl.mix?.sfxDb) };
  const setMix = (k: MixKey, db: number) => {
    const t = tlRef.current;
    if (db === (k === "musicDb" ? musicVolDb(t) : dbOf(t.mix?.[k]))) return;
    commit(withMixDb(t, k, db), undefined, `mix:${k}`);
  };
  const setSceneDb = (id: string, k: MixKey, db: number) => {
    const t = tlRef.current;
    const next = withSceneDb(t, id, k, db);
    if (next !== t) commit(next, undefined, `scene:${id}:${k}`);
  };
  const setLineDb = (id: string, db: number) => {
    const t = tlRef.current;
    const next = withVoDb(t, id, db);
    if (next !== t) commit(next, undefined, `vo:${id}`);
  };
  /** volume satu SFX: angka yang terdengar (cueDbView) → cue.gain */
  const setCueDb = (si: number, ci: number, db: number) => {
    const t = tlRef.current;
    const sc = t.scenes[si];
    const cue = sc?.sfx[ci];
    const m = cue ? metaOf(cue.id) : undefined;
    if (!cue || !m) return;
    const gain = cueGainFor(m, db);
    if (gain === cue.gain) return;
    const upd = (c: Scene["sfx"][number]) => {
      const { gain: _old, ...rest } = c;
      return gain === undefined ? rest : { ...rest, gain };
    };
    commit({ ...t, scenes: t.scenes.map((s, i) => (i === si ? { ...s, sfx: s.sfx.map((c, k) => (k === ci ? upd(c) : c)) } : s)) }, undefined, `cue:${sc.id}:${ci}`);
  };

  // ---------------- 🎵 musik: ganti (＋ Musik), geser bagian lagu (offset) ----------------
  const pickMusicSrc = (src: string, upload?: { name: string }) => {
    const t = tlRef.current;
    setPick({ kind: "music" });
    if (src === t.music.src && !upload) return;
    const next = withMusicSrc(t, src, catalog, upload);
    commit(next, src === "none" ? "🔇 Tanpa musik" : `🎵 Musik diganti: ${next.music.name ?? "musik"}`);
    // dipilih langsung (ketukan user) → preview diputar supaya musiknya langsung terdengar
    if (src !== "none" && !upload) onPlay?.();
  };
  const setMusicOffset = (off: number) => {
    const t = tlRef.current;
    if (!mDur || !isMusicFile(t.music.src)) return;
    const next = withMusicOffset(t, off, mDur);
    if (next.music.offset === musicOffsetOf(t.music) && t.music.dur === next.music.dur) return;
    commit(next, `🎵 Lagu mulai dari ${songClock(next.music.offset ?? 0)}`, "music:offset");
  };
  const onMusicDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== undefined && e.button > 0) return;
    const picked = pick?.kind === "music";
    const can = fileMusic && !!mDur && (e.pointerType !== "touch" || picked);
    if (can) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    musicDrag.current = { x0: e.clientX, off0: offNow, off: offNow, max: maxMusicOffset(mDur ?? 0), can, moved: false };
  };
  const onMusicMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = musicDrag.current;
    if (!d || !d.can) return;
    const dx = e.clientX - d.x0;
    if (!d.moved && Math.abs(dx) <= 3) return;
    d.moved = true;
    // blok digeser ke kiri = bagian lagu yang lebih akhir mulai di detik 0 video (nempel 0,1 dtk)
    d.off = r1(Math.min(d.max, Math.max(0, d.off0 - dx / pps)));
    setMusicDraft(d.off);
  };
  const endMusic = (ok: boolean) => {
    const d = musicDrag.current;
    musicDrag.current = null;
    setMusicDraft(null);
    if (!d || !ok) return;
    setPick({ kind: "music" });
    if (d.moved && Math.abs(d.off - d.off0) > 1e-6) setMusicOffset(d.off);
  };
  const onMusicKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setPick({ kind: "music" });
    } else if (e.key === "Escape") setPick(null);
    else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && fileMusic && mDur) {
      // panah = blok bergeser (kiri = bagian lagu lebih akhir)
      e.preventDefault();
      setPick({ kind: "music" });
      setMusicOffset(offNow + (e.shiftKey ? OFF_BIG : OFF_STEP) * (e.key === "ArrowLeft" ? 1 : -1));
    }
  };
  const musicName = tl.music.src === "none" ? "Tanpa musik" : tl.music.src === "bed" ? "Trailer bed (cadangan)" : tl.music.name || "Musik";
  const musicOff = musicDraft ?? offNow;
  /** detik video tempat lagu diulang dari awal (sisa lagu sesudah offset, lalu tiap panjang lagu; dengan offset: crossfade, musicHeadSec) */
  const musicSeams = useMemo(() => {
    if (!fileMusic || !mDur || mDur < 1) return [] as number[];
    const m = { src: tl.music.src, offset: musicOff, dur: mDur };
    const head = musicHeadSec(m) || mDur - Math.min(musicOff, mDur);
    const step = musicCycleSec(m) || mDur;
    const out: number[] = [];
    for (let t = head; t < total - 0.05 && out.length < 50; t += step) if (t > 0.05) out.push(t);
    return out;
  }, [fileMusic, mDur, musicOff, total, tl.music.src]);
  /** keadaan ketukan musik (deteksi di laptop lewat useBeats) */
  const beatState: { text: string; busy: boolean } | null = !fileMusic
    ? tl.music.src === "bed"
      ? { text: `🥁 Ketukan ${BED_BPM} BPM (ikut adegan otomatis)`, busy: false }
      : null
    : (tl.music.beats?.length ?? 0) >= 2
      ? { text: `🥁 ${tl.music.beats?.length} ketukan terdeteksi${tl.music.bpm ? ` · ±${Math.round(tl.music.bpm)} BPM` : ""}`, busy: false }
      : tl.music.bpm
        ? { text: `🥁 ±${Math.round(tl.music.bpm)} BPM`, busy: false }
        : !beatHint || /mendeteksi/i.test(beatHint)
          ? { text: "⏳ Mendeteksi ketukan…", busy: true }
          : { text: `⚠️ ${beatHint}`, busy: false };
  const catalogMusic = catalog?.music ?? [];
  const inCatalog = !fileMusic || catalogMusic.some((m) => m.src === tl.music.src);

  // penggaris: label tiap 1/2/5/10/… dtk, minimal 44 px antarlabel
  const step = [1, 2, 5, 10, 15, 30, 60].find((s) => s * pps >= 44) ?? 60;
  const ticks: number[] = [];
  for (let t = 0; t <= total + 1e-6; t += step) ticks.push(t);
  const beatStep = beats.length > 1 ? beats[1] - beats[0] : 0;
  const showBeats = beats.length > 1 && beatStep * pps >= 5;
  // tanda ketukan (penggaris & jalur musik): elemen yang sama dipakai ulang selama ketukan / zoom tidak berubah
  const beatMarks = useMemo(() => {
    if (!showBeats) return null;
    const vis = beats.filter((b) => b <= total + 0.01);
    return {
      ruler: vis.map((b, k) => <span key={`b${k}`} className="absolute bottom-0 h-1.5 w-px bg-orange-500/50" style={{ left: b * pps }} />),
      lane: vis.map((b, k) => <span key={`m${k}`} className="pointer-events-none absolute top-0 bottom-0 w-px bg-current opacity-30" style={{ left: b * pps }} data-music-beat />),
    };
  }, [showBeats, beats, total, pps]);
  const beatInfo = tl.music?.src === "none" ? null : tl.music?.src === "bed" ? `Trailer bed · ${BED_BPM} BPM` : tl.music?.beats?.length ? "Ketukan musik terdeteksi" : tl.music?.bpm ? `${Math.round(tl.music.bpm)} BPM` : null;
  const videoEnd = total + Math.round(TAIL_SEC * fps) / fps;

  // ---------------- bar edit untuk yang dipilih ----------------
  const pickVo = pick?.kind === "vo" ? (() => {
    const i = tl.scenes.findIndex((s) => s.id === pick.sceneId);
    const line = voLines.find((l) => l.sceneId === pick.sceneId);
    return i >= 0 && line ? { i, s: tl.scenes[i], line } : null;
  })() : null;
  const pickCue = pick?.kind === "sfx" ? (() => {
    const si = tl.scenes.findIndex((s) => s.id === pick.sceneId);
    const cue = tl.scenes[si]?.sfx[pick.ci];
    return cue && cue.id === pick.id ? { si, s: tl.scenes[si], ci: pick.ci, cue } : null;
  })() : null;
  // bar kunci durasi adegan teaser: adegan teaser dipilih & bar lain (VO / SFX / musik / jalur) tidak terbuka
  const selTeaser = (!pick || pick.kind === "scene") && selected ? tl.scenes.find((s) => s.id === selected && isTeaserScene(s)) ?? null : null;
  const pickScene = pick?.kind === "scene" ? (() => {
    const i = tl.scenes.findIndex((s) => s.id === pick.sceneId);
    return i >= 0 ? { i, s: tl.scenes[i] } : null;
  })() : null;
  const clashLabels = clashes.map((c) => `${scenes[c.scene]?.name} → ${scenes[c.next]?.name} (${fmt(Math.max(0.01, c.sec), 2)} dtk)`);

  let bar: ReactNode = null;
  if (pickVo) {
    const { i, s, line } = pickVo;
    const at = voStartOf(s, line);
    const speech = voSpeechEnd(line);
    const base = isTeaserScene(s) ? teaserVoAt(s.layout.shot) : VO_AT;
    const hit = clashes.find((c) => c.scene === i || c.next === i);
    const cut = cuts.find((c) => c.scene === i);
    bar = (
      <div className="space-y-2" data-tl-bar="vo">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold text-zinc-200">
            🎙️ VO · {i + 1}. {s.name}
          </span>
          <span className="text-[11px] text-zinc-500">
            ucapan {fmt(speech, 2)} dtk{line.tempo !== undefined ? ` · kecepatan ${fmtTempo(line.tempo)}` : line.speed ? ` · dipercepat ${line.speed}%` : ""}
          </span>
          <button type="button" className="ml-auto h-7 w-7 rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300" aria-label="Tutup bar VO" onClick={() => setPick(null)}>
            ✕
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11.5px] font-semibold text-zinc-300">⏱️ Mulai</span>
          <button type="button" className="btn-ghost h-8 w-8 p-0" aria-label={`Mulai VO ${s.name} 0,05 detik lebih awal`} disabled={at <= 0} onClick={() => setVoAt(s.id, at - NUDGE)}>
            −
          </button>
          <span className="min-w-[64px] text-center text-[12.5px] tabular-nums text-zinc-100" data-vo-at>
            {fmt(at, 2)} dtk
          </span>
          <button type="button" className="btn-ghost h-8 w-8 p-0" aria-label={`Mulai VO ${s.name} 0,05 detik lebih lambat`} disabled={at >= voMax(s) - 1e-6} onClick={() => setVoAt(s.id, at + NUDGE)}>
            +
          </button>
          <span className="text-[11px] text-zinc-500">dari awal adegan</span>
          {base !== undefined && Math.abs(base - at) > 5e-4 && (
            <button type="button" className="text-[11.5px] font-semibold text-orange-400 hover:text-orange-300" onClick={() => setVoAt(s.id, base)}>
              ↺ {isTeaserScene(s) ? "Waktu naskah" : "Bawaan"} ({fmt(base, 2)})
            </button>
          )}
        </div>
        <DbSlider
          icon="🔊"
          label="Volume"
          value={dbOf(s.vo?.gainDb)}
          onChange={(db) => setLineDb(s.id, db)}
          testId="vo-line"
          note={dbOf(tl.mix?.voDb) || dbOf(s.gain?.voDb) ? `Kalimat ini · total VO adegan ${fmtDb(voDbOf(tl, s))} (ikut 🎚️ VO${dbOf(s.gain?.voDb) ? " & volume adegan" : ""})` : "Volume kalimat ini saja · suara tidak dibuat ulang"}
        />
        {guardPlan && voDbOf(tl, s) > 0 && voGuardDb(guardPlan, s.id) <= -1 && (
          <p className="text-[11px] leading-snug text-amber-300" data-vo-guard>
            {guardNote(voGuardDb(guardPlan, s.id))}
          </p>
        )}
        {hit ? (
          <p className="text-[11.5px] text-red-400" data-vo-bar-clash>
            ⛔ Menabrak VO {hit.scene === i ? `${scenes[hit.next]?.name} sesudahnya` : `${scenes[hit.scene]?.name} sebelumnya`} — geser mulainya, pilih kecepatan lebih cepat, atau 🪄 Susun otomatis.
          </p>
        ) : cut ? (
          <p className="text-[11.5px] text-red-400" data-vo-bar-clash>
            ⛔ Ujungnya terpotong di akhir video ({fmt(cut.sec, 2)} dtk) — geser lebih awal atau pilih lebih cepat.
          </p>
        ) : (
          <p className="text-[11px] text-zinc-500">Tarik bloknya atau pakai panah ←/→ (Shift = 0,25 dtk). Suara tidak dibuat ulang.</p>
        )}
        <VoLineTools key={s.id} scene={s} timeline={tl} tools={tempo} />
      </div>
    );
  } else if (pickCue) {
    const { si, s, ci, cue } = pickCue;
    const locked = isTeaserBeatCue(s, cue);
    const meta = metaOf(cue.id);
    bar = (
      <div className="space-y-2" data-tl-bar="sfx">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`h-2.5 w-2.5 flex-none rounded-full ${catOf(meta?.cat).dot}`} />
          <span className="min-w-0 truncate font-semibold text-zinc-200">{cue.id}</span>
          <span className="text-[11px] text-zinc-500">
            {si + 1}. {s.name}
          </span>
          <button type="button" className="ml-auto h-7 w-7 rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300" aria-label="Tutup bar SFX" onClick={() => setPick(null)}>
            ✕
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11.5px] font-semibold text-zinc-300">{locked ? "🔒" : "⏱️"} Detik</span>
          <button type="button" className="btn-ghost h-8 w-8 p-0" aria-label={`Geser ${cue.id} 0,05 detik lebih awal`} disabled={locked || cue.at <= 0} onClick={() => setSfxAt(si, ci, cue.at - NUDGE)}>
            −
          </button>
          <span className="min-w-[64px] text-center text-[12.5px] tabular-nums text-zinc-100" data-sfx-at>
            {fmt(cue.at, 2)} dtk
          </span>
          <button type="button" className="btn-ghost h-8 w-8 p-0" aria-label={`Geser ${cue.id} 0,05 detik lebih lambat`} disabled={locked || cue.at >= s.dur - 1e-6} onClick={() => setSfxAt(si, ci, cue.at + NUDGE)}>
            +
          </button>
          <button type="button" className="btn-ghost px-2.5 py-1.5 text-[12px]" onClick={() => toggleSfx(si, ci)} data-sfx-toggle>
            {cue.on ? "🔇 Matikan" : "🔊 Nyalakan"}
          </button>
        </div>
        {meta && (
          <DbSlider
            icon="🔊"
            label="Volume"
            value={cueDbView(meta, cue.gain)}
            min={cueMinDb(meta)}
            max={cueMaxDb(meta)}
            onChange={(db) => setCueDb(si, ci, db)}
            testId="sfx-cue"
            note={cueMaxDb(meta) < 6 ? `Maks ${fmtDb(cueMaxDb(meta))} untuk file ini (puncaknya sudah tinggi) — lebih keras: naikkan 🎚️ SFX` : null}
          />
        )}
        <p className="text-[11px] text-zinc-500">
          {locked
            ? "🔒 Detiknya dikunci — sinkron dengan gerakan animasi premium. Buka kunci durasi adegan ini (klik blok adegannya) untuk menggeser."
            : `Tarik titiknya atau pakai panah ←/→ (nempel ke ketukan musik).${meta?.use ? ` ${meta.use}` : ""}`}
        </p>
      </div>
    );
  } else if (pick?.kind === "music") {
    bar = (
      <div className="space-y-2" data-tl-bar="music">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 truncate font-semibold text-zinc-200">
            {tl.music.src === "bed" ? "🥁" : tl.music.src === "none" ? "🔇" : "🎵"} {musicName}
          </span>
          {beatState && (
            <span className={`text-[11px] ${beatState.busy ? "animate-pulse text-violet-300" : "text-zinc-500"}`} data-music-beats>
              {beatState.text}
            </span>
          )}
          <button type="button" className="ml-auto h-7 w-7 rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300" aria-label="Tutup bar musik" onClick={() => setPick(null)}>
            ✕
          </button>
        </div>
        {fileMusic && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11.5px] font-semibold text-zinc-300">⏱️ Mulai lagu dari</span>
            <button type="button" className="btn-ghost h-8 w-8 p-0" aria-label="Mulai lagu 0,1 detik lebih awal" disabled={!mDur || offNow <= 0} onClick={() => setMusicOffset(offNow - OFF_STEP)}>
              −
            </button>
            <span className="min-w-[64px] text-center text-[12.5px] tabular-nums text-zinc-100" data-music-offset>
              {songClock(musicOff)}
            </span>
            <button type="button" className="btn-ghost h-8 w-8 p-0" aria-label="Mulai lagu 0,1 detik lebih akhir" disabled={!mDur || offNow >= maxMusicOffset(mDur) - 1e-6} onClick={() => setMusicOffset(offNow + OFF_STEP)}>
              +
            </button>
            {offNow > 0 && (
              <button type="button" className="text-[11.5px] font-semibold text-orange-400 hover:text-orange-300" onClick={() => setMusicOffset(0)}>
                ↺ Dari awal lagu
              </button>
            )}
            {mDur && <span className="text-[11px] text-zinc-500">· panjang lagu {songClock(mDur)}</span>}
          </div>
        )}
        {musicSeams.length > 0 && (
          <p className="text-[11px] leading-snug text-orange-300" data-music-loop-note>
            ↺ Lagu habis di detik {fmt(musicSeams[0], 1)} video, lalu diulang dari awal lagu (garis putus-putus di blok 🎵).
          </p>
        )}
        {tl.music.src !== "none" && <DbSlider icon="🎵" label="Musik" value={musicVol} onChange={(db) => setMix("musicDb", db)} testId="music-bar" />}
        {restNote("musicDb")}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-ghost px-2.5 py-1.5 text-[12px]" onClick={() => setPick({ kind: "musicMenu" })} data-music-change>
            🔁 Ganti musik
          </button>
          <span className="text-[11px] text-zinc-500">
            {fileMusic
              ? mDur
                ? "Geser blok 🎵 ke kiri / kanan untuk pilih bagian lagu (nempel 0,1 dtk) — ketukan ikut bergeser."
                : "Membaca panjang lagu…"
              : tl.music.src === "bed"
                ? "Trailer bed otomatis ikut level musik tiap adegan."
                : "Video tanpa musik."}
          </span>
        </div>
      </div>
    );
  } else if (pick?.kind === "musicMenu") {
    const chip = (on: boolean) =>
      `inline-flex min-h-[34px] max-w-full items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition ${
        on ? "border-orange-500 bg-orange-500/10 text-orange-300" : "border-zinc-700 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800"
      }`;
    bar = (
      <div className="space-y-2" data-tl-bar="music-menu">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-zinc-200">＋ Musik</span>
          <span className="min-w-0 truncate text-[11px] text-zinc-500">pilih → langsung diputar di preview</span>
          <button type="button" className="ml-auto h-7 w-7 flex-none rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300" aria-label="Tutup menu musik" onClick={() => setPick(null)}>
            ✕
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Pilih musik">
          {catalogMusic.map((m) => (
            <button key={m.src} type="button" className={chip(tl.music.src === m.src)} aria-pressed={tl.music.src === m.src} onClick={() => pickMusicSrc(m.src)} data-music-opt={m.src}>
              🎵 <span className="max-w-[220px] truncate">{m.name}</span>
            </button>
          ))}
          {!inCatalog && (
            <button type="button" className={chip(true)} aria-pressed onClick={() => setPick({ kind: "music" })}>
              🎵 <span className="max-w-[220px] truncate">{tl.music.name || "Musik upload"}</span>
            </button>
          )}
          <button type="button" className={chip(tl.music.src === "bed")} aria-pressed={tl.music.src === "bed"} onClick={() => pickMusicSrc("bed")} data-music-opt="bed">
            🥁 Trailer bed (cadangan)
          </button>
          <button type="button" className={chip(tl.music.src === "none")} aria-pressed={tl.music.src === "none"} onClick={() => pickMusicSrc("none")} data-music-opt="none">
            🔇 Tanpa musik
          </button>
          <UploadBtn
            accept="audio/*"
            sub="music"
            label="⬆️ Upload file"
            className="min-h-[34px]"
            onDone={(r) => {
              pickMusicSrc(r.src, { name: r.name });
              // muat ulang katalog supaya musik upload tetap ada di daftar
              void reloadStudioCatalog();
            }}
          />
        </div>
        <p className="text-[11px] text-zinc-500">
          {catalogMusic.length ? "" : "Belum ada musik di katalog. "}Pakai musik bebas hak cipta (mp3 / wav / m4a). Ketukan dideteksi otomatis di laptop.
        </p>
      </div>
    );
  } else if (pick?.kind === "lane") {
    const vo = pick.lane === "voDb";
    const lane = pick.lane;
    bar = (
      <div className="space-y-1.5" data-tl-bar="lane">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-zinc-200">{vo ? "🎙️ Volume semua VO" : "🔊 Volume semua SFX"}</span>
          <button type="button" className="ml-auto h-7 w-7 rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300" aria-label="Tutup bar volume" onClick={() => setPick(null)}>
            ✕
          </button>
        </div>
        <DbSlider icon={vo ? "🎙️" : "🔊"} label={vo ? "VO" : "SFX"} value={laneDb[lane]} onChange={(db) => setMix(lane, db)} testId={`lane-${lane}`} />
        {vo && laneDb.voDb > 0 && guardAll <= -1 && <p className="text-[11px] leading-snug text-amber-300">{guardNote(guardAll)}</p>}
        {!vo && restNote("sfxDb")}
        <p className="text-[11px] text-zinc-500">{vo ? "Per kalimat: klik blok VO-nya." : "Per SFX: klik titiknya."} Per adegan: klik blok adegan.</p>
      </div>
    );
  } else if (selTeaser || pickScene) {
    let lockBar: ReactNode = null;
    if (selTeaser) {
      const s = selTeaser;
      const canon = teaserDur(s.layout.shot) ?? s.dur;
      const diff = Math.abs(canon - s.dur) > 1e-6;
      lockBar = (
        <div className="space-y-2" data-tl-bar="lock">
          {isLockedTeaser(s) ? (
            askUnlock === s.id ? (
              <div className="space-y-2 rounded-lg bg-amber-500/10 px-2.5 py-2 text-[12px] leading-relaxed text-amber-200" role="alert" data-unlock-warn>
                <p>
                  ⚠️ Animasi premium <b>{s.name}</b> dibuat pas untuk {fmt(canon, 2)} dtk. Kalau durasinya diubah, animasinya bisa <b>terpotong</b> (lebih pendek) atau{" "}
                  <b>diam di akhir</b> (lebih panjang), dan potongan adegan sesudahnya bisa tidak pas ketukan musik lagi. Detik SFX bawaan juga jadi bisa digeser.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-ghost px-3 py-1.5 text-[12px] text-amber-200" onClick={() => unlock(s.id)} data-unlock-yes>
                    🔓 Ya, buka kunci
                  </button>
                  <button type="button" className="px-2 text-[12px] font-semibold text-zinc-400 hover:text-zinc-200" onClick={() => setAskUnlock(null)}>
                    Batal
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                <span className="text-zinc-300">
                  🔒 Durasi <b>{s.name}</b> dikunci di ketukan musik ({fmt(s.dur, 2)} dtk)
                </span>
                <button type="button" className="btn-ghost px-2.5 py-1.5 text-[12px]" onClick={() => setAskUnlock(s.id)} data-unlock>
                  🔓 Buka kunci durasi
                </button>
              </div>
            )
          ) : (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5" data-unlocked>
              <span className="text-amber-300">
                🔓 Kunci durasi <b>{s.name}</b> dibuka · animasi dibuat untuk {fmt(canon, 2)} dtk{diff ? ` (sekarang ${fmt(s.dur, 2)} dtk — bisa terpotong / diam di akhir)` : ""}
              </span>
              <button type="button" className="btn-ghost px-2.5 py-1.5 text-[12px]" title="Durasi & detik SFX bawaan kembali ke aslinya, lalu dikunci lagi" onClick={() => relock(s.id)} data-relock>
                {diff ? "↺ Kembalikan durasi asli" : "🔒 Kunci lagi"}
              </button>
            </div>
          )}
        </div>
      );
    }
    const sc = pickScene;
    bar = (
      <div className="space-y-3">
        {lockBar}
        {sc && (
          <div className={`space-y-1.5 ${lockBar ? "border-t border-zinc-800 pt-2.5" : ""}`} data-tl-bar="scene">
            <div className="flex items-center gap-2">
              <span className="min-w-0 truncate font-semibold text-zinc-200">
                🎚️ Volume adegan {sc.i + 1}. {sc.s.name}
              </span>
              <button type="button" className="ml-auto h-7 w-7 flex-none rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300" aria-label="Tutup volume adegan" onClick={() => setPick(null)}>
                ✕
              </button>
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(20rem,100%),1fr))] gap-x-4 gap-y-1">
              <DbSlider icon="🎵" label="Musik" value={dbOf(sc.s.gain?.musicDb)} disabled={tl.music.src === "none"} onChange={(db) => setSceneDb(sc.s.id, "musicDb", db)} testId="scene-musicDb" />
              <DbSlider icon="🎙️" label="VO" value={dbOf(sc.s.gain?.voDb)} disabled={!sc.s.vo?.text} onChange={(db) => setSceneDb(sc.s.id, "voDb", db)} testId="scene-voDb" />
              <DbSlider icon="🔊" label="SFX" value={dbOf(sc.s.gain?.sfxDb)} disabled={!sc.s.sfx.length} onChange={(db) => setSceneDb(sc.s.id, "sfxDb", db)} testId="scene-sfxDb" />
            </div>
            <p className="text-[11px] text-zinc-500">Hanya selama adegan ini · ditambah 🎚️ Volume semua adegan.</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="card min-w-0 p-3 sm:p-4"
      onKeyDown={(e) => {
        // Ctrl/Cmd+Z di dalam timeline = urungkan perubahan terakhir dari timeline
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) {
          e.preventDefault();
          undo();
        }
      }}
    >
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="label mb-0">Timeline</div>
        <div className="text-xs text-zinc-400">
          Total <b className="text-zinc-200">{fmt(total)} dtk</b> · {tl.scenes.length} adegan
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" className="btn-ghost h-8 w-8 p-0 text-base" aria-label="Urungkan perubahan terakhir di timeline" title="Urungkan (Ctrl+Z)" disabled={!undoN} onClick={undo} data-tl-undo>
            ↶
          </button>
          <button type="button" className={`btn-ghost px-2.5 py-1.5 text-xs ${mixOpen ? "border-orange-500/60 text-orange-300" : ""}`} aria-expanded={mixOpen} aria-controls="tl-mixer" title="Volume musik, VO & SFX" onClick={toggleMix} data-tl-mix-toggle>
            🎚️ Volume
          </button>
          <button type="button" className="btn-ghost px-2.5 py-1.5 text-xs" disabled={beats.length < 2} title={beats.length >= 2 ? "Geser batas adegan ke ketukan musik terdekat" : !tl.music || tl.music.src === "none" ? "Pilih musik dulu supaya ada ketukan" : beatHint || "Tempo musik belum diketahui"} onClick={snapAll}>
            🎯 Tempel ke ketukan
          </button>
          <button type="button" className="btn-ghost h-8 w-8 p-0 text-base" aria-label="Perkecil" disabled={zoom === 0} onClick={() => setZoom((z) => Math.max(0, z - 1))}>
            −
          </button>
          <button type="button" className="btn-ghost h-8 w-8 p-0 text-base" aria-label="Perbesar" disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))}>
            +
          </button>
        </div>
      </div>

      {/* 🎚️ Volume: musik / VO / SFX semua adegan (tl.mix) */}
      {mixOpen && (
        <div id="tl-mixer" className="mb-2 rounded-xl border border-zinc-800 bg-zinc-950/40 px-2.5 py-1.5" data-tl-mixer>
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-[11px]">
            <span className="font-semibold text-zinc-300">🎚️ Volume · semua adegan</span>
            <span className="text-zinc-500">ketuk 2x slider = normal (0 dB)</span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(20rem,100%),1fr))] gap-x-4">
            <DbSlider icon="🎵" label="Musik" value={musicVol} disabled={tl.music.src === "none"} onChange={(db) => setMix("musicDb", db)} testId="musicDb" />
            <DbSlider icon="🎙️" label="VO" value={laneDb.voDb} onChange={(db) => setMix("voDb", db)} testId="voDb" />
            <DbSlider icon="🔊" label="SFX" value={laneDb.sfxDb} onChange={(db) => setMix("sfxDb", db)} testId="sfxDb" />
          </div>
          {laneDb.voDb > 0 && guardAll <= -1 && (
            <p className="pb-1 text-[11px] leading-snug text-amber-300" data-vo-guard>
              {guardNote(guardAll)}
            </p>
          )}
          <div className="pb-1">{restNote()}</div>
        </div>
      )}

      <div className="flex min-w-0 gap-1.5">
        {/* label baris (SFX / VO / musik = tombol volume jalur) */}
        <div className="flex w-8 flex-none flex-col text-center text-[13px] leading-none text-zinc-500">
          <div style={{ height: ROW.ruler }} aria-hidden />
          <div className="flex items-center justify-center" style={{ height: ROW.scene }} title="Adegan" aria-hidden>
            🎬
          </div>
          <LaneBtn icon="🔊" name="SFX" db={laneDb.sfxDb} h={ROW.sfx} on={pick?.kind === "lane" && pick.lane === "sfxDb"} onClick={() => setPick((pk) => (pk?.kind === "lane" && pk.lane === "sfxDb" ? null : { kind: "lane", lane: "sfxDb" }))} />
          <LaneBtn icon="🎙️" name="VO" db={laneDb.voDb} h={ROW.vo} on={pick?.kind === "lane" && pick.lane === "voDb"} onClick={() => setPick((pk) => (pk?.kind === "lane" && pk.lane === "voDb" ? null : { kind: "lane", lane: "voDb" }))} />
          <LaneBtn icon="🎵" name="Musik" db={tl.music.src === "none" ? 0 : musicVol} h={ROW.music} on={pick?.kind === "music"} onClick={() => setPick((pk) => (pk?.kind === "music" ? null : { kind: "music" }))} />
        </div>

        <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain rounded-xl border border-zinc-800 bg-zinc-950/60 [scrollbar-width:thin]">
          <div className="relative select-none" style={{ width: inner }}>
            {/* penggaris + ketukan (klik / geser = lompat) */}
            <div
              className={`relative border-b border-zinc-800 ${onSeek ? "cursor-pointer" : ""}`}
              style={{ height: ROW.ruler, touchAction: "pan-y" }}
              onPointerDown={onRulerDown}
              onPointerMove={onRulerMove}
              onPointerUp={() => (scrub.current = false)}
              onPointerCancel={() => (scrub.current = false)}
            >
              {beatMarks?.ruler}
              {ticks.map((t) => (
                <span key={t} className="absolute top-0 h-full border-l border-zinc-700/70 pl-1 text-[10px] leading-[20px] text-zinc-500" style={{ left: t * pps }}>
                  {clockLabel(t)}
                </span>
              ))}
            </div>

            {/* blok adegan */}
            <div className="relative" style={{ height: ROW.scene }}>
              {scenes.map((s, i) => {
                const left = starts[i] * pps;
                const w = Math.max(6, s.dur * pps);
                const sel = s.id === selected;
                const dragging = draft?.id === s.id;
                const line = voLines.find((l) => l.sceneId === s.id);
                const locked = isLockedTeaser(s);
                // ucapan asli (kata terakhir + 0,12 dtk), bukan panjang file: hening di ujung mp3 tidak dihitung "lewat"
                const long = !!line && voStartOf(s, line) + voSpeechEnd(line) + 0.05 > s.dur;
                return (
                  <div
                    key={s.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={sel}
                    title={`${i + 1}. ${s.name} · ${fmt(s.dur, 2)} dtk${isTeaserScene(s) ? (locked ? " · 🔒 durasi dikunci" : " · 🔓 kunci durasi dibuka") : ""}`}
                    onClick={() => {
                      // pilih adegan + buka volume adegan ini (dan kunci durasi kalau adegan premium)
                      setPick({ kind: "scene", sceneId: s.id });
                      onSelect(s.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
                      e.preventDefault();
                      setPick({ kind: "scene", sceneId: s.id });
                      onSelect(s.id);
                    }}
                    className={`group absolute top-1.5 bottom-1.5 overflow-hidden rounded-lg border text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-orange-500/60 ${
                      sel ? "border-orange-500 bg-orange-500/15" : i % 2 ? "border-zinc-700 bg-zinc-800/80 hover:border-zinc-600" : "border-zinc-700 bg-zinc-800/50 hover:border-zinc-600"
                    } ${long ? (red.has(i) ? "ring-1 ring-inset ring-red-500/70" : "ring-1 ring-inset ring-amber-500/50") : ""}`}
                    style={{ left: left + 1, width: w - 2 }}
                  >
                    <div className="pointer-events-none px-1.5 pr-4 pt-1">
                      <div className={`truncate text-[11px] font-semibold ${sel ? "text-orange-300" : "text-zinc-200"}`}>
                        {w > 40 ? `${i + 1}. ${s.name}` : i + 1}
                      </div>
                      {w > 34 && (
                        <div className={`truncate text-[10px] tabular-nums ${dragging && draft?.snapped ? "font-bold text-orange-400" : "text-zinc-500"}`}>
                          {fmt(s.dur, 2)}s{s.vo?.text && w > 60 ? " · 🎙" : ""}
                          {long && w > 80 ? " · VO lewat" : ""}
                        </div>
                      )}
                    </div>
                    {/* pegangan ubah durasi (adegan premium teaser yang masih dikunci: tampil gembok) */}
                    {locked ? (
                      <div
                        title="Durasi dikunci di ketukan musik (adegan premium) — pilih adegan ini untuk membuka kunci"
                        aria-label={`Durasi ${s.name} dikunci`}
                        className="pointer-events-none absolute right-0 top-0 flex h-full w-3.5 items-center justify-center bg-zinc-700/20 text-[8px] leading-none opacity-70"
                      >
                        🔒
                      </div>
                    ) : (
                      <div
                        role="slider"
                        tabIndex={0}
                        aria-label={`Durasi ${s.name}`}
                        aria-valuemin={MIN_DUR}
                        aria-valuemax={MAX_DUR}
                        aria-valuenow={s.dur}
                        title="Tarik untuk ubah durasi"
                        className={`absolute right-0 top-0 flex h-full w-3.5 cursor-ew-resize items-center justify-center ${dragging ? "bg-orange-500/40" : isTeaserScene(s) ? "bg-amber-500/25 group-hover:bg-amber-500/40" : "bg-zinc-700/30 group-hover:bg-zinc-600/50"}`}
                        style={{ touchAction: "none" }}
                        onPointerDown={(e) => onHandleDown(e, i)}
                        onPointerMove={onHandleMove}
                        onPointerUp={() => endDrag(true)}
                        onPointerCancel={() => endDrag(false)}
                        onLostPointerCapture={() => drag.current && endDrag(true)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => onHandleKey(e, i)}
                        data-dur-handle={s.id}
                      >
                        <span className={`h-4 w-0.5 rounded-full ${dragging ? "bg-orange-300" : "bg-zinc-400/70"}`} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* titik SFX */}
            <div className="relative border-t border-zinc-800/70" style={{ height: ROW.sfx }}>
              {dots.map((d) => {
                const c = catOf(d.meta?.cat);
                const sc = scenes[d.si];
                const picked = pick?.kind === "sfx" && pick.sceneId === sc?.id && pick.ci === d.ci;
                const moving = sfxDraft?.si === d.si && sfxDraft.ci === d.ci;
                return (
                  <div
                    key={`${d.si}-${d.ci}`}
                    role="slider"
                    tabIndex={0}
                    aria-label={`SFX ${d.cue.id} (${sc?.name}) ${d.cue.on ? "nyala" : "mati"}${d.locked ? ", detik dikunci" : ""}`}
                    aria-valuemin={0}
                    aria-valuemax={sc?.dur ?? 0}
                    aria-valuenow={r3(d.at)}
                    aria-valuetext={`${fmt(d.at, 2)} detik dari awal adegan`}
                    aria-readonly={d.locked || undefined}
                    title={`${d.cue.id}${d.meta?.use ? ` — ${d.meta.use}` : ""}\n${fmt(d.t, 2)} dtk${d.locked ? " · 🔒 detik dikunci (sinkron animasi)" : " · tarik untuk geser"} · klik untuk pilih`}
                    onPointerDown={(e) => onSfxDown(e, d.si, d.ci, d.locked)}
                    onPointerMove={onSfxMove}
                    onPointerUp={() => endSfx(true)}
                    onPointerCancel={() => endSfx(false)}
                    onLostPointerCapture={() => sfxDrag.current && endSfx(true)}
                    onKeyDown={(e) => onSfxKey(e, d.si, d.ci)}
                    className={`absolute flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-orange-500/70 ${d.locked ? "cursor-pointer" : "cursor-grab"} ${picked ? "ring-2 ring-orange-500" : ""}`}
                    style={{ left: d.x, top: 1 + d.lane * 11, touchAction: picked && !d.locked ? "none" : "pan-x" }}
                    data-sfx-dot={`${sc?.id}:${d.ci}`}
                  >
                    <span
                      className={`block h-2.5 w-2.5 rounded-full ${d.cue.on ? `${c.dot} ring-2 ring-zinc-950` : "bg-transparent opacity-70 ring-1 ring-zinc-500"} ${moving && sfxDraft?.snapped ? "scale-125" : ""}`}
                    />
                  </div>
                );
              })}
              {!dots.length && <div className="px-2 text-[11px] leading-[44px] text-zinc-600">Belum ada SFX</div>}
            </div>

            {/* blok VO (bisa digeser) */}
            <div className="relative border-t border-zinc-800/70" style={{ height: ROW.vo }}>
              {voLines.map((l) => {
                const i = scenes.findIndex((s) => s.id === l.sceneId);
                if (i < 0) return null;
                const s = scenes[i];
                const at = voDraft?.id === s.id ? voDraft.at : voStartOf(s, l);
                // blok = bagian yang terdengar (ucapan asli); hening di ujung file tidak digambar & tidak dihitung "lewat"
                const speech = voSpeechEnd(l);
                const past = at + speech + 0.05 > s.dur;
                const bad = red.has(i) && !!s.vo?.text;
                // video habis di total adegan + ekor hening -> ucapan sesudahnya terpotong (sama dengan voCutoffs)
                const cut = l.src && s.vo?.text ? starts[i] + at + speech - videoEnd : 0;
                const picked = pick?.kind === "vo" && pick.sceneId === s.id;
                // kalimat ini sedang dibuat ulang (kecepatan) — tetap jalan walau barnya ditutup
                const making = tempoBusy(tempo.runs[s.id]);
                return (
                  <div
                    key={l.sceneId}
                    role="slider"
                    aria-busy={making || undefined}
                    tabIndex={0}
                    aria-label={`Mulai VO ${s.name}`}
                    aria-valuemin={0}
                    aria-valuemax={voMax(s)}
                    aria-valuenow={r3(at)}
                    aria-valuetext={`${fmt(at, 2)} detik dari awal adegan ${s.name}${bad ? ", menabrak" : ""}${making ? ", suaranya sedang dibuat ulang" : ""}`}
                    title={`VO ${s.name} · mulai ${fmt(at, 2)} dtk · ucapan ${fmt(speech, 2)} dtk${l.dur - speech > 0.05 ? ` (file ${fmt(l.dur, 2)} dtk, ujungnya hening)` : ""}${l.tempo !== undefined ? ` · kecepatan ${fmtTempo(l.tempo)}` : l.speed ? ` · dipercepat ${l.speed}%` : ""}${cut > 1e-3 ? ` — ujungnya terpotong di akhir video (${fmt(cut, 2)} dtk)` : bad ? " — menabrak VO lain" : past ? " — masuk ke adegan berikutnya" : ""}${making ? "\n⏳ Suaranya sedang dibuat ulang" : ""}\nTarik / panah ←→ untuk geser mulai, klik untuk atur`}
                    onPointerDown={(e) => onVoDown(e, s, l)}
                    onPointerMove={onVoMove}
                    onPointerUp={() => endVo(true)}
                    onPointerCancel={() => endVo(false)}
                    onLostPointerCapture={() => voDrag.current && endVo(true)}
                    onKeyDown={(e) => onVoKey(e, s, l)}
                    className={`absolute top-1 bottom-1 cursor-grab overflow-hidden rounded border px-1 text-[9px] leading-[18px] outline-none focus-visible:ring-2 focus-visible:ring-orange-500/70 active:cursor-grabbing ${
                      bad ? "border-red-500/80 bg-red-500/25 text-red-300" : tl.vo?.temp ? "border-amber-400/60 bg-amber-400/20 text-amber-300" : "border-emerald-400/60 bg-emerald-400/20 text-emerald-300"
                    } ${past && !bad ? "border-dashed" : ""} ${picked ? "z-[5] ring-2 ring-orange-500" : ""} ${making ? "animate-pulse" : ""}`}
                    style={{ left: (starts[i] + at) * pps, width: Math.max(8, speech * pps), touchAction: picked ? "none" : "pan-x" }}
                    data-vo-block={s.id}
                    data-vo-clash={bad || undefined}
                  >
                    {making ? (speech * pps > 14 ? "⏳" : "") : speech * pps > 26 ? (l.tempo !== undefined ? `VO ${fmtTempo(l.tempo)}` : "VO") : ""}
                  </div>
                );
              })}
              {!voLines.length && (
                <div className="px-2 text-[11px] leading-[28px] text-zinc-600">{!voOn ? "Tanpa VO" : hasVoText ? "VO belum dibuat" : "Belum ada naskah VO"}</div>
              )}
            </div>

            {/* jalur musik: ＋ Musik (menempel di kiri) + blok musik (geser = bagian lagu), tanda ketukan */}
            <div className="relative border-t border-zinc-800/70" style={{ height: ROW.music }} data-music-lane>
              {tl.music.src !== "none" && (
                <div
                  role="button"
                  tabIndex={0}
                  aria-pressed={pick?.kind === "music"}
                  aria-label={`Musik ${musicName}${fileMusic ? `, mulai dari ${songClock(musicOff)} lagu` : ""}${beatState ? `, ${beatState.text.replace(/^\S+\s/, "")}` : ""}. ${fileMusic ? "Geser blok atau panah kiri kanan untuk pilih bagian lagu" : "Klik untuk atur"}`}
                  title={`${musicName}${fileMusic ? ` · mulai dari ${songClock(musicOff)}${mDur ? ` · tarik ke kiri / kanan untuk pilih bagian lagu` : ""}` : ""}${beatState ? `\n${beatState.text}` : ""}`}
                  onPointerDown={onMusicDown}
                  onPointerMove={onMusicMove}
                  onPointerUp={() => endMusic(true)}
                  onPointerCancel={() => endMusic(false)}
                  onLostPointerCapture={() => musicDrag.current && endMusic(true)}
                  onKeyDown={onMusicKey}
                  className={`absolute top-1 bottom-1 overflow-hidden rounded border text-[10px] leading-[20px] outline-none focus-visible:ring-2 focus-visible:ring-orange-500/70 ${
                    fileMusic && mDur ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
                  } ${tl.music.src === "bed" ? "border-indigo-400/50 bg-indigo-400/15 text-indigo-300" : "border-violet-400/60 bg-violet-400/20 text-violet-300"} ${pick?.kind === "music" ? "z-[5] ring-2 ring-orange-500" : ""}`}
                  style={{ left: 0, width: Math.max(8, total * pps), touchAction: pick?.kind === "music" && fileMusic ? "none" : "pan-x" }}
                  data-music-block
                >
                  {beatMarks?.lane}
                  {musicSeams.map((t) => (
                    <span key={`seam${t}`} className="pointer-events-none absolute top-0 bottom-0 border-l-2 border-dashed border-orange-400/80" style={{ left: t * pps }} data-music-seam={Math.round(t * 10) / 10}>
                      <span className="absolute left-0.5 top-0 text-[9px] leading-none text-orange-300">↺</span>
                    </span>
                  ))}
                  <span className={`pointer-events-none relative block truncate pl-[84px] pr-2 ${musicDraft !== null ? "font-bold text-orange-400" : ""}`}>
                    {musicName}
                    {fileMusic && (musicOff > 0 || musicDraft !== null) ? ` · dari ${songClock(musicOff)}` : ""}
                    {beatState?.busy ? " · ⏳ Mendeteksi ketukan…" : ""}
                  </span>
                </div>
              )}
              <div className="pointer-events-none sticky left-0 z-[6] inline-flex h-full items-center gap-1.5 pl-1">
                <button
                  type="button"
                  className={`pointer-events-auto rounded-md border px-2 py-1 text-[11px] font-semibold leading-none shadow-sm ${pick?.kind === "musicMenu" ? "border-orange-500 bg-orange-500/15 text-orange-300" : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-zinc-600"}`}
                  aria-expanded={pick?.kind === "musicMenu"}
                  onClick={() => setPick((pk) => (pk?.kind === "musicMenu" ? null : { kind: "musicMenu" }))}
                  data-music-add
                >
                  ＋ Musik
                </button>
                {tl.music.src === "none" && <span className="text-[11px] text-zinc-600">Tanpa musik</span>}
              </div>
            </div>

            {/* playhead */}
            {head !== null && head <= inner && (
              <div className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-orange-500" style={{ left: head }}>
                <span className="absolute -left-[4px] top-0 h-0 w-0 border-x-[4.5px] border-t-[6px] border-x-transparent border-t-orange-500" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* VO numpuk → peringatan + susun otomatis */}
      {(clashes.length > 0 || cuts.length > 0) && !voDraft && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-[11.5px] text-red-300" role="alert" data-tl-clash>
          <span>
            ⛔ {clashes.length ? `VO numpuk${clashes.length > 1 ? ` total ${fmt(Math.max(0.01, clashSec), 2)} dtk` : ""}: ${clashLabels.join(", ")}` : ""}
            {clashes.length && cuts.length ? " · " : ""}
            {cuts.length ? `Terpotong di akhir video: ${cuts.map((c) => scenes[c.scene]?.name).join(", ")}` : ""}
          </span>
          {canArrange && (
            <button type="button" className="font-semibold text-orange-300 underline hover:text-orange-200" onClick={arrange} data-tl-arrange>
              🪄 Susun otomatis
            </button>
          )}
        </div>
      )}

      {bar && <div className="mt-2 rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-[12px]">{bar}</div>}
      {tempo.watchers}

      <div className="mt-2 flex min-h-[18px] flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
        {note ? (
          <span role="status" className="font-semibold text-orange-400" data-tl-note>
            {note}
          </span>
        ) : (
          <>
            {cats.map((c) => (
              <span key={c} className="inline-flex items-center gap-1">
                <span className={`h-2 w-2 rounded-full ${catOf(c).dot}`} />
                {catOf(c).label}
              </span>
            ))}
            {beatInfo && <span className="text-zinc-600">· {beatInfo}</span>}
            <span className="text-zinc-600">
              {scenes.length > 0 && scenes.every(isLockedTeaser)
                ? "· 🔒 Durasi adegan premium dikunci di ketukan (klik bloknya untuk buka kunci) · klik / geser titik SFX & blok VO untuk atur sendiri"
                : "· Tarik tepi kanan blok untuk ubah durasi · klik / geser titik SFX & blok VO untuk atur sendiri"}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

/** tombol volume jalur (kolom label kiri): ikon + titik oranye kalau volumenya tidak 0 dB */
function LaneBtn({ icon, name, db, h, on, onClick }: { icon: string; name: string; db: number; h: number; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`relative flex w-full items-center justify-center rounded-md transition hover:bg-zinc-800 ${on ? "bg-zinc-800 ring-1 ring-orange-500/70" : ""}`}
      style={{ height: h }}
      aria-label={`Volume ${name}: ${fmtDb(db)}`}
      aria-pressed={on}
      title={`Volume ${name} (${fmtDb(db)})`}
      onClick={onClick}
      data-lane-btn={name}
    >
      <span aria-hidden>{icon}</span>
      {db !== 0 && <span className="absolute right-0 top-1 h-1.5 w-1.5 rounded-full bg-orange-500" aria-hidden />}
    </button>
  );
}
