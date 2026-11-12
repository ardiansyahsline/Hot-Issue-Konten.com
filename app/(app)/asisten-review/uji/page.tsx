import { requireAsisten } from "@/lib/asistenReview.server";
import BelumSiap from "@/components/asisten/BelumSiap";
import UjiPanel from "@/components/asisten/UjiPanel";
import { loadArStatus } from "@/components/asisten/status.server";

export const dynamic = "force-dynamic";

const missing = (code: string | null) => code === "42P01" || code === "PGRST205" || code === "42883" || code === "PGRST202";

/** "Jalankan uji": status laptop, tombol uji 50 / 500, progres, tempel ID / link video, run terakhir (lanjutkan / ulangi). */
export default async function UjiPage() {
  const ctx = await requireAsisten();
  if (!ctx.ready) return <BelumSiap />;
  const status = await loadArStatus(ctx);
  if (missing(status.error)) return <BelumSiap />;
  return <UjiPanel initial={status} admin={ctx.admin} />;
}
