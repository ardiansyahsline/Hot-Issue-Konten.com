import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { studioGuard } from "@/lib/studio/access.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sajikan SFX / musik dari assets/audio (BUKAN public/) — wajib login + akses Studio.
 * Dukung Range (206) supaya audio bisa di-seek di Player. File ikut ter-deploy lewat outputFileTracingIncludes (next.config.mjs).
 */

const DIRS = new Set(["sfx", "music"]);
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.(mp3|wav|m4a|ogg)$/i;
const TYPES: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg" };

const err = (status: number, error: string, extra: Record<string, string> = {}) =>
  Response.json({ error }, { status, headers: { "Cache-Control": "no-store", ...extra } });

/** "bytes=a-b" | "bytes=a-" | "bytes=-n" -> [awal, akhir] inklusif; null = abaikan (kirim penuh); "bad" = di luar ukuran */
function parseRange(h: string | null, size: number): [number, number] | null | "bad" {
  if (!h) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(h.trim()); // multi-range tidak didukung -> kirim penuh
  if (!m || (!m[1] && !m[2])) return null;
  let a: number;
  let b: number;
  if (!m[1]) {
    const n = Number(m[2]);
    if (n === 0) return "bad";
    a = Math.max(0, size - n);
    b = size - 1;
  } else {
    a = Number(m[1]);
    b = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (a >= size || a > b) return "bad";
  return [a, b];
}

async function serve(req: Request, params: Promise<{ path?: string[] }>, head: boolean) {
  const g = await studioGuard();
  if (!g.ok) return g.res;

  const parts = (await params).path ?? [];
  const [dir, file] = parts;
  if (parts.length !== 2 || !DIRS.has(dir) || !file || file.includes("..") || !NAME.test(file)) return err(404, "File tidak ditemukan.");

  const root = path.join(process.cwd(), "assets", "audio", dir);
  const full = path.join(root, file);
  if (path.dirname(full) !== root) return err(404, "File tidak ditemukan.");

  let size: number;
  let mtime: Date;
  try {
    const st = await stat(full);
    if (!st.isFile()) return err(404, "File tidak ditemukan.");
    size = st.size;
    mtime = st.mtime;
  } catch {
    return err(404, "File tidak ditemukan.");
  }

  const ext = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
  const etag = `"${size.toString(36)}-${Math.floor(mtime.getTime() / 1000).toString(36)}"`;
  const base: Record<string, string> = {
    "Content-Type": TYPES[ext] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=86400",
    ETag: etag,
    "Last-Modified": mtime.toUTCString(),
  };

  const rangeHeader = req.headers.get("range");
  // If-Range beda versi -> kirim file penuh
  const ifRange = req.headers.get("if-range");
  const range = parseRange(ifRange && ifRange !== etag ? null : rangeHeader, size);
  if (range === "bad") return err(416, "Rentang tidak valid.", { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" });
  if (!range && req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: base });

  const [a, b] = range ?? [0, Math.max(0, size - 1)];
  const len = size === 0 ? 0 : b - a + 1;
  const headers = { ...base, "Content-Length": String(len), ...(range ? { "Content-Range": `bytes ${a}-${b}/${size}` } : {}) };
  if (head || len === 0) return new Response(null, { status: range ? 206 : 200, headers });

  const body = Readable.toWeb(createReadStream(full, { start: a, end: b })) as unknown as ReadableStream<Uint8Array>;
  return new Response(body, { status: range ? 206 : 200, headers });
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: Request, { params }: Ctx) {
  return serve(req, params, false);
}

export async function HEAD(req: Request, { params }: Ctx) {
  return serve(req, params, true);
}
