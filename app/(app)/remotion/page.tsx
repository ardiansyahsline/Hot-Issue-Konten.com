import { requireAdmin } from "@/lib/auth";
import RemotionStudio from "@/components/remotion/StudioLazy";

export const metadata = { title: "Remotion · CS Tracker" };

/** Menu Remotion — bikin video promosi/UGC dari kode (sementara khusus admin) */
export default async function RemotionPage() {
  await requireAdmin();
  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">🎞️ Remotion</h1>
        <p className="page-sub">Bikin video UGC fitur CS Tracker — preview, ubah teks, lalu download. Khusus admin.</p>
      </div>
      <RemotionStudio />
    </div>
  );
}
