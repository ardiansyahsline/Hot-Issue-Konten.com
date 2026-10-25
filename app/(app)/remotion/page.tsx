import { requireStudio } from "@/lib/studio/access.server";
import StudioTabs from "@/components/remotion/pro/StudioTabs";

export const metadata = { title: "Studio · CS Tracker" };

/** Menu Studio — admin & user yang diberi akses (dicek di server) */
export default async function StudioPage() {
  await requireStudio();
  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">🎬 Studio</h1>
        <p className="page-sub">Bikin video pro bareng Harley si Sutradara — ketik ide, cek rencana, preview, lalu download.</p>
      </div>
      <StudioTabs />
    </div>
  );
}
