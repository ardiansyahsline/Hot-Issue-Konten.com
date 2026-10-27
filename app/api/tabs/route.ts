import { NextResponse } from "next/server";
import { getTabAccess } from "@/lib/tabs.server";

export const dynamic = "force-dynamic";

/**
 * Tab yang ditutup admin untuk user yang login — dicek ulang browser (components/TabAccessProvider.tsx)
 * saat pindah halaman / kembali ke tab / tiap 60 detik, supaya menu & chat melayang ikut berubah tanpa muat ulang.
 * `sure` false = gagal dicek sementara -> browser tetap memakai daftar lama.
 */
export async function GET() {
  const a = await getTabAccess();
  return NextResponse.json({ closed: [...a.blocked], sure: a.sure }, { headers: { "Cache-Control": "no-store, private" } });
}
