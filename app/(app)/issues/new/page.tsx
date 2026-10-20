import IssueForm from "@/components/IssueForm";
import { getCurrentUser, requireWriter } from "@/lib/auth";
import { createIssue } from "../actions";

export default async function NewIssuePage() {
  await requireWriter("issues");
  const { supabase, user } = await getCurrentUser();
  const { data: profiles } = await supabase.from("profiles").select("id, full_name, email").order("full_name");

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-xl font-semibold">Issue baru</h1>
      <IssueForm action={createIssue} profiles={profiles ?? []} defaultPicId={user.id} />
    </div>
  );
}
