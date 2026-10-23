"use client";

import { useState } from "react";
import type { AskInfo } from "@/lib/analysisCard";

const OPTIONS = [
  { id: "sr", title: "Support & Resistance", desc: "Level kunci, area entry / SL / TP paling jelas", tag: "Disarankan" },
  { id: "pattern", title: "Chart Pattern", desc: "Double top, triangle, flag, trendline — digambar di chart" },
  { id: "full", title: "Lengkap ala analis", desc: "Derivatif/fundamental, sentimen, berita + teknikal (lebih panjang)" },
] as const;
const TFS = ["15m", "1H", "4H", "1D", "1W"];

/**
 * Kotak pertanyaan sebelum analisa (gaya Claude): pilih pendekatan + timeframe, atau ketik sendiri.
 * Jawaban dikirim sebagai pesan "📌 Analisa … · pendekatan · TF …" supaya server tidak bertanya lagi.
 */
export default function AskCard({ title, info, disabled, onSubmit }: { title: string; info: AskInfo; disabled?: boolean; onSubmit: (text: string) => void }) {
  const stock = /^saham/.test(info.market);
  const initTf = TFS.find((t) => t.toLowerCase() === String(info.tf ?? "").toLowerCase()) ?? "1D";
  const [pick, setPick] = useState<string>("sr");
  const [tf, setTf] = useState(stock && !["1D", "1W"].includes(initTf) ? "1D" : initTf);
  const [other, setOther] = useState("");
  const send = (skip = false) => {
    if (disabled) return;
    if (skip) return onSubmit(`📌 Analisa ${info.label} · langsung · TF ${tf}`);
    const o = OPTIONS.find((x) => x.id === pick);
    const custom = other.trim();
    onSubmit(`📌 Analisa ${info.label} · ${o && pick !== "other" ? o.title : "Pendekatan lain"}${custom ? ` (${custom.slice(0, 180)})` : ""} · TF ${tf}`);
  };
  return (
    <div className={`my-1 overflow-hidden rounded-2xl border border-zinc-800 ${disabled ? "opacity-60" : ""}`}>
      <div className="border-b border-zinc-800/70 px-3.5 py-3 text-[14px] font-bold">
        {title}
        <small className="mt-0.5 block text-[12px] font-medium text-zinc-500">{disabled ? "Sudah dijawab." : "Pilih satu, atau ketik sendiri."}</small>
      </div>
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          type="button"
          disabled={disabled}
          onClick={() => setPick(o.id)}
          className={`flex w-full items-start gap-2.5 border-b border-zinc-800/70 px-3.5 py-2.5 text-left text-[13px] ${pick === o.id ? "bg-orange-500/10" : "hover:bg-zinc-800/40"}`}
        >
          <span className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 ${pick === o.id ? "border-orange-500 bg-[radial-gradient(#ea580c_45%,transparent_50%)]" : "border-zinc-600"}`} />
          <span>
            <b className="block">
              {o.title}
              {"tag" in o && o.tag && <span className="ml-1.5 rounded-md bg-orange-500/15 px-1.5 py-px text-[10px] font-bold text-orange-500">{o.tag}</span>}
            </b>
            <span className="text-[12px] text-zinc-500">{o.desc}</span>
          </span>
        </button>
      ))}
      <div className="px-3.5 pt-2.5">
        <input
          value={other}
          disabled={disabled}
          onChange={(e) => {
            setOther(e.target.value);
            if (e.target.value.trim() && pick === "sr") setPick("other");
          }}
          onFocus={() => setPick("other")}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder='✍️ Lainnya… (mis. "scalping pakai volume")'
          className="input w-full border-dashed py-1.5 text-[12.5px]"
        />
      </div>
      <div className="px-3.5 py-2.5 text-[12px] text-zinc-500">
        Timeframe
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {TFS.map((t) => {
            const off = stock && !["1D", "1W"].includes(t);
            return (
              <button
                key={t}
                type="button"
                disabled={disabled || off}
                onClick={() => setTf(t)}
                title={off ? "Data intraday saham belum tersedia" : undefined}
                className={`rounded-lg border px-2.5 py-1 text-[12px] font-semibold ${tf === t ? "border-zinc-200 bg-zinc-200 text-zinc-900" : off ? "cursor-not-allowed border-zinc-800 text-zinc-700" : "border-zinc-800 hover:border-zinc-600"}`}
              >
                {t}
              </button>
            );
          })}
        </div>
      </div>
      {!disabled && (
        <div className="flex items-center justify-between gap-2 border-t border-zinc-800/70 px-3.5 py-2.5">
          <button type="button" onClick={() => send(true)} className="rounded-xl border border-zinc-800 px-3 py-1.5 text-[12.5px] font-bold hover:border-zinc-600">
            Lewati, analisa langsung
          </button>
          <button type="button" onClick={() => send()} className="rounded-xl bg-orange-600 px-3.5 py-1.5 text-[12.5px] font-bold text-white hover:bg-orange-500">
            Analisa →
          </button>
        </div>
      )}
    </div>
  );
}
