/**
 * Skill Studio: setelan proyek yang bisa disimpan / dibagikan supaya referensi tim sama — kamus ejaan, suara, volume campuran,
 * sutradara, catatan gaya. Disimpan sebagai file .json (unduh / impor) atau di Library tim (tabel studio_skills, migration-21).
 *
 * File skill = JSON TIDAK DIPERCAYA (bisa dari siapa saja): `normSkill` memvalidasi ketat — batas ukuran ±64 KB, kamus lewat
 * normLexicon (maks 60), catatan maks 20 × 300 huruf tanpa HTML, angka dibatasi rentangnya, field asing dibuang.
 * Aman dipakai di server & browser (tanpa import server-only).
 */
import { MAX_LEXICON, normLexicon, type LexEntry } from "./pronounce";
import {
  isDirectorHero,
  mixDb,
  normNotes,
  plainText,
  DIRECTOR_NOTES_MAX,
  type Director,
  type EdgeVoice,
  type Mix,
  type Voice,
  type VoiceMode,
} from "./timeline";

export const SKILL_KIND = "studio-skill";
export const SKILL_VERSION = 1;
/** batas ukuran file / data skill (byte JSON) */
export const SKILL_MAX_BYTES = 64 * 1024;
export const SKILL_NAME_MAX = 60;
export const SKILL_DESC_MAX = 300;

export type SkillSection = "lexicon" | "voice" | "mix" | "director" | "notes";
export const SKILL_SECTIONS: readonly SkillSection[] = ["lexicon", "voice", "mix", "director", "notes"];
export const SECTION_LABEL: Record<SkillSection, string> = {
  lexicon: "Kamus ejaan",
  voice: "Suara",
  mix: "Volume",
  director: "Sutradara",
  notes: "Catatan gaya",
};
export const SECTION_ICON: Record<SkillSection, string> = { lexicon: "📖", voice: "🎙️", mix: "🎚️", director: "🎬", notes: "✍️" };

/** setelan suara di skill (tanpa voiceId: id bank suara beda per database — dicocokkan lewat voiceName saat diterapkan) */
export type SkillVoice = { mode?: VoiceMode; voiceName?: string; edgeVoice?: EdgeVoice; exaggeration?: number; cfg?: number; temperature?: number; preset?: string };
export type StudioSkill = {
  kind: typeof SKILL_KIND;
  v: typeof SKILL_VERSION;
  name: string;
  desc?: string;
  created_at: string;
  sections: {
    lexicon?: LexEntry[];
    voice?: SkillVoice;
    mix?: Mix;
    director?: { hero: string; name?: string };
    notes?: string[];
  };
};
export type SkillResult = { ok: true; skill: StudioSkill } | { ok: false; error: string };
/** satu baris Library tim (GET /api/studio/skills) */
export type SkillLibraryRow = {
  id: string;
  name: string;
  desc: string | null;
  owner: string;
  ownerName: string;
  mine: boolean;
  canDelete: boolean;
  created_at: string;
  sections: SkillSection[];
  skill: StudioSkill;
};

/** voice di timeline + kolom tambahan yang mungkin dipakai mesin suara (temperature / preset) */
export type VoiceLike = Voice & { temperature?: number; preset?: string };
/** bagian timeline yang dibaca / diubah skill (Timeline memenuhi tipe ini; tanpa rencana cukup { director }) */
export type SkillTarget = { voice?: VoiceLike; mix?: Mix; director?: Director };

const MODES: readonly VoiceMode[] = ["bank", "edge", "elevenlabs", "none"];
const EDGE_VOICES: readonly EdgeVoice[] = ["id-ID-ArdiNeural", "id-ID-GadisNeural"];
const PRESET = /^[\w .-]{1,40}$/;

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
/** angka (atau teks angka "0,7") di rentang lo..hi (2 angka di belakang koma); bukan angka → undefined */
function clampNum(v: unknown, lo: number, hi: number): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? parseFloat(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) ? Math.round(Math.min(hi, Math.max(lo, n)) * 100) / 100 : undefined;
}
/** buang kunci yang nilainya undefined */
function compact<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}
/** kunci kamus (sama dengan pronounce.ts: huruf kecil, spasi & strip diabaikan) */
const lexKey = (s: string) => s.toLowerCase().replace(/[\s-]+/g, "");

