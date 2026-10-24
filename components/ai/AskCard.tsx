"use client";

import { useState } from "react";
import type { AskInfo } from "@/lib/analysisCard";

/** judul opsi sr/pattern/full tetap (dibaca server), deskripsinya bervariasi supaya tidak monoton */
const DESC: Record<string, string[]> = {
  sr: ["Level kunci, area entry / SL / TP paling jelas", "Cari area pantul & tembus — cocok buat entry rapi", "Zona harga yang sering diuji pasar, langsung jadi trade plan"],
  pattern: ["Double top, triangle, flag, trendline — digambar di chart", "Baca pola harga yang lagi terbentuk + target polanya", "Head & shoulders, wedge, channel — lengkap dengan garisnya"],
  full: ["Derivatif/fundamental, sentimen, berita + teknikal (lebih panjang)", "Ala analis pro: data, sentimen pasar, makro + level teknikal", "Bedah menyeluruh: berita, fundamental/derivatif, lalu skenario"],
};
const EXTRA = [
  { id: "extra", title: "Tren & Moving Average", desc: "Arah tren pakai MA20/50/200 + titik pullback" },
  { id: "extra", title: "Volume & Momentum", desc: "RSI, MACD & volume — kuat atau mulai lemah?" },
  { id: "extra", title: "Smart Money (SMC)", desc: "Order block, liquidity sweep & break of structure" },
  { id: "extra", title: "Fibonacci Retracement", desc: "Area koreksi 38,2–61,8% buat cari entry" },
];
const optionsFor = (info: AskInfo) => {
  const v = (info.v ?? 0) % 3;
  const base = [
    { id: "sr", title: "Support & Resistance", desc: DESC.sr[v] },
    { id: "pattern", title: "Chart Pattern", desc: DESC.pattern[v] },
    { id: "full", title: "Lengkap ala analis", desc: DESC.full[v] },
    EXTRA[(info.x ?? 0) % EXTRA.length],
  ];
  const rec = base.find((o) => o.id === (info.rec ?? "sr")) ?? base[0];
  // yang direkomendasikan ditaruh paling atas
  return [rec, ...base.filter((o) => o !== rec)].map((o) => ({ ...o, tag: o === rec ? "Disarankan" : undefined }));
};
const TFS = ["15m", "1H", "4H", "1D", "1W"];
/** gaya trading per timeframe (ditampilkan di tombol timeframe) */
const STYLE: Record<string, string> = { "15m": "Scalping", "1H": "Intraday", "4H": "Swing", "1D": "Swing", "1W": "Investasi" };
const GOALS = [
  { id: "entry", title: "Cari entry", desc: "Trade plan: entry, SL & TP digambar di chart" },
  { id: "kondisi", title: "Analisa kondisi", desc: "Arah tren, level penting & skenario naik/turun" },
  { id: "berita", title: "Berita & sentimen", desc: "Kabar terbaru & pengaruhnya ke harga" },
];

/**
 * Kotak pertanyaan sebelum analisa (gaya Claude): pilih pendekatan + timeframe, atau ketik sendiri.
 * Jawaban dikirim sebagai pesan "📌 Analisa … · pendekatan · TF …" supaya server tidak bertanya lagi.
 */
export default function AskCard({ title, info, disabled, onSubmit }: { title: string; info: AskInfo; disabled?: boolean; onSubmit: (text: string) => void }) {
  const stock = /^saham/.test(info.market);
  const initTf = TFS.find((t) => t.toLowerCase() === String(info.tf ?? "").toLowerCase()) ?? "1D";
  const OPTIONS = optionsFor(info);
  const [pick, setPick] = useState<string>(OPTIONS[0].id);
  const [tf, setTf] = useState(stock && !["1D", "1W"].includes(initTf) ? "1D" : initTf);
  const [other, setOther] = useState("");
  const [goal, setGoal] = useState(GOALS.find((g) => g.id === info.goal)?.id ?? "entry");
  const send = (skip = false) => {
    if (disabled) return;
    if (skip) return onSubmit(`📌 Analisa ${info.label} · langsung · TF ${tf}`);
    const o = OPTIONS.find((x) => x.id === pick);
    const custom = other.trim();
    const g = GOALS.find((x) => x.id === goal)!;
    const how = goal === "berita" ? "Berita & sentimen" : o && pick !== "other" ? o.title : "Pendekatan lain";
    onSubmit(`📌 Analisa ${info.label} · ${how}${custom ? ` (${custom.slice(0, 180)})` : ""} · TF ${tf} · Gaya ${STYLE[tf] ?? "Swing"} · Tujuan ${g.title}`);
  };
  return (
    <div className={`my-1 overflow-hidden rounded-2xl border border-zinc-800 ${disabled ? "opacity-60" : ""}`}>
      <div className="border-b border-zinc-800/70 px-3.5 py-3 text-[14px] font-bold">
        {title}
        <small className="mt-0.5 block text-[12px] font-medium text-zinc-500">{disabled ? "Sudah dijawab." : "Pilih tujuan, gaya & pendekatan — atau ketik sendiri."}</small>
      </div>
      <div className="border-b border-zinc-800/70 px-3.5 py-2.5 text-[12px] text-zinc-500">
        Tujuan
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {GOALS.map((g) => (
            <button
              key={g.id}
              type="button"
              disabled={disabled}
              onClick={() => setGoal(g.id)}
              className={`rounded-lg border px-2.5 py-1 text-[12px] font-semibold ${goal === g.id ? "border-orange-500 bg-orange-500/10 text-orange-500" : "border-zinc-800 hover:border-zinc-600"}`}
            >
              {g.title}
              {g.id === (info.goal ?? "entry") && <span className="ml-1 text-[10px] font-bold opacity-80">★</span>}
            </button>
          ))}
        </div>
        <span className="mt-1 block text-[11.5px]">{GOALS.find((g) => g.id === goal)?.desc}</span>
      </div>
      {goal !== "berita" && OPTIONS.map((o) => (
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
              {o.tag && <span className="ml-1.5 rounded-md bg-orange-500/15 px-1.5 py-px text-[10px] font-bold text-orange-500">{o.tag}</span>}
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
            if (e.target.value.trim() && pick === OPTIONS[0].id) setPick("other");
          }}
          onFocus={() => setPick("other")}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder='✍️ Lainnya… (mis. "scalping pakai volume")'
          className="input w-full border-dashed py-1.5 text-[12.5px]"
        />
      </div>
      <div className="px-3.5 py-2.5 text-[12px] text-zinc-500">
        Timeframe & gaya
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
                {t} <span className="font-medium opacity-70">· {STYLE[t]}</span>
              </button>
            );
          })}
        </div>
      </div>
      {!disabled && (
        <div className="flex items-center justify-between gap-2 border-t border-zinc-800/70 px-3.5 py-2.5">
          <button type="button" onClick={() => send(true)} className="rounded-xl border border-zinc-800 px-3 py-1.5 text-[12.5px] font-bold hover:border-zinc-600">
            Lewati, langsung kerjain
          </button>
          <button type="button" onClick={() => send()} className="rounded-xl bg-orange-600 px-3.5 py-1.5 text-[12.5px] font-bold text-white hover:bg-orange-500">
            Kirim →
          </button>
        </div>
      )}
    </div>
  );
}
