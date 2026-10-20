import { notFound } from "next/navigation";
import { getCurrentUser, requireWriter } from "@/lib/auth";
import type { VideoReviewRow } from "@/lib/types";
import { todayWib } from "@/lib/utils";
import VrForm from "@/components/VrForm";
import { updateReview } from "../../actions";

export default async function EditReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  await requireWriter("reviews", `/video-review/${id}`);
  const { supabase } = await getCurrentUser();
  const { data } = await supabase.from("video_review_list").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 page-title">Edit kasus #{id}</h1>
      <VrForm action={updateReview.bind(null, id)} review={data as VideoReviewRow} today={todayWib()} />
    </div>
  );
}
