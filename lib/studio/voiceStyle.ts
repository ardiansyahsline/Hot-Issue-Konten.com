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

/** suara bank bawaan kalau proyek belum memilih (nama di tabel studio_voices) */
export const DEFAULT_BANK_VOICE = "Alif - Energik";

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
 * - tanpa preset dengan angka sendiri: data lama (tanpa variasi) → Kustom, yang kosong 0,65 / 0,35 / 0,8 seperti dulu; data baru
 *   (ada variasi, mis. rencana AI {temperature: 0.9}) → yang kosong dari preset bawaan; angka cocok persis preset bernama → preset itu
 * - "kustom" → Kustom (yang kosong dari preset bawaan)
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
  const k = preset === "kustom" || temp !== undefined ? styleOf(defaultPreset(teaser)) : { exaggeration: 0.65, cfg: 0.35, temperature: 0.8 };
  const s = {
    exaggeration: clampNum(exg, EXG_MIN, EXG_MAX) ?? k.exaggeration,
    cfg: clampNum(cfg, CFG_MIN, CFG_MAX) ?? k.cfg,
    temperature: normTemperature(temp) ?? k.temperature,
  };
  return { preset: (!preset && matchPreset(s)) || "kustom", ...s };
}

/** isi timeline.voice untuk gaya bicara ini (preset + angka yang dipakai, supaya skill / ekspor membaca angka yang sama) */
export const voicePatch = (s: VoiceStyle): Pick<Voice, "preset" | "exaggeration" | "cfg" | "temperature"> => ({
  preset: s.preset,
  exaggeration: round2(s.exaggeration),
  cfg: round2(s.cfg),
  temperature: round2(s.temperature),
});

/** kolom gaya bicara yang dikirim dari luar (skill / AI sutradara); kolom kosong = tidak diubah */
export type StylePatch = { preset?: unknown; exaggeration?: unknown; cfg?: unknown; temperature?: unknown };

/**
 * Gaya bicara sesudah diubah dari luar panel Suara VO (Skill Studio / AI sutradara) — hanya kolom yang ikut dikirim:
 * - preset bernama tanpa angka → angka preset itu (angka lama di proyek tidak membuat pilihan itu terbaca Kustom)
 * - preset bernama / tanpa preset + angka → gaya sekarang (atau preset itu) diganti angkanya; angka cocok persis preset bernama
 *   → preset itu, selain itu Kustom. "kustom" = Kustom dengan angka itu (yang kosong: angka yang sedang dipakai)
 * - angka lama bawaan (0,65/0,35 · 0,6/0,4 tanpa variasi, contoh lama di prompt sutradara) = bukan pilihan user: tanpa preset →
 *   tidak diubah; bersama preset bernama → preset itu persis (angka contoh diabaikan)
 * - tidak ada kolom gaya → voice tidak berubah (objek yang sama)
 * Hasil selalu lengkap (preset + 3 angka) supaya ekspor, skill & job laptop membaca angka yang sama.
 */
export function applyStyle<V extends Voice>(v: V, patch: StylePatch | null | undefined, teaser = false): V {
  if (!patch) return v;
  const preset = normPreset(patch.preset);
  const exg = clampNum(patch.exaggeration, EXG_MIN, EXG_MAX);
  const cfg = clampNum(patch.cfg, CFG_MIN, CFG_MAX);
  const temp = normTemperature(patch.temperature);
  if (!preset && exg === undefined && cfg === undefined && temp === undefined) return v;
  const legacy = temp === undefined && exg !== undefined && cfg !== undefined && LEGACY.some(([e, c]) => near(e, exg) && near(c, cfg));
  if (legacy && !preset) return v;
  if (legacy && preset !== "kustom") return { ...v, ...voicePatch(styleOf(preset as NamedPreset)) };
  const base = preset && preset !== "kustom" ? styleOf(preset) : voiceStyle(v, teaser);
  const s = { exaggeration: exg ?? base.exaggeration, cfg: cfg ?? base.cfg, temperature: temp ?? base.temperature };
  const named = preset === "kustom" ? undefined : matchPreset(s);
  return { ...v, ...voicePatch({ preset: named ?? "kustom", ...s }) };
}

/**
 * setelan job bank suara (laptop) — sama persis untuk "Generate ulang VO", 🔊 Dengar & buat ulang satu kalimat (cache laptop).
 * `preset` hanya keterangan (tersimpan di antrian, worker memakai angkanya) — tidak memengaruhi kunci cache laptop.
 */
export function bankSettings(t: Pick<Timeline, "voice" | "scenes">): { exaggeration: number; cfg_weight: number; temperature: number; takes: number; preset: VoicePreset } {
  const s = voiceStyle(t.voice, isTeaserTimeline(t));
  return { exaggeration: s.exaggeration, cfg_weight: s.cfg, temperature: s.temperature, takes: BANK_TAKES, preset: s.preset };
}

/** label singkat: "Promo energik" / "Kustom (ekspresi 0,7 · tempo 0,4 · variasi 0,9)" */
export function styleLabel(s: VoiceStyle): string {
  const f = (n: number) => String(round2(n)).replace(".", ",");
  return s.preset === "kustom" ? `Kustom (ekspresi ${f(s.exaggeration)} · tempo ${f(s.cfg)} · variasi ${f(s.temperature)})` : presetOf(s.preset).label;
}
