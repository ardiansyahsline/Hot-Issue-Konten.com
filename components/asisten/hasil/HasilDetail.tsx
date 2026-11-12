import Link from "next/link";
import { linkVideo, rupiah, type ReviewResult } from "@/lib/asistenReview";
import {
  ChecklistView,
  CocokBadge,
  CondongAI,
  KeputusanBadge,
  MusikView,
  PipelineNote,
  RingkasCek,
  SaranBadge,
  SerahList,
  VisualView,
  cekList,
  detik,
  perluCekManusia,
} from "./Bits";
import UmpanBalik, { type FeedbackMine } from "./UmpanBalik";

const waktu = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }).format(new Date(iso)) : "-";
const BANDING: Record<string, string> = { dibatalkan: "Keputusan dibatalkan saat banding", dikuatkan: "Keputusan dikuatkan saat banding", menunggu: "Banding masih menunggu" };
const TAHAP: Record<string, string> = { unduh: "Unduh", frame: "Frame", asr: "Suara → teks", ocr: "Teks layar", musik: "Musik", visual: "Visual", hakim: "AI menilai" };

function Kotak({ judul, children, className = "" }: { judul: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card p-4 sm:p-5 ${className}`}>
      <h2 className="section-title mb-3">{judul}</h2>
      {children}
    </section>
  );
}

export type CatatanTim = { user_id: string; nama: string; agree: boolean; note: string };

/**
 * Isi halaman detail satu hasil AI (tanpa ambil data → bisa diuji di harness): checklist lengkap + bukti, musik, visual,
 * alasan, biaya/waktu per tahap, keputusan & banding, umpan balik (punyaku + catatan tim).
 */
export default function HasilDetail({ r, mine, counts, lain }: { r: ReviewResult; mine: FeedbackMine; counts: { setuju: number; tidak: number }; lain: CatatanTim[] }) {
  const list = cekList(r.checklist);
  const link = linkVideo(r.platform, r.platform_video_id);
  const tok = r.tokens ?? {};
  const tahap = Object.entries(r.stage_sec ?? {}).filter(([, v]) => typeof v === "number" && v >= 0);
  const maxTahap = Math.max(1, ...tahap.map(([, v]) => v));
  const cost = Number(r.cost_usd) || 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={r.run_id ? `/asisten-review?run=${r.run_id}` : "/asisten-review"} className="text-sm font-semibold text-orange-400 hover:underline">
          ← Kembali ke daftar
        </Link>
        {r.run_id && (
          <Link href={`/asisten-review/ringkasan?run=${r.run_id}`} className="text-xs font-semibold text-zinc-400 hover:text-zinc-200">
            📊 Ringkasan uji ini
          </Link>
        )}
      </div>

      <section className="card space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-display text-xl font-bold">Video #{r.video_id}</h2>
            <p className="mt-0.5 break-words text-sm text-zinc-400">
              {r.campaign_title || (r.campaign_id ? `Campaign ${r.campaign_id}` : "Campaign tidak diketahui")}
              {r.brand ? ` · ${r.brand}` : ""}
            </p>
          </div>
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer nofollow" referrerPolicy="no-referrer" className="btn-ghost px-3 py-1.5 text-xs">
              Buka video ↗
            </a>
          )}
        </div>
        <PipelineNote status={r.pipeline_status} error={r.error} />
        {r.ai_lean !== undefined && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
            <p className="label mb-1.5">Pendapat AI sendiri</p>
            <CondongAI lean={r.ai_lean} yakin={r.ai_lean_confidence} perluCek={perluCekManusia(r.suggestion)} akhir={r.final_truth} besar />
            <p className="mt-1.5 text-xs text-zinc-500">
              {r.ai_lean === "approve" || r.ai_lean === "reject"
                ? "Kalau AI harus memilih sendiri. Angka yakin = seberapa yakin AI pilihannya benar."
                : "AI tidak berpendapat karena gagal menilai, video tidak bisa dibuka, atau hasil ini dibuat sebelum fitur pendapat AI — AI tidak menebak."}
              {perluCekManusia(r.suggestion) && (r.ai_lean === "approve" || r.ai_lean === "reject") && " Tetap perlu dicek reviewer (alasannya di bawah)."}
            </p>
          </div>
        )}
        <dl className="grid grid-cols-2 gap-x-3 gap-y-3 text-xs sm:grid-cols-4">
          <div>
            <dt className="label mb-1">Saran akhir AI</dt>
            <dd>
              <SaranBadge saran={r.suggestion} yakin={r.confidence} />
            </dd>
          </div>
          <div>
            <dt className="label mb-1">Keputusan reviewer</dt>
            <dd className="space-y-0.5">
              <KeputusanBadge v={r.human_decision} />
              {r.reviewer && <p className="text-[11px] text-zinc-500">{r.reviewer}{r.decided_at ? ` · ${waktu(r.decided_at)}` : ""}</p>}
            </dd>
          </div>
          <div>
            <dt className="label mb-1">Hasil akhir</dt>
            <dd className="space-y-0.5">
              <KeputusanBadge v={r.final_truth} />
              {r.appeal && <p className="text-[11px] text-zinc-500">{BANDING[r.appeal]}</p>}
            </dd>
          </div>
          <div>
            <dt className="label mb-1">AI vs hasil akhir</dt>
            <dd>
              <CocokBadge match={r.match} saran={r.suggestion} />
            </dd>
          </div>
        </dl>
        {(r.official_reason || r.specific_reason) && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3 text-sm">
            <p className="label mb-1">Alasan AI</p>
            {r.official_reason && <p className="font-semibold">{r.official_reason}</p>}
            {r.specific_reason && <p className="mt-0.5 break-words text-zinc-300">{r.specific_reason}</p>}
          </div>
        )}
        {r.human_reason && (
          <p className="break-words text-xs text-zinc-400">
            Alasan reviewer: <span className="text-zinc-300">{r.human_reason}</span>
          </p>
        )}
        {!!r.handoff_reasons?.length && (
          <div>
            <p className="label mb-1">Kenapa diserahkan ke manusia</p>
            <SerahList list={r.handoff_reasons} />
          </div>
        )}
        <div className="border-t border-zinc-800 pt-3">
          <UmpanBalik resultId={r.id} mine={mine} counts={counts} />
          {lain.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {lain.map((x) => (
                <li key={x.user_id} className="break-words text-xs text-zinc-400">
                  <b className={x.agree ? "text-emerald-400" : "text-red-400"}>{x.agree ? "👍" : "👎"} {x.nama}</b>: {x.note}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <Kotak judul="Checklist brief">
        <div className="mb-3">
          <RingkasCek list={list} />
        </div>
        <ChecklistView list={list} />
      </Kotak>

      <div className="grid gap-4 lg:grid-cols-2">
        <Kotak judul="Musik campaign">
          <MusikView m={r.music} />
        </Kotak>
        <Kotak judul="Poster / trailer">
          <VisualView v={r.visual} />
          {typeof r.meta?.durasi_detik === "number" && (
            <p className="mt-3 text-xs text-zinc-400">
              Durasi video {detik(r.meta.durasi_detik)} · {r.meta.n_hashtag ?? 0} hashtag
              {typeof r.meta.n_frame === "number" ? ` · ${r.meta.n_frame} frame dinilai` : ""}
            </p>
          )}
        </Kotak>
      </div>

      <Kotak judul="Biaya & waktu">
        <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div>
            <dt className="label mb-0.5">Biaya AI</dt>
            <dd className="text-sm font-semibold">
              {rupiah(cost)} <span className="text-xs font-normal text-zinc-500">(${cost.toFixed(4)})</span>
            </dd>
          </div>
          <div>
            <dt className="label mb-0.5">Waktu total</dt>
            <dd className="text-sm font-semibold">{typeof r.process_sec === "number" ? `${Math.round(r.process_sec)} dtk` : "-"}</dd>
          </div>
          <div className="col-span-2">
            <dt className="label mb-0.5">Token</dt>
            <dd className="text-zinc-400">
              masuk {tok.input ?? 0} · keluar {tok.output ?? 0} · cache dibaca {tok.cache_read ?? 0} · cache ditulis {(tok.cache_write_1h ?? 0) + (tok.cache_write_5m ?? 0)}
            </dd>
          </div>
        </dl>
        {tahap.length > 0 && (
          <ul className="mt-3 space-y-1.5" aria-label="Waktu per tahap">
            {tahap.map(([k, v]) => (
              <li key={k} className="grid grid-cols-[88px_1fr_52px] items-center gap-2 text-xs">
                <span className="truncate text-zinc-400">{TAHAP[k] ?? k}</span>
                <span className="h-2 overflow-hidden rounded-full bg-zinc-800">
                  <span className="block h-full rounded-full bg-violet-500" style={{ width: `${Math.max(2, (v / maxTahap) * 100)}%` }} />
                </span>
                <span className="text-right tabular-nums text-zinc-400">{v.toFixed(1)} dtk</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[11px] text-zinc-500">
          Model {r.model ?? "-"} · rubrik {r.rubric_version ?? "-"}
          {r.rubric_hash ? ` (${r.rubric_hash})` : ""} · dinilai {waktu(r.created_at)}
        </p>
      </Kotak>
    </div>
  );
}
