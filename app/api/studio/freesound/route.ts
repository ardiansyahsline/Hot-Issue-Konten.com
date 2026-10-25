import { NextResponse } from "next/server";
import { studioGuard } from "@/lib/studio/access.server";
import type { SfxMeta } from "@/lib/studio/sfxMeta";
import { putStudio, studioAdmin } from "@/lib/studio/storage.server";
import { storageSrc } from "@/lib/studio/urls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Cari & tambah SFX dari Freesound — HANYA lisensi CC0 (bebas tanpa atribusi).
 * GET ?q= -> maks 15 hasil; POST {id} -> unduh preview HQ mp3 ke storage sfx/fs-<id>.mp3 + baris studio_sfx.
 * Tanpa FREESOUND_API_KEY -> { disabled: true }.
 */

const API = "https://freesound.org/apiv2";
const FIELDS = "id,name,username,duration,previews,license,tags";
const CC0 = /publicdomain\/zero|creative commons 0|^cc0$/i;
const MAX_DUR = 120; // dtk
const MAX_BYTES = 8 * 1024 * 1024;

type Sound = { id?: number; name?: string; username?: string; duration?: number; previews?: Record<string, string>; license?: string; tags?: string[] };

const json = (body: unknown, status = 200, cache = "no-store") => NextResponse.json(body, { status, headers: { "Cache-Control": cache } });
const apiKey = () => process.env.FREESOUND_API_KEY?.trim() ?? "";
const fsFetch = (path: string, key: string) =>
  fetch(`${API}${path}`, { headers: { Authorization: `Token ${key}`, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(12_000) });
const clip = (s: unknown, n: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, n) : "");

/** link preview hanya boleh dari server Freesound (https) */
function previewUrl(s: Sound): string | null {
  const u = s.previews?.["preview-hq-mp3"];
  if (!u) return null;
  try {
    const x = new URL(u);
    return x.protocol === "https:" && (x.hostname === "freesound.org" || x.hostname.endsWith(".freesound.org")) ? x.toString() : null;
  } catch {
    return null;
  }
}

/** tebak kategori (sama dengan kategori SFX bawaan) dari tag & nama */
const CATS: [RegExp, string][] = [
  [/\b(whoosh|swoosh|woosh|swish|swipe|pass ?by)\b/, "whoosh"],
  [/\b(coins?|money|cash|cha-?ching)\b/, "koin"],
  [/\b(riser|rise|rising|uplifter|build ?up|tension)\b/, "riser"],
  [/\b(braam|brass|horn)\b/, "braam"],
  [/\b(bass ?drop|sub ?drop|beat ?drop|sub ?bass)\b/, "bass-drop"],
  [/\b(boom|explosion|thunder)\b/, "boom"],
  [/\b(impact|hit|punch|slam|thud|stomp)\b/, "impact"],
  [/\b(glitch|digital|error|static|noise ?burst)\b/, "glitch"],
  [/\b(ambience|ambient|ambiance|drone|atmosphere|room ?tone)\b/, "ambience"],
  [/\b(magic|sparkle|shimmer|fairy|twinkle)\b/, "magic"],
  [/\b(paper|page|book|foley|footsteps?|door|cloth)\b/, "foley"],
  [/\b(transition|snap|spin)\b/, "transisi"],
  [/\b(click|button|ui|interface|notification|pop|beep|ping|blip|alert|chime)\b/, "ui"],
];
function guessCat(s: Sound): string {
  const t = `${(s.tags ?? []).join(" ")} ${s.name ?? ""}`.toLowerCase();
  return CATS.find(([re]) => re.test(t))?.[1] ?? "ui";
}

const brief = (s: Sound) => ({
  id: Number(s.id),
  name: clip(s.name, 120),
  username: clip(s.username, 60),
  dur: Math.round(Number(s.duration ?? 0) * 100) / 100,
  preview: previewUrl(s),
  tags: (s.tags ?? []).slice(0, 8).map((x) => clip(x, 30)),
  license: "CC0",
});

export async function GET(req: Request) {
  const g = await studioGuard();
  if (!g.ok) return g.res;
  const key = apiKey();
  if (!key) return json({ disabled: true });

  const q = clip(new URL(req.url).searchParams.get("q"), 80);
  if (!q) return json({ results: [] });
  const sp = new URLSearchParams({ query: q, filter: 'license:"Creative Commons 0"', fields: FIELDS, page_size: "15" });
  try {
    const r = await fsFetch(`/search/text/?${sp}`, key);
    if (!r.ok) {
      console.error("[studio/freesound] cari", r.status);
      return json({ error: r.status === 429 ? "Pencarian Freesound lagi penuh. Coba lagi sebentar." : "Freesound lagi nggak bisa dihubungi. Coba lagi sebentar." }, 502);
    }
    const j = (await r.json()) as { results?: Sound[] };
    const results = (j.results ?? []).filter((s) => s.id && CC0.test(s.license ?? "") && previewUrl(s)).slice(0, 15).map(brief);
    return json({ results }, 200, "private, max-age=300");
  } catch (e) {
    console.error("[studio/freesound] cari", e instanceof Error ? e.message : e);
    return json({ error: "Freesound lagi nggak bisa dihubungi. Coba lagi sebentar." }, 502);
  }
}

