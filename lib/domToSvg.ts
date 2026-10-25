/**
 * Ubah desain yang sudah dirender (DOM di iframe) jadi file SVG "siap Figma":
 * - teks tetap TEKS (<text>, bisa diedit), bukan gambar; huruf besar/kecil, jarak huruf, warna & gradasi ikut
 * - elemen dengan data-layer jadi grup bernama (Logo, Judul, Sorotan, Angka 3D, Foto Tokoh, Latar, …) -> nama layer di Figma
 * - gambar ditanam di file (data URL), kotak/warna/gradasi/border jadi bentuk vektor, bayangan teks jadi lapisan (efek 3D)
 * Yang tidak didukung SVG/Figma (blur, filter) dilewati supaya file tetap bersih.
 */

type Ctx = { win: Window; ox: number; oy: number; defs: string[]; id: number; imgs: Map<string, { i: number; p: Promise<string> }>; used: Set<string>; names: Map<string, number>; base: string };

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n2 = (v: number) => Math.round(v * 100) / 100;

/** "rgba(1, 2, 3, 0.5)" -> { c: "rgb(1,2,3)", a: 0.5 } */
function color(s: string): { c: string; a: number } | null {
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (!m) return s === "transparent" ? null : { c: s, a: 1 };
  const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  const a = p.length > 3 ? p[3] : 1;
  return a <= 0 ? null : { c: `rgb(${p[0]},${p[1]},${p[2]})`, a };
}
const fillAttr = (c: { c: string; a: number }, attr = "fill") => `${attr}="${c.c}"${c.a < 1 ? ` ${attr}-opacity="${n2(c.a)}"` : ""}`;

/** pisah koma tingkat atas (tidak di dalam kurung) */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** gradasi CSS -> <linearGradient>/<radialGradient> di defs; kembalikan id */
function gradient(ctx: Ctx, css: string, box: { x: number; y: number; w: number; h: number }, mask = false): string | null {
  const lin = css.match(/^(repeating-)?linear-gradient\(([\s\S]*)\)$/);
  const rad = css.match(/^radial-gradient\(([\s\S]*)\)$/);
  if (!lin && !rad) return null;
  const args = splitTop((lin ? lin[2] : rad![1]) ?? "");
  let angle = 180;
  if (lin && args[0] && /deg|turn|^to /.test(args[0])) {
    const a = args.shift()!;
    if (a.endsWith("turn")) angle = parseFloat(a) * 360;
    else if (a.startsWith("to ")) angle = { "to top": 0, "to right": 90, "to bottom": 180, "to left": 270, "to top right": 45, "to bottom right": 135, "to bottom left": 225, "to top left": 315 }[a] ?? 180;
    else angle = parseFloat(a);
  }
  let rcx = 50, rcy = 50;
  if (rad && args[0] && !/^rgb|^#|^[a-z]+$/.test(args[0])) {
    const at = args.shift()!.match(/at\s+([\d.]+)%\s+([\d.]+)%/);
    if (at) (rcx = +at[1]), (rcy = +at[2]);
  }
  const stops = args
    .map((st, i, all) => {
      const m = st.match(/^(rgba?\([^)]+\)|#[0-9a-f]+|[a-z]+)\s*([\d.]+%)?/i);
      if (!m) return "";
      const c = color(m[1]) ?? { c: "rgb(0,0,0)", a: 0 };
      const off = m[2] ? parseFloat(m[2]) : (i / Math.max(1, all.length - 1)) * 100;
      return mask ? `<stop offset="${n2(off)}%" stop-color="#fff" stop-opacity="${n2(c.a)}"/>` : `<stop offset="${n2(off)}%" stop-color="${c.c}"${c.a < 1 ? ` stop-opacity="${n2(c.a)}"` : ""}/>`;
    })
    .join("");
  const id = `g${++ctx.id}`;
  if (rad) {
    ctx.defs.push(`<radialGradient id="${id}" cx="${rcx}%" cy="${rcy}%" r="75%" fx="${rcx}%" fy="${rcy}%">${stops}</radialGradient>`);
    return id;
  }
  const t = (angle * Math.PI) / 180;
  const dx = Math.sin(t), dy = -Math.cos(t);
  const L = Math.abs(box.w * dx) + Math.abs(box.h * dy);
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  ctx.defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n2(cx - (dx * L) / 2)}" y1="${n2(cy - (dy * L) / 2)}" x2="${n2(cx + (dx * L) / 2)}" y2="${n2(cy + (dy * L) / 2)}">${stops}</linearGradient>`);
  return id;
}

