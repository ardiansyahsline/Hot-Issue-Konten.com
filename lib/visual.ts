/**
 * Kemampuan visual AI TANPA model pembuat gambar (cara kerja ala Claude):
 *  - DESAIN: AI menulis HTML/CSS/SVG di blok ```design <ukuran> | <nama>``` → website merender di kotak aman
 *    (iframe sandbox tanpa script + CSP) → bisa diunduh PNG resolusi tinggi & HTML. Beberapa blok = beberapa opsi.
 *  - FOTO: AI menulis blok ```photos {"query":"…","count":6}``` → website mencari foto ASLI (Unsplash/Pexels → web).
 */

export type DesignSize = "1:1" | "4:5" | "9:16" | "16:9" | "A4";
export const SIZES: Record<DesignSize, { w: number; h: number; label: string }> = {
  "1:1": { w: 1080, h: 1080, label: "Feed 1:1" },
  "4:5": { w: 1080, h: 1350, label: "Feed 4:5" },
  "9:16": { w: 1080, h: 1920, label: "Story/TikTok 9:16" },
  "16:9": { w: 1920, h: 1080, label: "Thumbnail 16:9" },
  A4: { w: 1240, h: 1754, label: "A4" },
};
export type Design = { size: DesignSize; name: string; html: string };
export type PhotoAsk = { query: string; count: number };

const DESIGN_DONE = /```design[ \t]*([^\n]*)\n([\s\S]*?)```/gi;
const PHOTOS_DONE = /```photos\s*\n?([\s\S]*?)```/i;

function sizeOf(s: string): DesignSize {
  const t = s.toLowerCase().replace(/\s+/g, "");
  if (/9:16|story|reels?|tiktok|vertikal|portrait/.test(t)) return "9:16";
  if (/16:9|thumbnail|youtube|landscape|horizontal|banner/.test(t)) return "16:9";
  if (/4:5/.test(t)) return "4:5";
  if (/a4|flyer|brosur/.test(t)) return "A4";
  return "1:1";
}

