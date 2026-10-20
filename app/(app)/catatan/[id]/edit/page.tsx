import { notFound, redirect } from "next/navigation";
import { getCurrentUser, getProfile } from "@/lib/auth";
import type { SuggestionRow } from "@/lib/suggestions";
import SgForm from "@/components/SgForm";
import { updateSuggestion } from "../../actions";

export default async function EditCatatan({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const [{ supabase, user }, profile] = await Promise.all([getCurrentUser(), getProfile()]);
  const { data } = await supabase.from("suggestion_list").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const r = data as SuggestionRow;
  const isAdmin = profile?.role === "admin";
  if (!isAdmin && r.created_by !== user.id) redirect(`/catatan/${id}`);
  const { data: people } = isAdmin ? await supabase.from("profiles").select("id, full_name, email").order("full_name") : { data: null };

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="page-title mb-5">Edit catatan</h1>
      <div className="card p-6">
        <SgForm action={updateSuggestion.bind(null, id)} suggestion={r} currentUserId={user.id} people={people ?? undefined} />
      </div>
    </div>
  );
}
