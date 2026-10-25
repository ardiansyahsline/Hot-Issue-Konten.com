/**
 * Template "TWS" (Trade With Suli) — konten berita/update ekonomi, saham, crypto, forex, makro.
 * AI menulis blok ```tws {json}``` (isi & angka dari hasil riset web), website merender tiap slide jadi HTML
 * bergaya referensi docs/design-ref/tws (1080×1350, latar hitam, judul tebal kapital + sorotan biru, angka 3D).
 * Hasilnya masuk ke pemutar desain yang sama (preview, revisi per slide, unduh PNG/SVG/HTML/ZIP).
 *
 * Elemen diberi data-layer (Logo, Judul, Sorotan, Angka 3D, Foto Tokoh, Latar, …) -> jadi nama layer di SVG/Figma.
 * Slot gambar: data-slot="bg" (gambar latar) & data-slot="person" (foto tokoh) diisi website (upload / Unsplash / web / grafis).
 */
import type { Design } from "./visual";

// TODO: ganti dengan logo resmi (public/brand/tws-logo.png) kalau sudah ada — sekarang versi teks + ikon garis miring
export const TWS_LOGO = "/brand/tws-logo.svg";
export const TWS_BLUE = "#2f5ff0";
export const TWS_TEXT_BLUE = "#3a6bff";
export const TWS_FONTS = ["Inter Tight"];

export type TwsTone = "gold" | "red" | "green" | "blue" | "white";
export type TwsGraphic = "chart-up" | "chart-down" | "coins" | "exchange" | "arrows" | "bank" | "globe";
/** isian gambar dari website: latar, foto tokoh (cut = latarnya sudah dihapus), kredit foto kecil di pojok */
export type TwsImg = { bg?: string; person?: string; cut?: boolean; credit?: string; /** logo TWS hanya kalau user memang minta konten TWS */ brand?: boolean; /** warna rata-rata foto latar (#rrggbb) — angka 3D ikut disinari warna ini */ ambient?: string };
type Img = TwsImg;
export type TwsRow = { label: string; value?: string; note?: string; icon?: string };
export type TwsItem = { label: string; a?: string; b?: string; pct?: string; value?: string; top?: string; icon?: string };
export type TwsSlide = {
  type: "cover" | "text" | "ath" | "timeline" | "bars" | "cta";
  big?: string;
  tone?: TwsTone;
  title?: string[];
  hl?: number;
  kicker?: string;
  text?: string;
  caption?: string;
  note?: string;
  rows?: TwsRow[];
  items?: TwsItem[];
  head?: string[];
  sub?: string;
  button?: string;
  align?: "left" | "center" | "right";
  /** kata kunci foto latar (Unsplash/Pexels/web) */
  bg?: string;
  /** latar grafis kalau foto tidak ada */
  graphic?: TwsGraphic;
  /** nama tokoh (foto dari upload user / foto berita web) */
  person?: string;
};
export type TwsDeck = { title?: string; asOf?: string; slides: TwsSlide[]; caption?: string; hashtags?: string[]; sources?: { title: string; url: string }[]; /** "tws" = pakai logo & gaya ajakan TWS (hanya kalau user menyebut TWS) */ brand?: "tws" };

/* ------------------------------------------------------------------ parse ------------------------------------------------------------------ */
const DONE = /```tws\s*\n?([\s\S]*?)```/i;
const s = (v: unknown, max: number) => (v === undefined || v === null ? "" : String(v).trim().slice(0, max));
const arr = (v: unknown) => (Array.isArray(v) ? v : []);
const TONES: TwsTone[] = ["gold", "red", "green", "blue", "white"];
const GRAPHICS: TwsGraphic[] = ["chart-up", "chart-down", "coins", "exchange", "arrows", "bank", "globe"];