/** ambil gambar -> data URL (ditanam di file SVG); kembalikan penanda yang nanti diganti isi gambarnya */
function ref(ctx: Ctx, src: string): string {
  const abs = src.startsWith("data:") ? src : new URL(src, ctx.base).href;
  if (!ctx.imgs.has(abs)) {
    const p = abs.startsWith("data:")
      ? Promise.resolve(abs)
      : fetch(abs)
          .then((r) => (r.ok ? r.blob() : Promise.reject()))
          .then(
            (b) =>
              new Promise<string>((res) => {
                const fr = new FileReader();
                fr.onload = () => res(String(fr.result));
                fr.readAsDataURL(b);
              })
          )
          .catch(() => "");
    ctx.imgs.set(abs, { i: ctx.imgs.size, p });
  }
  return `__IMG_${ctx.imgs.get(abs)!.i}__`;
}

function layerName(ctx: Ctx, el: Element): string | null {
  const n = el.getAttribute("data-layer");
  if (!n) return null;
  const k = (ctx.names.get(n) ?? 0) + 1;
  ctx.names.set(n, k);
  return k === 1 ? n : `${n} ${k}`;
}

const fontName = (f: string) => {
  const first = f.split(",")[0].trim().replace(/^["']|["']$/g, "");
  return first.replace(/\s+Variable$/i, "");
};

let measure: CanvasRenderingContext2D | null = null;
function ascent(font: string, size: number): number {
  measure ??= document.createElement("canvas").getContext("2d");
  if (!measure) return size * 0.8;
  measure.font = font;
  const m = measure.measureText("Hg");
  return m.fontBoundingBoxAscent ?? size * 0.8;
}

function transformText(t: string, tt: string) {
  return tt === "uppercase" ? t.toUpperCase() : tt === "lowercase" ? t.toLowerCase() : tt === "capitalize" ? t.replace(/\b\w/g, (c) => c.toUpperCase()) : t;
}

/** baris-baris teks dari satu text node (dikelompokkan per posisi baris di layar) */
function textLines(ctx: Ctx, node: Text, st: CSSStyleDeclaration, el: Element): string {
  const raw = node.textContent ?? "";
  if (!raw.trim()) return "";
  const doc = node.ownerDocument;
  const lines: { top: number; left: number; h: number; words: string[] }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const range = doc.createRange();
    range.setStart(node, m.index);
    range.setEnd(node, m.index + m[0].length);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0);
    if (!rects.length) continue;
    // kata yang terpotong ke baris berikutnya (jarang) -> pakai potongan pertama
    const r = rects[0];
    const line = lines.find((l) => Math.abs(l.top - r.top) < Math.max(3, r.height * 0.3));
    if (line) line.words.push(m[0]);
    else lines.push({ top: r.top, left: r.left, h: r.height, words: [m[0]] });
  }
  if (!lines.length) return "";
  const size = parseFloat(st.fontSize);
  const family = fontName(st.fontFamily);
  ctx.used.add(family);
  const weight = st.fontWeight;
  const ls = st.letterSpacing === "normal" ? 0 : parseFloat(st.letterSpacing);
  const asc = ascent(`${st.fontStyle} ${weight} ${size}px ${st.fontFamily}`, size);
  // warna: biasa, atau gradasi (background-clip: text)
  const clipText = (st.webkitBackgroundClip || st.backgroundClip) === "text";
  const box = el.getBoundingClientRect();
  let fill = "";
  if (clipText && st.backgroundImage.startsWith("linear-gradient")) {
    const id = gradient(ctx, st.backgroundImage, { x: box.left - ctx.ox, y: box.top - ctx.oy, w: box.width, h: box.height });
    fill = id ? `fill="url(#${id})"` : `fill="#fff"`;
  } else {
    const c = color(st.color);
    if (!c) return "";
    fill = fillAttr(c);
  }
  const attrs = `font-family="${esc(family)}" font-size="${n2(size)}" font-weight="${weight}"${st.fontStyle === "italic" ? ' font-style="italic"' : ""}${ls ? ` letter-spacing="${n2(ls)}"` : ""} xml:space="preserve"`;
  const rows = lines.map((l) => ({ x: n2(l.left - ctx.ox), y: n2(l.top - ctx.oy + asc), t: esc(transformText(l.words.join(" "), st.textTransform)) }));
  const txt = (f: string, dx = 0, dy = 0) => rows.map((r) => `<text x="${n2(r.x + dx)}" y="${n2(r.y + dy)}" ${attrs} ${f}>${r.t}</text>`).join("");
  // bayangan teks (angka 3D = tumpukan bayangan) digambar di bawah teks
  let shadows = "";
  if (st.textShadow && st.textShadow !== "none") {
    const list = splitTop(st.textShadow).reverse();
    for (const sh of list) {
      const cm = sh.match(/rgba?\([^)]+\)|#[0-9a-f]+/i);
      const nums = sh.replace(cm?.[0] ?? "", "").trim().split(/\s+/).map(parseFloat);
      const c = cm ? color(cm[0]) : null;
      if (!c || nums.length < 2) continue;
      const blur = nums[2] || 0;
      if (blur > 12) continue; // bayangan lebar/glow: dilewati (berat & tidak didukung rapi di Figma)
      shadows += txt(fillAttr(c), nums[0], nums[1]);
    }
  }
  return shadows ? `<g>${shadows}${txt(fill)}</g>` : txt(fill);
}

