import { requireWriter } from "@/lib/auth";
import { todayWib } from "@/lib/utils";
import VrForm from "@/components/VrForm";
import { createReview } from "../actions";

export default async function NewReviewPage() {
  await requireWriter("reviews", "/video-review");
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-xl font-semibold">Kasus Video Review baru</h1>
      <VrForm action={createReview} today={todayWib()} />
    </div>
  );
}
