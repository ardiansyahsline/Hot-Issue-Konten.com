/**
 * GAYA BICARA bank suara (Chatterbox di laptop): preset ekspresi / tempo / variasi supaya VO tidak kedengeran "AI banget".
 * Disimpan di timeline.voice: `preset` (natural | promo | tenang | kustom) + angka yang dipakai (`exaggeration`, `cfg`,
 * `temperature`). Angka = sumber kebenaran: preset bernama yang angkanya sudah diubah (AI sutradara / skill) dibaca sebagai Kustom.
 * Modul tanpa import nilai (hanya tipe) supaya aman dipakai timeline.ts, server, maupun browser.
 *
 * Catatan tuning (README Chatterbox): exaggeration 0,5 & cfg 0,5 = bicara wajar; exaggeration makin tinggi makin ekspresif
 * (dan cepat); cfg makin tinggi = tempo lebih cepat & rapat (percepatan atempo di adegan teaser jadi jarang), makin rendah makin
 * santai; temperature = variasi intonasi antar-versi (0,8 bawaan).
 */
import type { Timeline, Voice } from "./timeline";

export type VoicePreset = "natural" | "promo" | "tenang" | "kustom";
export type NamedPreset = Exclude<VoicePreset, "kustom">;
export type VoiceStyle = { preset: VoicePreset; exaggeration: number; cfg: number; temperature: number };

export const VOICE_PRESETS: readonly { id: NamedPreset; label: string; hint: string; exaggeration: number; cfg: number; temperature: number }[] = [
  { id: "natural", label: "Natural ngobrol", hint: "Santai kayak ngobrol — paling nggak kedengeran AI.", exaggeration: 0.5, cfg: 0.5, temperature: 0.8 },
  { id: "promo", label: "Promo energik", hint: "Semangat & cepat untuk iklan / teaser.", exaggeration: 0.65, cfg: 0.5, temperature: 0.85 },
  { id: "tenang", label: "Tenang meyakinkan", hint: "Pelan & mantap untuk penjelasan.", exaggeration: 0.4, cfg: 0.35, temperature: 0.75 },
];
export const PRESET_IDS: readonly VoicePreset[] = [...VOICE_PRESETS.map((p) => p.id), "kustom"];

/** rentang slider (sama dengan normalizeTimeline) */
export const EXG_MIN = 0.25;
export const EXG_MAX = 1;
export const CFG_MIN = 0.1;
export const CFG_MAX = 1;
export const TEMP_MIN = 0.5;
export const TEMP_MAX = 1;
/** jumlah versi per potongan yang diminta ke laptop (dipilih yang paling jelas & natural) */
export const BANK_TAKES = 3;
/** angka lama tanpa preset (Studio 0,65/0,35; contoh di prompt sutradara 0,6/0,4) = belum dipilih user → ikut preset bawaan */
const LEGACY: readonly (readonly [number, number])[] = [
  [0.65, 0.35],
  [0.6, 0.4],
];

const near = (a: number, b: number) => Math.abs(a - b) < 1e-3;
const round2 = (n: number) => Math.round(n * 100) / 100;
const clampNum = (v: unknown, lo: number, hi: number): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? parseFloat(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) ? round2(Math.min(hi, Math.max(lo, n))) : undefined;
};

/** preset dari data: id dikenal (huruf kecil) atau undefined */
export const normPreset = (v: unknown): VoicePreset | undefined => {
  const k = typeof v === "string" ? v.trim().toLowerCase() : "";
  return (PRESET_IDS as readonly string[]).includes(k) ? (k as VoicePreset) : undefined;
};
/** variasi (temperature) dari data: angka / "0,8" → 0,5–1,0 (2 desimal); selain itu undefined */
export const normTemperature = (v: unknown): number | undefined => clampNum(v, TEMP_MIN, TEMP_MAX);

export const presetOf = (id: NamedPreset) => VOICE_PRESETS.find((p) => p.id === id)!;
/** preset bawaan: teaser = Promo energik (tempo asli lebih cepat → jarang perlu dipercepat), selain itu Natural ngobrol */
export const defaultPreset = (teaser: boolean): NamedPreset => (teaser ? "promo" : "natural");
/** timeline berisi adegan premium teaser */
export const isTeaserTimeline = (t: Pick<Timeline, "scenes"> | null | undefined): boolean => !!t?.scenes?.some((s) => s?.layout?.kind === "teaser");

