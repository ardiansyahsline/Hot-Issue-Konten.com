import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/**
 * Cari lagu di YouTube (YouTube Data API v3, resmi). Key disimpan di server (env YOUTUBE_API_KEY), tidak dikirim ke browser.
 * Kuota gratis 10.000 unit/hari, 1x cari = 100 unit -> ±100 pencarian/hari. Tanpa key: fitur tempel link tetap jalan.
 */
export async function GET(req: Request) {
  await getCurrentUser();
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 120);
  const key = (process.env.YOUTUBE_API_KEY ?? "").trim();
  if (!key) return NextResponse.json({ error: "nokey" }, { status: 503 });
  if (!q) return NextResponse.json({ items: [] });
  const u = new URL("https://www.googleapis.com/youtube/v3/search");
  u.search = new URLSearchParams({ part: "snippet", q, type: "video", videoEmbeddable: "true", videoCategoryId: "10", maxResults: "10", regionCode: "ID", safeSearch: "moderate", key }).toString();
  const r = await fetch(u, { cache: "no-store" });
  if (!r.ok) return NextResponse.json({ error: r.status === 403 ? "Kuota pencarian YouTube hari ini habis, coba tempel link saja." : "Pencarian YouTube gagal." }, { status: 502 });
  const j = (await r.json()) as { items?: { id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string; thumbnails?: { default?: { url?: string } } } }[] };
  const items = (j.items ?? [])
    .filter((x) => x.id?.videoId)
    .map((x) => ({ id: x.id!.videoId!, title: decode(x.snippet?.title ?? ""), channel: decode(x.snippet?.channelTitle ?? ""), thumb: x.snippet?.thumbnails?.default?.url ?? `https://i.ytimg.com/vi/${x.id!.videoId}/default.jpg` }));
  return NextResponse.json({ items }, { headers: { "Cache-Control": "private, max-age=600" } });
}
