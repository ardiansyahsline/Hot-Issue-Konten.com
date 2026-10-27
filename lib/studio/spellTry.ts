/**
 * 🎧 COBA EJAAN (bagian tanpa React, teruji): menyusun SATU job bank suara berisi kalimat adegan dengan satu kata dieja beberapa cara,
 * dan mengubah 📖 Kamus ejaan proyek saat salah satunya dipilih.
 *  - teks ucapan tiap kandidat = teks ucapan versi bank kalimat itu kalau kamus proyek ditambah {from: kata, to: kandidat, bank} —
 *    sama persis dengan yang dikirim nanti setelah "Pakai ini" (yang didengar = yang nanti dipakai)
 *  - semua kandidat memakai benih acak yang sama (`seed`, voice-worker ≥ versi ini) & 1 versi per kalimat
 *  - job ditandai settings.purpose = TRY_PURPOSE: hasilnya hanya untuk didengar, TIDAK PERNAH dipasang ke VO adegan / timeline
 */
import type { VoiceJobLine } from "./client";
import { eWords, isPepetSpelling, type EToken } from "./pepet";
import { DEFAULT_LEXICON, LEX_FROM_MAX, LEX_TO_MAX, MAX_LEXICON, legacySayKey, lexKey, lexiconOf, normLexicon, speakText, voSayKey, type LexEntry } from "./pronounce";
import type { Scene, Timeline } from "./timeline";

/** penanda job 🎧 Coba ejaan (settings.purpose) — sama dengan TRY_PURPOSE di voice-worker/studio_worker/jobs_tts.py */
export const TRY_PURPOSE = "coba-ejaan";
/** job ini job 🎧 Coba ejaan? (hasilnya tidak boleh dipasang ke VO adegan / timeline) */
export const isTryJob = (job: { settings?: unknown } | null | undefined): boolean =>
  !!job && !!job.settings && typeof job.settings === "object" && (job.settings as Record<string, unknown>).purpose === TRY_PURPOSE;

/** teks VO lebih panjang dari ini → yang dicoba cukup kalimat yang berisi kata itu (supaya cepat) */
export const WHOLE_MAX = 200;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
/** kata utuh di teks (tidak peka huruf besar) */
const wordRe = (w: string) => new RegExp(`(^|[^\\p{L}\\p{N}'’])${esc(w)}(?![\\p{L}\\p{N}'’])`, "iu");

/** benih acak 1..2³¹−2 dari teks (sama untuk semua kandidat → beda suaranya hanya dari ejaan) */
export function seedOf(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h % 2147483646) + 1;
}