const styleOf = (p: NamedPreset): VoiceStyle => {
  const x = presetOf(p);
  return { preset: p, exaggeration: x.exaggeration, cfg: x.cfg, temperature: x.temperature };
};
/** angka cocok dengan preset bernama mana (urut VOICE_PRESETS), kalau ada */
const matchPreset = (s: Omit<VoiceStyle, "preset">): NamedPreset | undefined =>
  VOICE_PRESETS.find((p) => near(p.exaggeration, s.exaggeration) && near(p.cfg, s.cfg) && near(p.temperature, s.temperature))?.id;

/**
 * Gaya bicara yang dipakai untuk suara ini:
 * - tanpa preset & angka kosong / angka lama bawaan (LEGACY) → preset bawaan (teaser: Promo energik, lainnya: Natural ngobrol)
 * - preset bernama → angkanya; angka tersimpan yang beda dari preset (diubah AI / skill) → Kustom dengan angka itu
 * - "kustom" / tanpa preset dengan angka sendiri → Kustom (yang kosong: 0,65 / 0,35 / 0,8 seperti dulu)
 */
export function voiceStyle(v: Pick<Voice, "exaggeration" | "cfg" | "preset" | "temperature"> | null | undefined, teaser = false): VoiceStyle {
  const exg = v?.exaggeration;
  const cfg = v?.cfg;
  const temp = v?.temperature;
  const preset = normPreset(v?.preset);
  if (!preset && temp === undefined) {
    if (exg === undefined && cfg === undefined) return styleOf(defaultPreset(teaser));
    if (exg !== undefined && cfg !== undefined && LEGACY.some(([e, c]) => near(e, exg) && near(c, cfg))) return styleOf(defaultPreset(teaser));
  }
  if (preset && preset !== "kustom") {
    const base = styleOf(preset);
    const s = { exaggeration: exg ?? base.exaggeration, cfg: cfg ?? base.cfg, temperature: temp ?? base.temperature };
    return matchPreset(s) === preset ? base : { preset: "kustom", ...s };
  }
  const k = preset === "kustom" ? styleOf(defaultPreset(teaser)) : { exaggeration: 0.65, cfg: 0.35, temperature: 0.8 };
  return {
    preset: "kustom",
    exaggeration: clampNum(exg, EXG_MIN, EXG_MAX) ?? k.exaggeration,
    cfg: clampNum(cfg, CFG_MIN, CFG_MAX) ?? k.cfg,
    temperature: normTemperature(temp) ?? k.temperature,
  };
}

/** isi timeline.voice untuk gaya bicara ini (preset + angka yang dipakai, supaya skill / ekspor membaca angka yang sama) */
export const voicePatch = (s: VoiceStyle): Pick<Voice, "preset" | "exaggeration" | "cfg" | "temperature"> => ({
  preset: s.preset,
  exaggeration: round2(s.exaggeration),
  cfg: round2(s.cfg),
  temperature: round2(s.temperature),
});

/** setelan job bank suara (laptop) — sama persis untuk "Generate ulang VO", 🔊 Dengar & buat ulang satu kalimat (cache laptop) */
export function bankSettings(t: Pick<Timeline, "voice" | "scenes">): { exaggeration: number; cfg_weight: number; temperature: number; takes: number } {
  const s = voiceStyle(t.voice, isTeaserTimeline(t));
  return { exaggeration: s.exaggeration, cfg_weight: s.cfg, temperature: s.temperature, takes: BANK_TAKES };
}

/** label singkat: "Promo energik" / "Kustom (ekspresi 0,7 · tempo 0,4 · variasi 0,9)" */
export function styleLabel(s: VoiceStyle): string {
  const f = (n: number) => String(round2(n)).replace(".", ",");
  return s.preset === "kustom" ? `Kustom (ekspresi ${f(s.exaggeration)} · tempo ${f(s.cfg)} · variasi ${f(s.temperature)})` : presetOf(s.preset).label;
}
