import { notFound } from "next/navigation";
import IssueForm from "@/components/IssueForm";
import { getCurrentUser, getProfile, requireWriter } from "@/lib/auth";
import type { IssueRow } from "@/lib/types";
import { updateIssue } from "../../actions";

export default async function EditIssuePage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();

  await requireWriter("issues", `/issues/${id}`);
  const { supabase, user } = await getCurrentUser();
  const profile = await getProfile();
  const isAdmin = profile?.role === "admin";
  const [{ data: issue }, { data: profiles }] = await Promise.all([
    supabase.from("issue_list").select("*").eq("id", id).maybeSingle(),
    isAdmin ? supabase.from("profiles").select("id, full_name, email").order("full_name") : Promise.resolve({ data: [] }),
  ]);
  if (!issue) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 page-title">Edit issue #{id}</h1>
      <IssueForm
        action={updateIssue.bind(null, id)}
        profiles={profiles ?? []}
        isAdmin={isAdmin}
        issue={issue as IssueRow}
        issueId={id}
        currentUserId={user.id}
      />
    </div>
  );
}
