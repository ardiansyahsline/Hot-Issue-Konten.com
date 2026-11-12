import Link from "next/link";
import { linkVideo, type HasilMusik, type KodeSerah, type Keputusan, type Saran } from "@/lib/asistenReview";
import { ChecklistView, CocokBadge, KeputusanBadge, MusikRingkas, PipelineNote, RingkasCek, SaranBadge, SerahList, cekList } from "./Bits";
import UmpanBalik, { type FeedbackMine } from "./UmpanBalik";

/** kolom review_results yang dibutuhkan kartu daftar (tanpa token / tahap / visual) */
export const KARTU_COLS =
  "id, scope, run_id, job_id, video_id, platform, platform_video_id, campaign_id, campaign_title, brand, rubric_version, pipeline_status, suggestion, confidence, official_reason, specific_reason, handoff_reasons, checklist, music, human_decision, human_reason, reviewer, appeal, final_truth, match, error, created_at";

export type KartuRow = {
  id: number;
  scope: string;
  run_id: string | null;
  job_id: string | null;
  video_id: string;
  platform: string | null;
  platform_video_id: string | null;
  campaign_id: string | null;
  campaign_title: string | null;
  brand: string | null;
  rubric_version: string | null;
  pipeline_status: string;
  suggestion: Saran | null;
  confidence: number | null;
  official_reason: string | null;
  specific_reason: string | null;
  handoff_reasons: KodeSerah[] | null;
  checklist: unknown;
  music: HasilMusik | null;
  human_decision: Keputusan | null;
  human_reason: string | null;
  reviewer: string | null;
  appeal: "dibatalkan" | "dikuatkan" | "menunggu" | null;
  final_truth: Keputusan | null;
  match: boolean | null;
  error: string | null;
  created_at: string;
};

const BANDING: Record<string, string> = { dibatalkan: "Banding: keputusan dibatalkan", dikuatkan: "Banding: keputusan dikuatkan", menunggu: "Banding: menunggu" };
const waktu = (iso: string) =>
  new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }).format(new Date(iso));

/** satu kartu hasil AI di daftar Hasil */
export default function HasilKartu({ r, mine, counts }: { r: KartuRow; mine: FeedbackMine; counts: { setuju: number; tidak: number } }) {
  const list = cekList(r.checklist);
  const link = linkVideo(r.platform, r.platform_video_id);
  const wajibGagal = list.filter((c) => c.wajib && c.hasil === "tidak").length;
  return (
    <li className="card space-y-3 p-3.5 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <Link href={`/asisten-review/hasil/${r.id}`} className="font-semibold hover:text-orange-400">
              Video #{r.video_id}
            </Link>
            {link && (
              <a href={link} target="_blank" rel="noopener noreferrer nofollow" referrerPolicy="no-referrer" className="text-xs font-semibold text-orange-400 hover:underline">
                Buka video ↗
              </a>
            )}
            {r.platform && <span className="text-[11px] text-zinc-500">{r.platform}</span>}
          </div>
          <p className="mt-0.5 break-words text-xs text-zinc-400">
            {r.campaign_title || (r.campaign_id ? `Campaign ${r.campaign_id}` : "Campaign tidak diketahui")}
            {r.brand ? ` · ${r.brand}` : ""}
          </p>
        </div>
        <span className="text-[11px] text-zinc-500">
          {waktu(r.created_at)}
          {r.rubric_version ? ` · rubrik ${r.rubric_version}` : ""}
          {r.scope.startsWith("job:") ? " · cek manual" : ""}
        </span>
      </div>

      <PipelineNote status={r.pipeline_status} error={r.error} />

      {/* HP: 2 kolom; layar lebar: 4 kolom sejajar */}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 text-xs sm:grid-cols-4">
        <div className="min-w-0">
          <dt className="label mb-1">Saran AI</dt>
          <dd>
            <SaranBadge saran={r.suggestion} yakin={r.confidence} />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="label mb-1">Keputusan reviewer</dt>
          <dd className="flex flex-wrap items-center gap-1">
            <KeputusanBadge v={r.human_decision} />
            {r.reviewer && <span className="text-[11px] text-zinc-500">{r.reviewer}</span>}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="label mb-1">Hasil akhir</dt>
          <dd className="space-y-0.5">
            <KeputusanBadge v={r.final_truth} />
            {r.appeal && <p className="text-[11px] text-zinc-500">{BANDING[r.appeal]}</p>}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="label mb-1">AI vs hasil akhir</dt>
          <dd>
            <CocokBadge match={r.match} saran={r.suggestion} />
          </dd>
        </div>
      </dl>

      {(r.official_reason || r.specific_reason) && (
        <p className="break-words text-sm">
          {r.official_reason && <b className="font-semibold">{r.official_reason}</b>}
          {r.official_reason && r.specific_reason ? " — " : ""}
          {r.specific_reason && <span className="text-zinc-300">{r.specific_reason}</span>}
        </p>
      )}
      {r.human_decision === "reject" && r.human_reason && (
        <p className="break-words text-xs text-zinc-400">
          Alasan reviewer: <span className="text-zinc-300">{r.human_reason}</span>
        </p>
      )}
      <SerahList list={r.handoff_reasons} />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <RingkasCek list={list} />
        <MusikRingkas m={r.music} />
      </div>

      {list.length > 0 && (
        <details className="group rounded-xl border border-zinc-800 bg-zinc-950/30 [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-zinc-300">
            <span>
              Checklist brief ({list.length} poin{wajibGagal ? `, ${wajibGagal} wajib tidak terpenuhi` : ""})
            </span>
            <span aria-hidden className="transition group-open:rotate-180">
              ▾
            </span>
          </summary>
          <div className="px-2.5 pb-2.5">
            <ChecklistView list={list} ringkas />
          </div>
        </details>
      )}

      <div className="flex flex-wrap items-end justify-between gap-2 border-t border-zinc-800 pt-3">
        <UmpanBalik resultId={r.id} mine={mine} counts={counts} compact />
        <Link href={`/asisten-review/hasil/${r.id}`} className="text-xs font-semibold text-orange-400 hover:underline">
          Detail lengkap →
        </Link>
      </div>
    </li>
  );
}
