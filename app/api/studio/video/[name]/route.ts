import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { studioGuard } from "@/lib/studio/access.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Video jadi internal (teaser CS Tracker: isi internal & nama asli tim) dari assets/videos/ — BUKAN public/.
 * Wajib login + akses Studio (studioGuard, sama dengan route asset SFX/musik). Hanya nama file yang terdaftar di bawah.
 * Dukung Range (206) supaya bisa diputar/di-seek; HEAD dipakai menu Template lama untuk cek file sudah ada atau belum (404).
 * Deploy: file ikut ter-deploy kalau assets/videos/** masuk outputFileTracingIncludes (next.config.mjs) untuk route ini.
 */
const DIR = path.join(process.cwd(), "assets", "videos");
const FILES: Record<string, string> = {
  "teaser-cs-tracker.mp4": path.join(process.cwd(), "assets", "videos", "teaser-cs-tracker.mp4"),
  "teaser-cs-tracker-tanpa-vo.mp4": path.join(process.cwd(), "assets", "videos", "teaser-cs-tracker-tanpa-vo.mp4"),
};

const err = (status: number, error: string, extra: Record<string, string> = {}) =>
  Response.json({ error }, { status, headers: { "Cache-Control": "no-store", ...extra } });

/** "bytes=a-b" | "bytes=a-" | "bytes=-n" -> [awal, akhir] inklusif; null = kirim penuh; "bad" = di luar ukuran */
function parseRange(h: string | null, size: number): [number, number] | null | "bad" {
  if (!h) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(h.trim());
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

async function serve(req: Request, params: Promise<{ name?: string }>, head: boolean) {
  const g = await studioGuard();
  if (!g.ok) return g.res;

  const name = (await params).name ?? "";
  const full = Object.prototype.hasOwnProperty.call(FILES, name) ? FILES[name] : null;
  if (!full || path.dirname(full) !== DIR) return err(404, "Video tidak ditemukan.");

  let size: number;
  let mtime: Date;
  try {
    const st = await stat(full);
    if (!st.isFile()) return err(404, "Video tidak ditemukan.");
    size = st.size;
    mtime = st.mtime;
  } catch {
    return err(404, "Video belum diunggah.");
  }

  const etag = `"${size.toString(36)}-${Math.floor(mtime.getTime() / 1000).toString(36)}"`;
  const base: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "Content-Disposition": `inline; filename="${name}"`,
    ETag: etag,
    "Last-Modified": mtime.toUTCString(),
  };

  const ifRange = req.headers.get("if-range");
  const range = parseRange(ifRange && ifRange !== etag ? null : req.headers.get("range"), size);
  if (range === "bad") return err(416, "Rentang tidak valid.", { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" });
  if (!range && req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: base });

  const [a, b] = range ?? [0, Math.max(0, size - 1)];
  const len = size === 0 ? 0 : b - a + 1;
  const headers = { ...base, "Content-Length": String(len), ...(range ? { "Content-Range": `bytes ${a}-${b}/${size}` } : {}) };
  if (head || len === 0) return new Response(null, { status: range ? 206 : 200, headers });

  const body = Readable.toWeb(createReadStream(full, { start: a, end: b })) as unknown as ReadableStream<Uint8Array>;
  return new Response(body, { status: range ? 206 : 200, headers });
}

type Ctx = { params: Promise<{ name: string }> };

export async function GET(req: Request, { params }: Ctx) {
  return serve(req, params, false);
}

export async function HEAD(req: Request, { params }: Ctx) {
  return serve(req, params, true);
}
