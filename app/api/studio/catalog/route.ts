import { NextResponse } from "next/server";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { studioGuard } from "@/lib/studio/access.server";
import { SFX_BUILTIN, type SfxMeta } from "@/lib/studio/sfxMeta";
import { listStudio, studioClient } from "@/lib/studio/storage.server";
import { musicSrc, sfxSrc, storageSrc } from "@/lib/studio/urls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Katalog audio Studio: SFX bawaan (assets/audio/sfx) + SFX tambahan (tabel studio_sfx),
 * musik di assets/audio/music + musik upload user (storage uploads/<uid>/music/). bed = musik cadangan "trailer bed" selalu ada.
 */

type Sfx = SfxMeta & { src: string };
type Music = { name: string; src: string; lufs?: number | null };
type Row = { id: string; path: string; cat: string | null; tags: string[] | null; dur: number | null; lufs: number | null; tp: number | null; hit: number | null; peak: number | null; use_for: string | null };

const MUSIC = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.(mp3|wav|m4a)$/i;
const UPLOAD = /\.(mp3|wav|m4a|ogg|aac|webm|flac)$/i;
const UUIDISH = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** "musik-teaser.mp3" -> "Musik teaser" */
function pretty(file: string): string {
  const s = file.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : file;
}

/** SFX tambahan. ok = false kalau tabel gagal dibaca -> katalog ditandai `partial` (klien jangan membuang cue SFX tambahan) */
async function extraSfx(sb: Parameters<typeof studioClient>[0]): Promise<{ list: Sfx[]; ok: boolean }> {
  if (!sb) return { list: [], ok: false };
  try {
    const { data, error } = await sb.from("studio_sfx").select("id,path,cat,tags,dur,lufs,tp,hit,peak,use_for").order("created_at", { ascending: true }).limit(500);
    if (error || !data) return { list: [], ok: false }; // tabel belum ada / gagal dibaca -> bawaan saja
    const builtin = new Set(SFX_BUILTIN.map((s) => s.id));
    const list = (data as Row[])
      .filter((r) => r.id && r.path && !builtin.has(r.id))
      .map((r) => ({
        id: r.id,
        file: r.path.split("/").pop() ?? r.path,
        cat: r.cat || "ui",
        tags: Array.isArray(r.tags) ? r.tags : [],
        dur: num(r.dur, 1),
        lufs: num(r.lufs, -20),
        tp: num(r.tp, -3),
        hit: num(r.hit, 0),
        peak: num(r.peak, 0),
        use: r.use_for ?? "",
        src: storageSrc(r.path),
      }));
    return { list, ok: true };
  } catch {
    return { list: [], ok: false };
  }
}

async function repoMusic(): Promise<Music[]> {
  try {
    const files = await readdir(path.join(process.cwd(), "assets", "audio", "music"));
    return files.filter((f) => MUSIC.test(f)).sort().map((f) => ({ name: pretty(f), src: musicSrc(f), lufs: null }));
  } catch {
    return [];
  }
}

async function userMusic(uid: string, sb: Parameters<typeof studioClient>[0]): Promise<Music[]> {
  const files = (await listStudio(`uploads/${uid}/music`, studioClient(sb))).filter((f) => UPLOAD.test(f.name));
  files.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? "") || a.name.localeCompare(b.name));
  return files.map((f, i) => ({ name: UUIDISH.test(f.name.replace(/\.[^.]+$/, "")) ? `Musik upload ${i + 1}` : pretty(f.name), src: storageSrc(f.path), lufs: null }));
}

export async function GET() {
  const g = await studioGuard();
  if (!g.ok) return g.res;

  const [extra, repo, mine] = await Promise.all([extraSfx(g.supabase), repoMusic(), userMusic(g.user.id, g.supabase)]);
  const sfx: Sfx[] = [...SFX_BUILTIN.map((s) => ({ ...s, src: sfxSrc(s.file) })), ...extra.list];
  return NextResponse.json({ sfx, music: [...repo, ...mine], bed: true, ...(extra.ok ? {} : { partial: true }) }, { headers: { "Cache-Control": "private, max-age=120" } });
}