export function splitTws(text: string): { text: string; deck: TwsDeck | null; partial: boolean } {
  const m = text.match(DONE);
  if (!m) {
    const i = text.search(/```tws\b/i);
    return i >= 0 ? { text: text.slice(0, i).trimEnd(), deck: null, partial: true } : { text, deck: null, partial: false };
  }
  const rest = (text.slice(0, m.index) + text.slice(m.index! + m[0].length)).trim();
  try {
    const j = JSON.parse(m[1].trim()) as Record<string, unknown>;
    const slides = arr(j.slides)
      .map((x) => x as Record<string, unknown>)
      .map((x): TwsSlide => {
        const type = (["cover", "text", "ath", "timeline", "bars", "cta"].includes(String(x.type)) ? x.type : "text") as TwsSlide["type"];
        return {
          type,
          big: s(x.big, 14) || undefined,
          tone: TONES.includes(x.tone as TwsTone) ? (x.tone as TwsTone) : undefined,
          title: arr(x.title).map((t) => s(t, 40)).filter(Boolean).slice(0, 4),
          hl: Number(x.hl) || undefined,
          kicker: s(x.kicker, 120) || undefined,
          text: s(x.text, 220) || undefined,
          caption: s(x.caption, 220) || undefined,
          note: s(x.note, 120) || undefined,
          rows: arr(x.rows).map((r) => r as Record<string, unknown>).map((r) => ({ label: s(r.label, 40), value: s(r.value, 24), note: s(r.note, 60), icon: s(r.icon, 12) })).filter((r) => r.label).slice(0, 5),
          items: arr(x.items).map((r) => r as Record<string, unknown>).map((r) => ({ label: s(r.label, 28), a: s(r.a, 16), b: s(r.b, 16), pct: s(r.pct, 12), value: s(r.value, 18), top: s(r.top, 14), icon: s(r.icon, 12) })).filter((r) => r.label).slice(0, 8),
          head: arr(x.head).map((t) => s(t, 14)).slice(0, 2),
          sub: s(x.sub, 40) || undefined,
          button: s(x.button, 30) || undefined,
          align: (["left", "center", "right"].includes(String(x.align)) ? x.align : undefined) as TwsSlide["align"],
          bg: s(x.bg, 80) || undefined,
          graphic: GRAPHICS.includes(x.graphic as TwsGraphic) ? (x.graphic as TwsGraphic) : undefined,
          person: s(x.person, 60) || undefined,
        };
      })
      .slice(0, 6);
    if (!slides.length) return { text: rest, deck: null, partial: false };
    return {
      text: rest,
      deck: {
        title: s(j.title, 80) || undefined,
        asOf: s(j.asOf, 40) || undefined,
        brand: String(j.brand ?? "").toLowerCase() === "tws" ? "tws" : undefined,
        slides,
        caption: s(j.caption, 2200) || undefined,
        hashtags: arr(j.hashtags).map((h) => s(h, 40).replace(/^#?/, "#")).filter((h) => h.length > 1).slice(0, 15),
        sources: arr(j.sources)
          .map((x) => x as Record<string, unknown>)
          .map((x) => ({ title: s(x.title, 120), url: s(x.url, 400) }))
          .filter((x) => /^https?:\/\//.test(x.url))
          .slice(0, 8),
      },
      partial: false,
    };
  } catch {
    return { text: rest, deck: null, partial: false };
  }
}

/* ------------------------------------------------------------------ helper ------------------------------------------------------------------ */
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** **kata kunci** -> tebal biru */
const rich = (t: string) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b class="k">$1</b>');
const dirOf = (v?: string) => (!v ? 0 : /^\s*[-−–]|turun|▼/.test(v) ? -1 : /^\s*\+|naik|▲/.test(v) ? 1 : 0);
const toneOf = (sl: TwsSlide): TwsTone => sl.tone ?? (dirOf(sl.big) < 0 ? "red" : dirOf(sl.big) > 0 ? "green" : "gold");

const BASE_CSS = `
.art{width:100%;height:100%;position:relative;overflow:hidden;background:#000;color:#fff;font-family:'Inter Tight Variable','Inter Tight','Inter Variable',sans-serif}
.logo{position:absolute;left:64px;top:56px;height:44px;z-index:20}
.logo.c{left:50%;transform:translateX(-50%)}
.num{position:absolute;right:64px;top:62px;font-size:26px;font-weight:500;color:#e4e4e7;z-index:20}
.latar{position:absolute;inset:0;z-index:0}
.latar img,.latar svg{width:100%;height:100%;object-fit:cover;object-position:50% 28%;display:block}
.latar.redup img{filter:brightness(.58) saturate(1.15) contrast(1.06)}
.vign{position:absolute;inset:0;z-index:1;background:linear-gradient(90deg,rgba(0,0,0,.5) 0%,rgba(0,0,0,0) 24%,rgba(0,0,0,0) 76%,rgba(0,0,0,.5) 100%)}
.fade{position:absolute;inset:0;z-index:5;background:linear-gradient(180deg,rgba(0,0,0,.5) 0%,rgba(0,0,0,0) 15%,rgba(0,0,0,0) 46%,rgba(0,0,0,.7) 62%,rgba(0,0,0,.95) 76%,#000 88%)}
.tokoh{position:absolute;z-index:4;bottom:236px;height:870px;left:50%;transform:translateX(-47%);-webkit-mask-image:linear-gradient(180deg,#000 78%,transparent 100%);mask-image:linear-gradient(180deg,#000 78%,transparent 100%)}
.tokoh img{height:100%;width:auto;max-width:none;display:block;filter:drop-shadow(0 0 34px rgba(61,110,247,.38)) drop-shadow(0 30px 40px rgba(0,0,0,.6))}
.kredit{position:absolute;right:20px;bottom:12px;z-index:12;font-size:15px;color:rgba(255,255,255,.5)}
.udara{position:absolute;left:0;right:0;top:0;height:760px;z-index:2}
.big3d{position:absolute;left:0;right:0;top:56px;z-index:3}
.judul{position:absolute;left:68px;right:52px;bottom:110px;z-index:10;margin:0;font-weight:800;line-height:1.12;letter-spacing:-.02em;text-transform:uppercase;text-shadow:0 2px 18px rgba(0,0,0,.45)}
.judul span{display:block;white-space:nowrap}
.judul em{font-style:normal;display:inline-block;background:linear-gradient(180deg,#4a7dff 0%,#2a56ea 100%);padding:3px 16px 1px;margin:3px 0 3px -16px;border-radius:5px;text-shadow:none;box-shadow:0 10px 28px rgba(42,86,234,.35)}
.kicker{font-size:28px;font-weight:400;color:#e4e4e7;letter-spacing:-.005em;line-height:1.3}
.isi{font-weight:400;line-height:1.1;letter-spacing:-.03em}
.isi .k,.k{color:${TWS_TEXT_BLUE};font-weight:700}
.cap{font-size:30px;font-weight:400;color:#d4d4d8;line-height:1.35;letter-spacing:-.005em}
.note{position:absolute;left:56px;right:56px;bottom:36px;z-index:10;font-size:19px;color:#9a9a9a;text-align:center}
.up{color:#3ee66b}.down{color:#ff3b3b}
`;

const kredit = (img: Img) => (img.credit && img.bg ? `<div class="kredit" data-layer="Kredit Foto">${esc(img.credit)}</div>` : "");
/**
 * Angka 3D sebagai vektor SVG — dibuat seperti benda logam yang DISINARI adegan fotonya (bukan stiker):
 * permukaan metalik berlapis (pantulan terang-gelap-terang), sisi tebal yang makin gelap ke belakang,
 * bayangan jatuh ke latar, cahaya pinggir berwarna lingkungan (ambient dari foto latar), tekstur halus,
 * dan bagian bawah sedikit tenggelam ke kabut supaya menyatu dengan foto.
 */
type Tone3D = { face: [number, string][]; side: string; glow: string; edge: string };
const TONE3D: Record<TwsTone, Tone3D> = {
  gold: { face: [[0, "#fff4c8"], [0.2, "#f2cf6c"], [0.42, "#b98425"], [0.56, "#ffe7a0"], [0.78, "#a46d18"], [1, "#5e3c0b"]], side: "#5a3a0a", glow: "rgba(255,186,70,.55)", edge: "#fff1c2" },
  red: { face: [[0, "#ffd0cc"], [0.2, "#ff5b52"], [0.42, "#b3141b"], [0.56, "#ff7d72"], [0.78, "#8e0c12"], [1, "#4a0508"]], side: "#4a0609", glow: "rgba(255,46,46,.6)", edge: "#ffc2bc" },
  green: { face: [[0, "#dcffe7"], [0.2, "#5cf08c"], [0.42, "#119a3f"], [0.56, "#8ef9b0"], [0.78, "#0a7029"], [1, "#043a16"]], side: "#053a17", glow: "rgba(46,255,120,.5)", edge: "#d2ffe0" },
  blue: { face: [[0, "#e4ecff"], [0.2, "#80a6ff"], [0.42, "#2b57e0"], [0.56, "#a9c1ff"], [0.78, "#1c3da4"], [1, "#0b1a4d"]], side: "#0d1d52", glow: "rgba(70,125,255,.6)", edge: "#dce6ff" },
  white: { face: [[0, "#ffffff"], [0.2, "#eef1f5"], [0.42, "#9aa3ae"], [0.56, "#f7f9fb"], [0.78, "#6e7884"], [1, "#363c45"]], side: "#2b3038", glow: "rgba(170,200,255,.45)", edge: "#ffffff" },
};

/** campur dua warna hex (t = porsi b) */
function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const x = p(a), y = p(b);
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

function big3d(text: string, tone: TwsTone, ambient?: string): string {
  const t = TONE3D[tone];
  const amb = ambient && /^#[0-9a-f]{6}$/i.test(ambient) ? ambient : null;
  // angka besar (±900 px lebar), makin panjang teksnya makin kecil
  const size = Math.round(Math.max(130, Math.min(320, 900 / (Math.max(3, text.length) * 0.6))));
  const y = 46 + size * 0.86;
  const id = `n${tone}`;
  const txt = esc(text);
  const attrs = `text-anchor="middle" font-family="Inter Tight Variable, Inter Tight, sans-serif" font-weight="900" font-size="${size}" letter-spacing="${(-size * 0.04).toFixed(1)}"`;
  // sisi tebal: dari warna sisi (sedikit kena warna lingkungan) di depan ke hampir hitam di belakang
  const layers = 20;
  const dx = size * 0.003, dy = size * 0.0068;
  const sideFront = amb ? mix(t.side, amb, 0.22) : t.side;
  const depth = Array.from({ length: layers }, (_, i) => layers - i)
    .map((k) => `<text ${attrs} x="${(540 + k * dx).toFixed(1)}" y="${(y + k * dy).toFixed(1)}" fill="${mix(sideFront, "#050505", (k / layers) * 0.85)}">${txt}</text>`)
    .join("");
  const rim = amb ? mix(amb, "#ffffff", 0.35) : t.edge;
  const h = Math.round(size * 1.25) + 80;
  const stops = t.face.map(([o, c]) => `<stop offset="${o}" stop-color="${amb && o > 0.5 ? mix(c, amb, 0.12) : c}"/>`).join("");
  return `<svg width="1080" height="${h}" viewBox="0 0 1080 ${h}" style="display:block;overflow:visible"><defs>
<linearGradient id="${id}f" x1="0" y1="0" x2="0.18" y2="1">${stops}</linearGradient>
<linearGradient id="${id}e" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.edge}" stop-opacity=".95"/><stop offset=".35" stop-color="${t.edge}" stop-opacity=".25"/><stop offset="1" stop-color="${t.edge}" stop-opacity="0"/></linearGradient>
<linearGradient id="${id}m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".7" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity=".55"/></linearGradient>
<mask id="${id}k" maskUnits="userSpaceOnUse" x="0" y="0" width="1080" height="${h}"><rect width="1080" height="${h}" fill="url(#${id}m)"/></mask>
<filter id="${id}g" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation="${Math.round(size * 0.16)}"/></filter>
<filter id="${id}s" x="-20%" y="-40%" width="140%" height="200%"><feGaussianBlur stdDeviation="${Math.round(size * 0.07)}"/></filter>
<filter id="${id}t" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="7"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .55 0"/><feComposite in2="SourceGraphic" operator="in"/></filter>
</defs><g transform="rotate(-3 540 ${Math.round(y - size * 0.35)})" mask="url(#${id}k)">
<text ${attrs} x="560" y="${(y + size * 0.16).toFixed(1)}" fill="#000" opacity=".7" filter="url(#${id}s)">${txt}</text>
<text ${attrs} x="540" y="${(y + size * 0.04).toFixed(1)}" fill="${t.glow}" filter="url(#${id}g)">${txt}</text>
${depth}
<text ${attrs} x="540" y="${y}" fill="url(#${id}f)">${txt}</text>
<text ${attrs} x="540" y="${y}" fill="#fff" opacity=".07" filter="url(#${id}t)">${txt}</text>
<text ${attrs} x="540" y="${y}" fill="none" stroke="url(#${id}e)" stroke-width="${Math.max(2, size * 0.011).toFixed(1)}">${txt}</text>
<text ${attrs} x="${(540 - size * 0.006).toFixed(1)}" y="${(y - size * 0.006).toFixed(1)}" fill="none" stroke="${rim}" stroke-opacity=".55" stroke-width="${Math.max(1.5, size * 0.006).toFixed(1)}">${txt}</text>
</g></svg>`;
}

/** logo TWS hanya untuk konten TWS (user menyebut TWS); selain itu tanpa logo */
const logo = (brand?: boolean, center = false) => (brand ? `<img data-layer="Logo" class="logo${center ? " c" : ""}" src="${TWS_LOGO}" alt="TWS">` : "");

/* ------------------------------------------------------- latar grafis SVG (kalau tidak ada foto) ------------------------------------------------------- */
function rnd(seed: number) {
  let x = seed;
  return () => ((x = (x * 9301 + 49297) % 233280) / 233280);
}
export function graphicSvg(kind: TwsGraphic = "chart-up", outW = 1080, outH = 1350): string {
  // koordinat gambar selalu 1080×1350, lalu dipotong pas ke kotak tujuan (slice)
  const w = 1080, h = 1350;
  const r = rnd(kind.length * 97 + outW);
  const up = kind !== "chart-down";
  const accent = kind === "chart-down" ? "#ff2d2d" : kind === "coins" ? "#f5c04a" : kind === "chart-up" ? "#2ee86a" : "#3d6ef7";
  const glow = kind === "chart-down" ? "rgba(255,45,45,.35)" : kind === "coins" ? "rgba(245,192,74,.30)" : kind === "chart-up" ? "rgba(46,232,106,.28)" : "rgba(61,110,247,.35)";
  const grid = Array.from({ length: 14 }, (_, i) => `<line x1="0" y1="${i * 70}" x2="${w}" y2="${i * 70}" stroke="#fff" stroke-opacity=".05"/>`).join("") + Array.from({ length: 16 }, (_, i) => `<line x1="${i * 72}" y1="0" x2="${i * 72}" y2="${h}" stroke="#fff" stroke-opacity=".04"/>`).join("");
  let body = "";
  if (kind === "chart-up" || kind === "chart-down" || kind === "arrows") {
    // lilin (candlestick) + panah besar
    let y = up ? 820 : 260;
    const candles: string[] = [];
    for (let i = 0; i < 22; i++) {
      const x = 40 + i * 47;
      const step = (up ? -1 : 1) * (14 + r() * 26) + (r() - 0.5) * 50;
      const o = y, c = y + step;
      const hi = Math.min(o, c) - 10 - r() * 30, lo = Math.max(o, c) + 10 + r() * 30;
      const green = c < o;
      const col = green ? "#22c55e" : "#ef4444";
      candles.push(`<line x1="${x + 12}" y1="${hi}" x2="${x + 12}" y2="${lo}" stroke="${col}" stroke-width="3" opacity=".75"/><rect x="${x}" y="${Math.min(o, c)}" width="24" height="${Math.max(6, Math.abs(c - o))}" fill="${col}" opacity=".8" rx="2"/>`);
      y = c;
    }
    const pts = up ? "60,900 260,760 380,820 560,600 690,660 900,380 1010,300" : "60,260 240,420 380,360 560,600 700,540 880,820 1010,900";
    const tip = up ? `<polygon points="1060,250 960,270 1010,350" fill="${accent}"/>` : `<polygon points="1060,960 960,940 1010,860" fill="${accent}"/>`;
    body = `<g data-layer="Grafik">${candles.join("")}</g><polyline points="${pts}" fill="none" stroke="${accent}" stroke-width="34" stroke-linejoin="round" stroke-linecap="round" opacity=".9" filter="url(#g)"/>${tip}`;
  } else if (kind === "coins") {
    const stacks: string[] = [];
    for (let k = 0; k < 9; k++) {
      const cx = 90 + k * 115 + (r() - 0.5) * 30, base = 960 + (r() - 0.5) * 80, n = 4 + Math.floor(r() * 9);
      for (let i = 0; i < n; i++) stacks.push(`<ellipse cx="${cx}" cy="${base - i * 22}" rx="52" ry="16" fill="url(#coin)" stroke="#7a5212" stroke-width="2"/>`);
    }
    body = `<g data-layer="Koin">${stacks.join("")}</g>`;
  } else if (kind === "exchange" || kind === "bank") {
    const cols = Array.from({ length: 8 }, (_, i) => `<rect x="${170 + i * 96}" y="560" width="46" height="380" fill="url(#col)"/>`).join("");
    const board = kind === "exchange" ? Array.from({ length: 6 }, (_, i) => `<text x="${80 + (i % 3) * 330}" y="${150 + Math.floor(i / 3) * 70}" font-family="monospace" font-size="40" fill="${i % 2 ? "#ef4444" : "#22c55e"}" opacity=".55">${i % 2 ? "▼" : "▲"} ${(r() * 9000 + 1000).toFixed(0)}</text>`).join("") : "";
    body = `<g data-layer="Gedung"><polygon points="110,560 540,380 970,560" fill="url(#col)"/><rect x="130" y="940" width="820" height="40" fill="url(#col)"/>${cols}</g>${board}`;
  } else {
    // bola dunia jaringan: garis lintang-bujur + titik terhubung yang menyala
    const cx = 540, cy = 760, R = 430;
    const meridian = Array.from({ length: 9 }, (_, i) => `<ellipse cx="${cx}" cy="${cy}" rx="${R - i * 48}" ry="${R}" fill="none" stroke="${accent}" stroke-opacity=".22"/>`).join("");
    const lat = Array.from({ length: 7 }, (_, i) => {
      const y = cy - R + ((i + 1) * 2 * R) / 8;
      const rx = Math.sqrt(Math.max(0, R * R - (y - cy) ** 2));
      return `<ellipse cx="${cx}" cy="${y}" rx="${rx}" ry="${rx * 0.12}" fill="none" stroke="${accent}" stroke-opacity=".18"/>`;
    }).join("");
    const pts = Array.from({ length: 26 }, () => {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * R * 0.92;
      return [cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.9];
    });
    const links = pts.map((p, i) => { const q = pts[(i * 7 + 3) % pts.length]; return `<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" stroke="${accent}" stroke-opacity=".28"/>`; }).join("");
    const dots = pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="${3 + r() * 4}" fill="#9db8ff"/>`).join("");
    body = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="url(#glw)" stroke="${accent}" stroke-opacity=".55" stroke-width="2"/>${meridian}${lat}<g data-layer="Jaringan">${links}${dots}</g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" width="${outW}" height="${outH}">
<defs><radialGradient id="bgg" cx="50%" cy="38%" r="70%"><stop offset="0" stop-color="#0d1630"/><stop offset=".55" stop-color="#05070f"/><stop offset="1" stop-color="#000"/></radialGradient>
<radialGradient id="glw" cx="50%" cy="45%" r="50%"><stop offset="0" stop-color="${glow}"/><stop offset="1" stop-color="rgba(0,0,0,0)"/></radialGradient>
<linearGradient id="coin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe9a3"/><stop offset=".5" stop-color="#e2a93a"/><stop offset="1" stop-color="#8a5d16"/></linearGradient>
<linearGradient id="col" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a4256"/><stop offset="1" stop-color="#0f1320"/></linearGradient>
<filter id="g" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
<rect width="${w}" height="${h}" fill="url(#bgg)"/><rect width="${w}" height="${h}" fill="url(#glw)"/>${grid}${body}</svg>`;
}

/* ------------------------------------------------------- ikon kecil (koin, barang) ------------------------------------------------------- */
const COIN: Record<string, [string, string]> = { BTC: ["#f7931a", "₿"], ETH: ["#627eea", "Ξ"], SOL: ["#9945ff", "◎"], XRP: ["#23292f", "✕"], BNB: ["#f3ba2f", "◆"], USDT: ["#26a17b", "₮"], DOGE: ["#c2a633", "Ð"], ADA: ["#0033ad", "₳"], GOLD: ["#d4a017", "Au"], EMAS: ["#d4a017", "Au"] };
/** piktogram barang sehari-hari untuk infografis "dulu vs sekarang" (garis putih di lingkaran) */
const PICTO: [RegExp, string, string][] = [
  [/rumah|house|properti/i, "#f97316", '<path d="M16 31 32 18l16 13v15H36v-9h-8v9H16z"/>'],
  [/emas|gold|logam/i, "#d4a017", '<path d="M14 42h36l-6-12H20zM22 28h20l-4-8H26z"/>'],
  [/motor|bike/i, "#ef4444", '<circle cx="20" cy="40" r="6"/><circle cx="44" cy="40" r="6"/><path d="M20 40h12l6-10h6M30 30h6"/>'],
  [/mobil|car/i, "#3b82f6", '<path d="M14 40v-7l5-9h26l5 9v7z"/><circle cx="22" cy="41" r="4"/><circle cx="42" cy="41" r="4"/>'],
  [/bensin|bbm|fuel|pertalite|pertamax|solar/i, "#eab308", '<path d="M20 46V18h16v28M20 28h16M36 24l8 6v12a3 3 0 0 0 6 0V30"/>'],
  [/beras|rice|padi/i, "#a3a3a3", '<path d="M18 26h28l-3 20H21zM22 26c2-6 18-6 20 0"/>'],
  [/telur|egg/i, "#f59e0b", '<ellipse cx="32" cy="34" rx="11" ry="14"/>'],
  [/gula|sugar/i, "#e5e7eb", '<rect x="20" y="22" width="24" height="24" rx="3"/><path d="M20 30h24"/>'],
  [/gas|lpg|tabung/i, "#22c55e", '<rect x="22" y="22" width="20" height="24" rx="8"/><path d="M28 22v-5h8v5"/>'],
  [/kopi|coffee|matcha|cup|minum/i, "#84cc16", '<path d="M18 26h22v10a11 11 0 0 1-22 0zM40 29h4a4 4 0 0 1 0 8h-4"/>'],
  [/hp|ponsel|phone|iphone/i, "#6366f1", '<rect x="23" y="16" width="18" height="32" rx="4"/><path d="M29 42h6"/>'],
  [/saham|ihsg|chart|grafik/i, "#22c55e", '<path d="M16 44l10-10 8 6 14-16M40 24h8v8"/>'],
  [/uang|rupiah|rp|duit|gaji/i, "#10b981", '<rect x="14" y="22" width="36" height="20" rx="3"/><circle cx="32" cy="32" r="5"/>'],
];
function icon(label: string, key?: string, size = 64): string {
  const k = (key || label).toUpperCase().replace(/[^A-Z]/g, "");
  const pic = !COIN[k] ? PICTO.find(([re]) => re.test(`${key ?? ""} ${label}`)) : undefined;
  if (pic) return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" style="display:block;margin:0 auto"><circle cx="32" cy="32" r="30" fill="${pic[1]}"/><g fill="none" stroke="#fff" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">${pic[2]}</g></svg>`;
  const [col, sym] = COIN[k] ?? ["#3d6ef7", (label.replace(/[^A-Za-z0-9]/g, "").slice(0, 1) || "•").toUpperCase()];
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" style="display:block;margin:0 auto"><circle cx="32" cy="32" r="30" fill="${col}"/><circle cx="32" cy="32" r="30" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="2"/><text x="32" y="42" text-anchor="middle" font-family="Inter Tight Variable, Inter Tight, sans-serif" font-weight="800" font-size="${sym.length > 1 ? 24 : 30}" fill="#fff">${esc(sym)}</text></svg>`;
}

/* ------------------------------------------------------- slide ------------------------------------------------------- */
const titleHtml = (lines: string[], hl?: number, cls = "judul", style = "") =>
  `<h1 data-layer="Judul" class="${cls}" style="${style}">${lines.map((l, i) => (hl === i + 1 ? `<span><em data-layer="Sorotan">${esc(l)}</em></span>` : `<span>${esc(l)}</span>`)).join("")}</h1>`;

const latar = (img: Img, sl: TwsSlide, style = "", cls = "") =>
  `<div data-layer="Latar" class="latar${cls ? ` ${cls}` : ""}" style="${style}">${img.bg ? `<img data-slot="bg" src="${esc(img.bg)}" alt="">` : graphicSvg(sl.graphic ?? (dirOf(sl.big) < 0 ? "chart-down" : "chart-up"))}</div>`;

/** ukuran huruf judul cover: baris terpanjang harus muat ±950 px (huruf kapital tebal ≈ 0,6 em) */
const coverSize = (lines: string[]) => Math.max(52, Math.min(80, Math.round(950 / (Math.max(8, ...lines.map((l) => l.length)) * 0.6))));

function cover(sl: TwsSlide, img: Img): string {
  const lines = sl.title?.length ? sl.title : ["JUDUL BERITA", "DI SINI"];
  const tone = toneOf(sl);
  // foto tokoh yang latarnya sudah dihapus = lapisan depan; kalau belum terpotong, fotonya jadi latar penuh
  const cut = !!(img.person && img.cut);
  const useBg = !!img.bg && (cut || !img.person);
  const base: Img = { ...img, bg: useBg ? img.bg : img.person ?? img.bg, credit: useBg ? img.credit : undefined };
  // kabut gelap + rona warna angka di bagian atas foto: angka tampak "berada" di adegan, bukan ditempel
  const air = sl.big ? `<div class="udara" data-layer="Cahaya Angka" style="background:radial-gradient(ellipse 70% 42% at 50% 17%,rgba(0,0,0,.5) 0%,rgba(0,0,0,0) 100%),radial-gradient(ellipse 60% 34% at 50% 20%,${TONE3D[tone].glow.replace(/[\d.]+\)$/, ".22)")} 0%,rgba(0,0,0,0) 100%)"></div>` : "";
  const big = sl.big ? `<div data-layer="Angka 3D" class="big3d">${big3d(sl.big, tone, img.ambient)}</div>` : "";
  const person = cut ? `<div data-layer="Foto Tokoh" class="tokoh"><img data-slot="person" src="${esc(img.person!)}" alt=""></div>` : "";
  // foto tokoh utuh (belum terpotong) + ada angka: foto diturunkan supaya wajah di bawah angka, bagian atasnya diisi
  // versi buram foto yang sama -> warnanya nyambung, angka "melayang" di atas kepala seperti referensi
  const drop = !!(sl.big && img.person && !cut && base.bg === img.person);
  const bgLayer = drop
    ? `<div data-layer="Latar Buram" class="latar" style="filter:blur(28px) brightness(.55) saturate(1.2);transform:scale(1.15)"><img src="${esc(base.bg!)}" alt=""></div>${latar(base, sl, "top:250px;-webkit-mask-image:linear-gradient(180deg,transparent 0,#000 26%);mask-image:linear-gradient(180deg,transparent 0,#000 26%)")}`
    : latar(base, sl, "", cut ? "redup" : "");
  return `<div class="art">${bgLayer}<div class="vign" data-layer="Vignette"></div>${air}${big}${person}<div class="fade" data-layer="Gradasi"></div>${logo(img.brand)}${titleHtml(lines, sl.hl, "judul", `font-size:${coverSize(lines)}px`)}${sl.note ? `<div class="note" data-layer="Catatan">${esc(sl.note)}</div>` : ""}${kredit(base)}</div>`;
}

/** ukuran kalimat besar slide isi: pendek = besar sekali (seperti referensi), panjang = mengecil */
const isiSize = (t: string) => {
  const n = t.replace(/\*\*/g, "").length;
  return n <= 40 ? 104 : n <= 60 ? 92 : n <= 90 ? 80 : n <= 130 ? 68 : 58;
};

function textSlide(sl: TwsSlide, img: Img, n: number): string {
  const align = sl.align ?? "center";
  const hasImg = !!img.bg || !!sl.graphic || !!sl.bg;
  const nRows = sl.rows?.length ?? 0;
  const rows = nRows
    ? `<div data-layer="Data" style="margin-top:40px;text-align:left">${sl
        .rows!.map((r) => {
          const d = dirOf(r.value);
          return `<div style="display:flex;align-items:center;gap:20px;padding:22px 0;border-top:1px solid rgba(255,255,255,.16)">${r.icon ? `<div style="flex:none">${icon(r.label, r.icon, 52)}</div>` : ""}<div style="flex:1;font-size:34px;font-weight:600;letter-spacing:-.01em">${esc(r.label)}</div><div style="text-align:right;max-width:55%"><div class="${d < 0 ? "down" : d > 0 ? "up" : ""}" style="font-size:40px;font-weight:800;letter-spacing:-.02em">${esc(r.value ?? "")}</div>${r.note ? `<div style="font-size:22px;color:#a1a1aa;margin-top:2px;line-height:1.3">${esc(r.note)}</div>` : ""}</div></div>`;
        })
        .join("")}</div>`
    : "";
  // foto pendukung mengisi sisa bagian bawah (memudar ke hitam di atasnya) — perkiraan tinggi teks supaya tidak menimpa tulisan
  const fs = isiSize(sl.text ?? "");
  const lines = (t: string, size: number, k: number) => Math.max(1, Math.ceil(t.replace(/\*\*/g, "").length / (952 / (size * k))));
  const textH =
    (img.brand ? 200 : 170) +
    (sl.kicker ? 58 : 0) +
    lines(sl.text ?? "", fs, 0.47) * fs * 1.1 +
    (sl.caption ? 26 + lines(sl.caption, 30, 0.47) * 40 : 0) +
    (nRows ? 40 + nRows * 96 : 0);
  const imgH = Math.max(320, Math.min(800, Math.round(1350 - textH + 60)));
  const imgBlock = latar(img, { ...sl, graphic: sl.graphic ?? (hasImg ? undefined : "globe") }, `top:auto;height:${imgH}px;-webkit-mask-image:linear-gradient(180deg,transparent 0%,#000 38%);mask-image:linear-gradient(180deg,transparent 0%,#000 38%)`);
  return `<div class="art">${imgBlock}${logo(img.brand)}<div class="num" data-layer="Nomor">${n}</div>
<div data-layer="Teks" style="position:absolute;left:64px;right:64px;top:${img.brand ? 200 : 170}px;z-index:5;text-align:${align}">
${sl.kicker ? `<div class="kicker" data-layer="Pengantar">${esc(sl.kicker)}</div>` : ""}
<div class="isi" style="font-size:${isiSize(sl.text ?? "")}px;margin-top:${sl.kicker ? 20 : 0}px">${rich(sl.text ?? "")}</div>
${sl.caption ? `<div class="cap" style="margin-top:26px">${esc(sl.caption)}</div>` : ""}
${rows}</div>${sl.note ? `<div class="note" data-layer="Catatan">${esc(sl.note)}</div>` : ""}${kredit(img)}</div>`;
}

function athSlide(sl: TwsSlide, n: number, brand?: boolean): string {
  const items = sl.items ?? [];
  const head = sl.head?.length === 2 ? sl.head : ["ATH", "SEKARANG"];
  const h = Math.min(104, Math.floor(820 / Math.max(1, items.length)) - 18);
  const body = items
    .map((it) => {
      const c = COIN[it.label.toUpperCase().replace(/[^A-Z]/g, "")]?.[0] ?? TWS_BLUE;
      return `<div style="display:flex;align-items:center;height:${h}px;margin-top:18px;border-radius:999px;background:linear-gradient(90deg,${c} 0%,${c}cc 30%,rgba(255,255,255,.08) 100%);border:2px solid rgba(255,255,255,.18);padding-right:14px">
<div style="flex:none;margin-left:-6px">${icon(it.label, it.icon, h + 8)}</div>
<div style="width:150px;padding-left:20px;font-size:34px;font-weight:800">${esc(it.label)}</div>
<div style="width:200px;text-align:center;font-size:26px;font-weight:700">${esc(it.a ?? "")}</div>
<div style="width:200px;text-align:center;font-size:26px;font-weight:700">${esc(it.b ?? "")}</div>
<div style="margin-left:auto;background:#16a34a;color:#fff;border-radius:14px;padding:8px 18px;font-size:28px;font-weight:800">${esc(it.pct ?? "")}</div></div>`;
    })
    .join("");
  return `<div class="art" style="background:radial-gradient(120% 80% at 50% 20%,#0c1733 0%,#000 70%)">${logo(brand, true)}${n > 1 ? `<div class="num" data-layer="Nomor">${n}</div>` : ""}
${titleHtml(sl.title?.length ? sl.title : ["BUTUH NAIK BERAPA", "SAMPAI BALIK ATH?"], sl.hl, "judul", "position:absolute;top:130px;bottom:auto;text-align:center;font-size:70px")}
<div data-layer="Tabel" style="position:absolute;left:60px;right:60px;top:${330}px">
<div style="display:flex;font-size:22px;font-weight:700;color:#d4d4d8;letter-spacing:.06em"><div style="width:${h + 2 + 170}px"></div><div style="width:200px;text-align:center">${esc(head[0])}</div><div style="width:200px;text-align:center">${esc(head[1])}</div></div>${body}</div>
${sl.note ? `<div class="note" data-layer="Catatan">${esc(sl.note)}</div>` : ""}</div>`;
}

function timelineSlide(sl: TwsSlide, n: number, brand?: boolean): string {
  const items = (sl.items ?? []).slice(0, 8);
  const per = items.length > 4 ? Math.ceil(items.length / 2) : items.length;
  const row = (list: TwsItem[], top: number) =>
    `<div style="position:absolute;left:60px;right:60px;top:${top}px;display:flex;justify-content:space-between"><div style="position:absolute;left:40px;right:40px;top:150px;height:2px;background:rgba(255,255,255,.35)"></div>${list
      .map(
        (it) =>
          `<div style="position:relative;width:${Math.floor(940 / per)}px;text-align:center">${icon(it.label, it.icon, 104)}<div style="margin-top:14px;display:inline-block;background:#000;padding:0 10px;font-size:34px;font-weight:800">${esc(it.top ?? "")}</div><div style="margin-top:6px;font-size:22px;color:#d4d4d8;line-height:1.25">${esc(it.label)}</div></div>`
      )
      .join("")}</div>`;
  return `<div class="art" style="background:radial-gradient(120% 70% at 50% 0%,#141b30 0%,#000 65%)">${logo(brand, true)}${n > 1 ? `<div class="num" data-layer="Nomor">${n}</div>` : ""}
${titleHtml(sl.title?.length ? sl.title : ["RP100 RIBU BISA", "DIPAKAI BUAT APA?"], sl.hl, "judul", "position:absolute;top:120px;bottom:auto;text-align:center;font-size:66px")}
${sl.sub ? `<div style="position:absolute;top:290px;left:0;right:0;text-align:center;font-size:30px;font-weight:600">${esc(sl.sub)}</div>` : ""}
<div data-layer="Timeline">${row(items.slice(0, per), 380)}${items.length > per ? row(items.slice(per), 760) : ""}</div>
${sl.note ? `<div class="note" data-layer="Catatan">${esc(sl.note)}</div>` : ""}</div>`;
}

function barsSlide(sl: TwsSlide, n: number, brand?: boolean): string {
  const items = sl.items ?? [];
  const nums = items.map((it) => Math.abs(parseFloat((it.pct ?? "0").replace(/[^\d,.-]/g, "").replace(",", ".")) || 0));
  const max = Math.max(0.01, ...nums);
  const rowH = Math.min(118, Math.floor(760 / Math.max(1, items.length)));
  const body = items
    .map((it, i) => {
      const d = dirOf(it.pct);
      const w = Math.max(6, (nums[i] / max) * 360);
      const col = d < 0 ? "#ef4444" : d > 0 ? "#22c55e" : "#a1a1aa";
      const first = i === 0;
      return `<div style="display:flex;align-items:center;height:${rowH}px;border-top:1px solid rgba(255,255,255,.12)${first ? ";background:rgba(61,110,247,.10)" : ""}">
<div style="width:250px;padding-left:16px"><div style="font-size:34px;font-weight:800">${esc(it.label)}</div>${it.value ? `<div style="font-size:20px;color:#a1a1aa">${esc(it.value)}</div>` : ""}</div>
<div style="flex:1;position:relative;height:44px"><div style="position:absolute;left:50%;top:-14px;bottom:-14px;width:2px;background:rgba(255,255,255,.25)"></div>
<div style="position:absolute;top:0;height:44px;border-radius:8px;background:${col};${d < 0 ? `right:50%;width:${w / 2}px` : `left:50%;width:${w / 2}px`};box-shadow:0 0 24px ${col}66"></div></div>
<div class="${d < 0 ? "down" : d > 0 ? "up" : ""}" style="width:170px;text-align:right;padding-right:16px;font-size:36px;font-weight:800">${esc(it.pct ?? "")}</div></div>`;
    })
    .join("");
  return `<div class="art" style="background:radial-gradient(120% 70% at 50% 0%,#0b1a33 0%,#000 65%)">${logo(brand, true)}${n > 1 ? `<div class="num" data-layer="Nomor">${n}</div>` : ""}
${titleHtml(sl.title?.length ? sl.title : ["IHSG VS", "BURSA ASIA"], sl.hl, "judul", "position:absolute;top:130px;bottom:auto;text-align:center;font-size:66px")}
${sl.sub ? `<div style="position:absolute;top:300px;left:0;right:0;text-align:center;font-size:26px;color:#d4d4d8">${esc(sl.sub)}</div>` : ""}
<div data-layer="Grafik Batang" style="position:absolute;left:60px;right:60px;top:380px">${body}</div>
${sl.note ? `<div class="note" data-layer="Catatan">${esc(sl.note)}</div>` : ""}</div>`;
}

function ctaSlide(sl: TwsSlide, img: Img): string {
  // tanpa TWS: ajakan umum (follow), bukan "live Suli"
  const lines = sl.title?.length ? sl.title : img.brand ? ["DAPETIN UPDATE", "MARKET CRYPTO"] : ["IKUTI TERUS", "UPDATE MARKETNYA"];
  const button = sl.button ?? (img.brand ? "KLIK LINK DI BIO!" : "FOLLOW BIAR NGGAK KETINGGALAN!");
  const fs = Math.min(84, Math.round(930 / (Math.max(10, ...lines.map((l) => l.length)) * 0.6)));
  return `<div class="art" style="background:linear-gradient(180deg,#000 0%,#000 45%,#0b1a4a 100%)">${logo(img.brand, true)}
<div data-layer="Teks" style="position:absolute;left:60px;right:60px;top:${img.brand ? 150 : 110}px;text-align:center">
${sl.kicker ? `<div class="kicker">${esc(sl.kicker)}</div>` : ""}
<h1 data-layer="Judul" style="margin:12px 0 0;font-size:${fs}px;line-height:1.04;font-weight:600;letter-spacing:-.025em">${lines.map((l, i) => `<span style="display:block;white-space:nowrap${i === lines.length - 1 ? `;color:${TWS_TEXT_BLUE};font-weight:800` : ""}">${esc(l)}</span>`).join("")}</h1></div>
<div data-layer="Gambar" style="position:absolute;left:130px;right:130px;top:${img.brand ? 470 : 430}px;height:540px;border-radius:30px;overflow:hidden;border:2px solid rgba(255,255,255,.2);background:#0b0f1a;box-shadow:0 30px 80px rgba(0,0,0,.6)">${img.bg ? `<img data-slot="bg" src="${esc(img.bg)}" alt="" style="width:100%;height:100%;object-fit:cover">` : graphicSvg(sl.graphic ?? "chart-up", 820, 540)}</div>
<div data-layer="Tombol" style="position:absolute;left:0;right:0;bottom:140px;text-align:center"><span style="display:inline-block;white-space:nowrap;background:linear-gradient(180deg,#4a7dff,#2a56ea);border-radius:6px;padding:10px 28px;font-size:${button.length > 22 ? 44 : 54}px;font-weight:800;letter-spacing:-.015em">${esc(button)}</span></div>${kredit(img)}</div>`;
}

/** HTML satu slide TWS (isi kanvas 1080×1350) */
export function twsSlideHtml(sl: TwsSlide, n: number, img: Img = {}): string {
  const html =
    sl.type === "cover" ? cover(sl, img) : sl.type === "ath" ? athSlide(sl, n, img.brand) : sl.type === "timeline" ? timelineSlide(sl, n, img.brand) : sl.type === "bars" ? barsSlide(sl, n, img.brand) : sl.type === "cta" ? ctaSlide(sl, img) : textSlide(sl, img, n);
  return `<style>${BASE_CSS}</style>${html}`;
}

const NAMES: Record<TwsSlide["type"], string> = { cover: "Cover", text: "Isi", ath: "Infografis ATH", timeline: "Timeline", bars: "Perbandingan", cta: "Ajakan" };

/** deck TWS -> daftar slide desain (dipakai pemutar desain) */
export function twsDesigns(deck: TwsDeck): Design[] {
  return deck.slides.map((sl, i) => ({ size: "4:5", name: `${NAMES[sl.type]}${sl.type === "text" && sl.text ? ` · ${sl.text.replace(/\*\*/g, "").slice(0, 24).trim()}` : ""}`, html: twsSlideHtml(sl, i + 1, { brand: deck.brand === "tws" }), slide: i + 1, tws: { deck, index: i } }));
}

/**
 * permintaan konten TWS: menyebut TWS / Trade With Suli / Suli, ATAU minta konten visual (carousel, poster, infografis, cover…)
 * bertema berita/update ekonomi, saham, crypto, forex, makro. Pertanyaan pasar biasa ("update harga btc") tetap jalur analisa.
 */
const TWS_NAME = /\b(tws|trade with suli|suli)\b/i;
const TWS_VISUAL = /\b(carousel|karosel|konten|infografis|infographic|cover|poster|slide|post(ingan)?|feed|gambar|desain|design|thumbnail|banner|story|reels)\b/i;
const TWS_TOPIC = /\b(ekonomi|makro|saham|ihsg|bursa|crypto|kripto|bitcoin|btc|eth|ethereum|forex|rupiah|dolar|suku bunga|bi rate|the fed|fed rate|inflasi|emas|obligasi|msci|nasdaq|wall street|ath|market|pasar)\b/i;
const NOT_TWS = /\b(ppt|pptx|powerpoint|presentasi|deck|laporan|report campaign|campaign performance)\b/i;
export const TWS_INTENT = { test: (t: string) => TWS_NAME.test(t) || (TWS_VISUAL.test(t) && TWS_TOPIC.test(t) && !NOT_TWS.test(t)) };

/** user memang minta konten TWS (menyebut TWS / Trade With Suli / Suli) -> pakai logo & ajakan TWS */
export const isTwsBrand = (t: string) => TWS_NAME.test(t);

/** aturan giliran untuk konten berita/market (template ```tws); brand=false -> tanpa logo/tulisan TWS sama sekali */
export function twsRules(asOf: string, brand = false): string {
  const cta = brand
    ? '{"type":"cta","kicker":"Cek live Suli terbaru untuk","title":["DAPETIN UPDATE","MARKET CRYPTO"],"button":"KLIK LINK DI BIO!"}'
    : '{"type":"cta","title":["IKUTI TERUS","UPDATE MARKETNYA"],"button":"FOLLOW BIAR NGGAK KETINGGALAN!"}';
  return [
    `MODE KONTEN BERITA / MARKET (gaya akun berita ekonomi IG: foto dramatis, angka 3D besar, judul kapital tebal + sorotan biru). Kamu menulis ISI, website yang menggambar desain & MENCARI FOTONYA SENDIRI di internet.`,
    brand
      ? `BRAND: user minta konten TWS (Trade With Suli) → isi "brand":"tws" di JSON (logo TWS tampil), boleh hashtag #TWS & ajakan live Suli.`
      : `BRAND: user TIDAK menyebut TWS → JANGAN isi "brand", JANGAN tulis "TWS", "Trade With Suli", atau "Suli" di slide, caption, maupun hashtag. Ajakan (cta) dibuat umum.`,
    "1) FAKTA DULU: semua angka, tanggal, nama, dan kejadian HANYA dari blok HASIL BROWSING INTERNET / DATA HARGA di atas. DILARANG mengarang angka atau kutipan. Data tidak ada → bilang terus terang & buat konten yang tidak butuh angka itu (atau tanya lewat kartu ```ask).",
    `2) Judul boleh catchy & bikin penasaran (gaya: "WALL STREET RONTOK, RP18.000T MENGUAP!"), tapi HARUS sesuai fakta beritanya — tidak menyesatkan, tidak merendahkan tokoh, tidak menaruh kata-kata di mulut orang. Tanggal data wajib ditulis di "note" slide yang memuat angka (mis. "*Harga per ${asOf}").`,
    "3) Tulis SATU blok ```tws berisi JSON satu kali (jangan tulis HTML). Format:",
    '```tws\n{"title":"BI Rate Oktober 2026","asOf":"21 Oktober 2026",' +
      (brand ? '"brand":"tws",' : "") +
      '"slides":[\n {"type":"cover","big":"5,75%","tone":"gold","title":["BREAKING! BI TAHAN","SUKU BUNGA 5,75%,","DI LUAR EKSPEKTASI"],"hl":3,"person":"Perry Warjiyo","bg":"bank indonesia headquarters jakarta night"},\n {"type":"text","kicker":"Keputusan RDG 20–21 Oktober 2026","text":"BI Rate ditahan di **5,75%** untuk keempat kalinya","caption":"Mayoritas ekonom memperkirakan naik ke 6,00%","rows":[{"label":"Deposit Facility","value":"5,00%","note":"naik"},{"label":"Lending Facility","value":"6,50%","note":"tetap"}],"note":"*Data per 21 Oktober 2026","bg":"bank indonesia monetary policy press conference"},\n {"type":"ath","title":["BUTUH NAIK BERAPA","SAMPAI BALIK ATH?"],"hl":2,"head":["ATH","SEKARANG"],"items":[{"label":"BTC","a":"$126.000","b":"$81.774","pct":"+54%"}],"note":"*Harga per 23 Oktober 2026"},\n {"type":"bars","title":["IHSG IJO,","BURSA ASIA LOYO"],"hl":2,"sub":"Penutupan 14 Oktober 2026","items":[{"label":"IHSG","value":"5.943,02","pct":"+0,29%"},{"label":"Nikkei","value":"67.744,29","pct":"-0,05%"}],"note":"*Sumber: Katadata"},\n {"type":"timeline","title":["RP100 RIBU BISA","DIPAKAI BUAT APA?"],"hl":2,"sub":"DULU VS SEKARANG","items":[{"top":"1960","label":"2 rumah"}]},\n ' +
      cta +
      '\n],"caption":"caption siap copas (2–4 kalimat, fakta + ajakan diskusi)","hashtags":[' +
      (brand ? '"#TWS",' : "") +
      '"#BIRate"],"sources":[{"title":"Bisnis.com — BI tahan BI Rate 5,75%","url":"https://…"}]}\n```',
    "   - type: cover (judul + angka 3D), text (kalimat besar + **kata kunci** biru, boleh rows data), ath (tabel butuh naik berapa sampai ATH), bars (perbandingan naik/turun, mis. IHSG vs bursa Asia), timeline (dulu vs sekarang), cta (ajakan, slide terakhir).",
    "   - cover: title 2–3 baris HURUF BESAR (maks ±20 huruf/baris, singkat & padat), hl = nomor baris yang disorot kotak biru (biasanya baris terakhir = inti beritanya). big = angka utama SANGAT pendek (\"-11%\", \"5,75%\", \"RP1,2 T\", \"40x\", maks 7 karakter). tone: gold netral/positif, red turun/bahaya, green naik.",
    "   - person (WAJIB di cover, pikir seperti redaktur berita): tokoh publik yang PALING dikaitkan publik dengan berita itu, tulis NAMA LENGKAP resmi. Contoh: kebijakan pemerintah / IHSG anjlok / MSCI turunkan status Indonesia → \"Prabowo Subianto\" (atau Menkeu kalau beritanya soal APBN/pajak); BI Rate / rupiah → \"Perry Warjiyo\"; OJK → Ketua OJK; perusahaan → CEO-nya (\"Jensen Huang\", \"Elon Musk\"); crypto → tokoh yang disebut berita (\"Michael Saylor\", \"Changpeng Zhao\"); The Fed → Ketua The Fed. Kosongkan HANYA kalau memang tidak ada tokoh yang relevan (mis. harga emas harian). Website mencari foto tokoh itu sendiri di internet lalu memotong latarnya — user TIDAK perlu upload. Kamu tidak menggambar wajah.",
    "   - bg = kata kunci foto adegan dalam Bahasa Inggris yang spesifik & dramatis sesuai isi slide (mis. \"indonesia stock exchange building jakarta\", \"stock market screen red numbers crash\", \"gold bars vault\", \"bitcoin coins dark\"). Isi bg di cover DAN tiap slide text supaya tiap slide punya foto berbeda. graphic = cadangan latar grafis: chart-up | chart-down | coins | exchange | bank | arrows | globe.",
    "   - text: 1 kalimat besar maks ±14 kata (pendek = huruf makin besar & makin mirip referensi), **kata kunci** 2–5 kata. caption = 1 kalimat kecil penjelas. Pakai rows hanya kalau ada 2–3 angka pembanding.",
    "   - Satu gambar → 1 slide cover. Carousel → 3–6 slide: cover → isi → (infografis) → cta.",
    "   - sources: daftar sumber berita/data yang benar-benar dipakai (judul + url ASLI dari hasil browsing) — foto utama artikel ini juga dipakai website sebagai cadangan foto.",
    "4) REVISI (\"ganti judul slide 2\", \"angka jadi merah\", \"ganti tokohnya\"): kirim ulang blok ```tws LENGKAP dengan perubahan itu saja; slide lain sama persis.",
    "5) Setelah blok: 1–2 kalimat gaya karaktermu (apa isinya + tokoh yang dipilih & alasannya singkat + tanggal data). Jangan menulis ulang caption/sumber di luar blok — website menampilkannya.",
  ].join("\n");
}
