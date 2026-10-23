import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { coinId } from "@/lib/aiWeb.server";
import { candlesFor, isTf } from "@/lib/candles.server";

export const dynamic = "force-dynamic";

/** Data candle untuk chart trade plan. ?symbol=PUMPUSDT|OANDA:XAUUSD|IDX:BBRI|AAPL &tf=1m..1w */
export async function GET(req: NextRequest) {
  await getCurrentUser();
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").toUpperCase().slice(0, 40);
  const tfIn = (req.nextUrl.searchParams.get("tf") ?? "1d").toLowerCase();
  return NextResponse.json(await candlesFor(symbol, isTf(tfIn) ? tfIn : "1d", coinId));
}
