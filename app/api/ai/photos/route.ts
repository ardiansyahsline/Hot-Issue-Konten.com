import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { searchPhotos, trackUnsplash } from "@/lib/photos.server";

export const dynamic = "force-dynamic";

/**
 * Foto asli dari internet untuk grid foto di chat AI. ?q=kucing lucu&n=6
 * ?src=web -> lewati Unsplash/Pexels (foto tokoh / berita).
 * ?track=<download_location Unsplash> -> lapor unduhan ke Unsplash (aturan API Unsplash).
 * Kunci kosong / sumber gagal -> {items: []} (bukan error).
 */
export async function GET(req: NextRequest) {
  await getCurrentUser();
  const sp = req.nextUrl.searchParams;
  const track = sp.get("track");
  if (track) return NextResponse.json({ ok: await trackUnsplash(track) });
  const r = await searchPhotos(sp.get("q") ?? "", Number(sp.get("n") ?? 6), sp.get("src") === "web");
  return NextResponse.json(r, { headers: { "Cache-Control": "private, max-age=600" } });
}