/** kalimat yang dicoba: seluruh teks VO (pendek / ada ejaan khusus adegan), selain itu kalimat yang berisi kata itu */
export function trySource(vo: { text: string; spell?: string | null }, word: string): { text: string; spell: string | null } {
  const spell = vo.spell?.trim() || null;
  if (spell || vo.text.length <= WHOLE_MAX) return { text: vo.text, spell };
  const parts = vo.text.match(/[^.!?…]+[.!?…]*["'”’)]*\s*/g) ?? [vo.text];
  const re = wordRe(word);
  return { text: (parts.find((p) => re.test(p)) ?? vo.text).trim(), spell: null };
}

/** teks ucapan (versi bank) kalimat itu kalau `word` dieja `to` */
export function trySpeech(src: { text: string; spell: string | null }, word: string, to: string, lexicon: readonly LexEntry[] | null | undefined): string {
  const k = lexKey(word);
  // entri coba di depan: tetap ikut walau kamus proyek sudah penuh (60)
  const lex: LexEntry[] = [{ from: word.slice(0, LEX_FROM_MAX), to, bank: true }, ...normLexicon(lexicon ?? []).filter((e) => lexKey(e.from) !== k)];
  return speakText(src.text, src.spell, lex, "bank");
}

export type TryRow = { id: number; text: string };
export type TryJob = { lines: VoiceJobLine[]; rows: TryRow[]; settings: Record<string, unknown> };

/**
 * isi job coba ejaan untuk adegan `scene`: satu baris per kandidat (id "coba-<id baris>", teks subtitle sama, `spell` = teks ucapan
 * kandidat, benih sama). Ejaan kosong / kembar dibuang. Gagal → { error } berpesan awam.
 */
export function buildTryJob(
  scene: Pick<Scene, "id" | "vo">,
  word: string,
  rows: readonly TryRow[],
  lexicon: readonly LexEntry[] | null | undefined,
  style: Record<string, unknown>,
): TryJob | { error: string } {
  if (!scene.vo?.text) return { error: "Adegan ini belum punya teks VO." };
  const src = trySource(scene.vo, word);
  const seen = new Set<string>();
  const pick: TryRow[] = [];
  for (const r of rows) {
    const text = r.text.replace(/\s+/g, " ").trim().slice(0, LEX_TO_MAX);
    if (!text || !/\p{L}/u.test(text) || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    pick.push({ id: r.id, text });
  }
  if (pick.length < 2) return { error: "Isi minimal 2 ejaan yang berbeda untuk dibandingkan." };
  const said = pick.map((r) => trySpeech(src, word, r.text, lexicon));
  if (new Set(said).size < 2) return { error: `“${word}” tidak ikut terbaca dari teks VO adegan ini — mungkin sudah dieja khusus di kolom "Ejaan untuk mesin suara". Ubah di sana.` };
  const seed = seedOf(src.text);
  const lines: VoiceJobLine[] = pick.map((r, k) => ({ id: `coba-${r.id}`, scene_id: scene.id, text: src.text, spell: said[k] === src.text ? null : said[k], start: 0, seed }));
  // gaya bicara proyek, 1 versi per kalimat (cepat), penanda supaya hasilnya tidak pernah dipasang ke VO adegan
  return { lines, rows: pick, settings: { ...style, takes: 1, purpose: TRY_PURPOSE, word: word.toLowerCase().slice(0, LEX_FROM_MAX) } };
}

/** cara baca kata (kunci `k`) oleh suara cadangan Edge dengan kamus `lex`: entri biasa proyek / bawaan, atau tulisannya sendiri */
const edgeReading = (lex: readonly LexEntry[], k: string, word: string): string => lexiconOf(lex).find((e) => lexKey(e.from) === k)?.to ?? word;

export type PickResult = {
  /** kamus proyek baru (null = kamus penuh untuk kata baru) */
  next: LexEntry[] | null;
  /** kamus tidak berubah */
  same: boolean;
  /**
   * pilihan ini ikut mengubah cara baca suara cadangan Edge (kata itu sudah punya entri biasa di 📖 Kamus — bukan khusus bank) →
   * TANYA dulu sebelum disimpan. `before` / `after` = cara baca Edge sekarang / sesudahnya. null = Edge tidak berubah.
   */
  edge: { before: string; after: string } | null;
};

/**
 * kamus proyek sesudah ejaan `to` dipilih untuk `word`: entri khusus bank suara {from, to, bank} (kata yang sama diganti di tempatnya).
 * Tulisan asli dipilih → ejaan kata itu dihapus dari kamus proyek (kata yang ada di kamus bawaan, mis. "update", diberi entri dirinya
 * sendiri supaya tetap dibaca seperti tulisannya). `next` null = kamus penuh (60) untuk kata baru.
 * Entri biasa (dipakai Edge juga) yang ejaannya sudah sama dengan pilihan dibiarkan (same). Kalau pilihan mengganti / melepas entri
 * biasa, `edge` diisi supaya pemanggil bertanya dulu (satu kata cuma punya satu entri, jadi ejaan Edge tidak bisa dipertahankan).
 */
export function lexiconAfterPick(lexicon: readonly LexEntry[] | null | undefined, word: string, to: string): PickResult {
  const cur = normLexicon(lexicon ?? []);
  const from = word.toLowerCase().slice(0, LEX_FROM_MAX);
  const k = lexKey(from);
  const spelled = to.replace(/\s+/g, " ").trim().slice(0, LEX_TO_MAX);
  const asIs = spelled.toLowerCase() === from;
  const at = cur.findIndex((x) => lexKey(x.from) === k);
  const old = at >= 0 ? cur[at] : null;
  // entri biasa yang sudah dieja begitu: bank suara sudah membacanya begitu, Edge juga — jangan dijadikan khusus bank
  if (old && !old.bank && old.to.toLowerCase() === spelled.toLowerCase()) return { next: cur, same: true, edge: null };
  const inDefault = DEFAULT_LEXICON.some((e) => lexKey(e.from) === k);
  let next: LexEntry[] | null;
  if (asIs && !inDefault) next = cur.filter((e) => lexKey(e.from) !== k);
  else {
    const e: LexEntry = { from, to: spelled, bank: true };
    next = at >= 0 ? normLexicon(cur.map((x, i) => (i === at ? e : x))) : cur.length >= MAX_LEXICON ? null : normLexicon([...cur, e]);
  }
  const same = !!next && JSON.stringify(next) === JSON.stringify(cur);
  const before = edgeReading(cur, k, from);
  const after = next ? edgeReading(next, k, from) : before;
  return { next, same, edge: !same && before !== after ? { before, after } : null };
}

/**
 * adegan yang VO-nya sudah ada & dibuat dari ucapan yang beda dengan naskah + kamus `after` (perlu dibuat ulang) — pembandingnya kunci
 * VoLine.say tiap baris (baris lama tanpa `say`: legacySayKey), sama dengan peringatan "VO lama" di panel Suara VO.
 */
export function scenesToRebuild(t: Pick<Timeline, "scenes" | "vo">, after: readonly LexEntry[] | null | undefined): string[] {
  const a = after ? [...after] : undefined;
  const lines = t.vo?.lines ?? [];
  return t.scenes
    .filter((s) => {
      if (!s.vo?.text) return false;
      const now = voSayKey(s.vo, a);
      return lines.some((l) => l.sceneId === s.id && l.src && (l.say || legacySayKey(s.vo!.text, s.vo!.spell)) !== now);
    })
    .map((s) => s.name);
}

export type PepetTok = EToken & { fixed?: string };
export type PepetSeg = { text: string; tok?: PepetTok };

type SegPat = { re: RegExp; to: string; fix: boolean };
const segCache = new Map<string, SegPat[]>();
/**
 * pola kata kamus (bawaan + proyek) untuk pepetSegments — dibuat SEKALI per isi kamus (±70 RegExp), bukan tiap render / adegan.
 * Aman dipakai ulang: matchAll menyalin RegExp-nya sendiri (lastIndex pola di cache tidak berubah).
 */
function segPats(lexicon: readonly LexEntry[] | undefined): SegPat[] {
  const mine = normLexicon(lexicon ?? []);
  const sig = JSON.stringify(mine);
  const hit = segCache.get(sig);
  if (hit) return hit;
  const own = new Map(mine.map((e) => [lexKey(e.from), e] as const));
  const out: SegPat[] = [];
  for (const e of [...DEFAULT_LEXICON.filter((x) => !own.has(lexKey(x.from))), ...mine]) {
    const parts = e.from.split(/[\s-]+/).filter(Boolean);
    if (!parts.length) continue;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}'’])(${parts.map(esc).join("[\\s-]*")})(?![\\p{L}\\p{N}'’])`, "giu");
    out.push({ re, to: e.to, fix: own.get(lexKey(e.from)) === e && isPepetSpelling(e.from, e.to) });
  }
  segCache.set(sig, out);
  if (segCache.size > 20) segCache.delete(segCache.keys().next().value as string);
  return out;
}

/**
 * naskah dipotong jadi teks biasa + kata ber-huruf e. Kata yang sudah dieja kamus lain (bawaan / proyek: "issue" → "isyu", "CS Tracker")
 * tidak bisa diketuk (yang dibaca mesin bukan tulisan itu); kata yang dieja lewat 🎧 Coba ejaan (entri yang cuma menandai bunyi e)
 * tetap bisa diketuk dan diberi tanda `fixed`.
 */
export function pepetSegments(text: string, lexicon: readonly LexEntry[] | undefined): PepetSeg[] {
  const covered: [number, number][] = [];
  const fixedAt = new Map<number, string>();
  for (const p of segPats(lexicon)) {
    for (const m of text.matchAll(p.re)) {
      const at = (m.index ?? 0) + m[1].length;
      if (p.fix) fixedAt.set(at, p.to);
      else covered.push([at, at + m[2].length]);
    }
  }
  const segs: PepetSeg[] = [];
  let pos = 0;
  for (const t of eWords(text)) {
    if (covered.some(([a, b]) => t.start < b && t.end > a)) continue;
    if (t.start > pos) segs.push({ text: text.slice(pos, t.start) });
    const fixed = fixedAt.get(t.start);
    segs.push({ text: text.slice(t.start, t.end), tok: fixed ? { ...t, fixed } : t });
    pos = t.end;
  }
  if (pos < text.length) segs.push({ text: text.slice(pos) });
  return segs;
}
