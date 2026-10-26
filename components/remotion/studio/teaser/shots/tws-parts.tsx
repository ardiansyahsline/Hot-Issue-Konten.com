"use client";

/**
 * Bagian adegan 7 teaser (desain berita TWS): slide dirender dengan renderer TWS ASLI (lib/tws.ts → twsSlideHtml),
 * sama persis dengan yang dipakai DesignCard di website, lalu disisipkan ke DOM Remotion dengan:
 *  - CSS bawaan TWS (BASE_CSS) di-scope ke `.twsx` supaya tidak bocor ke adegan lain
 *  - id SVG dibuat unik per salinan (graphicSvg memakai id tetap "bgg"/"glw" → di satu halaman bisa saling pinjam gradien)
 *  - pengganti khusus teaser untuk CSS yang tidak didukung @remotion/web-renderer:
 *      "Cahaya Angka" (CSS radial-gradient)  → SVG radialGradient dengan elips yang sama
 *      "Color Grading" (mix-blend-mode soft-light) → lapisan biasa beropasitas rendah, HANYA saat render web
 *  - logo TWS lewat preset brand (useSrc → di laptop dipetakan ke <public>/brand/tws-logo.svg)
 *  - font & logo ditunggu (useDelayRender, scope render laptop MAUPUN browser) sebelum frame diambil; logo gagal → dibuang
 * lib/tws.ts TIDAK diubah.
 */
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useDelayRender } from "remotion";
import { TWS_LOGO, twsSlideHtml, type TwsSlide } from "@/lib/tws";
import { useSrc } from "../../theme";

export const SLIDE_W = 1080;
export const SLIDE_H = 1350;
const SCOPE = "twsx";

const escAttr = (t: string) => t.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const escRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * semua selector BASE_CSS diawali `.twsx `.
 * `.judul span` (turunan) → `.judul>span` (anak langsung = baris judul): @remotion/web-renderer menyisipkan <span> sementara
 * di dalam elemen teks (pembungkus text node & pengukur per kata); selector turunan ikut mengenai span itu → tiap kata jadi
 * display:block dan judul tergambar tumpang tindih di render browser. Baris judul asli selalu anak langsung h1.judul.
 */
function scopeCss(css: string): string {
  return css
    .replace(/([^{}]+)\{/g, (_m, sel: string) => `${sel.split(",").map((x) => `.${SCOPE} ${x.trim()}`).join(",")}{`)
    .replace(/\.judul span\{/g, ".judul>span{");
}

/** id SVG unik per salinan slide (id tetap di graphicSvg / big3d tidak boleh bentrok antar-slide di satu DOM) */
function uniqIds(html: string, sfx: string): string {
  const ids = new Set<string>();
  html.replace(/\sid="([^"]+)"/g, (_m, id: string) => (ids.add(id), ""));
  let out = html;
  for (const id of ids) {
    const e = escRe(id);
    out = out
      .replace(new RegExp(`(\\sid=")${e}(")`, "g"), `$1${id}-${sfx}$2`)
      .replace(new RegExp(`url\\(#${e}\\)`, "g"), `url(#${id}-${sfx})`)
      .replace(new RegExp(`(href=")#${e}(")`, "g"), `$1#${id}-${sfx}$2`);
  }
  return out;
}

/** rgba(r,g,b,a) → [rgb(r,g,b), a] untuk stop SVG */
function splitRgba(c: string): [string, number] {
  const m = /rgba?\(([^)]*)\)/.exec(c);
  if (!m) return ["#000000", 0];
  const p = m[1].split(",").map((x) => x.trim());
  return [`rgb(${p[0]},${p[1]},${p[2]})`, p[3] === undefined ? 1 : parseFloat(p[3])];
}

/**
 * "Cahaya Angka" asli = 2 CSS radial-gradient elips (62%×38% gelap + 52%×30% rona warna angka) di kotak 1080×760.
 * Web-renderer tidak mendukung radial-gradient CSS → diganti SVG radialGradient pada elips berukuran sama (hasil visual setara).
 */
