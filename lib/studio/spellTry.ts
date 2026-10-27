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
import { DEFAULT_LEXICON, LEX_FROM_MAX, LEX_TO_MAX, MAX_LEXICON, lexKey, normLexicon, speakText, voSayKey, type LexEntry } from "./pronounce";
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

/**
 * kamus proyek sesudah ejaan `to` dipilih untuk `word`: entri khusus bank suara {from, to, bank} (kata yang sama diganti di tempatnya).
 * Tulisan asli dipilih → ejaan kata itu dihapus dari kamus proyek (kata yang ada di kamus bawaan, mis. "update", diberi entri dirinya
 * sendiri supaya tetap dibaca seperti tulisannya). `next` null = kamus penuh (60) untuk kata baru.
 */
export function lexiconAfterPick(lexicon: readonly LexEntry[] | null | undefined, word: string, to: string): { next: LexEntry[] | null; same: boolean } {
  const cur = normLexicon(lexicon ?? []);
  const from = word.toLowerCase().slice(0, LEX_FROM_MAX);
  const k = lexKey(from);
  const asIs = to.trim().toLowerCase() === from;
  const inDefault = DEFAULT_LEXICON.some((e) => lexKey(e.from) === k);
  let next: LexEntry[] | null;
  if (asIs && !inDefault) next = cur.filter((e) => lexKey(e.from) !== k);
  else {
    const e: LexEntry = { from, to: to.replace(/\s+/g, " ").trim().slice(0, LEX_TO_MAX), bank: true };
    const at = cur.findIndex((x) => lexKey(x.from) === k);
    next = at >= 0 ? normLexicon(cur.map((x, i) => (i === at ? e : x))) : cur.length >= MAX_LEXICON ? null : normLexicon([...cur, e]);
  }
  return { next, same: !!next && JSON.stringify(next) === JSON.stringify(cur) };
}

/** adegan yang VO-nya sudah ada & ucapannya berubah karena kamus `before` → `after` (perlu dibuat ulang) */
export function scenesToRebuild(t: Pick<Timeline, "scenes" | "vo">, before: readonly LexEntry[] | null | undefined, after: readonly LexEntry[] | null | undefined): string[] {
  const b = before ? [...before] : undefined;
  const a = after ? [...after] : undefined;
  return t.scenes.filter((s) => s.vo?.text && (t.vo?.lines ?? []).some((l) => l.sceneId === s.id && l.src) && voSayKey(s.vo, b) !== voSayKey(s.vo, a)).map((s) => s.name);
}

export type PepetTok = EToken & { fixed?: string };
export type PepetSeg = { text: string; tok?: PepetTok };

/**
 * naskah dipotong jadi teks biasa + kata ber-huruf e. Kata yang sudah dieja kamus lain (bawaan / proyek: "issue" → "isyu", "CS Tracker")
 * tidak bisa diketuk (yang dibaca mesin bukan tulisan itu); kata yang dieja lewat 🎧 Coba ejaan (entri yang cuma menandai bunyi e)
 * tetap bisa diketuk dan diberi tanda `fixed`.
 */
export function pepetSegments(text: string, lexicon: readonly LexEntry[] | undefined): PepetSeg[] {
  const mine = normLexicon(lexicon ?? []);
  const own = new Map(mine.map((e) => [lexKey(e.from), e] as const));
  const entries = [...DEFAULT_LEXICON.filter((e) => !own.has(lexKey(e.from))), ...mine];
  const covered: [number, number][] = [];
  const fixedAt = new Map<number, string>();
  for (const e of entries) {
    const parts = e.from.split(/[\s-]+/).filter(Boolean);
    if (!parts.length) continue;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}'’])(${parts.map(esc).join("[\\s-]*")})(?![\\p{L}\\p{N}'’])`, "giu");
    const pepetFix = own.get(lexKey(e.from)) === e && isPepetSpelling(e.from, e.to);
    for (const m of text.matchAll(re)) {
      const at = (m.index ?? 0) + m[1].length;
      if (pepetFix) fixedAt.set(at, e.to);
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
