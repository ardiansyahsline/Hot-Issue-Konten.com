import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { aiConfig, aiHeaders } from "@/lib/ai.server";

export const dynamic = "force-dynamic";

let cache: { at: number; ids: string[] } | null = null;

/** Daftar model dari OmniRoute (disimpan 10 menit) */
export async function GET() {
  await getCurrentUser();
  const cfg = aiConfig();
  if (!cfg.ok) return NextResponse.json({ models: [], default: cfg.model, ready: false });
  if (!cache || Date.now() - cache.at > 600000) {
    try {
      const r = await fetch(`${cfg.base}/models`, { headers: aiHeaders(cfg.key), signal: AbortSignal.timeout(8000) });
      const j = await r.json();
      const ids = ((j?.data ?? []) as { id?: string }[]).map((m) => String(m.id ?? "")).filter(Boolean);
      cache = { at: Date.now(), ids: [...new Set(ids)].sort((a, b) => a.localeCompare(b)) };
    } catch {
      return NextResponse.json({ models: cache?.ids ?? [], default: cfg.model, ready: true });
    }
  }
  return NextResponse.json({ models: cache.ids, default: cfg.model, ready: true });
}
