"use client";

import type { ComponentType } from "react";
import { FPS, H, W } from "./ugc/kit";
import { UGC_DEFAULTS, UGC_DURATION, UgcFitur } from "./ugc/UgcFitur";

export type Field = { key: string; label: string; type: "text" | "toggle"; hint?: string };

export type Comp = {
  id: string;
  title: string;
  desc: string;
  component: ComponentType<Record<string, unknown>>;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  defaultProps: Record<string, unknown>;
  fields: Field[];
};

/** Daftar video di menu Remotion. Mau tambah video baru: bikin komponennya lalu daftarkan di sini. */
export const COMPOSITIONS: Comp[] = [
  {
    id: "ugc-fitur-cs-tracker",
    title: "UGC — Fitur CS Tracker",
    desc: "Video vertikal 9:16 (TikTok / Reels / Shorts): dashboard, HOT otomatis, AI, chat, report.",
    component: UgcFitur as unknown as ComponentType<Record<string, unknown>>,
    width: W,
    height: H,
    fps: FPS,
    durationInFrames: UGC_DURATION,
    defaultProps: UGC_DEFAULTS,
    fields: [
      { key: "hook", label: "Hook (teks pembuka)", type: "text", hint: "3 detik pertama — bikin orang berhenti scroll" },
      { key: "prompt", label: "Prompt yang diketik ke AI", type: "text" },
      { key: "cta", label: "Ajakan di akhir (CTA)", type: "text" },
      { key: "captions", label: "Tampilkan caption", type: "toggle", hint: "matikan kalau mau pakai teks sendiri di CapCut" },
    ],
  },
];
