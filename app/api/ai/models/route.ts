import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { aiConfig, listModels } from "@/lib/ai.server";
import { isChatModel, isVisionModel, pickTextModel, pickVisionModel } from "@/lib/aiModels";

export const dynamic = "force-dynamic";

/** Daftar model untuk pemilih model (model non-chat disembunyikan) */
export async function GET() {
  await getCurrentUser();
  const cfg = aiConfig();
  if (!cfg.ok) return NextResponse.json({ models: [], ready: false });
  const all = await listModels();
  const models = all.filter(isChatModel);
  return NextResponse.json({
    ready: true,
    models,
    vision: models.filter(isVisionModel),
    bestText: pickTextModel(all),
    bestVision: cfg.visionModel || pickVisionModel(all),
    default: cfg.model,
  });
}
