import "server-only";

/**
 * Cari FOTO ASLI dari internet (bukan dibuat AI). Urutan sumber:
 *  1. Unsplash (UNSPLASH_ACCESS_KEY) & Pexels (PEXELS_API_KEY) — foto bebas pakai, wajib kredit fotografer
 *  2. cadangan: pencarian gambar web — SerpApi Google Images (SERPAPI_API_KEY) lalu Tavily (TAVILY_API_KEY)
 *  3. semua kosong / gagal -> daftar kosong (AI menggambar ilustrasi SVG dan bilang itu ilustrasi)
 * Kunci diisi di Vercel (Environment Variables) — begitu diisi, sumber otomatis pindah tanpa ubah kode.
 * Aturan Unsplash: gambar di-hotlink (tidak disimpan ulang), kredit + link fotografer & Unsplash, dan
 * endpoint download dipanggil saat user mengunduh (lihat trackUnsplash).
 */
export type PhotoProvider = "unsplash" | "pexels" | "web";
export type Photo = {
  id: string;
  thumb: string;
  full: string;
  page: string;
  author: string;
  authorUrl?: string;
  alt?: string;
  provider: PhotoProvider;
  license: string;
  /** Unsplash: links.download_location (dipanggil saat diunduh) */
  download?: string;
  w?: number;
  h?: number;
};
export type PhotoResult = { query: string; source: PhotoProvider | "none"; items: Photo[]; note?: string };

const env = (k: string) => (process.env[k] ?? "").trim();
const TIMEOUT = 7000;
const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const httpsOnly = (u: string) => (/^https:\/\//i.test(u) ? u : "");
const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** sumber yang kuncinya sudah diisi (untuk memberi tahu AI, tanpa memanggil apa pun) */
export function photoSources() {
  return { stock: !!(env("UNSPLASH_ACCESS_KEY") || env("PEXELS_API_KEY")), web: !!(env("SERPAPI_API_KEY") || env("TAVILY_API_KEY")) };
}

async function getJson(url: string, init: RequestInit = {}) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT), cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<Record<string, unknown>>;
}
const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

async function unsplash(q: string, n: number): Promise<Photo[]> {
  const key = env("UNSPLASH_ACCESS_KEY");
  if (!key) return [];
  const j = await getJson(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=${n}&content_filter=high&lang=id`, {
    headers: { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" },
  });
  return arr(j.results).map((p) => {
    const urls = obj(p.urls);
    const links = obj(p.links);
    const user = obj(p.user);
    return {
      id: `u-${str(p.id, 40)}`,
      thumb: httpsOnly(str(urls.small, 600)),
      full: httpsOnly(str(urls.regular, 600)),
      page: httpsOnly(str(links.html, 300)),
      author: str(user.name, 80) || "Unsplash",
      authorUrl: httpsOnly(str(obj(user.links).html, 300)),
      alt: str(p.alt_description, 160),
      provider: "unsplash" as const,
      license: "Unsplash License · gratis dipakai",
      download: str(links.download_location, 400),
      w: Number(p.width) || undefined,
      h: Number(p.height) || undefined,
    };
  });
}

async function pexels(q: string, n: number): Promise<Photo[]> {
  const key = env("PEXELS_API_KEY");
  if (!key) return [];
  const j = await getJson(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=${n}&locale=id-ID`, { headers: { Authorization: key } });
  return arr(j.photos).map((p) => {
    const src = obj(p.src);
    return {
      id: `p-${str(String(p.id ?? ""), 40)}`,
      thumb: httpsOnly(str(src.medium, 600)),
      full: httpsOnly(str(src.large2x, 600) || str(src.large, 600)),
      page: httpsOnly(str(p.url, 300)),
      author: str(p.photographer, 80) || "Pexels",
      authorUrl: httpsOnly(str(p.photographer_url, 300)),
      alt: str(p.alt, 160),
      provider: "pexels" as const,
      license: "Pexels License · gratis dipakai",
      w: Number(p.width) || undefined,
      h: Number(p.height) || undefined,
    };
  });
}

const WEB_LICENSE = "Foto web · cek hak cipta sebelum dipakai";

async function serpImages(q: string, n: number): Promise<Photo[]> {
  const key = env("SERPAPI_API_KEY");
  if (!key) return [];
  const j = await getJson(`https://serpapi.com/search.json?engine=google_images&q=${encodeURIComponent(q)}&safe=active&hl=id&gl=id&api_key=${encodeURIComponent(key)}`);
  return arr(j.images_results)
    .slice(0, n * 2)
    .map((p, i) => {
      const page = httpsOnly(str(p.link, 400));
      return {
        id: `s-${i}`,
        thumb: httpsOnly(str(p.thumbnail, 600)),
        full: httpsOnly(str(p.original, 600)) || httpsOnly(str(p.thumbnail, 600)),
        page,
        author: str(p.source, 80) || host(page) || "web",
        alt: str(p.title, 160),
        provider: "web" as const,
        license: WEB_LICENSE,
        w: Number(p.original_width) || undefined,
        h: Number(p.original_height) || undefined,
      };
    });
}