/** sudut membulat (px atau %, mis. border-radius:50% = lingkaran) */
function radius(st: CSSStyleDeclaration, w: number, h: number) {
  const v = st.borderTopLeftRadius.split(" ")[0] ?? "0";
  const r = v.endsWith("%") ? (parseFloat(v) / 100) * Math.min(w, h) : parseFloat(v) || 0;
  return Math.min(r, w / 2, h / 2);
}

function paintBox(ctx: Ctx, el: Element, st: CSSStyleDeclaration, b: { x: number; y: number; w: number; h: number }): string {
  let out = "";
  const rx = radius(st, b.w, b.h);
  const rect = (attrs: string) => `<rect x="${n2(b.x)}" y="${n2(b.y)}" width="${n2(b.w)}" height="${n2(b.h)}"${rx ? ` rx="${n2(rx)}"` : ""} ${attrs}/>`;
  const bg = color(st.backgroundColor);
  const clipText = (st.webkitBackgroundClip || st.backgroundClip) === "text";
  if (bg && !clipText) out += rect(fillAttr(bg));
  if (st.backgroundImage && st.backgroundImage !== "none" && !clipText) {
    for (const layer of splitTop(st.backgroundImage).reverse()) {
      const u = layer.match(/^url\(["']?(.*?)["']?\)$/);
      if (u) {
        const fit = st.backgroundSize === "contain" ? "meet" : "slice";
        out += `<image x="${n2(b.x)}" y="${n2(b.y)}" width="${n2(b.w)}" height="${n2(b.h)}" preserveAspectRatio="xMidYMid ${fit}" href="${ref(ctx, u[1])}"/>`;
      } else {
        const id = gradient(ctx, layer, b);
        if (id) out += rect(`fill="url(#${id})"`);
      }
    }
  }
  const bw = parseFloat(st.borderTopWidth) || 0;
  const bc = color(st.borderTopColor);
  if (bw > 0 && bc && st.borderTopStyle !== "none" && st.borderTopWidth === st.borderBottomWidth && st.borderLeftWidth === st.borderTopWidth) out += rect(`fill="none" ${fillAttr(bc, "stroke")} stroke-width="${n2(bw)}"`);
  else if (bw > 0 && bc && st.borderTopStyle !== "none") out += `<line x1="${n2(b.x)}" y1="${n2(b.y + bw / 2)}" x2="${n2(b.x + b.w)}" y2="${n2(b.y + bw / 2)}" ${fillAttr(bc, "stroke")} stroke-width="${n2(bw)}"/>`;
  return out;
}

function walk(ctx: Ctx, el: Element): string {
  const st = ctx.win.getComputedStyle(el);
  if (st.display === "none" || st.visibility === "hidden") return "";
  const op = parseFloat(st.opacity);
  if (op === 0) return "";
  const r = el.getBoundingClientRect();
  const b = { x: r.left - ctx.ox, y: r.top - ctx.oy, w: r.width, h: r.height };
  const tag = el.tagName.toLowerCase();
  let body = "";

  if (tag === "img") {
    const img = el as HTMLImageElement;
    if (!img.currentSrc && !img.src) return "";
    const href = ref(ctx, img.currentSrc || img.src);
    const fit = st.objectFit === "cover" ? "xMidYMid slice" : st.objectFit === "contain" ? "xMidYMid meet" : "none";
    body = `<image x="${n2(b.x)}" y="${n2(b.y)}" width="${n2(b.w)}" height="${n2(b.h)}" preserveAspectRatio="${fit}" href="${href}"/>`;
  } else if (tag === "svg") {
    const clone = el.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("x", String(n2(b.x)));
    clone.setAttribute("y", String(n2(b.y)));
    clone.setAttribute("width", String(n2(b.w)));
    clone.setAttribute("height", String(n2(b.h)));
    clone.removeAttribute("class");
    clone.removeAttribute("style");
    body = new XMLSerializer().serializeToString(clone).replace(/ xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, "");
  } else {
    body = paintBox(ctx, el, st, b);
    const statics: string[] = [];
    const positioned: { z: number; i: number; s: string }[] = [];
    Array.from(el.childNodes).forEach((c, i) => {
      if (c.nodeType === 3) statics.push(textLines(ctx, c as Text, st, el));
      else if (c.nodeType === 1 && !["style", "script", "title"].includes((c as Element).tagName.toLowerCase())) {
        const cs = ctx.win.getComputedStyle(c as Element);
        const s = walk(ctx, c as Element);
        if (cs.position !== "static") positioned.push({ z: cs.zIndex === "auto" ? 0 : Number(cs.zIndex), i, s });
        else statics.push(s);
      }
    });
    positioned.sort((a, c) => a.z - c.z || a.i - c.i);
    let kids = positioned.filter((p) => p.z < 0).map((p) => p.s).join("") + statics.join("") + positioned.filter((p) => p.z >= 0).map((p) => p.s).join("");
    // potong isi yang keluar kotak (overflow hidden) & pinggiran memudar (mask-image)
    if (kids && (st.overflow === "hidden" || st.overflowX === "hidden" || st.overflow === "clip")) {
      const id = `c${++ctx.id}`;
      const rx = radius(st, b.w, b.h);
      ctx.defs.push(`<clipPath id="${id}"><rect x="${n2(b.x)}" y="${n2(b.y)}" width="${n2(b.w)}" height="${n2(b.h)}"${rx ? ` rx="${n2(rx)}"` : ""}/></clipPath>`);
      kids = `<g clip-path="url(#${id})">${kids}</g>`;
    }
    body += kids;
  }
  const mi = (st as CSSStyleDeclaration & { webkitMaskImage?: string }).webkitMaskImage || st.maskImage;
  if (body && mi && mi !== "none") {
    const gid = gradient(ctx, mi, b, true);
    if (gid) {
      const id = `m${++ctx.id}`;
      ctx.defs.push(`<mask id="${id}" maskUnits="userSpaceOnUse" x="${n2(b.x)}" y="${n2(b.y)}" width="${n2(b.w)}" height="${n2(b.h)}"><rect x="${n2(b.x)}" y="${n2(b.y)}" width="${n2(b.w)}" height="${n2(b.h)}" fill="url(#${gid})"/></mask>`);
      body = `<g mask="url(#${id})">${body}</g>`;
    }
  }
  if (!body) return "";
  const name = layerName(ctx, el);
  if (name || op < 1) return `<g${name ? ` id="${esc(name)}" data-name="${esc(name)}"` : ""}${op < 1 ? ` opacity="${n2(op)}"` : ""}>${body}</g>`;
  return body;
}

/** desain (elemen kanvas di iframe) -> teks file SVG + daftar font yang dipakai */
export async function domToSvg(root: HTMLElement, w: number, h: number, title: string): Promise<{ svg: string; fonts: string[] }> {
  const doc = root.ownerDocument;
  const win = doc.defaultView!;
  const rr = root.getBoundingClientRect();
  const ctx: Ctx = { win, ox: rr.left, oy: rr.top, defs: [], id: 0, imgs: new Map(), used: new Set(), names: new Map(), base: doc.baseURI };
  await doc.fonts?.ready;
  let body = walk(ctx, root);
  const srcs = await Promise.all(Array.from(ctx.imgs.values()).map((x) => x.p));
  srcs.forEach((src, i) => (body = body.split(`__IMG_${i}__`).join(src)));
  // gambar yang gagal diambil -> dibuang supaya file tetap valid
  body = body.replace(/<image [^>]*href=""\/>/g, "");
  const fonts = Array.from(ctx.used).filter(Boolean);
  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `<title>${esc(title)}</title>`,
    `<desc>Dibuat CS Tracker. Teks masih bisa diedit. Font yang dipakai (install dulu supaya tampilan sama): ${esc(fonts.join(", "))}.</desc>`,
    `<defs>${ctx.defs.join("")}</defs>`,
    `<g id="${esc(title)}" data-name="${esc(title)}">${body}</g>`,
    `</svg>`,
  ].join("\n");
  return { svg: svg.replace(/Inter Tight Variable/g, "Inter Tight").replace(/Plus Jakarta Sans Variable/g, "Plus Jakarta Sans").replace(/Inter Variable/g, "Inter"), fonts: fonts.map((f) => f.replace(/\s+Variable$/i, "")) };
}

/** tautan unduh font gratis untuk nama font yang dipakai */
export const FONT_LINKS: Record<string, string> = {
  "Inter Tight": "https://fonts.google.com/specimen/Inter+Tight",
  Inter: "https://fonts.google.com/specimen/Inter",
  "Plus Jakarta Sans": "https://fonts.google.com/specimen/Plus+Jakarta+Sans",
  "Neue Montreal": "https://pangrampangram.com/products/neue-montreal",
};
