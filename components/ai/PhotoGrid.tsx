"use client";

import { useEffect, useState } from "react";
import { withUtm, type PhotoAsk } from "@/lib/visual";

/**
 * Grid FOTO ASLI dari internet (blok ```photos) — bukan buatan AI.
 * Unsplash/Pexels: kredit fotografer + link, gambar di-hotlink, unduhan Unsplash dilaporkan (aturan API).
 * Foto web umum: label "cek hak cipta sebelum dipakai" dan tidak ditawarkan untuk dimasukkan ke desain.
 */
type Photo = {
  id: string;
  thumb: string;
  full: string;
  page: string;
  author: string;
  authorUrl?: string;
  alt?: string;
  provider: "unsplash" | "pexels" | "web";
  license: string;
  download?: string;
};
type Res = { query: string; source: string; items: Photo[]; note?: string };

const PROV = { unsplash: "Unsplash", pexels: "Pexels", web: "Web" } as const;
const HOME = { unsplash: "https://unsplash.com/", pexels: "https://www.pexels.com/" } as const;

export default function PhotoGrid({ ask, disabled, onSend }: { ask: PhotoAsk; disabled?: boolean; onSend: (t: string) => void }) {
  const [res, setRes] = useState<Res | null>(null);
  const [fail, setFail] = useState(false);
  const [broken, setBroken] = useState<Set<string>>(new Set());
  useEffect(() => {
    let off = false;
    fetch(`/api/ai/photos?q=${encodeURIComponent(ask.query)}&n=${ask.count}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j: Res) => !off && setRes(j))
      .catch(() => !off && setFail(true));
    return () => {
      off = true;
    };
  }, [ask.query, ask.count]);

  const items = (res?.items ?? []).filter((p) => !broken.has(p.id));
  const stock = items.some((p) => p.provider !== "web");

  const save = async (p: Photo) => {
    // aturan Unsplash: laporkan unduhan lewat endpoint download (lewat server, kunci tidak pernah ke browser)
    if (p.provider === "unsplash" && p.download) fetch(`/api/ai/photos?track=${encodeURIComponent(p.download)}`).catch(() => {});
    try {
      const r = await fetch(p.full, { mode: "cors" });
      if (!r.ok) throw new Error();
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `foto-${ask.query.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${p.author.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.jpg`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch {
      window.open(p.full, "_blank", "noopener,noreferrer");
    }
  };

  if (!res && !fail)
    return (
      <div className="my-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {Array.from({ length: Math.min(ask.count, 6) }, (_, i) => (
          <div key={i} className="aspect-[4/3] animate-pulse rounded-xl bg-zinc-800/60" />
        ))}
      </div>
    );

  if (!items.length)
    return (
      <div className="my-2 rounded-xl border border-dashed border-zinc-800 px-3 py-2.5 text-[12.5px] text-zinc-400">
        📷 Foto asli untuk “{ask.query}” belum ketemu{res?.note ? ` (${res.note})` : ""}.
        {!disabled && (
          <button type="button" onClick={() => onSend(`📌 Foto asli nggak ketemu — gambarin ilustrasi SVG aja: ${ask.query}`)} className="ml-2 font-semibold text-orange-500 hover:text-orange-400">
            Bikin ilustrasi SVG →
          </button>
        )}
      </div>
    );

  return (
    <div className="my-2">
      <div className="mb-1.5 text-[12px] text-zinc-500">
        📷 Foto asli dari internet ({PROV[items[0].provider]}) · bukan dibuat AI{!stock && " · cek hak cipta sebelum dipakai"}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map((p) => (
          <figure key={p.id} className="group min-w-0 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/40">
            <a href={p.provider === "web" ? p.page : withUtm(p.page)} target="_blank" rel="noopener noreferrer" className="block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.thumb}
                alt={p.alt || ask.query}
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={() => setBroken((b) => new Set(b).add(p.id))}
                className="aspect-[4/3] w-full object-cover transition group-hover:opacity-90"
              />
            </a>
            <figcaption className="space-y-1 px-2 py-1.5 text-[11px] leading-snug">
              <div className="truncate text-zinc-300">
                {p.provider === "web" ? (
                  <>
                    Sumber:{" "}
                    <a href={p.page} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
                      {p.author}
                    </a>
                  </>
                ) : (
                  <>
                    📷{" "}
                    <a href={withUtm(p.authorUrl || p.page)} target="_blank" rel="noopener noreferrer" className="font-semibold underline-offset-2 hover:underline">
                      {p.author}
                    </a>{" "}
                    di{" "}
                    <a href={withUtm(HOME[p.provider])} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
                      {PROV[p.provider]}
                    </a>
                  </>
                )}
              </div>
              <div className={`truncate ${p.provider === "web" ? "text-amber-500" : "text-emerald-500"}`}>{p.license}</div>
              <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 pt-0.5 text-zinc-500">
                <button type="button" onClick={() => save(p)} className="hover:text-zinc-200">
                  ⬇ Unduh
                </button>
                {p.provider !== "web" && !disabled && (
                  <button type="button" onClick={() => onSend(`📌 Pakai foto ini di desain: ${p.full} · Foto: ${p.author} / ${PROV[p.provider]}`)} className="hover:text-zinc-200">
                    🎨 Pakai di desain
                  </button>
                )}
              </div>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