async function tavilyImages(q: string, n: number): Promise<Photo[]> {
  const key = env("TAVILY_API_KEY");
  if (!key) return [];
  const base = (process.env.TAVILY_BASE_URL ?? "https://api.tavily.com").trim().replace(/\/+$/, "");
  const j = await getJson(`${base}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query: `${q} foto`, include_images: true, include_image_descriptions: true, max_results: 5, search_depth: "basic" }),
  });
  return (Array.isArray(j.images) ? (j.images as unknown[]) : [])
    .map((x) => (typeof x === "string" ? { url: x } : obj(x)))
    .filter((p) => typeof p.url === "string")
    .slice(0, n * 2)
    .map((p, i) => {
      const url = httpsOnly(str(p.url, 600));
      return { id: `t-${i}`, thumb: url, full: url, page: url, author: host(url) || "web", alt: str(p.description, 160), provider: "web" as const, license: WEB_LICENSE };
    });
}

const cache = new Map<string, { at: number; r: PhotoResult }>();
const TTL = 15 * 60_000;

/** cari foto: kunci kosong / sumber gagal tidak pernah melempar error — hasilnya daftar kosong + catatan */
export async function searchPhotos(qIn: string, nIn = 6, webOnly = false): Promise<PhotoResult> {
  const query = qIn.replace(/\s+/g, " ").trim().slice(0, 80);
  const n = Math.min(6, Math.max(4, Math.round(nIn) || 6));
  if (!query) return { query, source: "none", items: [], note: "kata kunci kosong" };
  const ck = `${query.toLowerCase()}|${n}|${webOnly ? "w" : ""}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < TTL) return hit.r;

  const ok = (list: Photo[]) => list.filter((p) => p.thumb && p.full);
  let r: PhotoResult | null = null;
  // 1) foto stok bebas pakai: Unsplash & Pexels dicari bareng, digabung selang-seling
  // webOnly: foto tokoh/berita (tidak ada di Unsplash/Pexels) -> langsung pencarian gambar web
  const [u, p] = webOnly ? [[], []] : await Promise.all([unsplash(query, n).catch(() => []), pexels(query, n).catch(() => [])]);
  const stock: Photo[] = [];
  for (let i = 0; i < n && stock.length < n; i++) {
    if (u[i]) stock.push(u[i]);
    if (p[i] && stock.length < n) stock.push(p[i]);
  }
  const s = ok(stock);
  if (s.length) r = { query, source: s[0].provider, items: s.slice(0, n) };
  // 2) cadangan: pencarian gambar web
  if (!r) {
    for (const f of [serpImages, tavilyImages]) {
      const w = ok(await f(query, n).catch(() => []));
      const seen = new Set<string>();
      const uniq = w.filter((x) => !seen.has(x.full) && seen.add(x.full));
      if (uniq.length) {
        r = { query, source: "web", items: uniq.slice(0, n) };
        break;
      }
    }
  }
  if (!r) {
    const src = photoSources();
    r = { query, source: "none", items: [], note: src.stock || src.web ? "foto tidak ditemukan / sumber sedang gagal" : "belum ada sumber foto yang aktif" };
  }
  if (r.items.length) {
    cache.set(ck, { at: Date.now(), r });
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
  }
  return r;
}

/* ---------------------------------------------------------------------------------------------------------
 * Foto TOKOH & foto BERITA untuk desain konten berita (dicari otomatis, tanpa upload):
 *  - potret Wikipedia/Wikimedia Commons (gratis, tanpa kunci; latarnya polos -> mudah dihapus jadi potongan orang)
 *  - foto web dari pencarian gambar (Tavily / SerpApi)
 *  - og:image artikel sumber berita (foto utama berita yang memang dipakai media itu)
 * --------------------------------------------------------------------------------------------------------- */
const UA = "CS-Tracker/1.0 (konten.com; foto desain berita)";

async function wikiPortrait(name: string, lang: "id" | "en"): Promise<Photo | null> {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent(name)}&gsrlimit=1&prop=pageimages|info&piprop=thumbnail|name&pithumbsize=1400&inprop=url`;
  const j = await getJson(url, { headers: { "User-Agent": UA } });
  const page = Object.values(obj(obj(j.query).pages))[0] as Record<string, unknown> | undefined;
  const th = obj(page?.thumbnail);
  const src = httpsOnly(str(th.source, 600));
  if (!page || !src) return null;
  return {
    id: `w-${lang}-${str(String(page.pageid ?? ""), 20)}`,
    thumb: src,
    full: src,
    page: httpsOnly(str(page.fullurl, 300)) || `https://${lang}.wikipedia.org`,
    author: "Wikipedia / Wikimedia Commons",
    alt: str(page.title, 120),
    provider: "web",
    license: "Wikimedia Commons · cek lisensi foto",
    w: Number(th.width) || undefined,
    h: Number(th.height) || undefined,
  };
}

