import { requireWriter } from "@/lib/auth";
import { todayWib } from "@/lib/utils";
import VrForm from "@/components/VrForm";
import { createReview } from "../actions";
import { requireTab } from "@/lib/tabs.server";

export default async function NewReviewPage() {
  await requireTab("video_review");
  await requireWriter("reviews", "/video-review");
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 page-title">Kasus Video Review baru</h1>
      <VrForm action={createReview} today={todayWib()} />
    </div>
  );
}
