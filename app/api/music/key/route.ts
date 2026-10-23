import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Kunci Gemini KHUSUS musik (Lyria RealTime) — hanya untuk user yang login.
 * Google belum mendukung token sementara untuk Lyria, jadi pakai key terpisah (project sendiri, kuota kecil)
 * di env GEMINI_MUSIC_API_KEY. Kalau bocor, cukup hapus key ini; key AI utama tidak terpengaruh.
 */
export async function GET() {
  await getCurrentUser();
  const key = (process.env.GEMINI_MUSIC_API_KEY ?? "").trim();
  if (!key) return NextResponse.json({ error: "Musik AI belum disetel (GEMINI_MUSIC_API_KEY)." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ key, model: (process.env.GEMINI_MUSIC_MODEL ?? "models/lyria-realtime-exp").trim() }, { headers: { "Cache-Control": "no-store, private" } });
}