function normVoice(v: unknown): SkillVoice | undefined {
  const o = obj(v);
  if (!o) return undefined;
  const preset = plainText(o.preset, 40);
  const out = compact<SkillVoice>({
    mode: MODES.includes(o.mode as VoiceMode) ? (o.mode as VoiceMode) : undefined,
    voiceName: plainText(o.voiceName, 60) || undefined,
    edgeVoice: EDGE_VOICES.includes(o.edgeVoice as EdgeVoice) ? (o.edgeVoice as EdgeVoice) : undefined,
    exaggeration: clampNum(o.exaggeration, 0.25, 1),
    cfg: clampNum(o.cfg, 0, 1),
    temperature: clampNum(o.temperature, 0.3, 1.2),
    preset: preset && PRESET.test(preset) ? preset : undefined,
  });
  return Object.keys(out).length ? out : undefined;
}

function normMixPart(v: unknown): Mix | undefined {
  const o = obj(v);
  if (!o) return undefined;
  const out = compact<Mix>({ musicDb: mixDb(o.musicDb), voDb: mixDb(o.voDb), sfxDb: mixDb(o.sfxDb) });
  return Object.keys(out).length ? out : undefined;
}

function normDirectorPart(v: unknown): { hero: string; name?: string } | undefined {
  const o = obj(v);
  if (!o || !isDirectorHero(o.hero)) return undefined;
  const hero = o.hero.trim();
  const name = plainText(o.name, 40);
  return { hero: hero.startsWith("char:") ? hero.toLowerCase() : hero, ...(name ? { name } : {}) };
}

/** ukuran JSON (byte UTF-8); gagal di-stringify (mis. melingkar) → Infinity */
function jsonBytes(v: unknown): number {
  try {
    const s = JSON.stringify(v);
    return s === undefined ? 0 : new TextEncoder().encode(s).length;
  } catch {
    return Infinity;
  }
}

/**
 * Validasi ketat skill dari file / database / body permintaan (teks JSON atau objek). Tidak pernah melempar error.
 * Field asing dibuang, angka dibatasi, teks dibersihkan. Skill tanpa satu pun bagian yang terpakai ditolak.
 */
export function normSkill(raw: unknown): SkillResult {
  let data: unknown = raw;
  if (typeof raw === "string") {
    if (raw.length > SKILL_MAX_BYTES || new TextEncoder().encode(raw).length > SKILL_MAX_BYTES) return { ok: false, error: "File skill terlalu besar (maks 64 KB)." };
    try {
      data = JSON.parse(raw.replace(/^﻿/, ""));
    } catch {
      return { ok: false, error: "File ini bukan JSON skill yang valid." };
    }
  } else if (jsonBytes(raw) > SKILL_MAX_BYTES) return { ok: false, error: "File skill terlalu besar (maks 64 KB)." };
  const o = obj(data);
  if (!o || o.kind !== SKILL_KIND) return { ok: false, error: "Ini bukan file skill Studio." };
  if (Number(o.v) !== SKILL_VERSION) return { ok: false, error: "Versi skill tidak dikenal. Minta pembuatnya menyimpan ulang." };
  const name = plainText(o.name, SKILL_NAME_MAX);
  if (!name) return { ok: false, error: "Nama skill kosong." };
  const desc = plainText(o.desc, SKILL_DESC_MAX);
  const t = typeof o.created_at === "string" && o.created_at.length <= 40 ? Date.parse(o.created_at) : NaN;
  const s = obj(o.sections) ?? {};
  const lexicon = normLexicon(Array.isArray(s.lexicon) ? s.lexicon.slice(0, MAX_LEXICON * 4) : []);
  const notes = normNotes(Array.isArray(s.notes) ? s.notes.slice(0, DIRECTOR_NOTES_MAX * 4) : []);
  const sections = compact<StudioSkill["sections"]>({
    lexicon: lexicon.length ? lexicon : undefined,
    voice: normVoice(s.voice),
    mix: normMixPart(s.mix),
    director: normDirectorPart(s.director),
    notes: notes.length ? notes : undefined,
  });
  if (!Object.keys(sections).length) return { ok: false, error: "Skill ini kosong — tidak ada bagian yang bisa dipakai." };
  return {
    ok: true,
    skill: { kind: SKILL_KIND, v: SKILL_VERSION, name, ...(desc ? { desc } : {}), created_at: new Date(Number.isFinite(t) ? t : Date.now()).toISOString(), sections },
  };
}

