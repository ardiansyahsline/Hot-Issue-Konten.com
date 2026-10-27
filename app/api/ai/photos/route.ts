import { NextResponse, type NextRequest } from "next/server";
import { assertTab } from "@/lib/tabs.server";
import { getCurrentUser } from "@/lib/auth";
import { newsImages, personPhotos, searchPhotos, trackUnsplash } from "@/lib/photos.server";

export const dynamic = "force-dynamic";

/**
 * Foto asli dari internet untuk grid foto di chat AI. ?q=kucing lucu&n=6
 * ?src=web -> lewati Unsplash/Pexels (foto tokoh / berita).
 * ?person=Prabowo Subianto -> foto tokoh (potret Wikipedia dulu, lalu foto web).
 * ?news=<url artikel>&news=<url> -> foto utama (og:image) artikel sumber berita.
 * ?track=<download_location Unsplash> -> lapor unduhan ke Unsplash (aturan API Unsplash).
 * Kunci kosong / sumber gagal -> {items: []} (bukan error).
 */
export async function GET(req: NextRequest) {
  await getCurrentUser();
  const gate = await assertTab("ai");
  if (!gate.ok) return gate.res;
  const sp = req.nextUrl.searchParams;
  const track = sp.get("track");
  if (track) return NextResponse.json({ ok: await trackUnsplash(track) });
  const person = sp.get("person");
  if (person) return NextResponse.json(await personPhotos(person), { headers: { "Cache-Control": "private, max-age=600" } });
  const news = sp.getAll("news");
  if (news.length) return NextResponse.json(await newsImages(news), { headers: { "Cache-Control": "private, max-age=600" } });
  const r = await searchPhotos(sp.get("q") ?? "", Number(sp.get("n") ?? 6), sp.get("src") === "web");
  return NextResponse.json(r, { headers: { "Cache-Control": "private, max-age=600" } });
}
