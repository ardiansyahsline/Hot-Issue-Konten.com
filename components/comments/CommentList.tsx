import type { AttachmentView } from "@/lib/attachments";
import type { ReactionKind, ReactionSummary } from "@/lib/reactions";
import { ROLES, isRole } from "@/lib/roles";
import { fmtDate, timeAgo } from "@/lib/utils";
import AttachmentGallery from "@/components/attach/AttachmentGallery";
import Reactions from "@/components/emoji/Reactions";
import { ReplyToggle } from "./CommentComposer";
import UserAvatar from "@/components/UserAvatar";

export type CommentView = {
  id: number;
  body: string;
  created_at: string;
  created_by: string | null;
  author_name: string | null;
  author_role: string | null;
  author_avatar?: string | null;
  files: AttachmentView[];
  reactions: ReactionSummary[];
  replies: CommentView[];
};

/**
 * Daftar komentar + balasan (menjorok), reaksi emoji, lampiran, dan tombol Balas / hapus.
 * Dipakai di Hot Issue (update) dan Catatan & Saran (tanggapan).
 */
export default function CommentList({
  comments,
  kind,
  meId,
  isAdmin,
  page,
  addAction,
  deleteAction,
  empty,
}: {
  comments: CommentView[];
  kind: Extract<ReactionKind, "issue_note" | "suggestion_comment">;
  meId: string;
  isAdmin: boolean;
  page: string;
  addAction: (fd: FormData) => void | Promise<void>;
  /** server action (commentId) => hapus */
  deleteAction: (commentId: number) => Promise<void>;
  empty: string;
}) {
  if (!comments.length) return <p className="text-[13.5px] text-zinc-500">{empty}</p>;

  const Item = ({ c, root }: { c: CommentView; root: CommentView }) => {
    const role = isRole(c.author_role) ? ROLES[c.author_role] : null;
    const reactions = <Reactions target={{ kind, id: c.id }} initial={c.reactions} page={page} />;
    return (
      <div className="flex gap-3">
        <UserAvatar name={c.author_name} url={c.author_avatar} size={c === root ? 32 : 26} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 text-[12.5px]">
            <span className="font-semibold text-zinc-200">{c.author_name ?? "-"}</span>
            {role && <span className={`text-[11px] font-semibold ${role.cls}`}>{role.label}</span>}
            <span className="text-zinc-500" title={fmtDate(c.created_at)}>{timeAgo(c.created_at)}</span>
            {(c.created_by === meId || isAdmin) && (
              <form action={deleteAction.bind(null, c.id)} className="ml-auto">
                <button className="text-zinc-500 hover:text-red-400">hapus</button>
              </form>
            )}
          </div>
          <p className="mt-1 whitespace-pre-wrap break-words text-[14px] leading-6 text-zinc-300">{c.body}</p>
          <AttachmentGallery items={c.files} meId={meId} isAdmin={isAdmin} page={page} compact />
          {/* balasan selalu ke komentar paling atas (satu tingkat) */}
          <ReplyToggle action={addAction} meId={meId} parentId={root.id} name={c.author_name ?? "komentar"}>
            {reactions}
          </ReplyToggle>
        </div>
      </div>
    );
  };

  return (
    <ul className="space-y-5">
      {comments.map((c) => (
        <li key={c.id}>
          <Item c={c} root={c} />
          {c.replies.length > 0 && (
            <ul className="ml-11 mt-3 space-y-3 border-l-2 border-zinc-800/80 pl-4">
              {c.replies.map((r) => (
                <li key={r.id}>
                  <Item c={r} root={c} />
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
