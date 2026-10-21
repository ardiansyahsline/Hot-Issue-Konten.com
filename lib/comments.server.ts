import "server-only";
import type { AttachmentView } from "@/lib/attachments";
import { summarize, type ReactionRow } from "@/lib/reactions";
import type { CommentView } from "@/components/comments/CommentList";

export type Person = { id: string; full_name: string | null; role: string | null };
export type CommentRow = {
  id: number;
  body: string;
  created_at: string;
  created_by: string | null;
  parent_id: number | null;
  reactions: ReactionRow[] | null;
};

/** Susun komentar jadi utas: komentar utama + balasannya (urut waktu) */
export function buildThread(
  rows: CommentRow[],
  files: AttachmentView[],
  fileKey: "issue_note_id" | "suggestion_comment_id",
  people: Map<string, Person>,
  meId: string
): CommentView[] {
  const names = new Map([...people.values()].map((p) => [p.id, p.full_name ?? "Anggota"]));
  const view = (r: CommentRow): CommentView => ({
    id: r.id,
    body: r.body,
    created_at: r.created_at,
    created_by: r.created_by,
    author_name: people.get(r.created_by ?? "")?.full_name ?? null,
    author_role: people.get(r.created_by ?? "")?.role ?? null,
    files: files.filter((f) => f[fileKey] === r.id),
    reactions: summarize(r.reactions, meId, names),
    replies: [],
  });
  const ids = new Set(rows.map((r) => r.id));
  const roots: CommentView[] = [];
  const byId = new Map<number, CommentView>();
  for (const r of rows) {
    if (r.parent_id && ids.has(r.parent_id)) continue;
    const v = view(r);
    roots.push(v);
    byId.set(r.id, v);
  }
  for (const r of rows) {
    if (r.parent_id && byId.has(r.parent_id)) byId.get(r.parent_id)!.replies.push(view(r));
  }
  return roots;
}

export const peopleMap = (rows: Person[] | null) => new Map((rows ?? []).map((p) => [p.id, p]));
export const nameMap = (people: Map<string, Person>) => new Map([...people.values()].map((p) => [p.id, p.full_name ?? "Anggota"]));
