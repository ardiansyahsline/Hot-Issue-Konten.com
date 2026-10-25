"use client";

import type { ComponentType } from "react";
import { TEASER_DEFAULTS, TEASER_FILES, TEASER_META, TeaserCsTracker } from "./teaserComp";
import { FPS, H, W } from "./ugc/kit";
import { UGC_DEFAULTS, UGC_DURATION, UgcFitur } from "./ugc/UgcFitur";

export type Field = {
  key: string;
  label: string;
  type: "text" | "toggle";
  hint?: string;
  /** pilihan versi (mis. dengan/tanpa VO), bukan editan teks — file jadi versi itu tetap bisa langsung didownload */
  variant?: boolean;
};

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
  /**
   * file MP4 yang sudah jadi (versi teks awal) — bisa langsung didownload tanpa render. Boleh fungsi dari props (versi).
   * Tombolnya hanya tampil kalau filenya benar-benar ada (dicek HEAD dulu), jadi aman kalau file belum diunggah.
   */
  file?: string | ((props: Record<string, unknown>) => string | undefined);
  /** catatan kecil di bawah tombol download */
  note?: string;
};

/** alamat file jadi untuk props sekarang */
export const fileOf = (c: Comp, props: Record<string, unknown>) => (typeof c.file === "function" ? c.file(props) : c.file);

/** Daftar video di menu Remotion. Mau tambah video baru: bikin komponennya lalu daftarkan di sini. */
export const COMPOSITIONS: Comp[] = [
  {
    id: "teaser-cs-tracker",
    title: "Teaser CS Tracker (premium)",
    desc: "Trailer 9:16 ±60 dtk: 11 adegan buatan tangan (hot issue, video review, chat, AI, desain berita, train AI, musik, Studio).",
    component: TeaserCsTracker as unknown as ComponentType<Record<string, unknown>>,
    width: TEASER_META.width,
    height: TEASER_META.height,
    fps: TEASER_META.fps,
    durationInFrames: TEASER_META.durationInFrames,
    defaultProps: TEASER_DEFAULTS,
    file: (p) => (p.vo === false ? TEASER_FILES.novo : TEASER_FILES.vo),
    note: "Mau suara VO sendiri? Buka Studio Pro → 🎞️ Buka Teaser CS Tracker → Bikin suara VO, lalu Download (Dengan VO / Tanpa VO).",
    fields: [{ key: "vo", label: "Pakai VO", type: "toggle", variant: true, hint: "Matikan buat versi musik + SFX + teks (tanpa subtitle VO)." }],
  },
  {
    id: "ugc-fitur-cs-tracker",
    title: "UGC — Fitur CS Tracker (arsip)",
    desc: "Video vertikal 9:16 (TikTok / Reels / Shorts): dashboard, HOT otomatis, AI, chat, report.",
    component: UgcFitur as unknown as ComponentType<Record<string, unknown>>,
    width: W,
    height: H,
    fps: FPS,
    durationInFrames: UGC_DURATION,
    defaultProps: UGC_DEFAULTS,
    file: "/videos/ugc-fitur-cs-tracker.mp4",
    note: "Belum ada suara — tambahin musik / voice over di CapCut biar makin UGC.",
    fields: [
      { key: "hook", label: "Hook (teks pembuka)", type: "text", hint: "3 detik pertama — bikin orang berhenti scroll" },
      { key: "prompt", label: "Prompt yang diketik ke AI", type: "text" },
      { key: "cta", label: "Ajakan di akhir (CTA)", type: "text" },
      { key: "captions", label: "Tampilkan caption", type: "toggle", hint: "matikan kalau mau pakai teks sendiri di CapCut" },
    ],
  },
];
