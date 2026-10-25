"use client";

/**
 * Adegan premium teaser CS Tracker (layout.kind "teaser", layout.shot). Tiap adegan = UI website yang dibuat ulang
 * dari komponen asli + kamera virtual; urutan & isi mengikuti assets/audio/teaser/cue-sheet.md dan naskah-vo.md.
 */
import type { ComponentType } from "react";
import type { TeaserShot } from "@/lib/studio/timeline";
import { useScene } from "../theme";
import { AiShot } from "./shots/ai";
import { HookShot, OutroShot, RevealShot } from "./shots/intro";
import { MontageShot } from "./shots/montage";
import { ChatShot, MusicReportShot } from "./shots/team";
import { TrainAiShot } from "./shots/train";
import { TwsShot } from "./shots/tws";
import { DashboardShot, VideoReviewShot } from "./shots/work";

export const SHOTS: Record<TeaserShot, ComponentType> = {
  hook: HookShot,
  reveal: RevealShot,
  dashboard: DashboardShot,
  videoReview: VideoReviewShot,
  chat: ChatShot,
  ai: AiShot,
  tws: TwsShot,
  trainAi: TrainAiShot,
  musicReport: MusicReportShot,
  montage: MontageShot,
  outro: OutroShot,
};

export function TeaserL() {
  const { scene } = useScene();
  const Shot = SHOTS[scene.layout.shot ?? "hook"] ?? HookShot;
  return <Shot />;
}