/** unduh preview dengan batas ukuran */
async function download(url: string): Promise<Buffer | null> {
  const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!r.ok || !r.body) return null;
  if (Number(r.headers.get("content-length") ?? 0) > MAX_BYTES) return null;
  const parts: Uint8Array[] = [];
  let n = 0;
  const rd = r.body.getReader();
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    n += value.length;
    if (n > MAX_BYTES) {
      await rd.cancel();
      return null;
    }
    parts.push(value);
  }
  return n ? Buffer.concat(parts) : null;
}

export async function POST(req: Request) {
  const g = await studioGuard();
  if (!g.ok) return g.res;
  const key = apiKey();
  if (!key) return json({ disabled: true });

  let raw: unknown;
  try {
    raw = ((await req.json()) as { id?: unknown })?.id;
  } catch {
    return json({ error: "Permintaan tidak valid." }, 400);
  }
  const num = typeof raw === "number" ? raw : typeof raw === "string" && /^\d{1,10}$/.test(raw.trim()) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(num) || num <= 0) return json({ error: "SFX tidak valid." }, 400);

  const admin = studioAdmin();
  if (!admin) return json({ error: "Belum bisa menyimpan SFX: kunci penyimpanan server belum diisi admin." }, 503);

  const sid = `fs-${num}`;
  const path = `sfx/${sid}.mp3`;
  const toMeta = (r: { cat: string; tags: string[]; dur: number; lufs: number; tp: number; hit: number; peak: number; use_for: string | null }): SfxMeta & { src: string } => ({
    id: sid,
    file: `${sid}.mp3`,
    cat: r.cat,
    tags: r.tags ?? [],
    dur: r.dur,
    lufs: r.lufs,
    tp: r.tp,
    hit: r.hit,
    peak: r.peak,
    use: r.use_for ?? "",
    src: storageSrc(path),
  });

  // sudah pernah ditambahkan -> pakai yang ada
  const { data: old, error: oldErr } = await g.supabase.from("studio_sfx").select("cat,tags,dur,lufs,tp,hit,peak,use_for").eq("id", sid).maybeSingle();
  if (oldErr && /schema cache|does not exist/i.test(oldErr.message)) return json({ error: "Jalankan supabase/migration-20-studio.sql dulu di Supabase." }, 503);
  if (old) return json({ sfx: toMeta(old), existed: true });

  let s: Sound;
  try {
    const r = await fsFetch(`/sounds/${num}/?fields=${FIELDS}`, key);
    if (r.status === 404) return json({ error: "SFX tidak ditemukan di Freesound." }, 404);
    if (!r.ok) throw new Error(`status ${r.status}`);
    s = (await r.json()) as Sound;
  } catch (e) {
    console.error("[studio/freesound] ambil", num, e instanceof Error ? e.message : e);
    return json({ error: "Freesound lagi nggak bisa dihubungi. Coba lagi sebentar." }, 502);
  }

  // cek lisensi lagi di server (jangan percaya hasil cari)
  if (!CC0.test(s.license ?? "")) return json({ error: "SFX ini bukan lisensi bebas (CC0), jadi tidak bisa ditambahkan." }, 400);
  const dur = Math.round(Number(s.duration ?? 0) * 100) / 100;
  if (!(dur > 0) || dur > MAX_DUR) return json({ error: "SFX kepanjangan (maks 2 menit)." }, 400);
  const url = previewUrl(s);
  if (!url) return json({ error: "File suara SFX ini tidak tersedia." }, 502);

  let mp3: Buffer | null = null;
  try {
    mp3 = await download(url);
  } catch (e) {
    console.error("[studio/freesound] unduh", num, e instanceof Error ? e.message : e);
  }
  if (!mp3) return json({ error: "Gagal mengunduh SFX dari Freesound. Coba lagi sebentar." }, 502);
  if (!(await putStudio(path, mp3, "audio/mpeg", admin))) return json({ error: "Gagal menyimpan SFX. Coba lagi sebentar." }, 500);

  const name = clip(s.name, 120) || sid;
  const user = clip(s.username, 60) || "anonim";
  const row = {
    id: sid,
    path,
    cat: guessCat(s),
    tags: (s.tags ?? []).slice(0, 12).map((x) => clip(x, 30).toLowerCase()).filter(Boolean),
    dur,
    // loudness belum diukur di server (tidak ada decoder mp3; kolom wajib terisi) -> perkiraan aman:
    // puncak dianggap penuh (0 dBTP) supaya sfxGain & limiter di audio.tsx tidak mendorong SFX sampai pecah
    lufs: -20,
    tp: 0,
    hit: 0,
    peak: 0,
    use_for: clip(`Freesound: ${name}`, 160),
    source: "freesound",
    license: "CC0",
    credit: clip(`${name} oleh ${user} (Freesound, CC0)`, 240),
  };
  // insert lewat service role (user tidak boleh insert langsung, supaya cek CC0 di atas tidak bisa dilewati); created_by = user
  const { error } = await admin.from("studio_sfx").insert({ ...row, created_by: g.user.id });
  if (error && error.code !== "23505") {
    console.error("[studio/freesound] simpan", error.message);
    return json({ error: "Gagal menyimpan SFX. Coba lagi sebentar." }, 500);
  }
  return json({ sfx: toMeta(row) });
}
