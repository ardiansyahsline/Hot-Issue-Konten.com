import "server-only";
import type { Word } from "./edgeTts.server";

/**
 * ElevenLabs (Premium, berbayar) — HANYA aktif kalau env ELEVENLABS_API_KEY ada.
 * Suara = env ELEVENLABS_VOICE_ID, atau suara pertama di akun (GET /v1/voices, di-cache 1 jam).
 * Waktu per huruf dari /with-timestamps digabung jadi waktu per kata (untuk subtitle).
 */

const API = "https://api.elevenlabs.io/v1";
const MODEL = "eleven_multilingual_v2";
const FORMAT = "mp3_44100_128";

const apiKey = () => process.env.ELEVENLABS_API_KEY?.trim() ?? "";
export const elevenEnabled = () => !!apiKey();

let voiceCache: { id: string; at: number } | null = null;

/** id suara yang dipakai. Lempar Error kalau akun tidak punya suara / API gagal */
export async function elevenVoice(): Promise<string> {
  const env = process.env.ELEVENLABS_VOICE_ID?.trim();
  if (env) return env;
  if (voiceCache && Date.now() - voiceCache.at < 3600_000) return voiceCache.id;
  const r = await fetch(`${API}/voices`, { headers: { "xi-api-key": apiKey(), Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`elevenlabs: daftar suara gagal (${r.status})`);
  const j = (await r.json()) as { voices?: { voice_id?: string }[] };
  const id = j.voices?.find((v) => v.voice_id)?.voice_id;
  if (!id) throw new Error("elevenlabs: akun belum punya suara");
  voiceCache = { id, at: Date.now() };
  return id;
}

type Align = { characters?: string[]; character_start_times_seconds?: number[]; character_end_times_seconds?: number[] };

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** waktu per huruf -> per kata (dipisah spasi) */
export function charsToWords(a: Align | null | undefined): Word[] {
  const ch = a?.characters ?? [];
  const st = a?.character_start_times_seconds ?? [];
  const en = a?.character_end_times_seconds ?? [];
  const out: Word[] = [];
  let w = "";
  let s = 0;
  let e = 0;
  const flush = () => {
    if (w.trim()) out.push({ w: w.trim(), s: round3(s), e: round3(Math.max(e, s)) });
    w = "";
  };
  ch.forEach((c, i) => {
    if (/\s/.test(c)) return flush();
    if (!w) s = Number(st[i] ?? e) || 0;
    w += c;
    e = Number(en[i] ?? st[i] ?? s) || s;
  });
  flush();
  return out;
}

/** Ubah teks jadi suara. Lempar Error kalau key kosong / API gagal / waktu habis (30 dtk). */
export async function elevenTts(text: string, voice?: string): Promise<{ mp3: Buffer; words: Word[]; dur: number; voice: string }> {
  if (!elevenEnabled()) throw new Error("elevenlabs: key kosong");
  const vid = voice || (await elevenVoice());
  const r = await fetch(`${API}/text-to-speech/${encodeURIComponent(vid)}/with-timestamps?output_format=${FORMAT}`, {
    method: "POST",
    headers: { "xi-api-key": apiKey(), "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ text, model_id: MODEL }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`elevenlabs: ${r.status} ${(await r.text().catch(() => "")).slice(0, 200)}`);
  const j = (await r.json()) as { audio_base64?: string; alignment?: Align | null; normalized_alignment?: Align | null };
  if (!j.audio_base64) throw new Error("elevenlabs: audio kosong");
  const mp3 = Buffer.from(j.audio_base64, "base64");
  const words = charsToWords(j.alignment?.characters?.length ? j.alignment : j.normalized_alignment);
  const ends = j.alignment?.character_end_times_seconds ?? j.normalized_alignment?.character_end_times_seconds ?? [];
  // CBR 128 kbps -> durasi dari ukuran file; ambil yang terpanjang dengan waktu huruf terakhir
  const dur = Math.max(mp3.length / 16_000, ends.length ? Number(ends[ends.length - 1]) || 0 : 0, words.length ? words[words.length - 1].e : 0);
  return { mp3, words, dur: round3(dur), voice: vid };
}
