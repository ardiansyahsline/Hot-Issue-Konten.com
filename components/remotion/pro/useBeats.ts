"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { createVoiceJob, useStudioJob, useStudioStatus, type VoiceJob } from "@/lib/studio/client";
import { MAX_TOTAL, type Music, type Timeline } from "@/lib/studio/timeline";
import { storagePathOf } from "@/lib/studio/urls";

type Found = Pick<Music, "bpm" | "beats" | "lufs">;

/** settings.src untuk job 'beats' di laptop: path storage atau "asset:music/<file>" (null = bed / tanpa musik / sumber lain) */
export function beatsSrcOf(src: string | null | undefined): string | null {
  const p = storagePathOf(src);
  if (p) return p;
  const m = /^\/api\/studio\/asset\/(music|sfx)\/([^/?#]+)$/.exec(src ?? "");
  if (!m) return null;
  try {
    return `asset:${m[1]}/${decodeURIComponent(m[2])}`;
  } catch {
    return null;
  }
}

/** musik yang belum punya BPM / ketukan -> perlu dideteksi di laptop */
const needsBeats = (m: Music | undefined): m is Music => !!m && m.src !== "none" && m.src !== "bed" && !m.bpm && (m.beats?.length ?? 0) < 2;

/** hasil job 'beats' -> nilai music yang valid (rentang sama dengan normalizeTimeline) */
export function beatsOf(r: VoiceJob["result"]): Found {
  const bpm = Number(r?.bpm);
  const lufs = Number(r?.lufs);
  const beats = (Array.isArray(r?.beats) ? r.beats : []).map(Number).filter((b) => Number.isFinite(b) && b >= 0 && b <= MAX_TOTAL);
  return {
    bpm: r?.bpm != null && bpm > 0 ? Math.min(240, Math.max(40, bpm)) : null,
    beats: beats.length >= 2 ? beats : null,
    lufs: r?.lufs != null && Number.isFinite(lufs) ? Math.min(0, Math.max(-40, lufs)) : null,
  };
}

/**
 * Deteksi BPM & ketukan musik upload / katalog lewat laptop (job 'beats'), satu job per musik.
 * Hasilnya (bpm, beats, lufs) ditulis ke tl.music lewat `onChange` — hanya kalau musiknya belum diganti.
 * Mengembalikan alasan ketukan belum ada (untuk keterangan tombol "Tempel ke ketukan"), null kalau tidak perlu.
 */
export function useBeats(tl: Timeline | null, projectId: string | null, tlRef: RefObject<Timeline | null>, onChange: (tl: Timeline) => void): string | null {
  const status = useStudioStatus();
  const online = !!status?.worker.online;
  const [pend, setPend] = useState<{ id: string; src: string } | null>(null);
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  /** musik yang sudah dimintakan job-nya (sesi ini) */
  const asked = useRef(new Set<string>());
  /** hasil per musik (dipakai lagi kalau user balik ke musik yang sama) */
  const found = useRef(new Map<string, Found>());
  const pendRef = useRef(pend);
  pendRef.current = pend;
  const gen = useRef(0);
  const cb = useRef(onChange);
  cb.current = onChange;

  const music = tl?.music;
  const need = needsBeats(music);
  const src = music?.src ?? "none";
  const key = need ? beatsSrcOf(src) : null;

  /** tulis hasil ke timeline terbaru, hanya kalau musiknya masih yang sama */
  const apply = (s: string, f: Found) => {
    const t = tlRef.current;
    if (!t || t.music.src !== s) return;
    // lufs dari katalog tetap dipakai; upload (lufs kosong) ikut hasil ukur laptop
    cb.current({ ...t, music: { ...t.music, bpm: f.bpm ?? t.music.bpm ?? null, beats: f.beats ?? t.music.beats ?? null, lufs: t.music.lufs ?? f.lufs } });
  };

  // musik baru tanpa ketukan + laptop nyala -> masukkan job 'beats'
  useEffect(() => {
    if (!key || failed.has(src)) return;
    const hit = found.current.get(src);
    if (hit) return apply(src, hit);
    if (!online || asked.current.has(src)) return;
    asked.current.add(src);
    // cuma satu job yang dipantau: job musik sebelumnya yang belum selesai dilepas (boleh diminta lagi nanti)
    const prev = pendRef.current;
    if (prev) asked.current.delete(prev.src);
    setPend(null);
    const g = ++gen.current;
    createVoiceJob({ kind: "beats", project_id: projectId, settings: { src: key } })
      .then((j) => {
        if (g === gen.current) setPend({ id: j.id, src });
        else asked.current.delete(src);
      })
      .catch(() => {
        if (g === gen.current) setFailed((f) => new Set(f).add(src));
      });
    // apply membaca ref terbaru
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, src, online, failed, projectId]);

  // ---------------- pantau job 'beats' ----------------
  const { job, missing } = useStudioJob<VoiceJob>("studio_voice_jobs", pend?.id ?? null);
  useEffect(() => {
    if (!pend) return;
    const fail = () => {
      setFailed((f) => new Set(f).add(pend.src));
      setPend(null);
    };
    if (missing) return fail();
    if (!job || job.id !== pend.id) return;
    if (job.status === "gagal" || job.status === "batal") return fail();
    if (job.status !== "selesai") return;
    const f = beatsOf(job.result);
    if (!f.bpm && !f.beats) return fail(); // ketukan tidak jelas -> tidak diminta ulang terus
    found.current.set(pend.src, f);
    setPend(null);
    apply(pend.src, f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, missing, pend]);

  if (!need || !beatsSrcOf(src)) return null;
  if (failed.has(src)) return "Ketukan musik ini tidak terdeteksi — potongan tidak bisa ditempel ke ketukan";
  if (status === null) return null;
  if (!online) return pend?.src === src ? "Laptop mati — deteksi ketukan musik menunggu laptop nyala" : "Laptop harus nyala untuk mendeteksi ketukan musik ini";
  return "Lagi mendeteksi ketukan musik di laptop…";
}
