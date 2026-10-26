"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { extraSfxOf, useStudioCatalog } from "@/lib/studio/client";
import { sfxById, type SfxMeta } from "@/lib/studio/sfxMeta";
import {
  arrangeVo,
  beatGrid,
  isLoudSfx,
  MAX_DUR,
  MAX_TOTAL,
  MIN_DUR,
  nearestBeat,
  sceneStartSecs,
  totalFrames,
  totalSec,
  TAIL_SEC,
  VO_AT,
  voClashes,
  voCutoffs,
  voSpeechEnd,
  voStartOf,
  type Scene,
  type Timeline,
  type VoLine,
} from "@/lib/studio/timeline";
import { beatReport, isLockedTeaser, isTeaserBeatCue, isTeaserScene, snapAroundTeaser, teaserDur, teaserVoAt, type BeatReport } from "@/lib/studio/teaserLock";
import VoLineTools from "./VoLineTools";
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
const ROW = { ruler: 22, scene: 54, sfx: 44, vo: 28 };
/** geser blok VO / titik SFX lewat keyboard & tombol: ±0,05 dtk (Shift ±0,25) */
const NUDGE = 0.05;
const NUDGE_BIG = 0.25;
/** blok VO boleh mulai paling lambat segini sebelum adegannya habis (ucapannya boleh masuk sedikit ke adegan berikut) */
const VO_END_ROOM = 0.1;
/** riwayat urungkan (perubahan dari timeline ini) */
const UNDO_MAX = 30;

/** 2.5 -> "2,5" */
const fmt = (n: number, d = 1) => String(Number(n.toFixed(d))).replace(".", ",");
const clockLabel = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** ketukan musik (detik) — sama dengan yang dipakai komposisi untuk menempel potongan */
export function musicBeats(tl: Timeline, until: number): number[] {
  const m = tl.music;
  if (!m || m.src === "none") return [];
  if (m.src === "bed") return beatGrid(BED_BPM, 0, until);
  if (m.beats && m.beats.length >= 2) return m.beats;
  return m.bpm ? beatGrid(m.bpm, m.offset ?? 0, until) : [];
}

/** ganti adegan; durasi berubah -> VO lengkap (.mp3 hasil worker) tidak sinkron lagi, jadi dilepas */
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
type Picked = { kind: "vo"; sceneId: string } | { kind: "sfx"; sceneId: string; ci: number; id: string };

/**
 * Timeline horizontal yang bisa diedit sendiri:
 * - blok adegan selebar durasinya (tarik tepi kanan untuk ubah durasi, nempel 0,1 dtk / ketukan musik); adegan premium teaser
 *   dikunci 🔒 kecuali kuncinya dibuka ("🔓 Buka kunci durasi", tersimpan di scene.unlocked)
 * - titik SFX: klik = pilih (nyala/mati, geser), tarik / panah ←→ = geser detiknya (cue.at); detik SFX bawaan teaser dikunci
 * - blok VO (bagian yang terdengar): klik = pilih, tarik / panah ←→ = geser mulainya (line.at & scene.vo.at, suara tidak dibuat
 *   ulang), merah kalau menabrak VO lain / terpotong di akhir video; bar VO: atur mulai, kecepatan kalimat (VoLineTools)
 * - 🪄 Susun otomatis (arrangeVo) & ↶ Urungkan (perubahan dari timeline ini)
 * Semua perubahan lewat `onChange` (changeEdit di StudioPro). Di HP: ketuk dulu untuk memilih, lalu geser.
 * `beatHint` = alasan ketukan musik belum ada (mis. laptop mati / lagi dideteksi), untuk tombol "Tempel ke ketukan".
 */
