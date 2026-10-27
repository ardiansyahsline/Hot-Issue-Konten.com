"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type { StudioStatus } from "@/lib/studio/client";
import { ETA_ORPHAN_MS, etaView, modelsHint, serverNow, trackEta, type EtaJob, type EtaTrack } from "@/lib/studio/eta";

/**
 * Perkiraan waktu selesai job laptop di Studio (lib/studio/eta.ts):
 * - EtaChip: "⏱ ±40 dtk lagi" yang menghitung mundur dari TENGGAT per job (trackEta: pesan baru " · sisa ±… " hanya menggeser tenggat
 *   kalau keluar dari pita ketidakpastiannya → tidak naik-turun tiap patch), berhenti di "sebentar lagi"; job yatim (updated_at > 5 menit)
 *   → disembunyikan. Angka per detik tidak dibacakan pembaca layar (aria-hidden); yang dibacakan teks kasar yang hanya berubah saat
 *   satuan / kelompoknya berubah.
 * - WarmBadge: "Laptop siap" (mesin sudah dimuat) / "Laptop menyiapkan mesin suara…" (info.loading) / netral "mesin dimuat saat job
 *   pertama" (belum dimuat & tidak sedang disiapkan); worker lama tanpa info.warm → tidak tampil.
 * - ModelsHint: petunjuk kecil kalau ada model laptop yang belum diunduh (info.models), mis. penilai kealamian (UTMOS).
 */

/** tenggat per id job — bertahan walau chip dilepas & dipasang lagi (popover dibuka ulang, panel dirender ulang) */
const TRACKS = new Map<string, EtaTrack>();
const TRACKS_MAX = 64;

function remember(key: string, t: EtaTrack | null): void {
  TRACKS.delete(key);
  if (!t) return;
  TRACKS.set(key, t);
  while (TRACKS.size > TRACKS_MAX) {
    const first = TRACKS.keys().next().value;
    if (first === undefined) break;
    TRACKS.delete(first);
  }
}

/**
 * `live` false = chip berada di dalam wilayah role="status" lain (wilayah itu sudah membacakan isinya) → teks pembaca layar chip
 * tidak dijadikan wilayah aria-live sendiri (tidak dibacakan dua kali).
 */
export function EtaChip({ job, className = "", live = true }: { job: EtaJob | null | undefined; className?: string; live?: boolean }) {
  const id = typeof job?.id === "string" && job.id ? job.id : null;
  const status = job?.status ?? null;
  const message = job?.message ?? null;
  const updatedAt = job?.updated_at ?? null;
  const inst = useId();
  const key = id ?? `chip${inst}`; // job tanpa id: tenggat milik chip ini saja

  // tenggat baru dihitung HANYA saat pesan / updated_at / status berubah (dihitung ulang dengan masukan sama → tenggat sama)
  const track = useMemo(() => {
    const t = trackEta(TRACKS.get(key) ?? null, { id, status, message, updated_at: updatedAt }, serverNow());
    remember(key, t);
    return t;
  }, [key, id, status, message, updatedAt]);

  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    if (!track) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const n = serverNow();
      setNow(n);
      const v = etaView(track, n);
      if (!v) return; // disembunyikan (yatim) → berhenti
      // menghitung mundur → tiap detik; sudah "sebentar lagi" → cukup satu kali lagi saat job dianggap yatim (chip disembunyikan)
      timer = setTimeout(tick, v.done ? Math.max(1000, track.at + ETA_ORPHAN_MS - n + 50) : 1000);
    };
    tick();
    return () => clearTimeout(timer);
  }, [track]);

  const v = etaView(track, now);
  if (!v) return null;
  return (
    <span
      className={`inline-flex flex-none items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ring-1 ring-inset ${v.done ? "bg-zinc-800/70 text-zinc-300 ring-zinc-700" : "bg-orange-500/10 text-orange-300 ring-orange-500/30"} ${className}`}
      data-job-eta={v.done ? 0 : Math.ceil(v.left)}
    >
      <span aria-hidden="true">⏱ {v.text}</span>
      {live ? (
        <span className="sr-only" aria-live="polite" aria-atomic="true">
          {v.spoken}
        </span>
      ) : (
        <span className="sr-only">{v.spoken}</span>
      )}
    </span>
  );
}

/** info.warm dari detak worker: true = mesin suara berikutnya sudah dimuat, false = belum, undefined = worker lama / laptop mati */
export const warmOf = (s: StudioStatus | null | undefined): boolean | undefined => (s?.worker.online && typeof s.worker.warm === "boolean" ? s.worker.warm : undefined);
/** info.loading: mesin suara sedang disiapkan (dimuat / dipanaskan / modelnya diunduh di latar) */
export const loadingOf = (s: StudioStatus | null | undefined): boolean => !!(s?.worker.online && s.worker.loading === true);

export function WarmBadge({ warm, loading = false }: { warm: boolean | null | undefined; loading?: boolean | null }) {
  if (warm === true)
    return (
      <span className="badge bg-emerald-500/10 text-emerald-400 ring-emerald-500/30" data-laptop-warm="1">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        Laptop siap
      </span>
    );
  if (warm === false && loading)
    return (
      <span className="badge bg-amber-500/10 text-amber-400 ring-amber-500/30" data-laptop-warm="0">
        <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
        Laptop menyiapkan mesin suara…
      </span>
    );
  if (warm === false)
    return (
      <span className="badge bg-zinc-800/70 text-zinc-400 ring-zinc-700" data-laptop-warm="dingin">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-zinc-500" />
        Laptop siap · mesin dimuat saat job pertama
      </span>
    );
  return null;
}

/** petunjuk model laptop yang belum siap (hanya saat laptop nyala & melapor info.models) */
export function ModelsHint({ status, className = "text-[10.5px]" }: { status: StudioStatus | null | undefined; className?: string }) {
  const hint = status?.worker.online ? modelsHint(status.worker.models) : null;
  if (!hint) return null;
  return (
    <p className={`leading-relaxed text-zinc-500 ${className}`} data-laptop-models>
      💡 {hint}
    </p>
  );
}
