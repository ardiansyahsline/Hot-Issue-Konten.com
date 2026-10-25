"use client";

import { useEffect, useRef, useState } from "react";
import { SIZES, sanitizeDesign, type Design } from "@/lib/visual";

/**
 * Desain dari AI (blok ```design): HTML/CSS/SVG dirender di iframe sandbox (tanpa script, CSP ketat,
 * tidak bisa membaca data user), dicek otomatis (teks kepotong → dikecilkan, kontras rendah → ditandai),
 * lalu bisa diunduh PNG resolusi tinggi & HTML. Beberapa opsi → pilih satu → revisi bertahap.
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
        if (/Neue Montreal|Inter Variable|Plus Jakarta Sans Variable/i.test(fam) && !/italic/i.test((r as CSSFontFaceRule).style?.getPropertyValue("font-style") ?? "")) {
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

function buildDoc(d: Design, standalone = false) {
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
    `<div id="cs-art">${sanitizeDesign(d.html)}</div>`,
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

function Frame({ d, maxH, onReady }: { d: Design; maxH: number; onReady?: (doc: Document, c: Check) => void }) {
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
  const [doc] = useState(() => (typeof document === "undefined" ? "" : buildDoc(d)));
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

const fileName = (d: Design) => `desain-${d.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "konten"}-${d.size.replace(":", "x")}`;

async function savePng(doc: Document | null, d: Design) {
  const node = doc?.getElementById("cs-art");
  if (!node) throw new Error("desain belum siap");
  const { toBlob } = await import("html-to-image");
  const { w, h } = SIZES[d.size];
  const blob = await toBlob(node, { pixelRatio: 2, width: w, height: h, cacheBust: true, backgroundColor: "#0a0a0a" });
  if (!blob) throw new Error("gagal membuat PNG");
  download(blob, `${fileName(d)}.png`);
}
function saveHtml(d: Design) {
  download(new Blob([buildDoc(d, true)], { type: "text/html" }), `${fileName(d)}.html`);
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const btn = "rounded-lg border border-zinc-800 px-2.5 py-1 text-[12px] font-semibold hover:bg-zinc-800/60 disabled:opacity-50";

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

function Tile({ d, i, many, disabled, onSend }: { d: Design; i: number; many: boolean; disabled?: boolean; onSend: (t: string) => void }) {
  const docRef = useRef<Document | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [rev, setRev] = useState("");
  const { w, h } = SIZES[d.size];
  const revise = (t: string) => t.trim() && onSend(`✏️ Revisi desain "${d.name}": ${t.trim().slice(0, 300)}`);
  return (
    <div className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-950/40 p-2">
      <Frame d={d} maxH={many ? 300 : 520} onReady={(doc, c) => ((docRef.current = doc), setCheck(c))} />
      <div className={`mt-2 flex px-0.5 ${many ? "flex-col" : "flex-wrap items-center gap-x-2 gap-y-1"}`}>
        <b className={`min-w-0 text-[13px] leading-snug ${many ? "" : "flex-1"}`}>
          {many && <span className="mr-1 text-orange-500">{String.fromCharCode(65 + i)}.</span>}
          {d.name}
        </b>
        <span className="text-[11px] text-zinc-500">
          {SIZES[d.size].label} · {w * 2}×{h * 2}
        </span>
      </div>
      <div className="mt-1 px-0.5 text-[11.5px]">
        <CheckLine c={check} onFix={disabled ? undefined : (why) => revise(`rapikan: ${why}. Jangan ubah konsepnya.`)} />
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {many && (
          <button type="button" disabled={disabled} onClick={() => onSend(`📌 Pilih desain: ${String.fromCharCode(65 + i)}. ${d.name} — lanjut pakai yang ini`)} className="rounded-lg bg-orange-600 px-2.5 py-1 text-[12px] font-bold text-white hover:bg-orange-500 disabled:opacity-50">
            Pilih ini
          </button>
        )}
        <button
          type="button"
          disabled={busy || !check}
          className={btn}
          onClick={async () => {
            setBusy(true);
            setErr("");
            try {
              await savePng(docRef.current, d);
            } catch (e) {
              setErr(e instanceof Error ? e.message : "gagal");
            }
            setBusy(false);
          }}
        >
          {busy ? "⏳" : "⬇"} PNG
        </button>
        <button type="button" className={btn} onClick={() => saveHtml(d)}>
          ⬇ HTML
        </button>
      </div>
      {err && <p className="mt-1 text-[11.5px] text-red-400">{err}</p>}
      {!many && !disabled && (
        <div className="mt-2 space-y-1.5">
          <div className="flex flex-wrap gap-1.5">
            {["Ganti warna", "Teks lebih besar", "Lebih minimalis", d.size === "9:16" ? "Versi 1:1" : "Versi 9:16"].map((t) => (
              <button key={t} type="button" onClick={() => revise(t)} className="rounded-full border border-zinc-800 px-2.5 py-0.5 text-[11.5px] text-zinc-400 hover:border-orange-500/50 hover:text-zinc-100">
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
            placeholder="Revisi… mis. judul jadi 'Gajian Clipper Cair!', Enter"
            className="input w-full py-1.5 text-[12.5px]"
          />
        </div>
      )}
    </div>
  );
}

export default function DesignCard({ designs, disabled, onSend }: { designs: Design[]; disabled?: boolean; onSend: (t: string) => void }) {
  const many = designs.length > 1;
  const wide = designs.every((d) => SIZES[d.size].w > SIZES[d.size].h);
  return (
    <div className="my-2">
      {many && <div className="mb-1.5 text-[12px] text-zinc-500">🎨 {designs.length} opsi desain — pilih satu, lalu revisi sampai pas</div>}
      <div className={many ? `grid gap-2 ${wide ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2 sm:grid-cols-3"}` : ""}>
        {designs.map((d, i) => (
          <Tile key={`${i}-${d.name}-${d.html.length}`} d={d} i={i} many={many} disabled={disabled} onSend={onSend} />
        ))}
      </div>
    </div>
  );
}
