"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BED_BPM } from "@/components/remotion/studio/audio";
import type { Catalog } from "@/lib/studio/client";
import { SFX_BUILTIN } from "@/lib/studio/sfxMeta";
import { BRANDS, FORMATS, MAX_SCENES, MAX_TOTAL, RATIOS, beatGrid, snapScenesToBeats, totalSec, type Brand, type BrandId, type Ratio, type Scene, type Timeline } from "@/lib/studio/timeline";
import { storagePathOf } from "@/lib/studio/urls";
import SceneCard, { type ScenePatch, type SfxItem } from "./SceneCard";
import { Field, Seg, Toggle, Txt, UploadBtn } from "./fields";
import { VOICE_LABEL, fmtSec, tidyTimeline } from "./planUtils";

type Props = {
  timeline: Timeline;
  onChange: (tl: Timeline) => void;
  catalog: Catalog | null;
  selected: string | null;
  onSelect: (sceneId: string) => void;
};

const HEX = /^#[0-9a-f]{6}$/i;
const EDGE_NAME: Record<string, string> = { "id-ID-ArdiNeural": "Ardi (pria)", "id-ID-GadisNeural": "Gadis (wanita)" };

/**
 * Kartu RENCANA DETAIL (format mengikuti naskah VO + cue sheet): konsep, hook, gaya, brand, suara, musik,
 * lalu kartu per adegan. Semua bisa diedit sebelum render; tiap perubahan dinormalisasi supaya tetap valid.
 */
