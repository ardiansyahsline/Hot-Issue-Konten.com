"use client";

/**
 * Template "Teaser CS Tracker (premium)" untuk menu 🧩 Template lama: StudioVideo + timeline teaser bawaan (lib/studio/teaser.ts).
 * Ukuran, fps & durasi dihitung dengan studioMeta — sama dengan Studio Pro & remotion/Root.tsx (komposisi TeaserCsTracker).
 *
 * Timeline bawaan TIDAK punya suara VO (tl.vo kosong: file VO dibuat per proyek di Studio Pro & disimpan di storage Studio),
 * jadi preview & render browser di menu ini = versi tanpa VO (musik + SFX + teks). Versi dengan VO:
 * Studio Pro → 🎞️ Buka Teaser CS Tracker → Bikin suara VO → Download (ExportPanel).
 */
import type { FC } from "react";
import { teaserTimeline } from "@/lib/studio/teaser";
import { StudioVideo, studioMeta } from "./studio/StudioVideo";

const TIMELINE = teaserTimeline();

/** 1080×1920, 30 fps, durasi = totalFrames + ekor hening (studioMeta) */
export const TEASER_META = studioMeta(TIMELINE);

export type TeaserCompProps = {
  /** true = suara VO + subtitle KALAU timeline punya VO (timeline bawaan tidak punya); false = musik + SFX + teks */
  vo?: boolean;
};
export const TEASER_DEFAULTS: TeaserCompProps = { vo: false };

/**
 * file MP4 jadi disajikan lewat route terlindungi — BUKAN public/ (isi internal, nama asli tim). Lihat assets/videos/BACA-INI.md.
 * `vo` HANYA untuk VO final (bank suara Alif). MP4 dengan VO sementara (cadangan Edge) dari Studio Pro bernama
 * `…-vo-sementara.mp4` (ExportPanel) dan sengaja tidak disajikan di menu ini supaya tidak dikira versi final.
 */
export const TEASER_FILES = {
  vo: "/api/studio/video/teaser-cs-tracker.mp4",
  novo: "/api/studio/video/teaser-cs-tracker-tanpa-vo.mp4",
} as const;

export const TeaserCsTracker: FC<TeaserCompProps> = ({ vo = false }) => <StudioVideo timeline={TIMELINE} audio={vo ? "all" : "novo"} />;
