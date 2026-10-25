"use client";

/**
 * Template "Teaser CS Tracker (premium)" untuk menu 🧩 Template lama: StudioVideo + timeline teaser bawaan (lib/studio/teaser.ts).
 * Ukuran, fps & durasi dihitung dengan studioMeta — sama dengan Studio Pro & remotion/Root.tsx (komposisi TeaserCsTracker).
 */
import type { FC } from "react";
import { teaserTimeline } from "@/lib/studio/teaser";
import { StudioVideo, studioMeta } from "./studio/StudioVideo";

const TIMELINE = teaserTimeline();

/** 1080×1920, 30 fps, durasi = totalFrames + ekor hening (studioMeta) */
export const TEASER_META = studioMeta(TIMELINE);

export type TeaserCompProps = {
  /** true = subtitle VO + suara VO (kalau timeline punya VO); false = versi musik + SFX + teks */
  vo?: boolean;
};
export const TEASER_DEFAULTS: TeaserCompProps = { vo: true };

/** file MP4 jadi (dirender di laptop) disajikan lewat route terlindungi — BUKAN public/ (isi internal, nama asli tim) */
export const TEASER_FILES = {
  vo: "/api/studio/video/teaser-cs-tracker.mp4",
  novo: "/api/studio/video/teaser-cs-tracker-tanpa-vo.mp4",
} as const;

export const TeaserCsTracker: FC<TeaserCompProps> = ({ vo = true }) => <StudioVideo timeline={TIMELINE} audio={vo === false ? "novo" : "all"} />;
