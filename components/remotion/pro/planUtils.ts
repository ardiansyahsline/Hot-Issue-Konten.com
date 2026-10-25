/**
 * Label awam & helper kecil untuk UI Studio Pro (kartu rencana, chat, proyek).
 * Semua perubahan timeline dari UI lewat `tidyTimeline` supaya tetap valid (normalizeTimeline).
 */
import { SFX_BUILTIN, type SfxMeta } from "@/lib/studio/sfxMeta";
import {
  normalizeTimeline,
  type BgKind,
  type Camera,
  type Dir,
  type LayoutKind,
  type MusicLevel,
  type ScreenKind,
  type Timeline,
  type TransitionKind,
  type VoiceMode,
} from "@/lib/studio/timeline";
import type { Catalog } from "@/lib/studio/client";

export const LAYOUT_LABEL: Record<LayoutKind, string> = {
  kinetic: "🔤 Teks bergerak",
  title: "🅰️ Judul besar",
  lowerThird: "🪪 Nama & jabatan",
  counter: "🔢 Angka berjalan",
  chart: "📈 Grafik",
  phone: "📱 Mockup HP",
  laptop: "💻 Mockup laptop",
  logo: "✨ Logo muncul",
  split: "↔️ Layar dibagi dua",
  features: "🧩 Kartu fitur",
  cta: "👉 Ajakan (CTA)",
  media: "🎞️ Klip / gambar",
  quote: "💬 Kutipan",
};

export const SCREEN_LABEL: Record<ScreenKind, string> = {
  dashboard: "Dashboard",
  hotIssue: "Hot Issue",
  videoReview: "Video Review",
  chat: "Chat tim",
  ai: "AI",
  design: "Desain berita",
  trainAi: "Train your AI",
  studio: "Studio",
  music: "Musik",
  report: "Laporan / PPT",
  website: "Website",
  media: "Media",
};

export const TRANSITION_LABEL: Record<TransitionKind, string> = {
  cut: "Potong langsung",
  fade: "Pudar",
  slide: "Geser",
  zoom: "Zoom",
  mask: "Sapuan",
  whip: "Kibas cepat",
  glitch: "Glitch",
};

export const DIR_LABEL: Record<Dir, string> = { left: "ke kiri", right: "ke kanan", up: "ke atas", down: "ke bawah" };

export const CAMERA_LABEL: Record<Camera, string> = {
  none: "Diam",
  push: "Maju pelan",
  pull: "Mundur pelan",
  pan: "Geser samping",
  tilt: "Geser atas-bawah",
};

export const MUSIC_LABEL: Record<MusicLevel, string> = {
  silent: "Hening",
  low: "Pelan",
  mid: "Sedang",
  high: "Keras",
  drop: "Puncak (drop)",
};

export const BG_LABEL: Record<BgKind, string> = {
  gradient: "Gradasi",
  particles: "Partikel",
  solid: "Polos",
  grid: "Kotak-kotak",
  media: "Klip / gambar",
};

export const VOICE_LABEL: Record<VoiceMode, string> = {
  bank: "Bank suara (laptop)",
  edge: "Suara cadangan",
  elevenlabs: "Premium (ElevenLabs)",
  none: "Tanpa suara",
};

const BUILTIN = new Set(SFX_BUILTIN.map((s) => s.id));

/** SFX katalog yang bukan bawaan (Freesound / tambahan) — diteruskan ke StudioVideo & normalizeTimeline */
export const sfxExtraOf = (c: Catalog | null): SfxMeta[] => (c ? c.sfx.filter((s) => !BUILTIN.has(s.id)) : []);

/** placeholder untuk id SFX tambahan saat katalog belum termuat (supaya cue-nya tidak ikut terbuang) */
const keepMeta = (id: string): SfxMeta => ({ id, file: "", cat: "ui", tags: [], dur: 1, lufs: -20, tp: -3, hit: 0, peak: 0, use: "" });

const DATA_AUDIO = /^data:audio\/[\w.+-]+;base64,[A-Za-z0-9+/=]+$/;
const DATA_MARK = "/api/studio/file?p=__vo_data__";

/**
 * VO cadangan saat penyimpanan server mati dikirim sebagai data URL (data:audio/…;base64).
 * normalizeTimeline hanya menerima URL route Studio, jadi baris itu ditandai dulu lalu dikembalikan
 * supaya editan rencana tidak menghapus VO yang sudah dibuat.
 */
function markDataVo(raw: unknown): { input: unknown; datas: string[] } {
  const datas: string[] = [];
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const vo = o?.vo && typeof o.vo === "object" ? (o.vo as Record<string, unknown>) : null;
  if (!o || !vo || !Array.isArray(vo.lines)) return { input: raw, datas };
  const lines = vo.lines.map((l) => {
    const src = (l as { src?: unknown } | null)?.src;
    if (typeof src !== "string" || !src.startsWith("data:audio/") || !DATA_AUDIO.test(src)) return l;
    datas.push(src);
    return { ...(l as object), src: `${DATA_MARK}${datas.length - 1}` };
  });
  return datas.length ? { input: { ...o, vo: { ...vo, lines } }, datas } : { input: raw, datas };
}

