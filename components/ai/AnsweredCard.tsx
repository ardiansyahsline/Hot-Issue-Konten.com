"use client";

/** jawaban kartu pertanyaan -> daftar pertanyaan & jawaban (dibaca dari pesan "📌 …" yang dikirim kartu) */
export function parseCardAnswer(text: string): { pairs: [string, string][]; skipped: boolean } | null {
  const t = text.trim();
  if (/^📌\s*Lewati pertanyaan/i.test(t)) return { pairs: [], skipped: true };
  const j = t.match(/^📌\s*Jawaban\s*—\s*([\s\S]+)$/i);
  if (j) {
    const pairs = j[1]
      .split(" · ")
      .map((part): [string, string] => {
        const i = part.indexOf(": ");
        return i > 0 ? [part.slice(0, i).trim(), part.slice(i + 2).trim()] : ["", part.trim()];
      })
      .filter(([, a]) => a);
    return { pairs, skipped: false };
  }
  // kartu pasar: "📌 Analisa BTCUSDT · Chart Pattern · TF 1H · Gaya Intraday · Tujuan Analisa kondisi"
  const m = t.match(/^📌\s*Analisa\s+(\S+)\s*·\s*([\s\S]+)$/i);
  if (m) {
    const parts = m[2].split(" · ").map((x) => x.trim());
    if (parts[0] === "langsung") return { pairs: [], skipped: true };
    const get = (k: string) => parts.find((x) => x.startsWith(`${k} `))?.slice(k.length + 1);
    const tf = get("TF");
    const style = get("Gaya");
    const goal = get("Tujuan");
    const how = parts.find((x) => !/^(TF|Gaya|Tujuan) /.test(x));
    const pairs: [string, string][] = [];
    if (goal) pairs.push(["Tujuan", goal]);
    if (how && how !== "Berita & sentimen") pairs.push(["Pendekatan", how]);
    if (tf) pairs.push(["Timeframe & gaya", `${tf}${style ? ` · ${style}` : ""}`]);
    return { pairs, skipped: false };
  }
  return null;
}

/**
 * Kartu yang sudah dijawab (gaya Claude): judul + semua pertanyaan dan jawabannya, ringkas & rapi.
 */
export default function AnsweredCard({ title, answer }: { title?: string; answer: { pairs: [string, string][]; skipped: boolean } }) {
  return (
    <div className="my-1 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900" style={{ boxShadow: "var(--shadow-sm)" }}>
      {title && <div className="border-b border-zinc-800/70 px-3.5 py-2 text-[12px] text-zinc-500">{title}</div>}
      {answer.skipped ? (
        <div className="flex items-center gap-2 px-3.5 py-2.5 text-[13px] text-zinc-400">
          <span className="text-zinc-500">↷</span> Pertanyaan dilewati — dikerjakan pakai asumsi terbaik
        </div>
      ) : (
        <ul className="divide-y divide-zinc-800/70">
          {answer.pairs.map(([q, a], i) => (
            <li key={i} className="flex items-start gap-2.5 px-3.5 py-2 text-[13px]">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-orange-500 text-[9px] font-bold text-white">✓</span>
              <span className="min-w-0">
                {q && <span className="block text-[12px] text-zinc-500">{q}</span>}
                <span className="block font-semibold">{a}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
