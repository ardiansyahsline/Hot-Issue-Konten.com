import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { aiConfig, healthMap, listCatalog, loadHealth } from "@/lib/ai.server";
import { isChatModel, isVisionModel, pickTextModel, pickVisionModel, setVisionCatalog } from "@/lib/aiModels";

export const dynamic = "force-dynamic";

/** Daftar model untuk pemilih hero. status: 0 = terbukti jalan, 1 = belum dicoba, 2 = baru gagal */
export async function GET() {
  const { supabase } = await getCurrentUser();
  const cfg = aiConfig();
  if (!cfg.ok) return NextResponse.json({ models: [], ready: false });
  const [catalog, health] = await Promise.all([listCatalog(), loadHealth(supabase)]);
  setVisionCatalog(catalog.vision);
  const chat = catalog.ids.filter(isChatModel);
  const hm = healthMap(chat, health);
  const status = (m: string) => hm.get(m) ?? 1;
  const models = chat
    .map((m, i) => ({ m, i, s: status(m) }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.m);
  const working = models.filter((m) => status(m) === 0);
  return NextResponse.json({
    ready: true,
    models,
    vision: models.filter(isVisionModel),
    status: Object.fromEntries(models.map((m) => [m, status(m)])),
    bestText: pickTextModel(working) ?? pickTextModel(models.filter((m) => status(m) < 2)) ?? pickTextModel(models),
    bestVision: cfg.visionModel || pickVisionModel(working) || pickVisionModel(models.filter((m) => status(m) < 2)) || pickVisionModel(models),
    visionList: models.filter(isVisionModel),
    default: cfg.model,
  });
}
