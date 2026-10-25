/**
 * Teaser resmi CS Tracker (premium trailer, 9:16, 30 fps, ±60 dtk) — mengikuti assets/audio/teaser/cue-sheet.md (11 baris)
 * & naskah-vo.md apa adanya. Semua batas adegan jatuh di ketukan trailer bed 100 BPM (kelipatan 0,6 dtk); musik berhenti
 * di ketukan terakhir (59,4 dtk) lalu hening ±0,5 dtk (ekor komposisi).
 * Isi visual tiap adegan = components/remotion/studio/teaser (layout.kind "teaser").
 */
import { BRANDS, normalizeTimeline, type MusicLevel, type SfxCue, type TeaserShot, type Timeline, type TransitionKind, type Dir } from "./timeline";

type Row = {
  shot: TeaserShot;
  name: string;
  dur: number;
  vo: string;
  spell: string;
  text: string[];
  visual: string;
  sfx: [string, number][];
  music: MusicLevel;
  tr: TransitionKind;
  dir?: Dir;
};

/** cue sheet → adegan. `sfx` = [id, detik dari awal adegan (titik pukulan)] */
const ROWS: Row[] = [
  {
    shot: "hook",
    name: "Hook",
    dur: 3.0,
    vo: "Hot issue numpuk… chat tim berantakan…",
    spell: "Hot isyu numpuk… chat tim berantakan…",
    text: ["Hot issue numpuk?", "Chat tim berantakan?"],
    visual: "Potongan cepat masalah: hot issue numpuk, chat berantakan, data kececer",
    sfx: [["glitch-error", 0], ["ambience-gelap", 0], ["ui-snap", 0.6], ["braam-transisi-gelap", 1.2], ["ui-snap", 1.8], ["ui-snap", 2.4]],
    music: "low",
    tr: "cut",
  },
  {
    shot: "reveal",
    name: "Reveal",
    dur: 2.4,
    vo: "Kenalin. CS Tracker.",
    spell: "Kenalin. Si-es Treker.",
    text: ["CS Tracker"],
    visual: "Logo CS Tracker + light sweep",
    sfx: [["riser-blastoff", 0], ["braam-epik-1", 0], ["impact-chord", 0]],
    music: "high",
    tr: "zoom",
  },
  {
    shot: "dashboard",
    name: "Dashboard + Hot Issue",
    dur: 4.8,
    vo: "Semua hot issue langsung ke-ranking otomatis. Yang paling panas, paling atas.",
    spell: "Semua hot isyu langsung ke-renking otomatis. Yang paling panas, paling atas.",
    text: ["Paling panas, paling atas"],
    visual: "Angka berjalan, badge HOT naik ke #1",
    sfx: [["swoosh-readout", 0.1], ["koin-ting", 1.2], ["ui-scifi-ping", 2.4]],
    music: "mid",
    tr: "whip",
    dir: "left",
  },
  {
    shot: "videoReview",
    name: "Issue & Video Review",
    dur: 4.8,
    vo: "Video review? Cek, kasih status… beres.",
    spell: "Video riviu? Cek, kasih status… beres.",
    text: ["Cek, kasih status, beres"],
    visual: "Kartu kasus digeser, status dipilih (Menunggu → Diproses → Disetujui)",
    sfx: [["whoosh-cepat", 0.6], ["ui-accept-glassy", 1.8], ["whoosh-cepat", 2.4], ["ui-accept-glassy", 3.6]],
    music: "mid",
    tr: "slide",
    dir: "up",
  },
  {
    shot: "chat",
    name: "Chat tim",
    dur: 6.0,
    vo: "Ngobrol bareng tim, real-time. Satu tempat, nggak ada yang kelewat.",
    spell: "Ngobrol bareng tim, ril-taim. Satu tempat, nggak ada yang kelewat.",
    text: ["Satu tempat, real-time"],
    visual: "Bubble chat Alif, Derencalibur, Nengok, Irsyad, Natasha masuk, reaksi emoji, lampiran (identitas clipper diburamkan)",
    sfx: [["notif-chat", 0.3], ["notif-chat", 1.2], ["notif-chat", 2.1], ["notif-chat", 3.0], ["ui-accept-boing", 3.9], ["ui-pop", 4.8]],
    music: "low",
    tr: "mask",
  },
  {
    shot: "ai",
    name: "AI",
    dur: 12.0,
    vo: "Tanya AI soal hot issue, saham, sampai kripto. Dia mikir dulu… bahkan nanya balik, biar jawabannya pas.",
    spell: "Tanya E-ai soal hot isyu, saham, sampai kripto. Dia mikir dulu… bahkan nanya balik, biar jawabannya pas.",
    text: ["AI yang mikir dulu", "Bahkan nanya balik"],
    visual: "AskCard muncul & dipilih, hero MBTI + label dibantu oleh, langkah berpikir, jawaban, chart saham/kripto",
    sfx: [["ai-magic", 0], ["ui-arp-twinkle", 0.6], ["ui-accept-glassy", 3.0], ["ui-readout-panjang", 4.8], ["ui-plucks-happy", 7.2], ["koin-flip", 9.0]],
    music: "high",
    tr: "glitch",
  },
  {
    shot: "tws",
    name: "Desain berita (TWS)",
    dur: 7.2,
    vo: "Butuh konten berita? Sekali ketik… langsung jadi. Tinggal download.",
    spell: "Butuh konten berita? Sekali ketik… langsung jadi. Tinggal daun-lod.",
    text: ["Sekali ketik, langsung jadi"],
    visual: "Cover berita asli (MSCI, Prabowo) angka 3D slam, carousel geser, export Figma",
    sfx: [["bass-drop-cepat", 1.2], ["impact-cut-sweep", 1.2], ["kertas-balik-halaman", 3.0], ["kertas-balik-halaman", 4.2], ["ui-pop", 6.0]],
    music: "drop",
    tr: "zoom",
  },
  {
    shot: "trainAi",
    name: "Train your AI",
    dur: 6.0,
    vo: "Mau AI yang ngerti gaya kamu? Latih versimu sendiri.",
    spell: "Mau E-ai yang ngerti gaya kamu? Latih versimu sendiri.",
    text: ["Latih AI versimu"],
    visual: "Kuis diketuk, animasi tipe muncul, pilih peran",
    sfx: [["ui-snap", 0.6], ["ui-snap", 1.2], ["ui-snap", 1.8], ["ai-magic", 2.4], ["sukses-happy", 2.4], ["whoosh-confetti", 3.0], ["ui-pop", 4.8]],
    music: "high",
    tr: "whip",
    dir: "right",
  },
  {
    shot: "musicReport",
    name: "Musik + laporan/PPT",
    dur: 4.2,
    vo: "Plus musik, laporan, sampai PPT.",
    spell: "Plus musik, laporan, sampai pe-pe-te.",
    text: ["Musik, laporan, PPT"],
    visual: "Pemutar musik, halaman laporan/PPT dibalik",
    sfx: [["ui-plucks-happy", 0.6], ["kertas-balik-halaman", 2.4]],
    music: "high",
    tr: "slide",
    dir: "left",
  },
  {
    shot: "montage",
    name: "Montage + Studio",
    dur: 4.8,
    vo: "Dan video ini… juga dibikin di sini.",
    spell: "Dan video ini… juga dibikin di sini.",
    text: ["Dibikin di sini"],
    visual: "Potongan 0,3–0,6 dtk semua fitur di tiap ketukan, terakhir tampilan Studio",
    sfx: [["bass-drop-jumpstart", 0], ["transisi-shaker-snap", 0.6], ["transisi-snap-spin", 1.2], ["transisi-shaker-snap", 1.8], ["glitch-tinggi", 2.4], ["transisi-snap-spin", 3.0]],
    music: "drop",
    tr: "cut",
  },
  {
    shot: "outro",
    name: "Outro",
    dur: 4.2,
    vo: "CS Tracker. Kerja lebih cepat… bareng-bareng.",
    spell: "Si-es Treker. Kerja lebih cepat… bareng-bareng.",
    text: ["Kerja lebih cepat", "Bareng-bareng"],
    visual: "Logo + tagline + CTA, hit akhir, potong bersih",
    sfx: [["whoosh-debris", 0], ["boom-trailer-1", 0.6], ["braam-epik-2", 0.6]],
    music: "high",
    tr: "mask",
  },
];