function replaceAir(html: string): string {
  return html.replace(/<div class="udara" data-layer="Cahaya Angka" style="([^"]*)"><\/div>/, (_m, st: string) => {
    const at = /at (\d+(?:\.\d+)?)% (\d+(?:\.\d+)?)%/.exec(st);
    const cx = ((at ? parseFloat(at[1]) : 50) / 100) * 1080;
    const cy = ((at ? parseFloat(at[2]) : 17) / 100) * 760;
    const cols = st.match(/rgba\([^)]*\)/g) ?? [];
    const [dark, da] = splitRgba(cols[0] ?? "rgba(0,0,0,.5)");
    const [glow, ga] = splitRgba(cols[2] ?? "rgba(255,46,46,.2)");
    const svg =
      `<svg width="1080" height="760" viewBox="0 0 1080 760" style="display:block"><defs>` +
      `<radialGradient id="aird"><stop offset="0" stop-color="${dark}" stop-opacity="${da}"/><stop offset="1" stop-color="${dark}" stop-opacity="0"/></radialGradient>` +
      `<radialGradient id="airg"><stop offset="0" stop-color="${glow}" stop-opacity="${ga}"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient></defs>` +
      `<ellipse cx="${cx}" cy="${cy}" rx="${0.62 * 1080}" ry="${0.38 * 760}" fill="url(#aird)"/>` +
      `<ellipse cx="${cx}" cy="${cy}" rx="${0.52 * 1080}" ry="${0.3 * 760}" fill="url(#airg)"/></svg>`;
    return `<div class="udara" data-layer="Cahaya Angka">${svg}</div>`;
  });
}

/** CSS tambahan (setara buildDoc DesignCard: #cs-art, box-sizing, img max-width) */
const EXTRA_CSS = [
  `.${SCOPE}{position:relative;width:${SLIDE_W}px;height:${SLIDE_H}px;overflow:hidden;font-family:'Inter Variable','Plus Jakarta Sans Variable',system-ui,sans-serif;color:#fff;-webkit-font-smoothing:antialiased;text-align:left;line-height:normal}`,
  `.${SCOPE} *{box-sizing:border-box}`,
  `.${SCOPE}>.art{width:100%;height:100%}`,
  `.${SCOPE} img{max-width:100%}`,
].join("\n");
/**
 * "Color Grading" asli = mix-blend-mode soft-light. Hanya saat render di browser (@remotion/web-renderer, tidak mendukung blend)
 * diganti lapisan biasa beropasitas rendah; di preview & render laptop (Chromium) tetap soft-light asli → identik dengan produk.
 */
const GRADE_WEB = `.${SCOPE} .grade{mix-blend-mode:normal!important;opacity:.26}`;

export type PreparedSlide = { html: string; css: string };

/** HTML slide TWS asli siap disisipkan (CSS terpisah, sudah di-scope) */
export function prepareSlide(sl: TwsSlide, n: number, logoSrc: string, key: string): PreparedSlide {
  const raw = twsSlideHtml(sl, n, { brand: true });
  const m = /^<style>([\s\S]*?)<\/style>/.exec(raw);
  let html = m ? raw.slice(m[0].length) : raw;
  // logoSrc kosong = logo gagal dimuat (useTwsReady) → <img> dibuang, bukan gambar rusak
  html = logoSrc ? html.split(`src="${TWS_LOGO}"`).join(`src="${escAttr(logoSrc)}"`) : html.replace(/<img data-layer="Logo"[^>]*>/g, "");
  html = replaceAir(html);
  html = uniqIds(html, key);
  return { html, css: m ? scopeCss(m[1]) : "" };
}

/** stylesheet TWS ter-scope (sekali untuk semua slide di adegan); `web` = sedang dirender @remotion/web-renderer */
export function TwsStyle({ css, anim, web }: { css: string; anim?: string; web?: boolean }) {
  return <style>{`${css}\n${EXTRA_CSS}\n${web ? GRADE_WEB : ""}\n${anim ?? ""}`}</style>;
}

/** lapisan "Angka 3D" (div.big3d berisi SVG angka) dari HTML slide yang sudah disiapkan — untuk angka slam di level kanvas */
export function bigNumberHtml(html: string): string {
  const m = /<div data-layer="Angka 3D" class="big3d">[\s\S]*?<\/svg><\/div>/.exec(html);
  return m ? m[0] : "";
}