/**
 * Bersihkan timeline (dari AI / DB / editan) — wajib dipakai sebelum disimpan.
 * Katalog sudah ada -> SFX yang tidak dikenal dibuang. Katalog belum ada -> id tambahan dipertahankan dulu.
 */
export function tidyTimeline(rawIn: unknown, catalog: Catalog | null): Timeline {
  const { input: raw, datas } = markDataVo(rawIn);
  const extra = sfxExtraOf(catalog);
  if (!catalog && raw && typeof raw === "object") {
    const scenes = (raw as { scenes?: unknown }).scenes;
    const ids = new Set<string>();
    if (Array.isArray(scenes))
      for (const s of scenes) {
        const cues = (s as { sfx?: unknown } | null)?.sfx;
        if (Array.isArray(cues))
          for (const c of cues) {
            const id = typeof c === "string" ? c : (c as { id?: unknown } | null)?.id;
            if (typeof id === "string" && id && !BUILTIN.has(id)) ids.add(id);
          }
      }
    extra.push(...[...ids].map(keepMeta));
  }
  const tl = normalizeTimeline(raw, { extraSfx: extra });
  if (datas.length && tl.vo)
    tl.vo = {
      ...tl.vo,
      lines: tl.vo.lines.map((l) => {
        const i = l.src.startsWith(DATA_MARK) ? Number(l.src.slice(DATA_MARK.length)) : -1;
        return i >= 0 && datas[i] ? { ...l, src: datas[i] } : l;
      }),
    };
  return tl;
}

const isData = (s: string | null | undefined) => !!s && s.startsWith("data:");

/** timeline untuk dikirim ke chat: baris VO data URL dibuang (besar & tidak dibaca AI) */
export function withoutDataVo(tl: Timeline | null): Timeline | null {
  if (!tl?.vo?.lines.some((l) => isData(l.src))) return tl;
  const lines = tl.vo.lines.filter((l) => !isData(l.src));
  return { ...tl, vo: lines.length ? { ...tl.vo, lines, full: isData(tl.vo.full) ? null : tl.vo.full } : null };
}

/** setelah revisi dari chat: VO data URL tetap dipakai untuk adegan yang id & teks VO-nya tidak berubah */
export function keepDataVo(prev: Timeline | null, next: Timeline): Timeline {
  const old = prev?.vo?.lines.filter((l) => isData(l.src)) ?? [];
  if (!prev?.vo || !old.length) return next;
  const same = (id: string) => {
    const a = prev.scenes.find((s) => s.id === id)?.vo;
    const b = next.scenes.find((s) => s.id === id)?.vo;
    return !!a && !!b && a.text === b.text && (a.spell ?? "") === (b.spell ?? "");
  };
  const have = new Set(next.vo?.lines.map((l) => l.sceneId));
  const add = old.filter((l) => same(l.sceneId) && !have.has(l.sceneId));
  if (!add.length) return next;
  const base = next.vo ?? { ...prev.vo, lines: [], full: null };
  return { ...next, vo: { ...base, lines: [...base.lines, ...add], full: null } };
}

/** 2,5 dtk (koma desimal ala Indonesia) */
export const fmtSec = (s: number, d = 1) => `${(Math.round(s * 10 ** d) / 10 ** d).toString().replace(".", ",")} dtk`;

/** angka -> teks input (koma desimal, maks 2 angka di belakang koma) */
export const numText = (n: number | undefined | null) => (n === undefined || n === null || !Number.isFinite(n) ? "" : String(Math.round(n * 100) / 100).replace(".", ","));

/** teks input -> angka (terima koma / titik). null kalau bukan angka */
export function parseNum(s: string): number | null {
  const n = parseFloat(s.trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** daftar dipisah koma -> array teks bersih */
export const commaList = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/** pesan error Supabase -> kalimat awam */
export function dbErrorText(e: { code?: string; message?: string } | null | undefined, fallback = "Gagal menyimpan. Coba lagi sebentar."): string {
  const code = e?.code ?? "";
  const msg = e?.message ?? "";
  if (code === "42P01" || code === "PGRST205" || /schema cache|does not exist/i.test(msg)) return "Database Studio belum siap. Minta admin menjalankan migration-20-studio.sql.";
  if (code === "42501" || /row-level security|permission denied/i.test(msg)) return "Kamu belum punya akses Studio. Minta akses ke admin.";
  if (/fetch|network|Failed to fetch/i.test(msg)) return "Koneksi internet terputus. Coba lagi sebentar.";
  return fallback;
}
