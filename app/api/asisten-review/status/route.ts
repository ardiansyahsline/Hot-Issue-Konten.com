import { NextResponse } from "next/server";
import { asistenGuard } from "@/lib/asistenReview.server";
import { loadArStatus } from "@/components/asisten/status.server";

export const dynamic = "force-dynamic";

/**
 * Status laptop (detak jantung review_workers) + antrian review_jobs + run terakhir — dipanggil browser
 * sesudah event realtime & sebagai cadangan polling (tiap 20 dtk saat tab terlihat). Akses: admin / user yang dibuka admin.
 * migration-23 belum dijalankan → `error` terisi, tetap 200 (halaman menampilkan pesan ramah).
 */
export async function GET() {
  const g = await asistenGuard();
  if (!g.ok) return g.res;
  const data = g.ctx.ready ? await loadArStatus(g.ctx) : { now: new Date().toISOString(), workers: [], jobs: [], antri: 0, runs: [], hasil: {}, error: "42P01" };
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store, private" } });
}