/** bagian yang terisi di skill (urutan tetap) */
export const skillSections = (skill: Pick<StudioSkill, "sections">): SkillSection[] => SKILL_SECTIONS.filter((k) => skill.sections[k] !== undefined);

/** bagian yang bisa diambil dari proyek ini (ada isinya) */
export function availableSections(src: SkillTarget): SkillSection[] {
  return SKILL_SECTIONS.filter((k) => {
    if (k === "lexicon") return !!src.voice?.lexicon?.length;
    if (k === "voice") return !!src.voice;
    if (k === "mix") return !!src.mix && Object.keys(src.mix).length > 0;
    if (k === "director") return true; // kosong = Harley
    return !!src.director?.notes?.length;
  });
}

/**
 * Ambil skill dari proyek (hanya bagian yang dicentang & ada isinya). Hasil sudah lewat normSkill.
 * Gagal (mis. semua bagian kosong) → null.
 */
export function collectSkill(src: SkillTarget, parts: readonly SkillSection[], info: { name: string; desc?: string; now?: Date }): StudioSkill | null {
  const want = new Set(parts);
  const v = src.voice;
  const sections: Record<string, unknown> = {};
  if (want.has("lexicon") && v?.lexicon?.length) sections.lexicon = v.lexicon;
  if (want.has("voice") && v)
    sections.voice = {
      mode: v.mode,
      voiceName: v.voiceName,
      edgeVoice: v.edgeVoice,
      exaggeration: v.exaggeration,
      cfg: v.cfg,
      temperature: v.temperature,
      preset: v.preset,
    };
  if (want.has("mix") && src.mix) sections.mix = src.mix;
  if (want.has("director")) sections.director = { hero: src.director?.hero ?? "Harley", name: src.director?.name };
  if (want.has("notes") && src.director?.notes?.length) sections.notes = src.director.notes;
  const r = normSkill({ kind: SKILL_KIND, v: SKILL_VERSION, name: info.name, desc: info.desc, created_at: (info.now ?? new Date()).toISOString(), sections });
  return r.ok ? r.skill : null;
}

/** gabung kamus: kata yang sama (per `from`) diganti versi skill di tempatnya, kata baru ditambah di belakang (maks 60) */
export function mergeLexicon(cur: readonly LexEntry[] | undefined, add: readonly LexEntry[]): { lexicon: LexEntry[]; added: number; replaced: number; skipped: number } {
  const base = normLexicon(cur ?? []);
  const incoming = normLexicon(add);
  const idx = new Map(base.map((e, i) => [lexKey(e.from), i] as const));
  let replaced = 0;
  const extra: LexEntry[] = [];
  for (const e of incoming) {
    const i = idx.get(lexKey(e.from));
    if (i === undefined) extra.push(e);
    else if (base[i].to !== e.to || base[i].from !== e.from) {
      base[i] = e;
      replaced++;
    }
  }
  const room = Math.max(0, MAX_LEXICON - base.length);
  const lexicon = normLexicon([...base, ...extra.slice(0, room)]);
  return { lexicon, added: Math.min(extra.length, room), replaced, skipped: Math.max(0, extra.length - room) };
}

/** gabung catatan gaya: yang lama dulu, catatan baru ditambah; lewat 20 → yang paling lama dibuang */
export function mergeNotes(cur: readonly string[] | undefined, add: readonly string[]): { notes: string[]; added: number } {
  const base = normNotes(cur ?? []);
  const have = new Set(base.map((n) => n.toLowerCase()));
  const extra = normNotes(add).filter((n) => !have.has(n.toLowerCase()));
  const all = [...base, ...extra];
  return { notes: all.slice(Math.max(0, all.length - DIRECTOR_NOTES_MAX)), added: extra.length };
}

