import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser, getProfile } from "@/lib/auth";
import { canWriteReviews } from "@/lib/roles";
import { VR_STATUSES } from "@/lib/videoReview";
import type { VideoReviewRow } from "@/lib/types";
import { fmtDate, fmtDay } from "@/lib/utils";
import { VrLinks, VrStatusBadge } from "@/components/VrBits";
import VrCategorySelect from "@/components/VrCategorySelect";
import { deleteReview, setReviewStatus } from "../actions";

export default async function ReviewDetail({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const { supabase } = await getCurrentUser();
  const [{ data }, profile] = await Promise.all([
    supabase.from("video_review_list").select("*").eq("id", id).maybeSingle(),
    getProfile(),
  ]);
  if (!data) notFound();
  const r = data as VideoReviewRow;
  const canWrite = canWriteReviews(profile?.role);
  const isAdmin = profile?.role === "admin";

  const Field = ({ label, value }: { label: string; value: string | null }) => (
    <div>
      <div className="label">{label}</div>
      <p className="whitespace-pre-wrap text-sm text-zinc-200">{value || <span className="text-zinc-500">-</span>}</p>
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link href="/video-review" className="text-sm text-zinc-400 hover:text-zinc-200">← Video Review</Link>

      <div className="card space-y-5 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-zinc-500">#{r.id}</span>
          <span className="text-sm text-zinc-400">{fmtDay(r.report_date)}</span>
          <VrStatusBadge status={r.status} />
          {canWrite ? (
            <VrCategorySelect id={r.id} category={r.category} />
          ) : (
            <span className="badge bg-zinc-800 text-zinc-300 ring-zinc-700">{r.category ?? "Belum dikategorikan"}</span>
          )}
        </div>
        <h1 className="page-title">{r.explanation}</h1>

        <div>
          <div className="label">Email / link</div>
          {r.links.length ? <VrLinks links={r.links} /> : <span className="text-sm text-zinc-500">-</span>}
        </div>
        <Field label="Penyelesaian" value={r.resolution} />
        <Field label="Insight" value={r.insight} />
        <Field label="Argumen clipper" value={r.clipper_argument} />

        <div className="text-xs text-zinc-500">
          Dibuat {fmtDate(r.created_at)} oleh {r.created_by_name ?? "-"} · update {fmtDate(r.updated_at)} oleh {r.updated_by_name ?? "-"}
          {r.source_key && " · hasil import sheet"}
        </div>

        {canWrite && (
          <div className="flex flex-wrap gap-2 border-t border-zinc-800 pt-4">
            <Link href={`/video-review/${id}/edit`} className="btn-primary">Edit</Link>
            {Object.entries(VR_STATUSES)
              .filter(([k]) => k !== r.status)
              .map(([k, v]) => (
                <form key={k} action={setReviewStatus.bind(null, id, k)}>
                  <button className="btn-ghost">Jadikan {v.label}</button>
                </form>
              ))}
            {isAdmin && (
              <form action={deleteReview.bind(null, id)} className="ml-auto">
                <button className="btn-danger">Hapus</button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
