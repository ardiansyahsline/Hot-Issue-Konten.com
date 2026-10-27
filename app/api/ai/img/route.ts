import { NextResponse, type NextRequest } from "next/server";
import { assertTab } from "@/lib/tabs.server";
import { getCurrentUser } from "@/lib/auth";
import { safeUrl } from "@/lib/safeUrl.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Perantara gambar web untuk desain AI: ?u=<url gambar https>.
 * Foto hasil pencarian web (situs berita dll.) biasanya tidak bisa dipakai langsung di kanvas (CORS) dan diblokir
 * aturan keamanan desain -> diambil lewat server ini supaya bisa tampil di desain & ikut ter-download.
 * Aman: hanya https, hanya alamat internet publik (bukan jaringan internal), hanya file gambar, maks 8 MB.
 */
const MAX = 8 * 1024 * 1024;

export async function GET(req: NextRequest) {
  await getCurrentUser();
  const gate = await assertTab("ai");
  if (!gate.ok) return gate.res;
  let url = await safeUrl(req.nextUrl.searchParams.get("u") ?? "");
  if (!url) return NextResponse.json({ error: "alamat gambar tidak diizinkan" }, { status: 400 });
  // ikuti pengalihan (maks 3) sambil cek ulang alamatnya
  let r: Response | null = null;
  for (let i = 0; i < 4; i++) {
    r = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(9000), headers: { "User-Agent": "Mozilla/5.0 CS-Tracker-ImageProxy", Accept: "image/*" } }).catch(() => null);
    if (!r) break;
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
      url = await safeUrl(new URL(r.headers.get("location")!, url).href);
      if (!url) return NextResponse.json({ error: "pengalihan tidak diizinkan" }, { status: 400 });
      continue;
    }
    break;
  }
  if (!r || !r.ok) return NextResponse.json({ error: "gambar gagal diambil" }, { status: 502 });
  const type = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(type)) return NextResponse.json({ error: "bukan file gambar" }, { status: 415 });
  if (Number(r.headers.get("content-length") ?? 0) > MAX) return NextResponse.json({ error: "gambar terlalu besar" }, { status: 413 });
  const buf = await r.arrayBuffer();
  if (buf.byteLength > MAX) return NextResponse.json({ error: "gambar terlalu besar" }, { status: 413 });
  return new NextResponse(buf, { headers: { "Content-Type": type, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" } });
}