export type ApplyOpts = {
  /** bank suara yang siap: voiceName dari skill dicocokkan ke id bank di database ini */
  voices?: readonly { id: string; name: string }[];
};

/**
 * Terapkan skill ke proyek — hanya bagian yang dicentang. Kamus & catatan digabung (tanpa dobel); suara, volume & sutradara
 * ditimpa sebatas kolom yang ada di skill. Proyek tanpa rencana (tanpa `voice`) hanya menerima sutradara & catatan.
 */
export function applySkill<T extends SkillTarget>(target: T, skill: StudioSkill, parts: readonly SkillSection[], opts: ApplyOpts = {}): T {
  const want = new Set(parts);
  const sec = skill.sections;
  const out: T = { ...target };
  if (out.voice) {
    let voice: VoiceLike = { ...out.voice };
    if (want.has("lexicon") && sec.lexicon?.length) {
      const { lexicon } = mergeLexicon(voice.lexicon, sec.lexicon);
      voice = { ...voice, lexicon: lexicon.length ? lexicon : undefined };
    }
    if (want.has("voice") && sec.voice) {
      const sv = sec.voice;
      const next: VoiceLike = { ...voice, ...compact({ ...sv }) };
      if (sv.voiceName !== undefined && sv.voiceName !== voice.voiceName) {
        // bank suara dicocokkan lewat nama; tidak ada di database ini → kosong (Studio memakai suara bawaan)
        const hit = opts.voices?.find((x) => x.name.trim().toLowerCase() === sv.voiceName!.trim().toLowerCase());
        next.voiceId = hit ? hit.id : null;
      }
      voice = next;
    }
    out.voice = voice;
  }
  if (want.has("mix") && sec.mix) out.mix = { ...(out.mix ?? {}), ...sec.mix };
  if (want.has("director") && sec.director) {
    const notes = out.director?.notes;
    out.director = { hero: sec.director.hero, ...(sec.director.name ? { name: sec.director.name } : {}), ...(notes?.length ? { notes } : {}) };
  }
  if (want.has("notes") && sec.notes?.length) {
    const { notes } = mergeNotes(out.director?.notes, sec.notes);
    out.director = { ...(out.director ?? { hero: "Harley" }), notes };
  }
  return out;
}

