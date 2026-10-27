import { NextResponse } from "next/server";
import { assertTab } from "@/lib/tabs.server";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/**
 * Cari lagu di YouTube (YouTube Data API v3, resmi). Key disimpan di server (env YOUTUBE_API_KEY), tidak dikirim ke browser.
 * Kuota gratis 10.000 unit/hari, 1x cari = 100 unit -> ±100 pencarian/hari. Tanpa key: fitur tempel link tetap jalan.
 */
type Item = { id: string; title: string; channel: string; thumb: string };
type Raw = { id?: string | { videoId?: string }; snippet?: { title?: string; channelTitle?: string; thumbnails?: { default?: { url?: string } } } };
const toItem = (x: Raw): Item | null => {
  const id = typeof x.id === "string" ? x.id : x.id?.videoId;
  return id ? { id, title: decode(x.snippet?.title ?? ""), channel: decode(x.snippet?.channelTitle ?? ""), thumb: x.snippet?.thumbnails?.default?.url ?? `https://i.ytimg.com/vi/${id}/default.jpg` } : null;
};

/** lagu (kategori Musik) yang lagi naik di satu negara — chart resmi YouTube, 1 unit, cache 3 jam */
async function chart(region: string, key: string): Promise<Item[]> {
  const u = new URL("https://www.googleapis.com/youtube/v3/videos");
  u.search = new URLSearchParams({ part: "snippet", chart: "mostPopular", videoCategoryId: "10", regionCode: region, maxResults: "20", key }).toString();
  const r = await fetch(u, { next: { revalidate: 10800 } });
  if (!r.ok) return [];
  const j = (await r.json()) as { items?: Raw[] };
  return (j.items ?? []).map(toItem).filter((x): x is Item => !!x);
}
/** cadangan kalau chart negara itu kosong: lagu paling banyak ditonton 7 hari terakhir (100 unit, cache 6 jam) */
async function fresh(region: string, q: string, key: string): Promise<Item[]> {
  const day = 86400000;
  const after = new Date(Math.floor(Date.now() / day) * day - 7 * day).toISOString();
  const u = new URL("https://www.googleapis.com/youtube/v3/search");
  u.search = new URLSearchParams({ part: "snippet", q, type: "video", videoCategoryId: "10", videoEmbeddable: "true", order: "viewCount", publishedAfter: after, regionCode: region, maxResults: "15", key }).toString();
  const r = await fetch(u, { next: { revalidate: 21600 } });
  if (!r.ok) return [];
  const j = (await r.json()) as { items?: Raw[] };
  return (j.items ?? []).map(toItem).filter((x): x is Item => !!x);
}

/**
 * Urutkan hasil cari supaya yang diputar duluan versi suara paling jernih:
 * audio resmi (channel "… - Topic" dari YouTube Music, VEVO, channel resmi) di atas;
 * versi yang suaranya diubah / direkam ulang (slowed, reverb, 8D, nightcore, cover, live, karaoke, lirik buatan fans) di bawah —
 * kecuali user memang meminta versi itu.
 */
const ALTERED = ["slowed", "reverb", "8d", "nightcore", "sped up", "speed up", "bass boost", "cover", "live", "karaoke", "lirik", "lyric", "lyrics", "remix", "acoustic", "instrumental", "tiktok", "1 hour", "1 jam", "loop", "piano version", "reaction"];
function rankSongs(items: Item[], q: string): Item[] {
  const want = q.toLowerCase();
  const score = (x: Item, i: number) => {
    const t = x.title.toLowerCase();
    const ch = x.channel.toLowerCase();
    let s = -i * 0.5; // urutan relevansi YouTube tetap dihargai
    if (/ - topic$/.test(ch)) s += 6;
    if (/vevo$/.test(ch)) s += 4;
    if (/official (audio|music video|video|lyric video)|\(official\)|\[official\]|official mv|\bmv\b/.test(t)) s += 3;
    if (/official|records|music$/.test(ch)) s += 1;
    for (const w of ALTERED) if (new RegExp(`(^|[^a-z])${w.replace(/ /g, "\\s*")}([^a-z]|$)`).test(t)) s += want.includes(w) ? 7 : -5;
    return s;
  };
  return items.map((x, i) => ({ x, s: score(x, i) })).sort((a, b) => b.s - a.s).map((y) => y.x);
}

export async function GET(req: Request) {
  await getCurrentUser();
  const gate = await assertTab("musik");
  if (!gate.ok) return gate.res;
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").trim().slice(0, 120);
  const key = (process.env.YOUTUBE_API_KEY ?? "").trim();
  if (!key) return NextResponse.json({ error: "nokey" }, { status: 503 });
  const top = sp.get("top");
  if (top === "id" || top === "global") {
    let items: Item[] = [];
    if (top === "id") {
      items = await chart("ID", key);
      if (!items.length) items = await fresh("ID", "lagu indonesia", key);
    } else {
      // "Global": gabungan chart musik beberapa negara besar, diurutkan bergiliran per peringkat
      const lists = await Promise.all(["US", "GB", "KR", "JP", "BR", "IN"].map((r) => chart(r, key)));
      const seen = new Set<string>();
      for (let i = 0; i < 20 && items.length < 10; i++)
        for (const l of lists) {
          const x = l[i];
          if (x && !seen.has(x.id) && items.length < 10) seen.add(x.id), items.push(x);
        }
      if (!items.length) items = await fresh("US", "official music video", key);
    }
    if (!items.length) return NextResponse.json({ error: "Daftar trending belum bisa diambil, coba lagi nanti." }, { status: 502 });
    return NextResponse.json({ items: items.slice(0, 10) }, { headers: { "Cache-Control": "private, max-age=1800" } });
  }
  if (!q) return NextResponse.json({ items: [] });
  const u = new URL("https://www.googleapis.com/youtube/v3/search");
  u.search = new URLSearchParams({ part: "snippet", q, type: "video", videoEmbeddable: "true", videoCategoryId: "10", maxResults: "10", regionCode: "ID", safeSearch: "moderate", key }).toString();
  const r = await fetch(u, { cache: "no-store" });
  if (!r.ok) return NextResponse.json({ error: r.status === 403 ? "Kuota pencarian YouTube hari ini habis, coba tempel link saja." : "Pencarian YouTube gagal." }, { status: 502 });
  const j = (await r.json()) as { items?: Raw[] };
  const items = rankSongs((j.items ?? []).map(toItem).filter((x): x is Item => !!x), q);
  return NextResponse.json({ items }, { headers: { "Cache-Control": "private, max-age=600" } });
}