/** satu slide 1080×1350 (renderer asli) di skala `scale`; `cls` = kelas tambahan untuk animasi ber-scope */
export function TwsSlideView({ html, scale, cls, style }: { html: string; scale: number; cls?: string; style?: CSSProperties }) {
  return (
    <div style={{ width: SLIDE_W * scale, height: SLIDE_H * scale, position: "relative", overflow: "hidden", flex: "none", ...style }}>
      <div className={`${SCOPE}${cls ? ` ${cls}` : ""}`} style={{ position: "absolute", left: 0, top: 0, transform: `scale(${scale})`, transformOrigin: "0 0" }} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

/** alamat logo TWS lewat preset brand (website: /brand/tws-logo.svg, laptop: <public>/brand/tws-logo.svg) */
export function useTwsLogo(): string {
  const src = useSrc();
  return useMemo(() => src(TWS_LOGO), [src]);
}

// ---------------------------------------------------------------------------------------------
// Font & gambar siap sebelum frame diambil
// ---------------------------------------------------------------------------------------------
let fontsP: Promise<unknown> | null = null;
function waitFonts(): Promise<unknown> {
  if (typeof document === "undefined" || !document.fonts) return Promise.resolve();
  if (!fontsP) {
    const fam = "'Inter Tight Variable'";
    fontsP = Promise.all([
      document.fonts.load(`900 120px ${fam}`, "-11,57%"),
      document.fonts.load(`800 80px ${fam}`, "IHSG AMBRUK"),
      document.fonts.load(`600 34px ${fam}`, "Okt"),
      document.fonts.load(`400 28px ${fam}`, "MSCI"),
      document.fonts.load(`700 20px 'Inter Variable'`, "Slide"),
    ])
      .catch(() => undefined)
      .then(() => document.fonts.ready);
  }
  return fontsP;
}

/** hasil muat gambar per alamat (sekali per halaman; render browser memasang ulang adegan tiap frame still) */
const imgP = new Map<string, Promise<boolean>>();
/** true = gambar termuat & terdekode; false = gagal (404 / rusak) */
function loadImg(src: string): Promise<boolean> {
  if (typeof Image === "undefined" || !src) return Promise.resolve(true);
  let p = imgP.get(src);
  if (!p) {
    p = new Promise<boolean>((res) => {
      const im = new Image();
      im.onload = () => {
        // decode supaya gambar benar-benar siap digambar di frame pertama
        im.decode().then(() => res(true), () => res(true));
      };
      im.onerror = () => res(false);
      im.src = src;
    });
    imgP.set(src, p);
  }
  return p;
}

/**
 * Tahan frame sampai font Inter Tight & logo TWS siap (maks 8 dtk, lalu lanjut apa adanya).
 * Pakai useDelayRender (scope render yang sedang berjalan): delayRender/continueRender global hanya menahan render laptop,
 * @remotion/web-renderer (tombol Download MP4) punya scope sendiri. Handle dibuat di useLayoutEffect (bukan initializer
 * useState) dan dilepas di cleanup → aman di StrictMode, tidak ada handle bocor.
 * Kembalian: false bila logo GAGAL dimuat → pemanggil membuang <img> logo dari slide (img rusak membuat render browser
 * gagal saat drawImage, dan di laptop memunculkan ikon gambar rusak). Selama logo baik, keluaran render tidak berubah.
 */
export function useTwsReady(logoSrc: string): boolean {
  const { delayRender, continueRender } = useDelayRender();
  const [badLogo, setBadLogo] = useState<string | null>(null);
  const [checked, setChecked] = useState<string | null>(null);
  const handle = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (checked === logoSrc) return;
    const h = delayRender("TWS: font & logo", { timeoutInMilliseconds: 25000 });
    handle.current = h;
    let done = false;
    const finish = (logoOk: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(to);
      if (!logoOk) setBadLogo(logoSrc);
      // handle dilepas di efek di bawah, SETELAH slide (tanpa logo bila gagal) terpasang
      setChecked(logoSrc);
    };
    const to = setTimeout(() => finish(true), 8000);
    Promise.all([waitFonts(), loadImg(logoSrc)]).then(
      ([, ok]) => finish(ok),
      () => finish(true),
    );
    return () => {
      done = true;
      clearTimeout(to);
      if (handle.current === h) {
        handle.current = null;
        continueRender(h);
      }
    };
    // `checked` sengaja bukan dependensi: efek ini hanya mulai menunggu saat alamat logo berganti
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logoSrc, delayRender, continueRender]);

  useLayoutEffect(() => {
    if (checked === logoSrc && handle.current !== null) {
      const h = handle.current;
      handle.current = null;
      continueRender(h);
    }
  }, [checked, logoSrc, continueRender]);

  return badLogo !== logoSrc;
}