/** pisahkan blok ```design (bisa lebih dari satu = opsi) dari teks. Blok yang belum selesai saat streaming disembunyikan. */
export function splitDesigns(text: string): { text: string; designs: Design[]; partial: boolean } {
  const designs: Design[] = [];
  let rest = text.replace(DESIGN_DONE, (_, head: string, body: string) => {
    const [sz, ...name] = head.split("|");
    const html = body.trim();
    if (html) designs.push({ size: sizeOf(sz || ""), name: name.join("|").trim().slice(0, 60) || `Opsi ${String.fromCharCode(65 + designs.length)}`, html: html.slice(0, 60000) });
    return "";
  });
  const open = rest.search(/```design\b/i);
  const partial = open >= 0;
  if (partial) rest = rest.slice(0, open);
  return { text: rest.replace(/\n{3,}/g, "\n\n").trim(), designs, partial };
}

/** pisahkan blok ```photos */
export function splitPhotos(text: string): { text: string; photos: PhotoAsk | null; partial: boolean } {
  const m = text.match(PHOTOS_DONE);
  if (!m) {
    const i = text.search(/```photos\b/i);
    return i >= 0 ? { text: text.slice(0, i).trimEnd(), photos: null, partial: true } : { text, photos: null, partial: false };
  }
  const rest = (text.slice(0, m.index) + text.slice(m.index! + m[0].length)).trim();
  let query = "";
  let count = 6;
  try {
    const j = JSON.parse(m[1].trim()) as { query?: unknown; count?: unknown };
    query = String(j.query ?? "").trim();
    count = Number(j.count) || 6;
  } catch {
    query = m[1].trim().split("\n")[0];
  }
  query = query.replace(/\s+/g, " ").slice(0, 80);
  return { text: rest, photos: query ? { query, count: Math.min(6, Math.max(4, count)) } : null, partial: false };
}

/** gambar yang boleh dipakai di desain: data:, file website sendiri (/…), foto Unsplash/Pexels */
export const IMG_OK = /^(data:image\/(png|jpe?g|gif|webp|svg\+xml)[;,]|\/(?!\/)|https:\/\/(images\.unsplash\.com|plus\.unsplash\.com|images\.pexels\.com)\/)/i;

/**
 * Bersihkan HTML desain dari AI (lapis pertama; lapis kedua = iframe sandbox tanpa script + CSP ketat):
 * buang script/iframe/form/link/meta, atribut on*, javascript:, @import, dan gambar dari luar daftar aman.
 */
export function sanitizeDesign(html: string): string {
  let s = html
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<\/?(html|head|body)\b[^>]*>/gi, "")
    .replace(/<(script|iframe|object|embed|noscript|template|frame|frameset|applet|form|textarea|select|button|audio|video|portal)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(script|iframe|object|embed|link|meta|base|frame|input|form|audio|video|source|track|portal)\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|xlink:href|action|formaction)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript\s*:/gi, "")
    .replace(/@import[^;]*;?/gi, "")
    .replace(/expression\s*\(/gi, "(");
  // src gambar di luar daftar aman -> dibuang
  s = s.replace(/\ssrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi, (all, _q, a, b, c) => (IMG_OK.test((a ?? b ?? c ?? "").trim()) ? all : ""));
  // url(...) di CSS di luar daftar aman -> none
  s = s.replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (all, _q, u: string) => (IMG_OK.test(u.trim()) || /^#/.test(u.trim()) ? all : "none"));
  return s.trim();
}

/** kata kunci permintaan desain visual (poster, banner, thumbnail, infografis, diagram, mockup, kartu quote …) */
export const VISUAL_INTENT =
  /\b(poster|banner|flyer|flayer|pamflet|brosur|thumbnail|thumb(nail)?\s*(yt|youtube|tiktok)|infografis|infographic|quote card|kartu (quote|kutipan|ucapan)|pengumuman|announcement|mock-?up|mockup|diagram|flowchart|flow chart|bagan|ilustrasi|illustration|feed (ig|instagram)|story (ig|instagram)|konten (ig|instagram) gambar|cover (reels|tiktok|youtube)|undangan|sertifikat|desain|design|gambarin|gambarkan|bikin(in)? gambar|buat(in|kan)? gambar|gambar(in)? (poster|banner|alur|diagram))\w*/i;
/** visual yang biasanya butuh mesin berat (banyak elemen / struktur) */
export const VISUAL_COMPLEX = /\b(infografis|infographic|diagram|flowchart|flow chart|bagan|alur|mock-?up|a4|flyer|brosur|ui|dashboard|landing)\w*/i;
/** permintaan FOTO asli (bukan foto yang dilampirkan user) */
export const PHOTO_INTENT = /\b(foto|photo|potret|stock photo|gambar asli|gambar (kucing|anjing|pantai|gunung|kota|makanan|bunga|pemandangan|alam|orang|hewan|mobil)|picture|pic)\b/i;
export const PHOTO_OF_ATTACHMENT = /\b(foto|gambar|photo)\s+(ini|itu|tadi|yang (aku|saya|ku|gue|gw) (kirim|upload|lampirkan)|di atas|terlampir)\b/i;

/** aturan giliran untuk permintaan desain visual */
export function visualRules(): string {
  const sizes = (Object.keys(SIZES) as DesignSize[]).map((k) => `${k} = ${SIZES[k].w}×${SIZES[k].h} (${SIZES[k].label})`).join(" · ");
  return [
    "MODE DESAIN VISUAL. Kamu TIDAK punya model pembuat gambar, tapi kamu BISA membuat desain dengan menulis HTML/CSS/SVG yang dirender website jadi PNG. JANGAN PERNAH menolak permintaan gambar/desain dan jangan bilang \"aku tidak bisa membuat gambar\".",
    "1) Belum jelas (ukuran, gaya, warna/brand, teks utama, tujuan) dan ini permintaan pertama → kirim kartu ```ask (maks 3 pertanyaan: ukuran 1:1/4:5/9:16/16:9/A4, gaya, teks utama) lalu berhenti. Sudah cukup jelas / user sudah jawab / lewati → langsung bikin. Default: tema Konten.com (hitam #0a0a0a, hijau #2fe34a, oranye #ff5a00→#ff8a00, teks putih & abu #8a8a8a).",
    "2) Desain BARU → buat 2–3 OPSI yang benar-benar beda (tata letak/gaya/warna), masing-masing satu blok:",
    "```design 1:1 | Bold Oranye\n<style>.art{…}</style>\n<div class=\"art\">…</div>\n```",
    `   Ukuran: ${sizes}. Kanvas tetap sebesar itu (px); elemen paling luar <div class="art"> width:100%;height:100%;position:relative;overflow:hidden. Tulis CSS di <style> (pakai class), boleh inline SVG.`,
    "3) User MEMILIH opsi / minta REVISI (\"ganti warna\", \"teks lebih besar\") → kirim SATU blok ```design saja: salin desain terakhir lalu ubah HANYA bagian yang diminta (nama tetap). Jangan mulai dari nol.",
    "4) KUALITAS (cek ulang sebelum kirim): hierarki jelas — 1 judul besar (2–8 kata), 1 sub, 1 info/CTA; maks 3 ukuran huruf; kontras teks ≥ 4.5:1 (teks di atas foto → lapisan gradasi gelap); jarak kelipatan 8px & konsisten; margin sisi ≥ 6% lebar; TIDAK ada teks kepotong (jangan beri tinggi tetap pada kotak teks, judul panjang → kecilkan huruf); rata & sejajar.",
    "   Font: 'Neue Montreal' (brand), 'Plus Jakarta Sans Variable' (judul), 'Inter Variable' (isi) — sudah tersedia, JANGAN memuat font/CSS dari luar. Logo Konten.com: <img src=\"/konten-logo-report.png\"> (tulisan putih, untuk latar gelap, rasio 640×59) atau <img src=\"/konten-logo.png\"> (ikon oranye kotak).",
    "   Infografis/alur/diagram: langkah bernomor dalam kotak + panah SVG, ikon sederhana dari SVG. Chart: batang/garis SVG dengan label angka — angka HANYA dari data user (tanpa data → pakai label contoh & bilang itu contoh). Mockup UI: bingkai HP/laptop dari CSS.",
    "   DILARANG: <script>, event on*, link/font/CSS/gambar dari luar. Gambar hanya: /konten-logo*.png, data:image, atau URL foto Unsplash/Pexels yang diberikan di blok HASIL CARI FOTO (wajib tulis kredit kecil \"Foto: Nama / Unsplash\" di pojok desain). Foto hasil web umum TIDAK BOLEH dimasukkan ke desain.",
    "5) Setelah blok: 1–2 kalimat (gaya karaktermu) bedanya tiap opsi, lalu ajak pilih/revisi. Jangan jelaskan kodenya.",
    "6) TOLAK bagian ini saja (tawarkan versi aman): logo/karakter merek lain (mis. Nike, Pikachu, Shopee), konten dewasa/vulgar, wajah/nama tokoh nyata untuk materi promosi. Alasannya 1 kalimat, lalu langsung beri alternatif desain.",
  ].join("\n");
}

/** URL tambahan kredit (aturan Unsplash: link ke fotografer & Unsplash dengan utm) */
export const UTM = "utm_source=cs_tracker_konten&utm_medium=referral";
export const withUtm = (u: string) => (u ? `${u}${u.includes("?") ? "&" : "?"}${UTM}` : u);