const VOICE_MODE_LABEL: Record<VoiceMode, string> = { bank: "Bank suara", edge: "Suara cadangan", elevenlabs: "Premium", none: "Tanpa suara" };
const EDGE_LABEL: Record<EdgeVoice, string> = { "id-ID-ArdiNeural": "Ardi (pria)", "id-ID-GadisNeural": "Gadis (wanita)" };
const num = (n: number | undefined) => (n === undefined ? "–" : String(n).replace(".", ","));
const db = (n: number | undefined) => (n === undefined ? "–" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${String(Math.abs(n)).replace(".", ",")} dB`);

/** label sutradara untuk ringkasan (nama karakter / hero) */
export const directorText = (d: { hero: string; name?: string } | undefined) => (d ? d.name || (d.hero.startsWith("char:") ? "Karakter buatan" : d.hero) : "Harley");

/**
 * Pratinjau perubahan per bagian sebelum diterapkan (kalimat awam singkat). `ok` = bagian bisa diterapkan ke proyek ini.
 */
export function skillPreview(target: SkillTarget, skill: StudioSkill, opts: ApplyOpts = {}): { key: SkillSection; ok: boolean; lines: string[] }[] {
  const sec = skill.sections;
  const out: { key: SkillSection; ok: boolean; lines: string[] }[] = [];
  const noPlan = !target.voice;
  if (sec.lexicon) {
    if (noPlan) out.push({ key: "lexicon", ok: false, lines: [`${sec.lexicon.length} kata — butuh rencana video dulu.`] });
    else {
      const m = mergeLexicon(target.voice?.lexicon, sec.lexicon);
      const lines = [m.added || m.replaced ? `${m.added} kata baru, ${m.replaced} ejaan diganti.` : "Semua kata sudah sama — tidak ada yang berubah."];
      if (m.skipped) lines.push(`${m.skipped} kata tidak muat (kamus maks ${MAX_LEXICON}).`);
      const sample = sec.lexicon.slice(0, 4).map((e) => `${e.from} → ${e.to}`);
      if (sample.length) lines.push(`Contoh: ${sample.join(", ")}${sec.lexicon.length > 4 ? ", …" : ""}`);
      out.push({ key: "lexicon", ok: true, lines });
    }
  }
  if (sec.voice) {
    if (noPlan) out.push({ key: "voice", ok: false, lines: ["Butuh rencana video dulu."] });
    else {
      const v = target.voice!;
      const s = sec.voice;
      const lines: string[] = [];
      if (s.mode && s.mode !== v.mode) lines.push(`Mesin: ${VOICE_MODE_LABEL[v.mode]} → ${VOICE_MODE_LABEL[s.mode]}`);
      if (s.voiceName !== undefined && s.voiceName !== v.voiceName) {
        const hit = !opts.voices || opts.voices.some((x) => x.name.trim().toLowerCase() === s.voiceName!.trim().toLowerCase());
        lines.push(`Suara bank: ${v.voiceName || "bawaan"} → ${s.voiceName}${hit ? "" : " (tidak ada di bank — pakai suara bawaan)"}`);
      }
      if (s.edgeVoice && s.edgeVoice !== v.edgeVoice) lines.push(`Suara cadangan: ${EDGE_LABEL[v.edgeVoice ?? "id-ID-ArdiNeural"]} → ${EDGE_LABEL[s.edgeVoice]}`);
      if (s.exaggeration !== undefined && s.exaggeration !== v.exaggeration) lines.push(`Ekspresi: ${num(v.exaggeration)} → ${num(s.exaggeration)}`);
      if (s.cfg !== undefined && s.cfg !== v.cfg) lines.push(`Tempo: ${num(v.cfg)} → ${num(s.cfg)}`);
      if (s.temperature !== undefined && s.temperature !== v.temperature) lines.push(`Variasi suara: ${num(v.temperature)} → ${num(s.temperature)}`);
      if (s.preset !== undefined && s.preset !== v.preset) lines.push(`Preset: ${v.preset || "–"} → ${s.preset}`);
      out.push({ key: "voice", ok: true, lines: lines.length ? lines : ["Sama dengan setelan sekarang."] });
    }
  }
  if (sec.mix) {
    const m = target.mix ?? {};
    const s = sec.mix;
    const lines: string[] = [];
    if (s.musicDb !== undefined && s.musicDb !== m.musicDb) lines.push(`Musik: ${db(m.musicDb)} → ${db(s.musicDb)}`);
    if (s.voDb !== undefined && s.voDb !== m.voDb) lines.push(`VO: ${db(m.voDb)} → ${db(s.voDb)}`);
    if (s.sfxDb !== undefined && s.sfxDb !== m.sfxDb) lines.push(`SFX: ${db(m.sfxDb)} → ${db(s.sfxDb)}`);
    out.push({ key: "mix", ok: !noPlan, lines: noPlan ? ["Butuh rencana video dulu."] : lines.length ? lines : ["Sama dengan setelan sekarang."] });
  }
  if (sec.director) {
    const same = (target.director?.hero ?? "Harley") === sec.director.hero;
    out.push({ key: "director", ok: true, lines: [same ? `Tetap ${directorText(sec.director)}.` : `${directorText(target.director)} → ${directorText(sec.director)}`] });
  }
  if (sec.notes) {
    const { added } = mergeNotes(target.director?.notes, sec.notes);
    out.push({ key: "notes", ok: true, lines: [added ? `${added} catatan baru ditambahkan.` : "Semua catatan sudah ada."] });
  }
  return out;
}

/** nama file unduhan: skill-<nama>.json */
export const skillFileName = (skill: Pick<StudioSkill, "name">) =>
  `skill-${
    skill.name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "studio"
  }.json`;
