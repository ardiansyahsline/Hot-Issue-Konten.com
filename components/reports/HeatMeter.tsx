import { REPORT_HOT_THRESHOLD } from "@/lib/constants";
import { heatLevel } from "@/lib/utils";

const LABEL = ["1 laporan", "Mulai ramai", "HOT", "Makin HOT", "Membara"];

/** Meter panas topik: makin banyak laporan clipper untuk kasus yang sama, makin HOT */
export default function HeatMeter({ reports, contacts, last24h }: { reports: number; contacts: number; last24h: number }) {
  const lvl = heatLevel(reports);
  const steps = [REPORT_HOT_THRESHOLD, REPORT_HOT_THRESHOLD + 2, REPORT_HOT_THRESHOLD * 3];
  const hot = reports >= REPORT_HOT_THRESHOLD;
  return (
    <a
      href="#laporan"
      className={`flex items-center gap-3 rounded-2xl border px-4 py-3 transition hover:brightness-105 ${
        hot ? "border-red-500/25 bg-gradient-to-r from-orange-500/10 to-red-500/10" : "border-zinc-800/80 bg-zinc-950/30"
      }`}
    >
      <span className={`shrink-0 text-[24px] leading-none ${lvl === 0 ? "opacity-30 grayscale" : ""}`} aria-hidden>
        {"🔥".repeat(Math.max(1, lvl))}
      </span>
      <div className="min-w-0 flex-1">
        <div className={`text-[14px] font-bold ${hot ? "text-red-400" : "text-zinc-200"}`}>
          {reports} laporan · {LABEL[lvl]}
        </div>
        <div className="text-[12px] text-zinc-500">
          {contacts} kontak clipper{last24h > 0 ? ` · +${last24h} laporan dalam 24 jam` : ""} ·{" "}
          {hot ? `HOT otomatis sejak ${REPORT_HOT_THRESHOLD} laporan` : `HOT otomatis di ${REPORT_HOT_THRESHOLD} laporan (kurang ${REPORT_HOT_THRESHOLD - reports})`}
        </div>
        <div className="mt-2 flex h-1.5 gap-1">
          {steps.map((t, i) => (
            <span key={t} className={`flex-1 rounded-full ${reports >= t ? ["bg-amber-400", "bg-orange-500", "bg-red-600"][i] : "bg-zinc-800"}`} />
          ))}
        </div>
      </div>
    </a>
  );
}
