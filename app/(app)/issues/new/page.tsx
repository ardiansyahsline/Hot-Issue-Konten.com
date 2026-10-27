import IssueForm from "@/components/IssueForm";
import { getCurrentUser, getProfile, requireWriter } from "@/lib/auth";
import { createIssue } from "../actions";
import { requireTab } from "@/lib/tabs.server";

export default async function NewIssuePage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  await requireTab("dashboard");
  const { category } = await searchParams;
  await requireWriter("issues");
  const { supabase, user } = await getCurrentUser();
  const profile = await getProfile();
  const isAdmin = profile?.role === "admin";
  const { data: profiles } = isAdmin
    ? await supabase.from("profiles").select("id, full_name, email").order("full_name")
    : { data: [] };

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 page-title">Issue baru</h1>
      <IssueForm
        action={createIssue}
        profiles={profiles ?? []}
        defaultPicId={user.id}
        currentUserId={user.id}
        defaultCategory={category}
        isAdmin={isAdmin}
        currentUserName={profile?.full_name ?? user.email}
      />
    </div>
  );
}
