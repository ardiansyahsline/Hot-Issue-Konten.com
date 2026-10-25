"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SIZES, sanitizeDesign, withUtm, type Design } from "@/lib/visual";
import { twsSlideHtml, type TwsDeck } from "@/lib/tws";
import { FONT_LINKS } from "@/lib/domToSvg";

/**
 * Desain dari AI (blok ```design / ```tws): HTML/CSS/SVG dirender di iframe sandbox (tanpa script, CSP ketat,
 * tidak bisa membaca data user), dicek otomatis (teks kepotong → dikecilkan, kontras rendah → ditandai).
 * - beberapa opsi → pilih satu → revisi bertahap; carousel (slide 1..6) → preview semua, revisi per slide
 * - gambar latar & foto tokoh: upload / Unsplash-Pexels / foto web (berlabel cek hak cipta) / latar grafis
 * - unduh: PNG resolusi tinggi, SVG siap Figma (teks tetap teks, layer bernama), HTML (html.to.design), ZIP semua slide
 */

/** @font-face website (Neue Montreal, Inter, Plus Jakarta Sans) supaya desain memakai font yang sama */
let fontCssCache: string | null = null;
function siteFontCss() {
  if (fontCssCache !== null) return fontCssCache;
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const r of Array.from(rules)) {
      if (r.constructor.name === "CSSFontFaceRule" || r.cssText.startsWith("@font-face")) {
        const fam = (r as CSSFontFaceRule).style?.getPropertyValue("font-family") ?? "";
        if (/Neue Montreal|Inter Variable|Inter Tight Variable|Plus Jakarta Sans Variable/i.test(fam) && !/italic/i.test((r as CSSFontFaceRule).style?.getPropertyValue("font-style") ?? "")) {
          // url relatif terhadap file CSS -> absolut (iframe & file HTML unduhan)
          const base = sheet.href || location.href;
          out.push(r.cssText.replace(/url\((['"]?)([^'")]+)\1\)/g, (_m, _q, u: string) => (/^(data:|https?:)/.test(u) ? `url("${u}")` : `url("${new URL(u, base).href}")`)));
        }
      }
    }
  }
  fontCssCache = out.join("\n");
  return fontCssCache;
}

const CSP =
  "default-src 'none'; img-src 'self' data: blob: https://images.unsplash.com https://plus.unsplash.com https://images.pexels.com; style-src 'unsafe-inline'; font-src 'self' data:";

function buildDoc(d: Design, html: string, standalone = false) {
  const { w, h } = SIZES[d.size];
  const origin = typeof location !== "undefined" ? location.origin : "";
  return [
    "<!doctype html><html><head><meta charset=\"utf-8\">",
    standalone ? `<base href="${origin}/"><title>${d.name.replace(/[<>&"]/g, "")}</title>` : `<meta http-equiv="Content-Security-Policy" content="${CSP}">`,
    `<style>${siteFontCss()}`,
    `html,body{margin:0;padding:0;background:#0a0a0a}*{box-sizing:border-box}`,
    `#cs-art{width:${w}px;height:${h}px;position:relative;overflow:hidden;font-family:'Inter Variable','Plus Jakarta Sans Variable',system-ui,sans-serif;color:#fff;-webkit-font-smoothing:antialiased}`,
    `#cs-art>.art{width:100%;height:100%}img{max-width:100%}`,
    "</style></head><body>",
    `<div id="cs-art">${sanitizeDesign(html)}</div>`,
    "</body></html>",
  ].join("");
}

type Check = { shrunk: number; cut: number; lowContrast: number };

/* ---------- cek otomatis setelah render ---------- */
const lum = (c: number[]) => {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const rgba = (s: string) => (s.match(/[\d.]+/g) ?? []).map(Number);
const ratio = (a: number[], b: number[]) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

function textEls(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>("*")).filter(
    (el) => !(el instanceof el.ownerDocument.defaultView!.SVGElement) && Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim().length > 0)
  );
}

/** teks keluar kotaknya / keluar kanvas → kecilkan bertahap (maks ±45%) */
function fitText(doc: Document): Check {
  const art = doc.getElementById("cs-art");
  const res: Check = { shrunk: 0, cut: 0, lowContrast: 0 };
  if (!art) return res;
  const win = doc.defaultView!;
  const box = art.getBoundingClientRect();
  const over = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const st = win.getComputedStyle(el);
    const clips = st.overflow !== "visible" || st.textOverflow === "ellipsis";
    return r.right > box.right + 1 || r.left < box.left - 1 || r.bottom > box.bottom + 1 || r.top < box.top - 1 || (clips && (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2)) || el.scrollWidth > el.clientWidth + 2;
  };
  for (const el of textEls(art)) {
    if (!over(el)) continue;
    const base = parseFloat(win.getComputedStyle(el).fontSize) || 16;
    let k = 1;
    while (over(el) && k > 0.56) {
      k -= 0.06;
      el.style.fontSize = `${(base * k).toFixed(1)}px`;
    }
    if (over(el)) res.cut++;
    else res.shrunk++;
  }
  // kontras: warna teks vs latar padat terdekat (latar gambar/gradasi dilewati)
  for (const el of textEls(art)) {
    const st = win.getComputedStyle(el);
    if (parseFloat(st.opacity) === 0 || st.visibility === "hidden") continue;
    const fg = rgba(st.color);
    let bg: number[] | null = null;
    for (let p: HTMLElement | null = el; p; p = p.parentElement) {
      const ps = win.getComputedStyle(p);
      if (ps.backgroundImage && ps.backgroundImage !== "none") break;
      const c = rgba(ps.backgroundColor);
      if (c.length >= 3 && (c[3] ?? 1) > 0.6) {
        bg = c;
        break;
      }
      if (p.id === "cs-art") bg = [10, 10, 10];
    }
    if (!bg || fg.length < 3 || (fg[3] ?? 1) < 0.35) continue;
    const big = parseFloat(st.fontSize) >= 32 || (parseFloat(st.fontSize) >= 24 && Number(st.fontWeight) >= 700);
    if (ratio(fg, bg) < (big ? 3 : 4.5)) res.lowContrast++;
  }
  return res;
}

/* ---------- isian gambar (latar & foto tokoh) — disimpan per slide selama halaman terbuka, ikut ke revisi berikutnya ---------- */
type Pic = { src: string; label?: string; page?: string; credit?: string; download?: string; web?: boolean };
type Fill = { bg?: Pic; person?: Pic & { cut?: boolean }; graphic?: boolean; bgList?: Pic[]; bgAt?: number; personList?: Pic[]; personAt?: number; ambient?: string; ambientSrc?: string; tried?: { bg?: boolean; person?: boolean } };
const fills = new Map<string, Fill>();
const listeners = new Set<() => void>();
const setFill = (k: string, f: Partial<Fill>) => {
  fills.set(k, { ...(fills.get(k) ?? {}), ...f });
  listeners.forEach((l) => l());
};
function useFills() {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return fills;
}
// nama tokoh ikut kunci: revisi "ganti tokohnya" -> foto dicari ulang
const keyOf = (d: Design) => (d.tws ? `tws|${d.tws.deck.title ?? ""}|${d.tws.index}|${d.tws.deck.slides[d.tws.index].person ?? ""}` : `d|${d.name}|${d.slide ?? ""}`);
const hasSlot = (d: Design, slot: "bg" | "person") => (d.tws ? (slot === "person" ? d.tws.deck.slides[d.tws.index].type === "cover" : ["cover", "text", "cta"].includes(d.tws.deck.slides[d.tws.index].type)) : d.html.includes(`data-slot="${slot}"`));

type PhotoItem = { thumb: string; full: string; page: string; author: string; provider: "unsplash" | "pexels" | "web"; download?: string };
const toPic = (p: PhotoItem): Pic =>
  p.provider === "web"
    ? { src: `/api/ai/img?u=${encodeURIComponent(p.full)}`, label: "Foto web · cek hak cipta sebelum dipakai", page: p.page, web: true }
    : { src: p.full, credit: `Foto: ${p.author} / ${p.provider === "unsplash" ? "Unsplash" : "Pexels"}`, page: withUtm(p.page), download: p.download };
async function findPhotos(q: string, web = false): Promise<PhotoItem[]> {
  try {
    const r = await fetch(`/api/ai/photos?q=${encodeURIComponent(q)}&n=6${web ? "&src=web" : ""}`);
    const j = (await r.json()) as { items?: PhotoItem[] };
    return j.items ?? [];
  } catch {
    return [];
  }
}

/** HTML akhir satu desain, dengan gambar latar / foto tokoh yang sudah dipilih */
function htmlOf(d: Design, f: Fill | undefined): string {
  if (d.tws) {
    const sl = d.tws.deck.slides[d.tws.index];
    return twsSlideHtml(sl, d.tws.index + 1, { bg: f?.graphic ? undefined : f?.bg?.src, person: f?.person?.src, cut: f?.person?.cut, credit: f?.bg?.credit, brand: d.tws.deck.brand === "tws", ambient: f?.ambient });
  }
  let h = d.html;
  if (f?.bg && !f.graphic) h = h.replace(/<img([^>]*?)data-slot="bg"([^>]*?)>/g, (_m, a: string, b: string) => `<img${(a + b).replace(/\ssrc="[^"]*"/, "")} data-slot="bg" src="${f.bg!.src}">`);
  if (f?.person) h = h.replace(/<img([^>]*?)data-slot="person"([^>]*?)>/g, (_m, a: string, b: string) => `<img${(a + b).replace(/\ssrc="[^"]*"/, "")} data-slot="person" src="${f.person!.src}">`);
  return h;
}

/** foto utama artikel sumber berita (og:image) — sekali per deck */
const newsCache = new Map<string, Promise<Pic[]>>();
function deckNews(deck: TwsDeck): Promise<Pic[]> {
  const urls = (deck.sources ?? []).map((x) => x.url).filter(Boolean);
  const k = urls.join("|");
  if (!k) return Promise.resolve([]);
  let p = newsCache.get(k);
  if (!p) {
    p = fetch(`/api/ai/photos?${urls.map((u) => `news=${encodeURIComponent(u)}`).join("&")}`)
      .then((r) => r.json() as Promise<{ items?: PhotoItem[] }>)
      .then((j) => (j.items ?? []).map((x) => ({ ...toPic(x), label: `Foto berita ${x.author} · cek hak cipta sebelum dipakai` })))
      .catch(() => []);
    newsCache.set(k, p);
  }
  return p;
}

/**
 * warna cahaya lingkungan foto latar (bagian atas, tempat angka 3D): rata-rata yang condong ke warna terang & jenuh
 * (lampu, grafik, api) -> dipakai untuk cahaya pinggir & sisi angka supaya angka menyatu dengan fotonya.
 */
const ambientCache = new Map<string, Promise<string | null>>();
function ambientOf(src: string): Promise<string | null> {
  let p = ambientCache.get(src);
  if (!p) {
    p = new Promise<string | null>((res) => {
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = () => {
        try {
          const c = document.createElement("canvas");
          c.width = 32;
          c.height = 20;
          const g = c.getContext("2d")!;
          g.drawImage(im, 0, 0, im.naturalWidth, im.naturalHeight * 0.6, 0, 0, 32, 20);
          const px = g.getImageData(0, 0, 32, 20).data;
          let r = 0, gg = 0, b = 0, w = 0;
          for (let i = 0; i < px.length; i += 4) {
            const mx = Math.max(px[i], px[i + 1], px[i + 2]), mn = Math.min(px[i], px[i + 1], px[i + 2]);
            const wt = Math.pow(mx ? (mx - mn) / mx : 0, 1.5) * (mx / 255) + 0.03;
            r += px[i] * wt;
            gg += px[i + 1] * wt;
            b += px[i + 2] * wt;
            w += wt;
          }
          const avg = [r / w, gg / w, b / w];
          const k = 225 / Math.max(1, ...avg); // dicerahkan: ini warna cahaya, bukan warna bayangan
          res(`#${avg.map((v) => Math.min(255, Math.round(v * k)).toString(16).padStart(2, "0")).join("")}`);
        } catch {
          res(null); // gambar tanpa izin CORS -> tanpa ambient
        }
      };
      im.onerror = () => res(null);
      im.src = src;
    });
    ambientCache.set(src, p);
  }
  return p;
}

/** hitung ulang ambient tiap kali foto latar cover (yang ada angka 3D-nya) berganti */
function useAmbient(designs: Design[]) {
  const store = useFills();
  useEffect(() => {
    designs.forEach((d) => {
      if (!d.tws || !d.tws.deck.slides[d.tws.index].big) return;
      const k = keyOf(d);
      const f = store.get(k);
      const src = f?.person && !f.person.cut ? f.person.src : f?.graphic ? undefined : f?.bg?.src;
      if (!src || f?.ambientSrc === src) return;
      setFill(k, { ambientSrc: src, ambient: undefined });
      void ambientOf(src).then((a) => fills.get(k)?.ambientSrc === src && a && setFill(k, { ambient: a }));
    });
  });
}

const PERSON_LABEL = "Foto tokoh dicari otomatis dari web · cek hak cipta & pastikan orangnya benar";

/** coba kandidat foto tokoh mulai dari `from`: yang latarnya berhasil dihapus dipakai di depan; semua gagal -> foto pertama jadi latar penuh */
async function pickPerson(k: string, list: Pic[], from: number) {
  const { removeBackground } = await import("@/lib/removeBg");
  for (let i = from; i < Math.min(list.length, from + 3); i++) {
    const cut = await removeBackground(list[i].src);
    if (cut) return setFill(k, { person: { ...list[i], src: cut, cut: true, label: PERSON_LABEL }, personAt: i });
  }
  if (list[from]) setFill(k, { person: { ...list[from], label: PERSON_LABEL }, personAt: from });
}

/** cari otomatis foto latar & foto tokoh untuk slide berita (sekali per slide) — tanpa upload */
function useAutoFill(designs: Design[], on: boolean) {
  useEffect(() => {
    if (!on) return;
    designs.forEach((d) => {
      if (!d.tws) return;
      const deck = d.tws.deck;
      const sl = deck.slides[d.tws.index];
      const k = keyOf(d);
      const f = fills.get(k) ?? {};
      if (hasSlot(d, "bg") && !f.bg && !f.tried?.bg) {
        setFill(k, { tried: { ...f.tried, bg: true } });
        // kata kunci adegan dari AI dulu; kosong -> foto utama artikel berita sumbernya (beda slide, beda foto)
        void (sl.bg ? findPhotos(sl.bg) : Promise.resolve([] as PhotoItem[])).then(async (items) => {
          let list = items.map(toPic);
          if (!list.length) {
            const news = await deckNews(deck);
            list = news.length ? [...news.slice(d.tws!.index % news.length), ...news.slice(0, d.tws!.index % news.length)] : [];
          }
          if (list.length && !fills.get(k)?.bg) setFill(k, { bg: list[0], bgList: list, bgAt: 0 });
        });
      }
      if (sl.person && hasSlot(d, "person") && !f.person && !f.tried?.person) {
        setFill(k, { tried: { ...(fills.get(k)?.tried ?? {}), person: true } });
        void fetch(`/api/ai/photos?person=${encodeURIComponent(sl.person)}`)
          .then((r) => r.json() as Promise<{ items?: PhotoItem[] }>)
          .then(async (j) => {
            const list = (j.items ?? []).map(toPic);
            if (!list.length || fills.get(k)?.person) return;
            setFill(k, { personList: list });
            await pickPerson(k, list, 0);
          })
          .catch(() => {});
      }
    });
  }, [designs, on]);
}

function Frame({ d, html, maxH, onReady }: { d: Design; html: string; maxH: number; onReady?: (doc: Document, c: Check) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [cw, setCw] = useState(0);
  const { w, h } = SIZES[d.size];
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCw(el.clientWidth));
    ro.observe(el);
    setCw(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const doc = useMemo(() => (typeof document === "undefined" ? "" : buildDoc(d, html)), [d, html]);
  const s = cw ? Math.min(cw / w, maxH / h) : 0;
  return (
    <div ref={wrap} className="w-full">
      <div className="mx-auto overflow-hidden rounded-lg bg-zinc-950" style={{ width: w * s, height: h * s, boxShadow: "var(--shadow-sm)" }}>
        {s > 0 && (
          <iframe
            title={d.name}
            sandbox="allow-same-origin"
            referrerPolicy="no-referrer"
            srcDoc={doc}
            width={w}
            height={h}
            scrolling="no"
            style={{ width: w, height: h, border: 0, transform: `scale(${s})`, transformOrigin: "0 0", pointerEvents: "none", display: "block" }}
            onLoad={async (e) => {
              const dd = e.currentTarget.contentDocument;
              if (!dd) return;
              try {
                await dd.fonts?.ready;
                await Promise.all(Array.from(dd.images).map((im) => (im.complete ? 0 : new Promise((r) => ((im.onload = r), (im.onerror = r))))));
              } catch {}
              onReady?.(dd, fitText(dd));
            }}
          />
        )}
      </div>
    </div>
  );
}

/* ---------- unduh ---------- */
const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "konten";
const fileName = (d: Design) => `${d.tws ? `${d.tws.deck.brand === "tws" ? "tws" : "berita"}-${slug(d.tws.deck.title ?? "konten").slice(0, 24)}` : "desain"}-${d.slide ? `${String(d.slide).padStart(2, "0")}-` : ""}${slug(d.name).slice(0, 28)}-${d.size.replace(":", "x")}`;
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
/**
 * @font-face + file font (data URL) untuk PNG. html-to-image hanya mendeteksi font di elemen paling luar kalau desain
 * ada di iframe, jadi font judul (mis. Inter Tight) tidak ikut & teks melebar/turun baris -> ditanam sendiri di sini.
 * Hanya subset latin (cukup untuk Bahasa Indonesia), disimpan selama halaman terbuka.
 */
let fontEmbed: Promise<string> | null = null;
function fontEmbedCss(): Promise<string> {
  fontEmbed ??= (async () => {
    const rules = siteFontCss()
      .split(/(?=@font-face)/)
      // buang subset cyrillic / greek / vietnam (tidak dipakai, bikin berat)
      .filter((r) => r.startsWith("@font-face") && !/unicode-range:\s*U\+(0?460|0?400|0?301|1F00|0?370|0?102)\b/i.test(r));
    const out = await Promise.all(
      rules.map(async (r) => {
        const urls = [...r.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1]);
        let css = r;
        for (const u of urls) {
          try {
            const blob = await (await fetch(u)).blob();
            const data = await new Promise<string>((res) => {
              const fr = new FileReader();
              fr.onload = () => res(String(fr.result));
              fr.readAsDataURL(blob);
            });
            css = css.split(u).join(data);
          } catch {}
        }
        return css;
      })
    );
    return out.join("\n");
  })().catch(() => "");
  return fontEmbed;
}
async function pngBlob(doc: Document | null | undefined, d: Design) {
  const node = doc?.getElementById("cs-art");
  if (!node) throw new Error("desain belum siap");
  const { toBlob } = await import("html-to-image");
  const { w, h } = SIZES[d.size];
  const blob = await toBlob(node, { pixelRatio: 2, width: w, height: h, cacheBust: true, backgroundColor: "#0a0a0a", fontEmbedCSS: await fontEmbedCss() });
  if (!blob) throw new Error("gagal membuat PNG");
  return blob;
}
async function svgText(doc: Document | null | undefined, d: Design) {
  const node = doc?.getElementById("cs-art");
  if (!node) throw new Error("desain belum siap");
  const { domToSvg } = await import("@/lib/domToSvg");
  const { w, h } = SIZES[d.size];
  return domToSvg(node, w, h, d.slide ? `Slide ${d.slide} · ${d.name}` : d.name);
}
/** aturan Unsplash: unduhan desain yang memakai foto Unsplash ikut dilaporkan */
const trackPhotos = (ds: Design[]) =>
  ds.forEach((d) => {
    const dl = fills.get(keyOf(d))?.bg?.download;
    if (dl && !fills.get(keyOf(d))?.graphic) void fetch(`/api/ai/photos?track=${encodeURIComponent(dl)}`).catch(() => {});
  });

type Fmt = "png" | "svg" | "html" | "zip-png" | "zip-svg";
async function exportAs(fmt: Fmt, list: { d: Design; doc?: Document | null; html: string }[], title: string): Promise<string[]> {
  trackPhotos(list.map((x) => x.d));
  const one = list[0];
  if (fmt === "png") download(await pngBlob(one.doc, one.d), `${fileName(one.d)}.png`);
  if (fmt === "html") download(new Blob([buildDoc(one.d, one.html, true)], { type: "text/html" }), `${fileName(one.d)}.html`);
  if (fmt === "svg") {
    const r = await svgText(one.doc, one.d);
    download(new Blob([r.svg], { type: "image/svg+xml" }), `${fileName(one.d)}.svg`);
    return r.fonts;
  }
  if (fmt === "zip-png" || fmt === "zip-svg") {
    const { zipSync, strToU8 } = await import("fflate");
    const files: Record<string, Uint8Array> = {};
    const fonts = new Set<string>();
    for (const x of list) {
      if (fmt === "zip-png") files[`${fileName(x.d)}.png`] = new Uint8Array(await (await pngBlob(x.doc, x.d)).arrayBuffer());
      else {
        const r = await svgText(x.doc, x.d);
        r.fonts.forEach((f) => fonts.add(f));
        files[`${fileName(x.d)}.svg`] = strToU8(r.svg);
      }
    }
    if (fmt === "zip-svg")
      files["BACA-DULU.txt"] = strToU8(
        `File SVG siap Figma: tarik (drag) file .svg ke Figma. Teks tetap bisa diedit, layer sudah dinamai (Logo, Judul, Sorotan, Angka 3D, Foto Tokoh, Latar).\nInstall font ini dulu supaya tampilannya sama:\n${[...fonts].map((f) => `- ${f}${FONT_LINKS[f] ? `: ${FONT_LINKS[f]}` : ""}`).join("\n")}\n`
      );
    download(new Blob([zipSync(files, { level: 6 }) as BlobPart], { type: "application/zip" }), `${slug(title)}-${fmt === "zip-png" ? "png" : "svg"}.zip`);
    return [...fonts];
  }
  return [];
}

const btn = "rounded-lg border border-zinc-800 px-2.5 py-1 text-[12px] font-semibold hover:bg-zinc-800/60 disabled:opacity-50";
const chip = "rounded-full border border-zinc-800 px-2.5 py-0.5 text-[11.5px] text-zinc-400 hover:border-orange-500/50 hover:text-zinc-100";

function CheckLine({ c, onFix }: { c: Check | null; onFix?: (why: string) => void }) {
  if (!c) return <span className="text-zinc-500">⏳ mengecek hasil render…</span>;
  const bad = [c.cut && `${c.cut} teks masih kepotong`, c.lowContrast && `${c.lowContrast} teks kontrasnya rendah`].filter(Boolean) as string[];
  if (!bad.length) return <span className="text-emerald-500">✓ Dicek: teks muat{c.shrunk ? ` (${c.shrunk} dikecilkan otomatis)` : ""}, kontras aman</span>;
  return (
    <span className="text-amber-500">
      ⚠ {bad.join(" · ")}
      {onFix && (
        <button type="button" onClick={() => onFix(bad.join(", "))} className="ml-2 font-semibold underline underline-offset-2 hover:text-amber-400">
          minta AI rapikan
        </button>
      )}
    </span>
  );
}

/** tombol unduh dengan pilihan format */
function Downloads({ get, many, title }: { get: (all: boolean) => { d: Design; doc?: Document | null; html: string }[]; many: boolean; title: string }) {
  const [busy, setBusy] = useState<Fmt | null>(null);
  const [msg, setMsg] = useState("");
  const run = async (f: Fmt) => {
    setBusy(f);
    setMsg("");
    try {
      const fonts = await exportAs(f, get(f.startsWith("zip")), title);
      if (fonts.length) setMsg(`Font di SVG: ${fonts.join(", ")} — install dulu supaya di Figma tampilannya sama.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "gagal");
    }
    setBusy(null);
  };
  const b = (f: Fmt, label: string, hint: string) => (
    <button key={f} type="button" title={hint} disabled={!!busy} onClick={() => run(f)} className={btn}>
      {busy === f ? "⏳" : "⬇"} {label}
    </button>
  );
  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-1.5">
        {b("png", "PNG", "Gambar resolusi tinggi (2×)")}
        {b("svg", "SVG Figma", "Teks tetap teks, layer bernama — tarik ke Figma")}
        {b("html", "HTML", "Untuk plugin Figma html.to.design")}
        {many && b("zip-png", "ZIP PNG", "Semua slide (PNG)")}
        {many && b("zip-svg", "ZIP SVG", "Semua slide (SVG siap Figma)")}
      </div>
      {msg && (
        <p className="mt-1 text-[11.5px] text-zinc-500">
          {msg}{" "}
          {Object.entries(FONT_LINKS)
            .filter(([f]) => msg.includes(f))
            .map(([f, u]) => (
              <a key={f} href={u} target="_blank" rel="noopener noreferrer" className="mr-2 text-orange-500 hover:underline">
                Unduh {f}
              </a>
            ))}
        </p>
      )}
    </div>
  );
}

/** kontrol gambar latar & foto tokoh untuk satu slide */
function ImageControls({ d, disabled }: { d: Design; disabled?: boolean }) {
  const k = keyOf(d);
  const f = useFills().get(k) ?? {};
  const bgIn = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState("");
  const canBg = hasSlot(d, "bg"), canP = hasSlot(d, "person");
  if (!canBg && !canP) return null;
  const nextBg = async () => {
    let list = f.bgList ?? [];
    const q = d.tws?.deck.slides[d.tws.index].bg;
    if (!list.length && q) {
      setBusy("bg");
      list = (await findPhotos(q)).map(toPic);
      setBusy("");
    }
    // urutan: foto berikutnya … lalu latar grafis
    const at = f.graphic ? 0 : (f.bgAt ?? -1) + 1;
    if (list.length && at < list.length) setFill(k, { bgList: list, bgAt: at, bg: list[at], graphic: false });
    else setFill(k, { graphic: true, bgAt: -1 });
  };
  const upload = async (file: File) => {
    const { fileToDataUrl } = await import("@/lib/removeBg");
    setBusy("bg");
    setFill(k, { bg: { src: await fileToDataUrl(file), label: "Foto upload kamu" }, graphic: false });
    setBusy("");
  };
  // foto tokoh tidak di-upload: website mencari sendiri; tombol ini mencoba kandidat foto berikutnya
  const nextPerson = async () => {
    const list = f.personList ?? [];
    if (!list.length) return;
    setBusy("person");
    await pickPerson(k, list, ((f.personAt ?? -1) + 1) % list.length);
    setBusy("");
  };
  return (
    <div className="mt-2 space-y-1">
      <div className="flex flex-wrap gap-1.5">
        {canBg && (
          <button type="button" disabled={disabled || !!busy} onClick={nextBg} className={chip}>
            {busy === "bg" ? "⏳" : "🖼"} Ganti gambar latar
          </button>
        )}
        {canBg && (
          <button type="button" disabled={disabled || !!busy} onClick={() => bgIn.current?.click()} className={chip}>
            ⬆ Upload latar
          </button>
        )}
        {canP && (f.personList?.length ?? 0) > 1 && (
          <button type="button" disabled={disabled || !!busy} onClick={nextPerson} className={chip}>
            {busy === "person" ? "⏳ mencari foto…" : "👤 Ganti foto tokoh"}
          </button>
        )}
        {f.person && (
          <button type="button" disabled={disabled} onClick={() => setFill(k, { person: undefined })} className={chip}>
            ✕ Tanpa tokoh
          </button>
        )}
      </div>
      <input ref={bgIn} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      {[f.graphic ? null : f.bg, f.person].filter(Boolean).map((p, i) => (
        <p key={i} className={`text-[11px] ${p!.web ? "text-amber-500" : "text-zinc-500"}`}>
          {p!.web ? "⚠ " : ""}
          {p!.credit ?? p!.label}
          {p!.page && (
            <a href={p!.page} target="_blank" rel="noopener noreferrer" className="ml-1 underline underline-offset-2">
              sumber
            </a>
          )}
        </p>
      ))}
      {canBg && f.graphic && <p className="text-[11px] text-zinc-500">Latar grafis (bukan foto)</p>}
    </div>
  );
}

/** opsi desain (pilih salah satu) */
function OptionTile({ d, i, disabled, onSend }: { d: Design; i: number; disabled?: boolean; onSend: (t: string) => void }) {
  const docRef = useRef<Document | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  const f = useFills().get(keyOf(d));
  const html = htmlOf(d, f);
  const { w, h } = SIZES[d.size];
  return (
    <div className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-950/40 p-2">
      <Frame d={d} html={html} maxH={300} onReady={(doc, c) => ((docRef.current = doc), setCheck(c))} />
      <div className="mt-2 flex flex-col px-0.5">
        <b className="min-w-0 text-[13px] leading-snug">
          <span className="mr-1 text-orange-500">{String.fromCharCode(65 + i)}.</span>
          {d.name}
        </b>
        <span className="text-[11px] text-zinc-500">
          {SIZES[d.size].label} · {w * 2}×{h * 2}
        </span>
      </div>
      <div className="mt-1 px-0.5 text-[11.5px]">
        <CheckLine c={check} onFix={disabled ? undefined : (why) => onSend(`✏️ Revisi desain "${d.name}": rapikan: ${why}. Jangan ubah konsepnya.`)} />
      </div>
      <button type="button" disabled={disabled} onClick={() => onSend(`📌 Pilih desain: ${String.fromCharCode(65 + i)}. ${d.name} — lanjut pakai yang ini`)} className="mt-2 rounded-lg bg-orange-600 px-2.5 py-1 text-[12px] font-bold text-white hover:bg-orange-500 disabled:opacity-50">
        Pilih ini
      </button>
      <Downloads get={() => [{ d, doc: docRef.current, html }]} many={false} title={d.name} />
    </div>
  );
}

/** satu desain atau carousel: preview besar + thumbnail semua slide + revisi per slide + unduh */
function Viewer({ designs, deck, disabled, onSend }: { designs: Design[]; deck?: TwsDeck; disabled?: boolean; onSend: (t: string) => void }) {
  const store = useFills();
  const [at, setAt] = useState(0);
  const [checks, setChecks] = useState<(Check | null)[]>(() => designs.map(() => null));
  const docs = useRef<(Document | null)[]>([]);
  const [rev, setRev] = useState("");
  const [copied, setCopied] = useState(false);
  const many = designs.length > 1;
  const cur = designs[Math.min(at, designs.length - 1)];
  const htmls = designs.map((d) => htmlOf(d, store.get(keyOf(d))));
  const n = cur.slide ?? at + 1;
  const revise = (t: string) => t.trim() && onSend(many ? `✏️ Revisi slide ${n} "${cur.name}": ${t.trim().slice(0, 300)}` : `✏️ Revisi desain "${cur.name}": ${t.trim().slice(0, 300)}`);
  const title = deck?.title || cur.name;
  const quick = deck ? ["Ganti judul", "Angka jadi merah", "Angka jadi hijau", "Teks lebih besar"] : ["Ganti warna", "Teks lebih besar", "Lebih minimalis", cur.size === "9:16" ? "Versi 1:1" : "Versi 9:16"];
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-2">
      {/* preview besar slide aktif (iframe thumbnail di bawah juga dipakai untuk unduh semua slide) */}
      <Frame d={cur} html={htmls[at]} maxH={540} onReady={(doc, c) => ((docs.current[at] = doc), setChecks((x) => x.map((v, i) => (i === at ? c : v))))} />
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 px-0.5">
        {many && (
          <button type="button" aria-label="Slide sebelumnya" disabled={at === 0} onClick={() => setAt(at - 1)} className={`${btn} px-2`}>
            ‹
          </button>
        )}
        <b className="min-w-0 flex-1 text-[13px] leading-snug">
          {many && <span className="mr-1 text-orange-500">Slide {n}/{designs.length}</span>}
          {cur.name}
        </b>
        {many && (
          <button type="button" aria-label="Slide berikutnya" disabled={at === designs.length - 1} onClick={() => setAt(at + 1)} className={`${btn} px-2`}>
            ›
          </button>
        )}
      </div>
      <div className="mt-0.5 px-0.5 text-[11px] text-zinc-500">
        {SIZES[cur.size].label} · {SIZES[cur.size].w * 2}×{SIZES[cur.size].h * 2}
      </div>
      {many && (
        <div className="mt-2 grid grid-cols-6 gap-1.5">
          {designs.map((d, i) => (
            <button key={i} type="button" onClick={() => setAt(i)} className={`min-w-0 rounded-md p-0.5 ${i === at ? "ring-2 ring-orange-500" : "opacity-70 hover:opacity-100"}`} aria-label={`Slide ${i + 1}`}>
              <Frame d={d} html={htmls[i]} maxH={110} onReady={(doc, c) => ((docs.current[i] = doc), setChecks((x) => x.map((v, j) => (j === i ? c : v))))} />
            </button>
          ))}
        </div>
      )}
      <div className="mt-1.5 px-0.5 text-[11.5px]">
        <CheckLine c={checks[at]} onFix={disabled ? undefined : (why) => revise(`rapikan: ${why}. Jangan ubah konsepnya.`)} />
      </div>
      <ImageControls d={cur} disabled={disabled} />
      <Downloads get={(all) => (all ? designs.map((d, i) => ({ d, doc: docs.current[i], html: htmls[i] })) : [{ d: cur, doc: docs.current[at], html: htmls[at] }])} many={many} title={title} />
      {!disabled && (
        <div className="mt-2 space-y-1.5">
          <div className="flex flex-wrap gap-1.5">
            {quick.map((t) => (
              <button key={t} type="button" onClick={() => revise(t)} className={chip}>
                {t}
              </button>
            ))}
          </div>
          <input
            value={rev}
            onChange={(e) => setRev(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && rev.trim()) {
                revise(rev);
                setRev("");
              }
            }}
            placeholder={many ? `Revisi slide ${n}… mis. judul jadi lebih singkat, Enter` : "Revisi… mis. judul jadi 'Gajian Clipper Cair!', Enter"}
            className="input w-full py-1.5 text-[12.5px]"
          />
        </div>
      )}
      {deck?.caption && (
        <div className="mt-3 rounded-lg border border-zinc-800 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <b className="text-[12px]">Caption siap copas</b>
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(`${deck.caption}\n\n${(deck.hashtags ?? []).join(" ")}`.trim()).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}
              className={btn}
            >
              {copied ? "✓ Tersalin" : "⧉ Salin"}
            </button>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-[12.5px] text-zinc-300">{deck.caption}</p>
          {!!deck.hashtags?.length && <p className="mt-1 text-[12px] text-orange-500">{deck.hashtags.join(" ")}</p>}
        </div>
      )}
      {!!deck?.sources?.length && (
        <div className="mt-2 px-0.5 text-[11.5px] text-zinc-500">
          <b className="text-zinc-400">Sumber data{deck.asOf ? ` (per ${deck.asOf})` : ""}:</b>
          <ol className="mt-0.5 list-decimal space-y-0.5 pl-4">
            {deck.sources.map((s, i) => (
              <li key={i}>
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="break-words underline-offset-2 hover:text-zinc-200 hover:underline">
                  {s.title || s.url}
                </a>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

export default function DesignCard({ designs, deck, disabled, onSend }: { designs: Design[]; deck?: TwsDeck; disabled?: boolean; onSend: (t: string) => void }) {
  useAutoFill(designs, true);
  useAmbient(designs);
  const slides = !!deck || designs.some((d) => d.slide);
  const options = !slides && designs.length > 1;
  const wide = designs.every((d) => SIZES[d.size].w > SIZES[d.size].h);
  if (options)
    return (
      <div className="my-2">
        <div className="mb-1.5 text-[12px] text-zinc-500">🎨 {designs.length} opsi desain — pilih satu, lalu revisi sampai pas</div>
        <div className={`grid gap-2 ${wide ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2 sm:grid-cols-3"}`}>
          {designs.map((d, i) => (
            <OptionTile key={`${i}-${d.name}-${d.html.length}`} d={d} i={i} disabled={disabled} onSend={onSend} />
          ))}
        </div>
      </div>
    );
  return (
    <div className="my-2">
      {slides && designs.length > 1 && <div className="mb-1.5 text-[12px] text-zinc-500">🖼 Carousel {designs.length} slide — klik slide untuk lihat & revisi</div>}
      <Viewer designs={designs} deck={deck} disabled={disabled} onSend={onSend} />
    </div>
  );
}

/** revisi satu slide carousel: slide yang tidak dikirim ulang diambil dari carousel sebelumnya */
export function mergeSlides(cur: Design[], prev: Design[] | null): Design[] {
  if (!prev?.length || !cur.length || !cur.every((d) => d.slide) || !prev.every((d) => d.slide)) return cur;
  const byNo = new Map(prev.map((d) => [d.slide!, d]));
  cur.forEach((d) => byNo.set(d.slide!, d));
  return [...byNo.values()].sort((a, b) => a.slide! - b.slide!);
}
