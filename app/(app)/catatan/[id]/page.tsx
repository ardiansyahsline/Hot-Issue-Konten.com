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
import CommentList from "@/components/comments/CommentList";
import CommentComposer from "@/components/comments/CommentComposer";
import Reactions from "@/components/emoji/Reactions";
import { buildThread, nameMap, peopleMap, type CommentRow, type Person } from "@/lib/comments.server";
import { summarize, type ReactionRow } from "@/lib/reactions";
import { startTab } from "@/lib/tabs.server";

type Comment = CommentRow & { files: AttachmentRow[] | null };

export default async function CatatanDetail({ params }: { params: Promise<{ id: string }> }) {
  // cek tab catatan bareng query di bawah (tidak menambah satu putaran ke Supabase)
  const gate = startTab("catatan");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const { supabase, user } = await getCurrentUser();
  const [, { data }, { data: cData }, profile, { data: filesData }, { data: reactData }, { data: peopleData }] = await Promise.all([
    gate,
    supabase.from("suggestion_list").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("suggestion_comments")
      .select(`id, body, created_at, created_by, parent_id, reactions(emoji, user_id), files:attachments(${ATTACH_SELECT})`)
      .eq("suggestion_id", id)
      .order("created_at"),
    getProfile(),
    supabase.from("attachments").select(ATTACH_SELECT).eq("suggestion_id", id).order("id"),
    supabase.from("reactions").select("emoji, user_id").eq("suggestion_id", id).order("id"),
    supabase.from("profiles").select("*"),
  ]);
  if (!data) notFound();
  const r = data as SuggestionRow;
  const comments = (cData ?? []) as unknown as Comment[];
  const files = await signAttachments(supabase, [
    ...((filesData ?? []) as unknown as AttachmentRow[]),
    ...comments.flatMap((c) => (c.files ?? []).sort((a, b) => a.id - b.id)),
  ]);
  const page = `/catatan/${id}`;
  const people = peopleMap(peopleData as Person[] | null);
  const thread = buildThread(comments, files, "suggestion_comment_id", people, user.id);
  const sgReactions = summarize(reactData as ReactionRow[] | null, user.id, nameMap(people));
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
        <h1 className="page-title mt-5 text-[21px] sm:text-[26px]">{r.title}</h1>
        {r.body && <p className="mt-3 whitespace-pre-wrap text-[14.5px] leading-7 text-zinc-300">{r.body}</p>}

        <div className="mt-5">
          <Reactions target={{ kind: "suggestion", id }} initial={sgReactions} page={page} showWho />
        </div>

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
        <h2 className="section-title">
          Tanggapan {comments.length > 0 && <span className="text-zinc-500">({comments.length})</span>}
        </h2>
        <div className="mt-4">
          <CommentList
            comments={thread}
            kind="suggestion_comment"
            meId={user.id}
            isAdmin={isAdmin}
            page={page}
            addAction={addComment.bind(null, id)}
            deleteAction={deleteComment.bind(null, id)}
            empty="Belum ada tanggapan."
          />
        </div>
        <div className="mt-5 border-t border-zinc-800/80 pt-4">
          <CommentComposer action={addComment.bind(null, id)} meId={user.id} placeholder="Tulis tanggapan…" submitLabel="Kirim tanggapan" />
        </div>
      </section>
    </div>
  );
}
