import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** versi web yang sedang online — dibandingkan dengan versi di tab yang terbuka (lihat components/UpdateNotice.tsx) */
export function GET() {
  return NextResponse.json({ v: process.env.NEXT_PUBLIC_BUILD_ID ?? "" }, { headers: { "Cache-Control": "no-store" } });
}
