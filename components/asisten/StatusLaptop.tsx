"use client";

import Link from "next/link";
import { rupiah, type ReviewWorker } from "@/lib/asistenReview";
import { WORKER_STATUS_LABEL, latestWorker, workerOnline, type ArStatus } from "./statusTypes";
import { useArStatus } from "./useArStatus";

const agoText = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} dtk lalu`;
  if (s < 3600) return `${Math.floor(s / 60)} mnt lalu`;
  if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`;
  return `${Math.floor(s / 86400)} hari lalu`;
};

type Chip = { ok: boolean | null; text: string; title?: string };

/** kesiapan bagian-bagian laptop (dari info detak jantung) → chip kecil */
function chips(w: ReviewWorker): Chip[] {
  const i = w.info ?? {};
  const out: Chip[] = [];
  if (i.db) out.push({ ok: i.db === "ok" ? true : i.db === "belum_dicek" ? null : false, text: i.db === "ok" ? "DB Konten.com tersambung" : i.db === "belum_dicek" ? "DB belum dicek" : "DB tidak tersambung (VPN?)" });
  if (i.ai) out.push({ ok: i.ai === "ok", text: i.ai === "ok" ? "AI siap" : i.ai === "kunci_kosong" ? "Kunci AI kosong" : "AI gagal" });
  if (i.musik) out.push({ ok: i.musik === "tidak_ada" ? false : i.musik === "chroma" ? null : true, text: i.musik === "tidak_ada" ? "Cek musik mati" : `Musik: ${i.musik}`, title: "panako/olaf = sidik jari lagu; chroma = cadangan kasar" });
  if (i.ocr) out.push({ ok: i.ocr === "mati" ? false : i.ocr === "easyocr-cpu" ? null : true, text: i.ocr === "mati" ? "OCR mati" : i.ocr === "easyocr-gpu" ? "OCR GPU" : "OCR CPU (lambat)" });
  if (i.gpu?.nama) out.push({ ok: true, text: `${i.gpu.nama}${i.gpu.vram_gb ? ` · ${i.gpu.vram_gb} GB` : ""}` });
  if (i.rubric_version) out.push({ ok: null, text: `Rubrik ${i.rubric_version}` });
  return out;
}

/** isi status laptop (tanpa hook data — dipakai UjiPanel yang sudah memegang data) */
export function StatusLaptopView({ data, tick, compact = false }: { data: ArStatus; tick: number; compact?: boolean }) {
  const w = latestWorker(data.workers);
  const online = workerOnline(w, tick);
  const st = w?.info?.status;
  const busy = online && st && st !== "siap";
  const budget = w?.info?.budget;
  const dot = online ? (st === "berhenti_biaya" ? "bg-amber-400" : "bg-emerald-400") : "bg-zinc-500";
  const headline = !w
    ? "Laptop belum pernah tersambung"
    : online
      ? (st && WORKER_STATUS_LABEL[st]) || "Menyala"
      : "Laptop mati / tidak tersambung";
  return (
    <section className={`card ${compact ? "p-3" : "p-4 sm:p-5"}`} aria-label="Status laptop">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
          {busy && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${dot}`} />}
          <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${dot}`} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            💻 {headline}
            {w && <span className="ml-1.5 text-xs font-normal text-zinc-500">· detak {agoText(tick - Date.parse(w.last_seen))}</span>}
          </p>
          {!compact && !online && (
            <p className="mt-0.5 text-xs text-zinc-400">
              Nyalakan <b className="font-semibold text-zinc-300">NYALAKAN-ASISTEN-REVIEW.bat</b> di laptop (VPN tersambung). Pekerjaan yang diantrikan tetap
              tersimpan dan dikerjakan saat laptop menyala.
            </p>
          )}
        </div>
        <span className="text-xs text-zinc-400">
          Antrian: <b className="font-semibold text-zinc-200">{data.antri}</b> menunggu
        </span>
        {budget && typeof budget.usd_hari_ini === "number" && (
          <span
            className={`text-xs ${budget.batas > 0 && budget.usd_hari_ini >= budget.batas ? "text-amber-400" : "text-zinc-400"}`}
            title="Biaya AI hari ini (WIB) / batas harian REVIEW_DAILY_BUDGET_USD"
          >
            Biaya hari ini: <b className="font-semibold">${budget.usd_hari_ini.toFixed(2)}</b> / ${Number(budget.batas || 0).toFixed(2)} ({rupiah(budget.usd_hari_ini)})
          </span>
        )}
        {compact && (
          <Link href="/asisten-review/uji" className="btn-ghost px-3 py-1.5 text-xs">
            ▶️ Jalankan uji
          </Link>
        )}
      </div>
      {!compact && w && online && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {chips(w).map((c) => (
            <li
              key={c.text}
              title={c.title}
              className={`badge ${c.ok === true ? "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30" : c.ok === false ? "bg-red-500/10 text-red-300 ring-red-500/30" : "bg-zinc-800 text-zinc-300 ring-zinc-700"}`}
            >
              {c.text}
            </li>
          ))}
        </ul>
      )}
      {data.error && <p className="mt-2 text-xs text-amber-400">Status antrian gagal dibaca. Muat ulang halaman sebentar lagi.</p>}
    </section>
  );
}

/** strip status ringkas (halaman Hasil): data sendiri, realtime */
export default function StatusLaptop({ initial, compact = true }: { initial: ArStatus; compact?: boolean }) {
  const { data, tick } = useArStatus(initial);
  return <StatusLaptopView data={data} tick={tick} compact={compact} />;
}