/** timeline mentah (sebelum dinormalisasi) — juga dipakai sebagai contoh di Studio Pro */
export function teaserTimelineRaw(): Record<string, unknown> {
  return {
    v: 1,
    title: "Teaser CS Tracker",
    ratio: "9:16",
    fps: 30,
    brand: { ...BRANDS.konten },
    concept: "Masalah kerja tim CS → CS Tracker beresin semuanya: ranking hot issue, video review, chat tim, AI yang mikir dulu, desain berita, AI versimu, musik & laporan, sampai video ini dibikin di Studio.",
    hook: "Hot issue numpuk… chat tim berantakan…",
    platform: "Internal tim (TikTok/Reels 9:16)",
    goal: "Kenalkan semua fitur terbaru CS Tracker ke tim",
    mood: "trailer premium, energik, percaya diri",
    voice: { mode: "bank", voiceName: "Alif - Energik", exaggeration: 0.65, cfg: 0.35, edgeVoice: "id-ID-ArdiNeural" },
    music: { src: "bed", name: "Trailer bed (100 BPM)", bpm: 100 },
    grain: true,
    vignette: true,
    scenes: ROWS.map((r, i) => ({
      id: `teaser-${i + 1}-${r.shot}`,
      name: r.name,
      dur: r.dur,
      vo: { text: r.vo, spell: r.spell },
      text: r.text,
      visual: r.visual,
      layout: { kind: "teaser", shot: r.shot },
      bg: { kind: "gradient" },
      transition: { kind: r.tr, dir: r.dir ?? "left", dur: r.tr === "cut" ? 0 : r.tr === "whip" || r.tr === "glitch" ? 0.3 : 0.4 },
      camera: "none",
      ease: "spring",
      sfx: r.sfx.map(([id, at]): SfxCue => ({ id, at, on: true })),
      music: r.music,
      subtitles: true,
    })),
  };
}

/** timeline teaser yang sudah dinormalisasi (siap diputar / dirender) */
export function teaserTimeline(): Timeline {
  return normalizeTimeline(teaserTimelineRaw());
}

/** total detik isi teaser (tanpa ekor hening) */
export const TEASER_SECONDS = ROWS.reduce((a, r) => a + r.dur, 0);
