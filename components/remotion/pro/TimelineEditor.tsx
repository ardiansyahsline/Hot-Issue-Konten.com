"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { extraSfxOf, useStudioCatalog } from "@/lib/studio/client";
import { sfxById, type SfxMeta } from "@/lib/studio/sfxMeta";
import { beatGrid, MAX_DUR, MAX_TOTAL, MIN_DUR, nearestBeat, sceneStartSecs, snapScenesToBeats, totalFrames, totalSec, type Scene, type Timeline } from "@/lib/studio/timeline";
import { isTeaserScene } from "./teaserLock";

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
const ROW = { ruler: 22, scene: 54, sfx: 44, vo: 22 };

/** 2.5 -> "2,5" */
const fmt = (n: number, d = 1) => String(Number(n.toFixed(d))).replace(".", ",");
const clockLabel = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

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

type Drag = { id: string; x0: number; d0: number; dur: number; start: number; others: number; moved: boolean };

/**
 * Timeline horizontal: blok adegan selebar durasinya (tarik tepi kanan untuk ubah durasi, nempel 0,1 dtk / ketukan musik),
 * titik SFX per cue (klik = nyala/mati), blok VO, playhead + klik/geser penggaris untuk lompat.
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
  const [note, setNote] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);
  const scrub = useRef(false);

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
    const t = setTimeout(() => setNote(null), 3500);
    return () => clearTimeout(t);
  }, [note]);

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
    const list = scenes.flatMap((s, si) => s.sfx.map((c, ci) => ({ si, ci, cue: c, meta: sfxById(c.id, extra), t: starts[si] + c.at })));
    list.sort((a, b) => a.t - b.t);
    const lastX = [-1e9, -1e9, -1e9];
    return list.map((d) => {
      const x = d.t * pps;
      let lane = lastX.findIndex((lx) => x - lx >= LANE_GAP);
      if (lane < 0) lane = lastX.indexOf(Math.min(...lastX));
      lastX[lane] = x;
      return { ...d, x, lane };
    });
  }, [scenes, starts, extra, pps]);
  const cats = useMemo(() => [...new Set(dots.map((d) => d.meta?.cat ?? ""))], [dots]);

  const voOn = tl.voice?.mode !== "none" && !tl.muteVo;
  const voLines = voOn && tl.vo ? tl.vo.lines : [];
  const hasVoText = tl.scenes.some((s) => s.vo?.text);

  // playhead ikut terlihat saat video diputar
  const head = frame === undefined ? null : (frame / fps) * pps;
  useEffect(() => {
    const el = scroller.current;
    if (!el || head === null || drag.current || scrub.current) return;
    if (head < el.scrollLeft + 8 || head > el.scrollLeft + el.clientWidth - 24) el.scrollLeft = Math.max(0, head - 48);
  }, [head]);

  // ---------------- ubah durasi (tarik tepi kanan) ----------------
  const onHandleDown = (e: PointerEvent<HTMLDivElement>, i: number) => {
    e.stopPropagation();
    e.preventDefault();
    const s = tl.scenes[i];
    if (isTeaserScene(s)) return; // adegan premium teaser: durasi dikunci di ketukan
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
  const endDrag = (commit: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (d && commit && d.moved && Math.abs(d.dur - d.d0) > 1e-6) {
      onChange(withScenes(tl, tl.scenes.map((s) => (s.id === d.id ? { ...s, dur: d.dur } : s))));
    }
    setDraft(null);
  };
  /** keyboard di pegangan: panah kiri/kanan = ±0,1 dtk (Shift ±0,5) */
  const onHandleKey = (e: KeyboardEvent<HTMLDivElement>, i: number) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const s = tl.scenes[i];
    if (isTeaserScene(s)) return;
    const step = (e.shiftKey ? 0.5 : 0.1) * (e.key === "ArrowRight" ? 1 : -1);
    const others = tl.scenes.reduce((a, x) => a + x.dur, 0) - s.dur;
    const dur = Math.round(Math.min(Math.max(s.dur + step, MIN_DUR), MAX_DUR, MAX_TOTAL - others) * fps) / fps;
    if (dur !== s.dur) onChange(withScenes(tl, tl.scenes.map((x) => (x.id === s.id ? { ...x, dur } : x))));
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

  // ---------------- SFX nyala/mati ----------------
  const toggleSfx = (si: number, ci: number) => {
    const sc = tl.scenes[si];
    const cue = sc?.sfx[ci];
    if (!cue) return;
    onChange({ ...tl, scenes: tl.scenes.map((s, i) => (i === si ? { ...s, sfx: s.sfx.map((c, k) => (k === ci ? { ...c, on: !c.on } : c)) } : s)) });
    setNote(`${cue.on ? "🔇" : "🔊"} ${cue.id} ${cue.on ? "dimatikan" : "dinyalakan"} (${sc.name})`);
  };

  const snapAll = () => {
    const snapped = snapScenesToBeats(tl, beats);
    // adegan premium teaser tidak ikut digeser (sudah di ketukan 0,6 dtk; animasinya sinkron dengan batas itu)
    const next = snapped === tl ? tl : { ...snapped, scenes: snapped.scenes.map((s, i) => (isTeaserScene(tl.scenes[i]) ? { ...s, dur: tl.scenes[i].dur } : s)) };
    const changed = next.scenes.some((s, i) => Math.abs(s.dur - tl.scenes[i].dur) > 1e-6);
    // total lewat 3 menit -> adegan terakhir nanti dibuang diam-diam saat dirapikan, jadi ditolak
    if (changed && totalSec(next) > MAX_TOTAL + 1e-6) return setNote(`Tidak ditempel: total video jadi lewat ${MAX_TOTAL} dtk. Pendekkan adegan dulu.`);
    if (changed) onChange(withScenes(tl, next.scenes));
    const locked = tl.scenes.some(isTeaserScene);
    setNote(changed ? "🎯 Potongan adegan sudah nempel ke ketukan musik" : locked ? "🔒 Adegan premium teaser sudah dikunci di ketukan" : "Potongan sudah pas di ketukan");
  };

  // penggaris: label tiap 1/2/5/10/… dtk, minimal 44 px antarlabel
  const step = [1, 2, 5, 10, 15, 30, 60].find((s) => s * pps >= 44) ?? 60;
  const ticks: number[] = [];
  for (let t = 0; t <= total + 1e-6; t += step) ticks.push(t);
  const beatStep = beats.length > 1 ? beats[1] - beats[0] : 0;
  const showBeats = beats.length > 1 && beatStep * pps >= 5;
  const beatInfo = tl.music?.src === "none" ? null : tl.music?.src === "bed" ? `Trailer bed · ${BED_BPM} BPM` : tl.music?.beats?.length ? "Ketukan musik terdeteksi" : tl.music?.bpm ? `${Math.round(tl.music.bpm)} BPM` : null;

  return (
    <div className="card min-w-0 p-3 sm:p-4">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="label mb-0">Timeline</div>
        <div className="text-xs text-zinc-400">
          Total <b className="text-zinc-200">{fmt(total)} dtk</b> · {tl.scenes.length} adegan
        </div>
        <div className="ml-auto flex items-center gap-1.5">
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
                const long = !!line && (line.at ?? 0.15) + line.dur + 0.05 > s.dur;
                return (
                  <div
                    key={s.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={sel}
                    title={`${i + 1}. ${s.name} · ${fmt(s.dur, 2)} dtk`}
                    onClick={() => onSelect(s.id)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
                      e.preventDefault();
                      onSelect(s.id);
                    }}
                    className={`group absolute top-1.5 bottom-1.5 overflow-hidden rounded-lg border text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-orange-500/60 ${
                      sel ? "border-orange-500 bg-orange-500/15" : i % 2 ? "border-zinc-700 bg-zinc-800/80 hover:border-zinc-600" : "border-zinc-700 bg-zinc-800/50 hover:border-zinc-600"
                    } ${long ? "ring-1 ring-inset ring-red-500/70" : ""}`}
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
                    {/* pegangan ubah durasi (adegan premium teaser: dikunci, tampil gembok) */}
                    {isTeaserScene(s) ? (
                      <div
                        title="Durasi dikunci di ketukan musik (adegan premium)"
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
                      className={`absolute right-0 top-0 flex h-full w-3.5 cursor-ew-resize items-center justify-center ${dragging ? "bg-orange-500/40" : "bg-zinc-700/30 group-hover:bg-zinc-600/50"}`}
                      style={{ touchAction: "none" }}
                      onPointerDown={(e) => onHandleDown(e, i)}
                      onPointerMove={onHandleMove}
                      onPointerUp={() => endDrag(true)}
                      onPointerCancel={() => endDrag(false)}
                      onLostPointerCapture={() => drag.current && endDrag(true)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => onHandleKey(e, i)}
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
                return (
                  <button
                    key={`${d.si}-${d.ci}`}
                    type="button"
                    aria-label={`${d.cue.id} ${d.cue.on ? "nyala" : "mati"}`}
                    title={`${d.cue.id}${d.meta?.use ? ` — ${d.meta.use}` : ""}\n${fmt(d.t, 2)} dtk · klik untuk ${d.cue.on ? "matikan" : "nyalakan"}`}
                    onClick={() => toggleSfx(d.si, d.ci)}
                    className="absolute flex h-5 w-5 -translate-x-1/2 items-center justify-center"
                    style={{ left: d.x, top: 1 + d.lane * 11 }}
                  >
                    <span className={`block h-2.5 w-2.5 rounded-full ${d.cue.on ? `${c.dot} ring-2 ring-zinc-950` : "bg-transparent opacity-70 ring-1 ring-zinc-500"}`} />
                  </button>
                );
              })}
              {!dots.length && <div className="px-2 text-[11px] leading-[44px] text-zinc-600">Belum ada SFX</div>}
            </div>

            {/* blok VO */}
            <div className="relative border-t border-zinc-800/70" style={{ height: ROW.vo }}>
              {voLines.map((l) => {
                const i = scenes.findIndex((s) => s.id === l.sceneId);
                if (i < 0) return null;
                const at = l.at ?? 0.15;
                const over = at + l.dur + 0.05 > scenes[i].dur;
                return (
                  <div
                    key={l.sceneId}
                    title={`VO ${scenes[i].name} · ${fmt(l.dur, 2)} dtk${over ? " — lebih panjang dari adegan" : ""}`}
                    className={`absolute top-1 bottom-1 overflow-hidden rounded border px-1 text-[9px] leading-[12px] ${
                      over ? "border-red-500/70 bg-red-500/20 text-red-300" : tl.vo?.temp ? "border-amber-400/60 bg-amber-400/20 text-amber-300" : "border-emerald-400/60 bg-emerald-400/20 text-emerald-300"
                    }`}
                    style={{ left: (starts[i] + at) * pps, width: Math.max(4, l.dur * pps) }}
                  >
                    {l.dur * pps > 26 ? "VO" : ""}
                  </div>
                );
              })}
              {!voLines.length && (
                <div className="px-2 text-[11px] leading-[22px] text-zinc-600">{!voOn ? "Tanpa VO" : hasVoText ? "VO belum dibuat" : "Belum ada naskah VO"}</div>
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

      <div className="mt-2 flex min-h-[18px] flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
        {note ? (
          <span className="font-semibold text-orange-400">{note}</span>
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
              {scenes.length > 0 && scenes.every(isTeaserScene)
                ? "· 🔒 Durasi adegan premium dikunci di ketukan, klik titik SFX untuk nyala/mati"
                : "· Tarik tepi kanan blok untuk ubah durasi, klik titik SFX untuk nyala/mati"}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
