import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser, getProfile } from "@/lib/auth";
import { HOT_THRESHOLD, STATUSES } from "@/lib/constants";
import { CONTACT_TYPES, contactLink, displayContact } from "@/lib/contacts";
import type { IssueRow } from "@/lib/types";
import { fmtDate, isAutoHot, timeAgo } from "@/lib/utils";
import { HotBadge, PriorityBadge, StatusBadge } from "@/components/Badges";
import { canWriteIssues } from "@/lib/roles";
import { addNote, deleteIssue, deleteNote, setStatus, takeIssue, toggleHot } from "../actions";
import { ATTACH_SELECT, signAttachments, type AttachmentRow } from "@/lib/attachments.server";
import AttachmentsCard from "@/components/attach/AttachmentsCard";
import CommentList from "@/components/comments/CommentList";
import CommentComposer from "@/components/comments/CommentComposer";
import Reactions from "@/components/emoji/Reactions";
import { buildThread, nameMap, peopleMap, type CommentRow, type Person } from "@/lib/comments.server";
import { summarize, type ReactionRow } from "@/lib/reactions";

type Note = CommentRow & { files: AttachmentRow[] | null };

export default async function IssueDetail({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();

  const { supabase, user } = await getCurrentUser();
  const [{ data }, { data: notesData }, profile, { data: filesData }, { data: reactData }, { data: peopleData }] = await Promise.all([
    supabase.from("issue_list").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("issue_notes")
      .select(`id, body, created_at, created_by, parent_id, reactions(emoji, user_id), files:attachments(${ATTACH_SELECT})`)
      .eq("issue_id", id)
      .order("created_at", { ascending: true }),
    getProfile(),
    supabase.from("attachments").select(ATTACH_SELECT).eq("issue_id", id).order("id"),
    supabase.from("reactions").select("emoji, user_id").eq("issue_id", id).order("id"),
    supabase.from("profiles").select("id, full_name, role"),
  ]);
  if (!data) notFound();
  const issue = data as IssueRow;
  const notes = (notesData ?? []) as unknown as Note[];
  // semua lampiran (issue + tiap update) ditandatangani sekaligus
  const files = await signAttachments(supabase, [
    ...((filesData ?? []) as unknown as AttachmentRow[]),
    ...notes.flatMap((n) => (n.files ?? []).sort((a, b) => a.id - b.id)),
  ]);
  const issueFiles = files.filter((f) => !f.issue_note_id);
  const page = `/issues/${id}`;
  const people = peopleMap(peopleData as Person[] | null);
  const thread = buildThread(notes, files, "issue_note_id", people, user.id);
  const issueReactions = summarize(reactData as ReactionRow[] | null, user.id, nameMap(people));
  const commentCount = notes.length;
  const isAdmin = profile?.role === "admin";
  const canWrite = canWriteIssues(profile?.role);
  const autoHot = isAutoHot(issue);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link href="/" className="text-sm text-zinc-400 hover:text-zinc-200">← Dashboard</Link>

      <div className={`card p-5 ${issue.status !== "resolved" && (issue.is_hot || autoHot) ? "border-red-900/70" : ""}`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-zinc-500">#{issue.id}</span>
          {issue.status !== "resolved" && <HotBadge manual={issue.is_hot} auto={autoHot} />}
          <StatusBadge status={issue.status} />
          <PriorityBadge priority={issue.priority} />
          <span className="badge bg-zinc-800 text-zinc-300 ring-zinc-700">{issue.category}</span>
        </div>
        <h1 className="mt-3 page-title">{issue.title}</h1>
        {issue.description && <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-300">{issue.description}</p>}

        <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-4">
          <div><dt className="label">Campaign</dt><dd>{issue.campaign || "-"}</dd></div>
          <div><dt className="label">PIC</dt><dd>{issue.pic_name || "-"}</dd></div>
          <div><dt className="label">Dibuat</dt><dd>{fmtDate(issue.created_at)} · {issue.created_by_name ?? "-"}</dd></div>
          <div><dt className="label">Update terakhir</dt><dd>{fmtDate(issue.updated_at)} · {issue.updated_by_name ?? "-"}</dd></div>
        </dl>

        <div className="mt-4">
          <Reactions target={{ kind: "issue", id }} initial={issueReactions} page={page} showWho />
        </div>

        {canWrite && (
        <div className="mt-5 flex flex-wrap gap-2 border-t border-zinc-800 pt-4">
          <Link href={`/issues/${id}/edit`} className="btn-primary">Edit</Link>
          {Object.entries(STATUSES)
            .filter(([k]) => k !== issue.status)
            .map(([k, v]) => (
              <form key={k} action={setStatus.bind(null, id, k)}>
                <button className="btn-ghost">Jadikan {v.label}</button>
              </form>
            ))}
          <form action={toggleHot.bind(null, id, !issue.is_hot)}>
            <button className="btn-ghost">{issue.is_hot ? "Hapus tanda HOT manual" : "🔥 Tandai HOT"}</button>
          </form>
          {issue.pic_id !== user.id && (
            <form action={takeIssue.bind(null, id)}>
              <button className="btn-ghost">Saya yang pegang</button>
            </form>
          )}
          {isAdmin && (
            <form action={deleteIssue.bind(null, id)} className="ml-auto">
              <button className="btn-danger">Hapus issue</button>
            </form>
          )}
        </div>
        )}
      </div>

      <AttachmentsCard
        items={issueFiles}
        target={{ kind: "issue", id }}
        page={page}
        meId={user.id}
        isAdmin={isAdmin}
        canAdd={canWrite}
      />

      <div className="card p-5">
        <h2 className="font-semibold">Kontak clipper</h2>
        {issue.contacts.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-400">Belum ada kontak.</p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-800">
            {issue.contacts.map((c) => {
              const link = contactLink(c.type, c.normalized_value);
              const hot = c.issue_count_30d >= HOT_THRESHOLD;
              return (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="w-24 text-xs text-zinc-500">{CONTACT_TYPES[c.type].label}</span>
                    {link ? (
                      <a href={link} target="_blank" rel="noreferrer" className="hover:underline">
                        {displayContact(c.type, c.normalized_value)}
                      </a>
                    ) : (
                      <span>{displayContact(c.type, c.normalized_value)}</span>
                    )}
                  </div>
                  <Link
                    href={`/contacts?type=${c.type}&q=${encodeURIComponent(c.normalized_value)}`}
                    className={`text-xs hover:underline ${hot ? "font-semibold text-red-300" : "text-zinc-400"}`}
                  >
                    {hot && "🔥 "}Dilaporkan di {c.issue_count} issue ({c.issue_count_30d} dalam 30 hari) →
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="card p-5">
        <h2 className="font-semibold">
          Komentar &amp; update {commentCount > 0 && <span className="text-zinc-500">({commentCount})</span>}
        </h2>
        <div className="mt-4">
          <CommentList
            comments={thread}
            kind="issue_note"
            meId={user.id}
            isAdmin={isAdmin}
            page={page}
            addAction={addNote.bind(null, id)}
            deleteAction={deleteNote.bind(null, id)}
            empty="Belum ada komentar. Semua tim bisa ikut komentar, kasih update, atau handover shift di sini."
          />
        </div>
        <div className="mt-5 border-t border-zinc-800/80 pt-4">
          <CommentComposer action={addNote.bind(null, id)} meId={user.id} placeholder="Tulis komentar / update / handover shift…" submitLabel="Kirim komentar" />
        </div>
      </div>
    </div>
  );
}
