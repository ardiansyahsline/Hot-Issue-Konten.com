"use client";

import { useEffect, useState } from "react";
import { BED_BPM } from "@/components/remotion/studio/audio";
import type { Catalog } from "@/lib/studio/client";
import { maxMusicOffset, type Timeline } from "@/lib/studio/timeline";

export const isMusicFile = (src: string | undefined): boolean => !!src && src !== "none" && src !== "bed";

/**
 * Ganti musik (kartu rencana & "＋ Musik" di timeline): mulai dari awal lagu, ketukan dideteksi ulang (useBeats), volume lama
 * file musik ikut. `upload` = musik yang baru diupload (belum ada di katalog).
 */
export function withMusicSrc(tl: Timeline, src: string, catalog: Catalog | null, upload?: { name: string }): Timeline {
  const music = tl.music;
  const keep = { offset: 0, gain: music.gain ?? 0, beats: null };
  if (src === "bed") return { ...tl, music: { ...keep, src, name: "Trailer bed (cadangan)", bpm: BED_BPM, lufs: null } };
  if (src === "none") return { ...tl, music: { ...keep, src, name: "Tanpa musik", bpm: null, lufs: null } };
  if (upload) return { ...tl, music: { ...keep, src, name: upload.name.replace(/\.[^.]+$/, "").slice(0, 80) || "Musik upload", bpm: null, lufs: null } };
  const m = catalog?.music.find((x) => x.src === src);
  return { ...tl, music: { ...keep, src, name: m?.name ?? music.name, bpm: null, lufs: m?.lufs ?? null } };
}

/** offset musik (detik lagu yang dilewati), dibulatkan 0,1 dtk & dijepit ke panjang lagu `dur` (ikut disimpan) */
export function withMusicOffset(tl: Timeline, offset: number, dur: number): Timeline {
  const off = Math.round(Math.min(Math.max(0, offset), maxMusicOffset(dur)) * 10) / 10;
  return { ...tl, music: { ...tl.music, offset: off, dur: Math.round(dur * 1000) / 1000 } };
}

const durCache = new Map<string, number>();

/** panjang file musik (detik) dari metadata browser; null = belum / tidak bisa dibaca. Tidak mengubah timeline */
export function useMusicDur(src: string | undefined, known?: number): number | null {
  const file = isMusicFile(src) ? (src as string) : null;
  const [, bump] = useState(0);
  useEffect(() => {
    if (!file || durCache.has(file) || typeof Audio === "undefined") return;
    const a = new Audio();
    a.preload = "metadata";
    const ok = () => {
      if (Number.isFinite(a.duration) && a.duration > 0) {
        durCache.set(file, a.duration);
        bump((n) => n + 1);
      }
    };
    a.addEventListener("loadedmetadata", ok);
    a.src = file;
    return () => {
      a.removeEventListener("loadedmetadata", ok);
      a.removeAttribute("src");
      a.load();
    };
  }, [file]);
  if (!file) return null;
  return durCache.get(file) ?? (known && known > 0 ? known : null);
}
