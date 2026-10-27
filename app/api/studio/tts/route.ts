import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { studioGuard } from "@/lib/studio/access.server";
import { edgeTts, isEdgeVoice, type Word } from "@/lib/studio/edgeTts.server";
import { elevenEnabled, elevenTts, elevenVoice } from "@/lib/studio/elevenlabs.server";
import { SPELL_MAX } from "@/lib/studio/pronounce";
import { putStudio, readStudioJson, studioAdmin } from "@/lib/studio/storage.server";
import { storageSrc } from "@/lib/studio/urls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * VO cepat dari website (tanpa worker laptop):
 * - "edge" (bawaan): Edge-TTS, layanan TIDAK RESMI -> selalu ditandai "VO sementara"
 * - "elevenlabs": hanya kalau ELEVENLABS_API_KEY ada (gagal -> turun ke Edge)
 * Hasil di-cache di storage tts/<sha1>.mp3 + .json (service role). Tanpa service role -> data URL base64.
 */

const MAX = 600;
/**
 * teks ucapan (`spell`) dibentuk browser dari ejaan adegan + kamus ejaan + angka jadi kata (lib/studio/pronounce.ts), jadi bisa
 * beberapa kali lebih panjang dari teks subtitle (mis. "IHSG 16.800" → "i ha es ge enam belas ribu delapan ratus") — batasnya
 * SPELL_MAX (sama dengan job bank suara di laptop). Edge memecah teks panjang per 4.096 byte sendiri.
 */
const MAX_SPELL = SPELL_MAX;
const FAIL = "Suara cadangan lagi nggak bisa dihubungi. Coba lagi sebentar atau pakai mesin suara laptop.";
const LABEL = { edge: "VO sementara · cadangan (layanan tidak resmi)", elevenlabs: "Premium" } as const;

type Engine = keyof typeof LABEL;
type Meta = { dur: number; words: Word[]; engine: Engine; voice: string };
type Body = { text?: unknown; spell?: unknown; voice?: unknown; engine?: unknown; rate?: unknown };

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const tidy = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");

/** "+10%" / "-5%" (dibatasi -50%..+100%), selain itu "+0%" */
function cleanRate(v: unknown): string {
  const m = typeof v === "string" ? /^([+-])(\d{1,3})%$/.exec(v.trim()) : null;
  if (!m) return "+0%";
  const n = Math.max(-50, Math.min(100, Number(m[1] + m[2])));
  return `${n < 0 ? "-" : "+"}${Math.abs(n)}%`;
}

/** kalau pakai ejaan khusus (spell) dan jumlah katanya sama, tampilkan kata asli di subtitle */
function showWords(words: Word[], text: string, spelled: boolean): Word[] {
  if (!spelled) return words;
  const toks = text.split(" ").filter(Boolean);
  return toks.length === words.length ? words.map((w, i) => ({ ...w, w: toks[i] })) : words;
}

const okMeta = (m: Meta | null): m is Meta => !!m && typeof m.dur === "number" && Array.isArray(m.words);

// cache kecil di memori untuk mode tanpa service role (per instance server)
const mem = new Map<string, { b64: string; meta: Meta }>();
const remember = (k: string, v: { b64: string; meta: Meta }) => {
  mem.delete(k);
  mem.set(k, v);
  while (mem.size > 24) mem.delete(mem.keys().next().value as string);
};

const reply = (src: string, m: Meta) => ({ src, dur: m.dur, words: m.words, engine: m.engine, temp: m.engine === "edge", label: LABEL[m.engine] });

async function speak(engine: Engine, text: string, spoken: string, voice: string, rate: string) {
  const vid = engine === "edge" ? voice : await elevenVoice();
  const key = sha1([engine, vid, engine === "edge" ? rate : "", spoken, text].join("\n"));
  const mp3Path = `tts/${key}.mp3`;
  const admin = studioAdmin();

  if (admin) {
    const hit = await readStudioJson<Meta>(`tts/${key}.json`, admin);
    if (okMeta(hit)) return reply(storageSrc(mp3Path), { ...hit, engine });
  } else {
    const hit = mem.get(key);
    if (hit) return reply(`data:audio/mpeg;base64,${hit.b64}`, hit.meta);
  }

  const r = engine === "edge" ? await edgeTts(spoken, { voice, rate }) : await elevenTts(spoken, vid);
  const meta: Meta = { dur: r.dur, words: showWords(r.words, text, spoken !== text), engine, voice: vid };
  // mp3 dulu, .json terakhir (json ada = cache lengkap)
  if (admin && (await putStudio(mp3Path, r.mp3, "audio/mpeg", admin)) && (await putStudio(`tts/${key}.json`, JSON.stringify(meta), "application/json", admin)))
    return reply(storageSrc(mp3Path), meta);
  const b64 = r.mp3.toString("base64");
  remember(key, { b64, meta });
  return reply(`data:audio/mpeg;base64,${b64}`, meta);
}

export async function POST(req: Request) {
  const g = await studioGuard();
  if (!g.ok) return g.res;

  let b: Body;
  try {
    b = (await req.json()) as Body;
  } catch {
    return json({ error: "Permintaan tidak valid." }, 400);
  }
  const text = tidy(b?.text);
  const spell = tidy(b?.spell);
  if (!text) return json({ error: "Teks VO masih kosong." }, 400);
  if (text.length > MAX) return json({ error: `Teks kepanjangan (maks ${MAX} huruf). Pecah jadi beberapa kalimat.` }, 400);
  if (spell.length > MAX_SPELL)
    return json({ error: `Teks ucapan kepanjangan setelah angka & kamus ejaan dieja (${spell.length.toLocaleString("id-ID")} dari maks ${MAX_SPELL.toLocaleString("id-ID")} huruf). Pecah kalimatnya atau persingkat ejaan di 📖 Kamus.` }, 400);

  const voice = isEdgeVoice(b.voice) ? b.voice : "id-ID-ArdiNeural";
  const rate = cleanRate(b.rate);
  const spoken = spell || text;
  const engines: Engine[] = b.engine === "elevenlabs" && elevenEnabled() ? ["elevenlabs", "edge"] : ["edge"];

  for (const engine of engines) {
    try {
      return json(await speak(engine, text, spoken, voice, rate));
    } catch (e) {
      console.error("[studio/tts]", engine, e instanceof Error ? e.message : e);
    }
  }
  return json({ error: FAIL }, 503);
}
