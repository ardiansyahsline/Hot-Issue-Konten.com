import Link from "next/link";
import { requireWriter } from "@/lib/auth";
import VrImport from "@/components/VrImport";
import { requireTab } from "@/lib/tabs.server";

export default async function ImportPage() {
  await requireTab("video_review");
  await requireWriter("reviews", "/video-review");
  return (
    <div className="space-y-4">
      <Link href="/video-review" className="text-sm text-zinc-400 hover:text-zinc-200">← Video Review</Link>
      <h1 className="page-title">Import dari Google Sheet</h1>
      <VrImport />
    </div>
  );
}