/** foto tokoh publik: potret Wikipedia dulu (paling rapi untuk dipotong), lalu foto web */
export async function personPhotos(nameIn: string, n = 6): Promise<PhotoResult> {
  const query = nameIn.replace(/\s+/g, " ").trim().slice(0, 60);
  if (!query) return { query, source: "none", items: [] };
  const ck = `person|${query.toLowerCase()}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < TTL) return hit.r;
  const [wid, wen, web] = await Promise.all([
    wikiPortrait(query, "id").catch(() => null),
    wikiPortrait(query, "en").catch(() => null),
    searchPhotos(query, n, true).catch(() => null),
  ]);
  const seen = new Set<string>();
  const items = [wid, wen, ...(web?.items ?? [])].filter((p): p is Photo => !!p && !!p.full && !seen.has(p.full) && !!seen.add(p.full)).slice(0, n);
  const r: PhotoResult = { query, source: items.length ? "web" : "none", items };
  if (items.length) cache.set(ck, { at: Date.now(), r });
  return r;
}

/** og:image / twitter:image dari halaman artikel (foto utama berita) */
async function ogImage(pageUrl: string): Promise<Photo | null> {
  const { safeUrl } = await import("./safeUrl.server");
  const u = await safeUrl(pageUrl);
  if (!u) return null;
  const r = await fetch(u, { redirect: "follow", signal: AbortSignal.timeout(TIMEOUT), headers: { "User-Agent": "Mozilla/5.0 (compatible; CS-Tracker)", Accept: "text/html" } });
  if (!r.ok || !(r.headers.get("content-type") ?? "").includes("html")) return null;
  // cukup bagian <head>
  const reader = r.body?.getReader();
  let html = "";
  const dec = new TextDecoder();
  while (reader && html.length < 400_000 && !/<\/head>/i.test(html)) {
    const { value, done } = await reader.read();
    if (done) break;
    html += dec.decode(value, { stream: true });
  }
  reader?.cancel().catch(() => {});
  const meta = (key: string) =>
    html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']+)["']`, "i"))?.[1] ??
    html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${key}["']`, "i"))?.[1];
  const raw = meta("og:image") ?? meta("og:image:url") ?? meta("twitter:image");
  if (!raw) return null;
  const src = httpsOnly(new URL(raw.replace(/&amp;/g, "&"), u).href);
  if (!src || /logo|favicon|default|placeholder/i.test(src)) return null;
  return { id: `og-${host(u.href)}`, thumb: src, full: src, page: u.href, author: host(u.href), alt: str(meta("og:title"), 160), provider: "web", license: WEB_LICENSE };
}

/** foto utama dari beberapa artikel sumber (maks 5, dicari bareng) */
export async function newsImages(urls: string[]): Promise<PhotoResult> {
  const list = [...new Set(urls.filter((x) => /^https:\/\//.test(x)))].slice(0, 5);
  const got = await Promise.all(list.map((x) => ogImage(x).catch(() => null)));
  const seen = new Set<string>();
  const items = got.filter((p): p is Photo => !!p && !seen.has(p.full) && !!seen.add(p.full));
  return { query: "berita", source: items.length ? "web" : "none", items };
}

/** Aturan Unsplash: panggil endpoint download saat user mengunduh foto (hanya URL resmi api.unsplash.com) */
export async function trackUnsplash(downloadLocation: string) {
  const key = env("UNSPLASH_ACCESS_KEY");
  if (!key || !/^https:\/\/api\.unsplash\.com\/photos\/[\w-]+\/download(\?|$)/.test(downloadLocation)) return false;
  try {
    const r = await fetch(downloadLocation, { headers: { Authorization: `Client-ID ${key}` }, signal: AbortSignal.timeout(TIMEOUT), cache: "no-store" });
    return r.ok;
  } catch {
    return false;
  }
}

/** kata kunci foto dari kalimat user: "foto kucing lucu" -> "kucing lucu", "poster libur pakai foto pantai" -> "pantai" */
export function photoQuery(text: string): string {
  const t = text.replace(/https?:\/\/\S+/g, " ").replace(/[`*_#>]/g, " ");
  const m = t.match(/\b(?:foto|photo|gambar|image|picture|pic)(?:-foto)?\s+(?:of\s+|tentang\s+|soal\s+|si\s+)?([^,.;:!?\n]{2,80})/i);
  const raw = (m ? m[1] : t)
    .replace(/\b(dong|deh|ya|yah|yg|yang|aja|saja|ini|itu|nya|sih|nih|kak|bro|tolong|please|plis|carikan|cariin|cari|kasih|tampilkan|beberapa|buat|untuk|buatku|aku|saya|mau|pengen|ingin|\d+|biji|buah|lembar|resolusi tinggi|hd|bagus|keren)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return raw.split(" ").slice(0, 5).join(" ");
}