export default function TimelineEditor(p: { timeline: Timeline; onChange: (tl: Timeline) => void; selected: string | null; onSelect: (sceneId: string) => void; frame?: number; onSeek?: (frame: number) => void; beatHint?: string | null }) {
  const { timeline: tl, onChange, selected, onSelect, frame, onSeek, beatHint } = p;
  const catalog = useStudioCatalog();
  const extra = useMemo<SfxMeta[]>(() => extraSfxOf(catalog), [catalog]);
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(360);
  const [zoom, setZoom] = useState(0);
  const [draft, setDraft] = useState<{ id: string; dur: number; snapped: boolean } | null>(null);
  const [voDraft, setVoDraft] = useState<{ id: string; at: number } | null>(null);
  const [sfxDraft, setSfxDraft] = useState<{ si: number; ci: number; at: number; snapped: boolean } | null>(null);
  const [pick, setPick] = useState<Picked | null>(null);
  const [askUnlock, setAskUnlock] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);
  const voDrag = useRef<VoDrag | null>(null);
  const sfxDrag = useRef<SfxDrag | null>(null);
  const scrub = useRef(false);
  const tlRef = useRef(tl);
  tlRef.current = tl;

  // ---------------- urungkan: hanya perubahan yang dibuat dari timeline ini, selama tidak ada perubahan lain sesudahnya ----------------
  const hist = useRef<{ before: Timeline; after: Timeline | null }[]>([]);
  const pending = useRef<Timeline | null>(null);
  const undoing = useRef(false);
  const [undoN, setUndoN] = useState(0);
  useEffect(() => {
    const h = hist.current;
    if (undoing.current) {
      undoing.current = false;
      if (h.length) h[h.length - 1].after = tl;
    } else if (pending.current && tl !== pending.current) {
      h.push({ before: pending.current, after: tl });
      if (h.length > UNDO_MAX) h.shift();
      pending.current = null;
    } else if (h.length && tl !== h[h.length - 1].after) hist.current = []; // diubah dari luar (kartu rencana, suara, Harley)
    setUndoN(hist.current.length);
  }, [tl]);
  /** satu-satunya pintu perubahan dari timeline ini (dicatat untuk urungkan) */
  const commit = (next: Timeline, msg?: string) => {
    if (next === tlRef.current) return;
    pending.current = tlRef.current;
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
    onChange(top.before);
    setNote("↶ Perubahan terakhir di timeline diurungkan");
  };

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
    setPick((pk) => (pk && selected && pk.sceneId !== selected ? null : pk));
    setAskUnlock(null);
  }, [selected]);

  // durasi yang tampil = durasi asli, kecuali adegan yang sedang ditarik
  const scenes = useMemo(() => (draft ? tl.scenes.map((s) => (s.id === draft.id ? { ...s, dur: draft.dur } : s)) : tl.scenes), [tl.scenes, draft]);
  const fps = tl.fps || 30;
  const starts = useMemo(() => sceneStartSecs({ scenes, fps }), [scenes, fps]);
  const total = useMemo(() => totalFrames({ scenes, fps }) / fps, [scenes, fps]);
  const beats = useMemo(() => musicBeats(tl, Math.max(total, totalFrames(tl) / fps) + 2), [tl, total, fps]);
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
  /** catatan setelah VO digeser: menabrak / terpotong / aman */
  const voMoveNote = (next: Timeline, id: string): string => {
    const i = next.scenes.findIndex((s) => s.id === id);
    const s = next.scenes[i];
    const line = next.vo?.lines.find((l) => l.sceneId === id);
    const hit = voClashes(next).find((c) => c.scene === i || c.next === i);
    if (hit) return `⛔ VO ${next.scenes[hit.scene].name} menabrak VO ${next.scenes[hit.next].name} (${fmt(Math.max(0.01, hit.sec), 2)} dtk) — geser lagi atau 🪄 Susun otomatis`;
    const cut = voCutoffs(next).find((c) => c.scene === i);
    if (cut) return `⛔ Ujung VO ${s.name} terpotong di akhir video (${fmt(cut.sec, 2)} dtk) — geser lebih awal`;
    return `🎙️ VO ${s.name} mulai ${fmt(voStartOf(s, line), 2)} dtk dari awal adegan`;
  };
  const setVoAt = (id: string, at: number) => {
    const s = tlRef.current.scenes.find((x) => x.id === id);
    if (!s) return;
    const a = r3(Math.min(Math.max(0, at), voMax(s)));
    const line = tlRef.current.vo?.lines.find((l) => l.sceneId === id);
    if (Math.abs(a - voStartOf(s, line)) < 5e-4) return;
    const next = withVoAt(tlRef.current, id, a);
    commit(next, voMoveNote(next, id));
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
    if (!r.moved.length) return setNote("Tidak ada VO yang bisa digeser lagi di dalam adegannya — pendekkan teks VO atau pilih kecepatan lebih cepat.");
    const left = voClashes(r.tl).length + voCutoffs(r.tl).length;
    commit(r.tl, `🪄 Disusun otomatis: ${movedText(r.tl, r.moved)}.${left ? " Masih ada yang numpuk (blok merah) — pendekkan teks VO atau pilih kecepatan lebih cepat." : " Sekarang tidak ada suara yang numpuk."}`);
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
    const want = teaserDur(s.layout.shot) ?? s.dur;
    const others = t.scenes.reduce((a, x) => a + x.dur, 0) - s.dur;
    if (others + want > MAX_TOTAL + 1e-6) return setNote(`Tidak bisa dikembalikan: total video jadi lewat ${MAX_TOTAL} dtk. Pendekkan adegan lain dulu.`);
    const scenesNext = t.scenes.map((x) => {
      if (x.id !== id) return x;
      const { unlocked: _u, ...rest } = x;
      void _u;
      return { ...rest, dur: want };
    });
    commit(withScenes(t, scenesNext), Math.abs(want - s.dur) > 1e-6 ? `↺ Durasi ${s.name} kembali ${fmt(want, 2)} dtk & dikunci lagi` : `🔒 Durasi ${s.name} dikunci lagi`);
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

  // penggaris: label tiap 1/2/5/10/… dtk, minimal 44 px antarlabel
  const step = [1, 2, 5, 10, 15, 30, 60].find((s) => s * pps >= 44) ?? 60;
  const ticks: number[] = [];
  for (let t = 0; t <= total + 1e-6; t += step) ticks.push(t);
  const beatStep = beats.length > 1 ? beats[1] - beats[0] : 0;
  const showBeats = beats.length > 1 && beatStep * pps >= 5;
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
  const selTeaser = !pickVo && !pickCue && selected ? tl.scenes.find((s) => s.id === selected && isTeaserScene(s)) ?? null : null;
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
        {hit ? (
          <p className="text-[11.5px] text-red-400" role="alert">
            ⛔ Menabrak: {scenes[hit.scene]?.name} → {scenes[hit.next]?.name} ({fmt(Math.max(0.01, hit.sec), 2)} dtk). Geser mulainya, pilih kecepatan lebih cepat, atau 🪄 Susun otomatis.
          </p>
        ) : cut ? (
          <p className="text-[11.5px] text-red-400" role="alert">
            ⛔ Ujungnya terpotong di akhir video ({fmt(cut.sec, 2)} dtk) — geser lebih awal atau pilih lebih cepat.
          </p>
        ) : (
          <p className="text-[11px] text-zinc-500">Tarik bloknya atau pakai panah ←/→ (Shift = 0,25 dtk). Suara tidak dibuat ulang.</p>
        )}
        <VoLineTools scene={s} timeline={tl} onApply={(fn) => commit(fn(tlRef.current))} />
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
        <p className="text-[11px] text-zinc-500">
          {locked
            ? "🔒 Detiknya dikunci — sinkron dengan gerakan animasi premium. Buka kunci durasi adegan ini (klik blok adegannya) untuk menggeser."
            : `Tarik titiknya atau pakai panah ←/→ (nempel ke ketukan musik).${meta?.use ? ` ${meta.use}` : ""}`}
        </p>
      </div>
    );
  } else if (selTeaser) {
    const s = selTeaser;
    const canon = teaserDur(s.layout.shot) ?? s.dur;
    const diff = Math.abs(canon - s.dur) > 1e-6;
    bar = (
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
            <button type="button" className="btn-ghost px-2.5 py-1.5 text-[12px]" onClick={() => relock(s.id)} data-relock>
              {diff ? "↺ Kembalikan durasi asli" : "🔒 Kunci lagi"}
            </button>
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

      <div className="flex min-w-0 gap-1.5">
        {/* label baris */}
        <div className="flex w-6 flex-none flex-col text-center text-[13px] leading-none text-zinc-500" aria-hidden>
          <div style={{ height: ROW.ruler }} />
          <div className="flex items-center justify-center" style={{ height: ROW.scene }} title="Adegan">
            🎬
          </div>
          <div className="flex items-center justify-center" style={{ height: ROW.sfx }} title="SFX">
            🔊
          </div>
          <div className="flex items-center justify-center" style={{ height: ROW.vo }} title="Voice over">
            🎙️
          </div>
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
              {showBeats &&
                beats
                  .filter((b) => b <= total + 0.01)
                  .map((b, k) => <span key={`b${k}`} className="absolute bottom-0 h-1.5 w-px bg-orange-500/50" style={{ left: b * pps }} />)}
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
                      setPick(null);
                      onSelect(s.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
                      e.preventDefault();
                      setPick(null);
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
                return (
                  <div
                    key={l.sceneId}
                    role="slider"
                    tabIndex={0}
                    aria-label={`Mulai VO ${s.name}`}
                    aria-valuemin={0}
                    aria-valuemax={voMax(s)}
                    aria-valuenow={r3(at)}
                    aria-valuetext={`${fmt(at, 2)} detik dari awal adegan ${s.name}${bad ? ", menabrak" : ""}`}
                    title={`VO ${s.name} · mulai ${fmt(at, 2)} dtk · ucapan ${fmt(speech, 2)} dtk${l.dur - speech > 0.05 ? ` (file ${fmt(l.dur, 2)} dtk, ujungnya hening)` : ""}${l.tempo !== undefined ? ` · kecepatan ${fmtTempo(l.tempo)}` : l.speed ? ` · dipercepat ${l.speed}%` : ""}${cut > 1e-3 ? ` — ujungnya terpotong di akhir video (${fmt(cut, 2)} dtk)` : bad ? " — menabrak VO lain" : past ? " — masuk ke adegan berikutnya" : ""}\nTarik / panah ←→ untuk geser mulai, klik untuk atur`}
                    onPointerDown={(e) => onVoDown(e, s, l)}
                    onPointerMove={onVoMove}
                    onPointerUp={() => endVo(true)}
                    onPointerCancel={() => endVo(false)}
                    onLostPointerCapture={() => voDrag.current && endVo(true)}
                    onKeyDown={(e) => onVoKey(e, s, l)}
                    className={`absolute top-1 bottom-1 cursor-grab overflow-hidden rounded border px-1 text-[9px] leading-[18px] outline-none focus-visible:ring-2 focus-visible:ring-orange-500/70 active:cursor-grabbing ${
                      bad ? "border-red-500/80 bg-red-500/25 text-red-300" : tl.vo?.temp ? "border-amber-400/60 bg-amber-400/20 text-amber-300" : "border-emerald-400/60 bg-emerald-400/20 text-emerald-300"
                    } ${past && !bad ? "border-dashed" : ""} ${picked ? "z-[5] ring-2 ring-orange-500" : ""}`}
                    style={{ left: (starts[i] + at) * pps, width: Math.max(8, speech * pps), touchAction: picked ? "none" : "pan-x" }}
                    data-vo-block={s.id}
                    data-vo-clash={bad || undefined}
                  >
                    {speech * pps > 26 ? (l.tempo !== undefined ? `VO ${fmtTempo(l.tempo)}` : "VO") : ""}
                  </div>
                );
              })}
              {!voLines.length && (
                <div className="px-2 text-[11px] leading-[28px] text-zinc-600">{!voOn ? "Tanpa VO" : hasVoText ? "VO belum dibuat" : "Belum ada naskah VO"}</div>
              )}
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
            ⛔ {clashes.length ? `VO numpuk: ${clashLabels.join(", ")}` : ""}
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
