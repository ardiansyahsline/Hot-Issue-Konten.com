"use client";

import { useState } from "react";
import { C, colorFor, deckFileName, deckToPptx, type Deck, type DeckSlide } from "@/lib/deck";
import { saveToFolder, type DirHandle } from "@/lib/localFolder";

const hex = (c: string) => `#${c}`;
const tone = (t?: string) => (t === "green" ? hex(C.green) : t === "orange" ? hex(C.orange2) : t === "red" ? hex(C.red) : "#fff");

/** pratinjau 1 slide (gaya sama dengan PPT: hitam, angka hijau, aksen oranye) */
function Mini({ s, deck, i }: { s: DeckSlide; deck: Deck; i: number }) {
  const max = s.chart ? Math.max(1, ...s.chart.series.flatMap((x) => x.values)) : 1;
  const cover = s.type === "cover" || (i === 0 && s.type !== "kpi" && !s.chart && !s.table);
  return (
    <div className="flex aspect-video w-full flex-col overflow-hidden rounded-lg p-[5%] text-white" style={{ background: hex(C.bg), border: `1px solid ${hex(C.border)}`, fontSize: 9 }}>
      <div className="flex items-center justify-between border-b pb-[2%]" style={{ borderColor: hex(C.border) }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/konten-logo-report.png" alt="" className="h-[9px] w-auto" />
        <span style={{ color: hex(C.soft), fontSize: 7, letterSpacing: 1 }}>{(deck.label || "LAPORAN").toUpperCase()}</span>
      </div>
      {cover ? (
        <div className="flex flex-1 flex-col justify-center border-l-[3px] pl-[4%]" style={{ borderColor: hex(C.green) }}>
          <b style={{ fontSize: 16, lineHeight: 1.1 }}>{s.title || deck.title}</b>
          <span style={{ color: hex(C.soft), fontSize: 9 }}>{s.subtitle || deck.subtitle}</span>
          {deck.period && <span style={{ color: hex(C.green), fontSize: 8 }}>{deck.period}</span>}
        </div>
      ) : s.type === "section" ? (
        <div className="flex flex-1 flex-col justify-center">
          <b style={{ fontSize: 16, color: hex(C.green) }}>{s.title}</b>
          <span style={{ color: hex(C.muted), fontSize: 8 }}>{s.subtitle}</span>
        </div>
      ) : (
        <div className="mt-[3%] flex min-h-0 flex-1 flex-col gap-[3%]">
          <b style={{ fontSize: 11 }} className="truncate">
            {s.title}
          </b>
          <div className={`flex min-h-0 flex-1 gap-[3%] ${!s.chart && !s.table ? "flex-col" : ""}`}>
            {!!s.kpis?.length && (
              <div className={`grid gap-[4px] ${s.chart || s.table ? "w-[30%] grid-cols-1" : "grid-cols-3"}`} style={{ alignContent: "start" }}>
                {s.kpis.slice(0, s.chart || s.table ? 3 : 6).map((k) => (
                  <div
                    key={k.label}
                    className="rounded-[4px] px-[6px] py-[4px]"
                    style={{ background: k.tone === "orange" ? hex(C.orange) : hex(C.panel), border: `1px solid ${k.tone === "green" ? hex(C.greenDark) : k.tone === "orange" ? hex(C.orange) : hex(C.border)}` }}
                  >
                    <div style={{ fontSize: 6.5, color: k.tone === "orange" ? "#fff" : hex(C.muted) }} className="truncate">
                      {k.label}
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: k.tone === "orange" ? "#fff" : tone(k.tone) }} className="truncate">
                      {k.value}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {s.chart && (
              <div className="flex flex-1 items-end gap-[3px] rounded-[4px] p-[6px]" style={{ background: hex(C.panel), border: `1px solid ${hex(C.border)}` }}>
                {s.chart.kind === "pie" || s.chart.kind === "doughnut" ? (
                  <div
                    className="m-auto aspect-square h-[85%] rounded-full"
                    style={{
                      background: (() => {
                        const v = s.chart.series[0].values;
                        const tot = v.reduce((a, b) => a + b, 0) || 1;
                        let acc = 0;
                        return `conic-gradient(${v.map((x, j) => `${hex(colorFor(s.chart!.labels[j], j))} ${(acc / tot) * 360}deg ${((acc += x) / tot) * 360}deg`).join(",")})`;
                      })(),
                      WebkitMask: s.chart.kind === "doughnut" ? "radial-gradient(circle, transparent 38%, #000 39%)" : undefined,
                    }}
                  />
                ) : (
                  s.chart.labels.map((l, j) => (
                    <div key={l + j} className="flex h-full flex-1 items-end gap-[1px]">
                      {s.chart!.series.map((sr, k) => (
                        <div key={k} className="flex-1 rounded-t-[1px]" style={{ height: `${Math.max(2, (sr.values[j] / max) * 100)}%`, background: hex(s.chart!.series.length === 1 ? C.green : colorFor(sr.name, k)) }} />
                      ))}
                    </div>
                  ))
                )}
              </div>
            )}
            {s.table && (
              <div className="flex-1 overflow-hidden rounded-[4px]" style={{ border: `1px solid ${hex(C.border)}`, fontSize: 6.5 }}>
                {[s.table.columns, ...s.table.rows.slice(0, 7)].map((r, ri) => (
                  <div key={ri} className="flex" style={{ background: ri === 0 ? hex(C.panel2) : ri % 2 ? hex(C.bg) : hex(C.panel), color: ri === 0 ? hex(C.muted) : hex(C.soft) }}>
                    {r.map((c, ci) => (
                      <span key={ci} className="flex-1 truncate px-[3px] py-[1.5px]">
                        {String(c)}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            )}
            {!s.chart && !s.table && (!s.kpis?.length || s.bullets?.length) && s.bullets?.length ? (
              <ul className="flex-1 space-y-[2px]" style={{ color: hex(C.soft), fontSize: 7.5 }}>
                {s.bullets.slice(0, 6).map((b) => (
                  <li key={b} className="line-clamp-2">
                    • {b}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      )}
      <div className="flex justify-between pt-[1%]" style={{ fontSize: 6, color: hex(C.muted2) }}>
        <span className="truncate">{s.source ? `Sumber: ${s.source}` : deck.period}</span>
        <span>
          {i + 1} / {deck.slides.length}
        </span>
      </div>
    </div>
  );
}

/** Kartu laporan PPT: pratinjau slide + unduh / simpan ke folder laptop */
export default function DeckCard({ deck, root }: { deck: Deck; root: DirHandle | null }) {
  const [busy, setBusy] = useState<"" | "dl" | "save">("");
  const [msg, setMsg] = useState<string | null>(null);
  const name = deckFileName(deck);
  const build = async () => deckToPptx(deck);
  const download = async () => {
    setBusy("dl");
    setMsg(null);
    try {
      const blob = await build();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) {
      setMsg(`Gagal membuat PPT: ${(e as Error).message}`);
    } finally {
      setBusy("");
    }
  };
  const save = async () => {
    if (!root) return;
    setBusy("save");
    setMsg(null);
    try {
      const path = await saveToFolder(root, `Laporan/${name}`, await build());
      setMsg(`✓ Tersimpan di folder ${root.name}/${path}`);
    } catch (e) {
      setMsg(`Gagal menyimpan: ${(e as Error).message}`);
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="ai-card mt-3">
      <div className="ai-body">
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <b>📊 {deck.title}</b>
          <span className="text-[11.5px] text-zinc-500">
            {deck.slides.length} slide · gaya laporan Konten.com{deck.period ? ` · ${deck.period}` : ""}
          </span>
        </div>
        <div className="mt-3 flex snap-x gap-2 overflow-x-auto pb-2">
          {deck.slides.map((s, i) => (
            <div key={i} className="w-[220px] shrink-0 snap-start">
              <Mini s={s} deck={deck} i={i} />
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" onClick={download} disabled={!!busy} className="rounded-lg bg-orange-500 px-3.5 py-1.5 text-[12.5px] font-bold text-white disabled:opacity-60">
            {busy === "dl" ? "Menyusun PPT…" : "⬇ Unduh PowerPoint"}
          </button>
          {root && (
            <button type="button" onClick={save} disabled={!!busy} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-[12.5px] font-bold text-zinc-300 hover:border-zinc-500 disabled:opacity-60">
              {busy === "save" ? "Menyimpan…" : `💾 Simpan ke folder ${root.name}/Laporan`}
            </button>
          )}
          {msg && <span className={`text-[12px] ${msg.startsWith("✓") ? "text-emerald-400" : "text-red-400"}`}>{msg}</span>}
        </div>
        <p className="mt-1.5 text-[11px] text-zinc-500">Angka diambil dari file di folder (lihat “Sumber” di tiap slide) — cek sekali lagi sebelum dikirim. Bisa diedit bebas di PowerPoint / Google Slides.</p>
      </div>
    </div>
  );
}
