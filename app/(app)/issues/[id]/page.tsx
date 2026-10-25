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
import AttachmentGallery from "@/components/attach/AttachmentGallery";
import HeatMeter from "@/components/reports/HeatMeter";
import ReportForm from "@/components/reports/ReportForm";
import { addReport, deleteReport } from "../reportActions";
import type { IssueContact } from "@/lib/types";

type Note = CommentRow & { files: AttachmentRow[] | null };
type Report = { id: number; note: string; created_at: string; created_by: string | null; files: AttachmentRow[] | null };

function ContactChips({ items }: { items: IssueContact[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {items.map((c) => (
        <Link
          key={c.id}
          href={`/contacts?type=${c.type}&q=${encodeURIComponent(c.normalized_value)}`}
          className="inline-flex items-center gap-1 rounded-md bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300 hover:bg-zinc-700"
        >
          <span className="font-semibold text-zinc-500">{CONTACT_TYPES[c.type].short}</span>
          {displayContact(c.type, c.normalized_value)}
        </Link>
      ))}
    </div>
  );
}

export default async function IssueDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ lapor?: string; lapor_error?: string }>;
}) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const sp = await searchParams;

  const { supabase, user } = await getCurrentUser();
  const [{ data }, { data: notesData }, profile, { data: filesData }, { data: reactData }, { data: peopleData }, { data: reportsData }] = await Promise.all([
    supabase.from("issue_list").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("issue_notes")
      .select(`id, body, created_at, created_by, parent_id, reactions(emoji, user_id), files:attachments(${ATTACH_SELECT})`)
      .eq("issue_id", id)
      .order("created_at", { ascending: true }),
    getProfile(),
    supabase.from("attachments").select(ATTACH_SELECT).eq("issue_id", id).order("id"),
    supabase.from("reactions").select("emoji, user_id").eq("issue_id", id).order("id"),
    supabase.from("profiles").select("*"),
    supabase
      .from("issue_reports")
      .select(`id, note, created_at, created_by, files:attachments(${ATTACH_SELECT})`)
      .eq("issue_id", id)
      .order("created_at", { ascending: false }),
  ]);
  if (!data) notFound();
  const issue = data as IssueRow;
  const notes = (notesData ?? []) as unknown as Note[];
  // semua lampiran (issue + tiap update) ditandatangani sekaligus
  const reports = (reportsData ?? []) as unknown as Report[];
  const reportFileRows = reports.flatMap((r) => (r.files ?? []).sort((a, b) => a.id - b.id));
  const signed = await signAttachments(supabase, [
    ...((filesData ?? []) as unknown as AttachmentRow[]),
    ...notes.flatMap((n) => (n.files ?? []).sort((a, b) => a.id - b.id)),
    ...reportFileRows,
  ]);
  // lampiran laporan ada di bagian akhir (urutan sama dengan input)
  const files = signed.slice(0, signed.length - reportFileRows.length);
  const reportFiles = new Map<number, typeof signed>();
  {
    let k = signed.length - reportFileRows.length;
    for (const r of reports) {
      const n = r.files?.length ?? 0;
      reportFiles.set(r.id, signed.slice(k, k + n));
      k += n;
    }
  }
  const issueFiles = files.filter((f) => !f.issue_note_id);
  const page = `/issues/${id}`;
  const people = peopleMap(peopleData as Person[] | null);
  const thread = buildThread(notes, files, "issue_note_id", people, user.id);
  const issueReactions = summarize(reactData as ReactionRow[] | null, user.id, nameMap(people));
  const commentCount = notes.length;
  const isAdmin = profile?.role === "admin";
  const canWrite = canWriteIssues(profile?.role);
  const autoHot = isAutoHot(issue);
  const reportCount = 1 + reports.length;
  const last24h = reports.filter((r) => Date.now() - new Date(r.created_at).getTime() < 86400000).length;
  const baseContacts = issue.contacts.filter((c) => !c.report_id);
  const contactsOf = (rid: number) => issue.contacts.filter((c) => c.report_id === rid);
  const nameOf = (uid: string | null) => (uid ? people.get(uid)?.full_name : null) ?? "-";
  const SHOW = 5;

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
        <h1 className="mt-3 page-title text-[21px] sm:text-[26px]">{issue.title}</h1>
        {issue.description && <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-300">{issue.description}</p>}

        <div className="mt-4">
          <HeatMeter reports={reportCount} contacts={issue.contacts.length} last24h={last24h} />
        </div>

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

      <div id="laporan" className="card scroll-mt-24 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">
              Laporan clipper <span className="text-zinc-500">({reportCount})</span>
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Kasus yang sama dari clipper lain — tiap laporan punya kontak, keterangan, dan bukti sendiri. Makin banyak laporan, makin HOT.
            </p>
          </div>
        </div>
        {sp.lapor === "ok" && <p className="mt-3 rounded-xl bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-400">Laporan ditambahkan ke topik ini 🔥</p>}
        {sp.lapor_error && <p className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-[13px] text-red-400">{sp.lapor_error}</p>}
        <div className="mt-4">
          <ReportForm
            action={addReport.bind(null, id)}
            meId={user.id}
            issueId={id}
            next={reportCount + 1}
            topicKeys={issue.contacts.map((c) => `${c.type}:${c.normalized_value}`)}
          />
        </div>

        {(() => {
          const items = [
            ...reports.map((r, i) => {
              const mine = r.created_by === user.id;
              return (
                <li key={r.id} className="rounded-2xl border border-zinc-800/80 p-4">
                  <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                    <span className="rounded-md bg-orange-500/15 px-1.5 py-0.5 text-[11px] font-bold text-orange-400">Laporan #{reportCount - i}</span>
                    <span className="font-semibold">{nameOf(r.created_by)}</span>
                    <span className="text-zinc-500">· {fmtDate(r.created_at)}</span>
                    {(mine || isAdmin) && (
                      <form action={deleteReport.bind(null, id, r.id)} className="ml-auto">
                        <button className="text-[12px] text-zinc-500 hover:text-red-400" title="Hapus laporan">
                          Hapus
                        </button>
                      </form>
                    )}
                  </div>
                  <ContactChips items={contactsOf(r.id)} />
                  {r.note && <p className="mt-2 whitespace-pre-wrap text-[13.5px] text-zinc-300">{r.note}</p>}
                  {(reportFiles.get(r.id)?.length ?? 0) > 0 && (
                    <div className="mt-2">
                      <AttachmentGallery items={reportFiles.get(r.id)!} meId={user.id} isAdmin={isAdmin} page={page} compact />
                    </div>
                  )}
                </li>
              );
            }),
            <li key="awal" className="rounded-2xl border border-zinc-800/80 p-4">
              <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                <span className="rounded-md bg-zinc-800 px-1.5 py-0.5 text-[11px] font-bold text-zinc-300">Laporan awal</span>
                <span className="font-semibold">{issue.created_by_name ?? "-"}</span>
                <span className="text-zinc-500">· {fmtDate(issue.created_at)}</span>
              </div>
              <ContactChips items={baseContacts} />
              <p className="mt-2 text-[13px] text-zinc-400">
                {issue.description ? issue.description.slice(0, 280) : issue.title}
                {issueFiles.length > 0 && <span className="text-zinc-500"> · bukti ada di bagian Bukti / lampiran</span>}
              </p>
            </li>,
          ];
          return (
            <>
              <ol className="mt-4 space-y-3">{items.slice(0, SHOW)}</ol>
              {items.length > SHOW && (
                <details className="group mt-3">
                  <summary className="cursor-pointer list-none text-center text-[13px] font-semibold text-orange-400 hover:underline">
                    <span className="group-open:hidden">Lihat {items.length - SHOW} laporan lainnya ↓</span>
                    <span className="hidden group-open:inline">Sembunyikan ↑</span>
                  </summary>
                  <ol className="mt-3 space-y-3">{items.slice(SHOW)}</ol>
                </details>
              )}
            </>
          );
        })()}
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
