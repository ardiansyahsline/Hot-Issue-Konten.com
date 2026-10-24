"use client";

import PagedAsk from "./PagedAsk";
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
 * Kotak pertanyaan sebelum analisa pasar (gaya Claude, satu pertanyaan per halaman):
 * 1) tujuan → 2) pendekatan (dilewati kalau tujuannya berita) → 3) timeframe & gaya.
 * Jawaban dikirim sebagai pesan "📌 Analisa … · pendekatan · TF … · Gaya … · Tujuan …" supaya server tidak bertanya lagi.
 */
export default function AskCard({ title, info, disabled, onSubmit }: { title: string; info: AskInfo; disabled?: boolean; onSubmit: (text: string) => void }) {
  const stock = /^saham/.test(info.market);
  const initTf = TFS.find((t) => t.toLowerCase() === String(info.tf ?? "").toLowerCase()) ?? "1D";
  const recTf = stock && !["1D", "1W"].includes(initTf) ? "1D" : initTf;
  const OPTIONS = optionsFor(info);
  const recGoal = GOALS.find((g) => g.id === info.goal)?.id ?? "entry";
  const tfLabel = (t: string) => `${t} · ${STYLE[t]}`;
  const questions = [
    { q: "Tujuannya apa?", options: GOALS.map((g) => ({ label: g.title, desc: g.desc, rec: g.id === recGoal })) },
    { q: "Mau pakai pendekatan apa?", options: OPTIONS.map((o) => ({ label: o.title, desc: o.desc, rec: !!o.tag })), skip: (a: string[][]) => a[0][0] === "Berita & sentimen" },
    {
      q: "Timeframe & gaya trading-nya?",
      other: false,
      options: TFS.map((t) => ({
        label: tfLabel(t),
        rec: t === recTf,
        off: stock && !["1D", "1W"].includes(t),
        hint: "Data intraday saham belum tersedia",
      })),
    },
  ];
  const tfOf = (label?: string) => TFS.find((t) => label?.startsWith(`${t} `)) ?? recTf;
  return (
    <PagedAsk
      title={title}
      questions={questions}
      disabled={disabled}
      onSkip={() => onSubmit(`📌 Analisa ${info.label} · langsung · TF ${recTf}`)}
      onDone={(a) => {
        const goal = GOALS.find((g) => g.title === a[0][0]);
        const known = OPTIONS.find((o) => o.title === a[1][0]);
        const tf = tfOf(a[2][0]);
        // tujuan / pendekatan yang diketik sendiri ikut sebagai catatan dalam kurung (dibaca server)
        const notes = [goal ? "" : a[0][0], known || goal?.id === "berita" ? "" : a[1][0]].filter(Boolean).join("; ");
        const how = goal?.id === "berita" ? "Berita & sentimen" : known ? known.title : "Pendekatan lain";
        onSubmit(`📌 Analisa ${info.label} · ${how}${notes ? ` (${notes.slice(0, 180)})` : ""} · TF ${tf} · Gaya ${STYLE[tf] ?? "Swing"} · Tujuan ${goal?.title ?? "Analisa kondisi"}`);
      }}
    />
  );
}
