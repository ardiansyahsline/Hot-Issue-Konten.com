"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="my-3 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/70">
      <div className="flex items-center justify-between border-b border-zinc-800/80 px-3 py-1.5 text-[11.5px] text-zinc-500">
        <span>{lang === "srt" ? "subtitle (.srt)" : lang || "teks"}</span>
        <span className="ml-auto mr-3">
          {/* subtitle: bisa diunduh lalu diimpor ke CapCut */}
          {lang === "srt" && (
            <button
              type="button"
              onClick={() => {
                const url = URL.createObjectURL(new Blob([code.replace(/\r?\n/g, "\r\n")], { type: "application/x-subrip" }));
                const a = document.createElement("a");
                a.href = url;
                a.download = `subtitle-${new Date().toISOString().slice(0, 10)}.srt`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
              className="font-semibold text-orange-400 hover:text-orange-300"
            >
              ⬇ Unduh .srt
            </button>
          )}
        </span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(code).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="hover:text-zinc-200"
        >
          {copied ? "✓ Tersalin" : "⧉ Salin"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[12.5px] leading-relaxed">
        <code className="font-mono text-zinc-200">{code}</code>
      </pre>
    </div>
  );
}

/**
 * Tabel jawaban AI. Tidak pernah bikin geser kanan-kiri: kalau tidak muat di lebar layar (atau kolomnya banyak di layar HP),
 * otomatis tampil sebagai KARTU per baris — kolom pertama jadi judul kartu, kolom lain "LABEL  isi".
 */
export function AiTable({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [stacked, setStacked] = useState(false);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const table = el.querySelector("table");
      if (!table) return;
      // label tiap sel = judul kolomnya (dipakai tampilan kartu)
      const heads = Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent?.trim() ?? "");
      const rows = Array.from(table.querySelectorAll("tbody tr"));
      rows.forEach((tr) => Array.from(tr.children).forEach((td, i) => td.setAttribute("data-label", heads[i] ?? "")));
      // judul kolom angka ikut rata kanan, sejajar dengan angkanya
      table.querySelectorAll("thead th").forEach((th, i) => {
        const cells = rows.map((tr) => tr.children[i]).filter(Boolean);
        if (cells.length && cells.every((c) => c.classList.contains("ai-num"))) (th as HTMLElement).style.textAlign = "right";
      });
      // ukur dalam bentuk tabel biasa
      el.classList.remove("stacked");
      const w = el.clientWidth;
      const cols = heads.length;
      const over = table.scrollWidth > w + 1;
      const tooNarrow = (cols >= 4 && w < 560) || (cols >= 3 && w < 360);
      const next = over || tooNarrow;
      el.classList.toggle("stacked", next);
      setStacked(next);
    };
    fit();
    // hanya hitung ulang kalau LEBAR berubah (tinggi berubah karena ganti tampilan tidak dihitung)
    let lastW = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (Math.abs(el.clientWidth - lastW) < 1) return;
      lastW = el.clientWidth;
      fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  });
  return (
    <div ref={box} className={`ai-table${stacked ? " stacked" : ""}`}>
      <table>{children}</table>
    </div>
  );
}

const C: Components = {
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  h1: ({ children }) => <h3 className="mb-2 mt-4 text-[17px] font-bold first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mb-2 mt-4 text-[16px] font-bold first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mb-1.5 mt-3 text-[15px] font-semibold first:mt-0">{children}</h4>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer noopener" className="text-orange-400 underline underline-offset-2">
      {children}
    </a>
  ),
  blockquote: ({ children }) => <blockquote className="my-2 border-l-4 border-orange-500/60 pl-3 text-zinc-400">{children}</blockquote>,
  hr: () => <hr className="my-4 border-zinc-800" />,
  table: ({ children }) => <AiTable>{children}</AiTable>,
  th: ({ children }) => <th>{children}</th>,
  // sel berisi angka (harga, persen, rasio) -> rata kanan & tebal
  td: ({ children }) => <td className={isNumCell(children) ? "ai-num" : undefined}>{children}</td>,
  code: ({ className, children }) => {
    const text = String(children ?? "");
    const lang = /language-(\w+)/.exec(className ?? "")?.[1] ?? "";
    if (lang || text.includes("\n")) return <CodeBlock lang={lang} code={text.replace(/\n$/, "")} />;
    return <code className="rounded-md bg-zinc-800 px-1.5 py-0.5 font-mono text-[0.88em] text-orange-300">{children}</code>;
  },
  pre: ({ children }) => <>{children}</>,
};

/** Tampilkan jawaban AI (markdown: daftar, tabel, kode, dll.) */
/** teks sel tabel (rekursif) untuk mendeteksi sel angka */
const cellText = (n: unknown): string =>
  typeof n === "string" || typeof n === "number" ? String(n) : Array.isArray(n) ? n.map(cellText).join("") : n && typeof n === "object" && "props" in n ? cellText((n as { props?: { children?: unknown } }).props?.children) : "";
const isNumCell = (n: unknown) => {
  const t = cellText(n).trim();
  return !!t && t.length <= 28 && /\d/.test(t) && /^[\d.,+\-−–%x×:/→\s$Rp()~±≈]+$/i.test(t);
};

export default function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={C}>
      {text}
    </ReactMarkdown>
  );
}
