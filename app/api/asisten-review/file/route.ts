import { NextResponse } from "next/server";
import { asistenGuard } from "@/lib/asistenReview.server";
import { cleanArPath, readAr, signedArUrl } from "@/lib/asistenReviewStorage.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };
const json = (error: string, status: number) => NextResponse.json({ error }, { status, headers: NO_STORE });

/**
 * File Asisten Review di bucket PRIVAT "asisten-review" (KONTRAK.md §2.3). Hanya admin & user yang dibuka tab-nya.
 * - GET ?p=materi/<campaign>/(auto|manual)/<file> → 302 ke signed URL 1 jam (lagu / poster / trailer).
 * - GET ?p=laporan/<run_id>.html → laporan uji akurasi disajikan dari sini (bukan signed URL) dengan CSP sandbox:
 *   tanpa skrip, tanpa sumber luar, hanya CSS inline + gambar data:. `&unduh=1` → disimpan sebagai file.
 */
export async function GET(req: Request) {
  const g = await asistenGuard();
  if (!g.ok) return g.res;
  if (!g.ctx.ready) return json("Jalankan migration-23-asisten-review.sql dulu di Supabase.", 503);

  const sp = new URL(req.url).searchParams;
  const p = cleanArPath(sp.get("p"));
  if (!p) return json("Alamat file tidak valid.", 400);
  const unduh = sp.get("unduh") === "1";
  const gone = () => json("File tidak ditemukan atau sudah dihapus.", 404);

  if (p.jenis === "materi") {
    const nama = unduh ? p.path.split("/").pop() : undefined;
    const url = await signedArUrl(p.path, g.ctx.supabase, 3600, nama);
    if (!url) return gone();
    // di bawah masa berlaku signed URL → putar ulang / geser audio tidak minta tanda tangan baru terus
    return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "private, max-age=1800" } });
  }

  const blob = await readAr(p.path, g.ctx.supabase);
  if (!blob) return gone();
  if (blob.size > 20 * 1024 * 1024) return json("Laporan terlalu besar untuk dibuka.", 413);
  const body = await blob.arrayBuffer();
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "SAMEORIGIN",
      "Cache-Control": "private, no-store",
      "Content-Disposition": `${unduh ? "attachment" : "inline"}; filename="laporan-uji-${p.runId.slice(0, 8)}.html"`,
    },
  });
}
