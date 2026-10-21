import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser, getProfile } from "@/lib/auth";
import { SG_STATUSES, type SuggestionRow } from "@/lib/suggestions";
import { fmtDate, timeAgo } from "@/lib/utils";
import { Avatar, SgCategoryBadge, SgStatusBadge } from "@/components/SgBits";
import SgProgressForm from "@/components/SgProgressForm";
import { addComment, deleteComment, deleteSuggestion, setProgress } from "../actions";
import { ATTACH_SELECT, signAttachments, type AttachmentRow } from "@/lib/attachments.server";
import AttachmentsCard from "@/components/attach/AttachmentsCard";
import AttachmentGallery from "@/components/attach/AttachmentGallery";
import AttachmentPicker from "@/components/attach/AttachmentPicker";

type Comment = {
  id: number;
  body: string;
  created_at: string;
  created_by: string | null;
  author: { full_name: string | null } | null;
  files: AttachmentRow[] | null;
};

export default async function CatatanDetail({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const { supabase, user } = await getCurrentUser();
  const [{ data }, { data: cData }, profile, { data: filesData }] = await Promise.all([
    supabase.from("suggestion_list").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("suggestion_comments")
      .select(`id, body, created_at, created_by, author:profiles!suggestion_comments_created_by_fkey(full_name), files:attachments(${ATTACH_SELECT})`)
      .eq("suggestion_id", id)
      .order("created_at"),
    getProfile(),
    supabase.from("attachments").select(ATTACH_SELECT).eq("suggestion_id", id).order("id"),
  ]);
  if (!data) notFound();
  const r = data as SuggestionRow;
  const comments = (cData ?? []) as unknown as Comment[];
  const files = await signAttachments(supabase, [
    ...((filesData ?? []) as unknown as AttachmentRow[]),
    ...comments.flatMap((c) => (c.files ?? []).sort((a, b) => a.id - b.id)),
  ]);
  const page = `/catatan/${id}`;
  const isAdmin = profile?.role === "admin";
  const isOwner = r.created_by === user.id;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href="/catatan" className="text-sm text-zinc-400 hover:text-zinc-200">← Catatan & Saran</Link>

      <article className="card p-6">
        <div className="flex flex-wrap items-center gap-3">
          <Avatar name={r.created_by_name} size={40} />
          <div className="leading-tight">
            <div className="text-[14px] font-semibold">{r.created_by_name ?? "-"}</div>
            <div className="text-[12.5px] text-zinc-500">{fmtDate(r.created_at)} · {timeAgo(r.created_at)}</div>
          </div>
          <div className="ml-auto flex gap-1.5">
            <SgCategoryBadge category={r.category} />
            <SgStatusBadge status={r.status} />
          </div>
        </div>
        <h1 className="page-title mt-5">{r.title}</h1>
        {r.body && <p className="mt-3 whitespace-pre-wrap text-[14.5px] leading-7 text-zinc-300">{r.body}</p>}

        {(isOwner || isAdmin) && (
          <div className="mt-6 flex gap-2 border-t border-zinc-800/80 pt-4">
            <Link href={`/catatan/${id}/edit`} className="btn-ghost">Edit</Link>
            <form action={deleteSuggestion.bind(null, id)}>
              <button className="btn-danger">Hapus</button>
            </form>
          </div>
        )}
      </article>

      <AttachmentsCard
        items={files.filter((f) => !f.suggestion_comment_id)}
        target={{ kind: "suggestion", id }}
        page={page}
        meId={user.id}
        isAdmin={isAdmin}
        canAdd={isOwner || isAdmin}
        className="card p-6"
      />

      <section className="card p-6">
        <div className="flex items-center justify-between">
          <h2 className="section-title">Progress</h2>
          <SgStatusBadge status={r.status} />
        </div>
        {r.status_reason ? (
          <p className="mt-3 whitespace-pre-wrap rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3 text-[14px] leading-6 text-zinc-300">
            {r.status_reason}
          </p>
        ) : (
          <p className="mt-2 text-[13.5px] text-zinc-500">
            {r.status === "baru" ? "Belum ditindaklanjuti." : "Belum ada keterangan."}
          </p>
        )}
        {r.status_changed_at && (
          <p className="mt-2 text-[12.5px] text-zinc-500">
            Diubah ke {SG_STATUSES[r.status].label} oleh {r.status_changed_by_name ?? "-"} · {fmtDate(r.status_changed_at)}
          </p>
        )}
        {isAdmin && (
          <div className="mt-5 border-t border-zinc-800/80 pt-5">
            <div className="label">Ubah progress (admin)</div>
            <SgProgressForm action={setProgress.bind(null, id)} status={r.status} reason={r.status_reason} />
          </div>
        )}
      </section>

      <section className="card p-6">
        <h2 className="section-title">Tanggapan</h2>
        <ul className="mt-4 space-y-4">
          {comments.length === 0 && <li className="text-[13.5px] text-zinc-500">Belum ada tanggapan.</li>}
          {comments.map((c) => (
            <li key={c.id} className="flex gap-3">
              <Avatar name={c.author?.full_name ?? null} size={30} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[12.5px]">
                  <span className="font-semibold text-zinc-200">{c.author?.full_name ?? "-"}</span>
                  <span className="text-zinc-500">{timeAgo(c.created_at)}</span>
                  {(c.created_by === user.id || isAdmin) && (
                    <form action={deleteComment.bind(null, id, c.id)} className="ml-auto">
                      <button className="text-zinc-500 hover:text-red-400">hapus</button>
                    </form>
                  )}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-[14px] leading-6 text-zinc-300">{c.body}</p>
                <AttachmentGallery items={files.filter((f) => f.suggestion_comment_id === c.id)} meId={user.id} isAdmin={isAdmin} page={page} compact />
              </div>
            </li>
          ))}
        </ul>
        <form action={addComment.bind(null, id)} className="mt-5 space-y-2">
          <textarea name="body" rows={3} placeholder="Tulis tanggapan…" className="input" />
          <AttachmentPicker userId={user.id} compact clearOnReset />
          <div className="flex justify-end">
            <button className="btn-primary">Kirim tanggapan</button>
          </div>
        </form>
      </section>
    </div>
  );
}