function PlanCard({ timeline: tl, onChange, catalog, selected, onSelect }: Props) {
  const ref = useRef(tl);
  ref.current = tl;
  const cat = useRef(catalog);
  cat.current = catalog;
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  /** satu-satunya pintu perubahan: fn(timeline terbaru) -> normalisasi -> onChange */
  const update = useCallback(
    (fn: (t: Timeline) => unknown) => {
      const next = tidyTimeline(fn(ref.current), cat.current);
      ref.current = next;
      onChange(next);
      return next;
    },
    [onChange],
  );
  const set = useCallback((p: Partial<Timeline>) => update((t) => ({ ...t, ...p })), [update]);

  // adegan dipilih dari luar (timeline / preview) -> buka kartunya & gulir ke sana (layar lebar saja)
  useEffect(() => {
    if (!selected) return;
    setOpen((o) => (o.has(selected) ? o : new Set(o).add(selected)));
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches)
      requestAnimationFrame(() => document.getElementById(`scene-${selected}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }, [selected]);

  const toggle = (id: string) => {
    if (open.has(id))
      setOpen((o) => {
        const n = new Set(o);
        n.delete(id);
        return n;
      });
    else {
      setOpen((o) => new Set(o).add(id));
      onSelect(id);
    }
  };
  const patch = useCallback(
    (id: string, p: ScenePatch) => update((t) => ({ ...t, scenes: t.scenes.map((s) => (s.id === id ? { ...s, ...(typeof p === "function" ? p(s) : p) } : s)) })),
    [update],
  );
  const move = useCallback(
    (id: string, d: -1 | 1) =>
      update((t) => {
        const i = t.scenes.findIndex((s) => s.id === id);
        const j = i + d;
        if (i < 0 || j < 0 || j >= t.scenes.length) return t;
        const scenes = [...t.scenes];
        [scenes[i], scenes[j]] = [scenes[j], scenes[i]];
        return { ...t, scenes };
      }),
    [update],
  );
  const dup = useCallback(
    (id: string) => {
      const i = ref.current.scenes.findIndex((s) => s.id === id);
      if (i < 0 || ref.current.scenes.length >= MAX_SCENES) return;
      // id kosong -> dibuatkan id baru oleh normalizeTimeline
      const next = update((t) => ({ ...t, scenes: [...t.scenes.slice(0, i + 1), { ...t.scenes[i], id: "", name: `${t.scenes[i].name} (salinan)`.slice(0, 40) }, ...t.scenes.slice(i + 1)] }));
      const nid = next.scenes[i + 1]?.id;
      if (nid) setOpen((o) => new Set(o).add(nid));
    },
    [update],
  );
  const del = useCallback((id: string) => update((t) => (t.scenes.length > 1 ? { ...t, scenes: t.scenes.filter((s) => s.id !== id) } : t)), [update]);
  const add = () => {
    if (tl.scenes.length >= MAX_SCENES) return;
    const blank: Partial<Scene> = { id: "", name: `Adegan ${tl.scenes.length + 1}`, dur: 3, text: ["Teks baru"], vo: null, visual: "", layout: { kind: "kinetic" }, sfx: [], music: "mid" };
    const next = update((t) => ({ ...t, scenes: [...t.scenes, blank] }));
    const nid = next.scenes[next.scenes.length - 1]?.id;
    if (nid) {
      setOpen((o) => new Set(o).add(nid));
      onSelect(nid);
    }
  };

  const sfxList: SfxItem[] = useMemo(() => catalog?.sfx ?? SFX_BUILTIN, [catalog]);
  const total = totalSec(tl);
  const allOpen = tl.scenes.every((s) => open.has(s.id));

  // ---------- brand ----------
  const pickBrand = (id: BrandId) =>
    set({ brand: id === "custom" ? { ...tl.brand, id: "custom", name: tl.brand.id === "custom" ? tl.brand.name : "Brand saya" } : { ...BRANDS[id], logo: tl.brand.logo ?? null } });
  const setBrand = (p: Partial<Brand>) => update((t) => ({ ...t, brand: { ...t.brand, ...p } }));

  // ---------- musik ----------
  const music = tl.music;
  const inList = music.src === "bed" || music.src === "none" || !!catalog?.music.some((m) => m.src === music.src);
  const pickMusic = (src: string) => {
    const keep = { offset: 0, gain: music.gain ?? 0, beats: null };
    if (src === "bed") return set({ music: { ...keep, src, name: "Trailer bed (cadangan)", bpm: BED_BPM, lufs: null } });
    if (src === "none") return set({ music: { ...keep, src, name: "Tanpa musik", bpm: null, lufs: null } });
    const m = catalog?.music.find((x) => x.src === src);
    set({ music: { ...keep, src, name: m?.name ?? music.name, bpm: null, lufs: m?.lufs ?? null } });
  };
  const beats = music.beats?.length ? music.beats : music.src === "bed" ? beatGrid(BED_BPM, 0, total + 1) : music.bpm ? beatGrid(music.bpm, music.offset ?? 0, total + 1) : [];
  const bpm = music.src === "bed" ? BED_BPM : music.bpm;

  const voice = tl.voice;
  const voiceName = voice.mode === "bank" ? voice.voiceName : voice.mode === "edge" ? EDGE_NAME[voice.edgeVoice ?? ""] : null;

  return (
    <section id="studio-plan" aria-label="Rencana video" className="card space-y-4 p-3.5 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-display text-[17px] font-bold">📋 Rencana video</h2>
          <p className="text-[12px] text-zinc-500">
            {tl.scenes.length} adegan · {fmtSec(total)} · {tl.ratio} · cek & ubah dulu sebelum download
          </p>
        </div>
      </div>

      {/* ringkasan */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Judul video" className="sm:col-span-2">
          {(id) => <Txt id={id} value={tl.title} maxLength={80} onCommit={(title) => set({ title })} />}
        </Field>
        <Field label="💡 Konsep" className="sm:col-span-2">
          {(id) => <Txt id={id} multiline rows={3} value={tl.concept} maxLength={600} onCommit={(concept) => set({ concept })} />}
        </Field>
        <Field label="⚡ Hook (1,5 detik pertama)" className="sm:col-span-2" hint="Kalimat/visual pembuka yang bikin orang berhenti scroll.">
          {(id) => <Txt id={id} value={tl.hook} maxLength={200} onCommit={(hook) => set({ hook })} />}
        </Field>
        <Field label="Tayang di">{(id) => <Txt id={id} value={tl.platform} maxLength={60} onCommit={(platform) => set({ platform })} />}</Field>
        <Field label="Tujuan">{(id) => <Txt id={id} value={tl.goal} maxLength={160} onCommit={(goal) => set({ goal })} />}</Field>
        <Field label="Suasana (mood)">{(id) => <Txt id={id} value={tl.mood} maxLength={80} onCommit={(mood) => set({ mood })} />}</Field>
        <div>
          <div className="mb-1 text-xs font-semibold text-zinc-400">Ukuran video</div>
          <Seg<Ratio> label="Ukuran video" value={tl.ratio} options={RATIOS.map((r) => [r, r] as const)} onChange={(ratio) => set({ ratio, platform: tl.platform === FORMATS[tl.ratio].label ? FORMATS[ratio].label : tl.platform })} />
          <div className="mt-1 text-[11px] text-zinc-500">{FORMATS[tl.ratio].label}</div>
        </div>
      </div>

      {/* brand */}
      <div className="space-y-2.5 rounded-xl border border-zinc-800/80 p-2.5 sm:p-3">
        <div className="text-xs font-semibold text-zinc-400">🎨 Brand</div>
        <Seg<BrandId>
          label="Brand"
          value={tl.brand.id}
          options={[
            ["konten", "Konten.com"],
            ["tws", "TWS"],
            ["custom", "Lainnya"],
          ]}
          onChange={pickBrand}
        />
        <div className="flex flex-wrap items-end gap-3">
          {tl.brand.id === "custom" && (
            <Field label="Nama brand" className="w-full sm:w-48">
              {(id) => <Txt id={id} value={tl.brand.name} maxLength={40} onCommit={(name) => setBrand({ name })} />}
            </Field>
          )}
          <ColorPick label="Warna utama" value={tl.brand.primary} onChange={(primary) => setBrand({ primary })} />
          <ColorPick label="Warna aksen" value={tl.brand.accent} onChange={(accent) => setBrand({ accent })} />
          <div className="flex flex-wrap items-center gap-2">
            <UploadBtn accept="image/*" sub="logo" label={tl.brand.logo ? "🔁 Ganti logo" : "⬆️ Logo"} onDone={(r) => setBrand({ logo: r.src })} />
            {tl.brand.logo && (
              <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-zinc-400">
                <span className="max-w-[140px] truncate">🏷️ {storagePathOf(tl.brand.logo)?.split("/").pop() ?? "logo"}</span>
                <button type="button" className="font-semibold text-zinc-500 hover:text-red-400" onClick={() => setBrand({ logo: null })}>
                  Lepas
                </button>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* suara & musik */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2 rounded-xl border border-zinc-800/80 p-2.5 sm:p-3">
          <div className="text-xs font-semibold text-zinc-400">🎙️ Suara VO</div>
          <p className="text-[13px] text-zinc-200">
            {tl.muteVo ? "Tanpa suara VO" : `${VOICE_LABEL[voice.mode]}${voiceName ? ` · ${voiceName}` : ""}`}
          </p>
          <p className="text-[11.5px] text-zinc-500">
            {tl.muteVo ? "Video cuma musik + SFX + teks." : tl.vo ? `${tl.vo.temp ? "VO sementara" : "VO"} sudah dibuat${tl.vo.label ? ` · ${tl.vo.label}` : ""}.` : "VO belum dibuat."} Atur & buat suaranya di panel Suara VO.
          </p>
          <Toggle on={!!tl.muteVo} onChange={(muteVo) => set({ muteVo })}>
            Tanpa suara VO
          </Toggle>
        </div>
        <div className="space-y-2 rounded-xl border border-zinc-800/80 p-2.5 sm:p-3">
          <Field label="🎵 Musik" hint={music.src === "none" ? "Video tanpa musik." : bpm ? `Tempo ±${Math.round(bpm)} BPM` : "Tempo (BPM) belum dideteksi."}>
            {(id) => (
              <select id={id} className="input py-2 text-[13px]" value={music.src} onChange={(e) => pickMusic(e.target.value)}>
                {catalog?.music.map((m) => (
                  <option key={m.src} value={m.src}>
                    🎵 {m.name}
                  </option>
                ))}
                {!inList && <option value={music.src}>🎵 {music.name || "Musik upload"}</option>}
                <option value="bed">🥁 Trailer bed (cadangan)</option>
                <option value="none">🔇 Tanpa musik</option>
              </select>
            )}
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <UploadBtn accept="audio/*" sub="music" label="⬆️ Upload musik" onDone={(r) => set({ music: { src: r.src, name: r.name.replace(/\.[^.]+$/, "").slice(0, 80), bpm: null, beats: null, offset: 0, gain: music.gain ?? 0, lufs: null } })} />
            <button
              type="button"
              disabled={beats.length < 2 || music.src === "none"}
              title={beats.length < 2 ? "Tempo musik belum diketahui" : "Geser batas adegan ke ketukan terdekat"}
              className="btn-ghost px-2.5 py-1.5 text-[12px]"
              onClick={() => update((t) => snapScenesToBeats(t, beats))}
            >
              🥁 Pas-kan ke ketukan
            </button>
          </div>
          {music.src !== "none" && (
            <label className="block text-[12px] text-zinc-400">
              <span className="flex justify-between">
                <span>Volume musik</span>
                <span className="tabular-nums text-zinc-500">{(music.gain ?? 0) > 0 ? "+" : ""}{music.gain ?? 0}</span>
              </span>
              <input
                type="range"
                min={-12}
                max={6}
                step={1}
                value={music.gain ?? 0}
                aria-label="Volume musik"
                className="mt-1 w-full accent-orange-500"
                onChange={(e) => set({ music: { ...music, gain: Number(e.target.value) } })}
              />
            </label>
          )}
        </div>
      </div>

      {/* adegan */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[13.5px] font-bold text-zinc-200">🎬 Adegan</h3>
          <button
            type="button"
            className="text-[12px] font-semibold text-zinc-500 hover:text-zinc-200"
            onClick={() => setOpen(allOpen ? new Set() : new Set(tl.scenes.map((s) => s.id)))}
          >
            {allOpen ? "Tutup semua" : "Buka semua"}
          </button>
        </div>
        {tl.scenes.map((s, i) => (
          <SceneCard
            key={s.id}
            scene={s}
            index={i}
            count={tl.scenes.length}
            open={open.has(s.id)}
            selected={selected === s.id}
            sfxList={sfxList}
            onToggle={toggle}
            onPatch={patch}
            onMove={move}
            onDup={dup}
            onDel={del}
          />
        ))}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <button type="button" className="btn-ghost px-3 py-2 text-[12.5px]" disabled={tl.scenes.length >= MAX_SCENES || total >= MAX_TOTAL - 0.5} onClick={add}>
            ＋ Tambah adegan
          </button>
          <span className="text-[11px] text-zinc-500">
            Maks {MAX_SCENES} adegan · {MAX_TOTAL} detik
          </span>
        </div>
        <p className="text-[11.5px] text-zinc-500">💬 Mau revisi cepat? Ketik aja di chat, mis. “adegan 3 lebih cepat” atau “ganti musiknya lebih santai”.</p>
      </div>
    </section>
  );
}

/** pilih warna: kotak warna + kode hex */
function ColorPick({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const full = HEX.test(value) ? value : value.length === 4 ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}` : "#f97316";
  return (
    <Field label={label}>
      {(id) => (
        <div className="flex items-center gap-1.5">
          <input id={id} type="color" value={full} onChange={(e) => onChange(e.target.value)} className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-zinc-700 bg-transparent p-0.5" />
          <Txt label={`${label} (kode)`} value={value} maxLength={9} className="w-24 font-mono text-[12px]" onCommit={onChange} />
        </div>
      )}
    </Field>
  );
}

export default memo(PlanCard);
