import { notFound } from "next/navigation";
import IssueForm from "@/components/IssueForm";
import { getCurrentUser } from "@/lib/auth";
import type { IssueRow } from "@/lib/types";
import { updateIssue } from "../../actions";

export default async function EditIssuePage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();

  const { supabase } = await getCurrentUser();
  const [{ data: issue }, { data: profiles }] = await Promise.all([
    supabase.from("issue_list").select("*").eq("id", id).maybeSingle(),
    supabase.from("profiles").select("id, full_name, email").order("full_name"),
  ]);
  if (!issue) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-xl font-semibold">Edit issue #{id}</h1>
      <IssueForm
        action={updateIssue.bind(null, id)}
        profiles={profiles ?? []}
        issue={issue as IssueRow}
        issueId={id}
      />
    </div>
  );
}
