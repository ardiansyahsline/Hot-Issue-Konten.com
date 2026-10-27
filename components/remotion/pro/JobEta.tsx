"use client";

import { useEffect, useState } from "react";
import type { StudioStatus } from "@/lib/studio/client";
import { etaLeft, etaSpoken, fmtEta, modelsHint, serverNow, type EtaJob } from "@/lib/studio/eta";

/**
 * Perkiraan waktu selesai job laptop di Studio (lib/studio/eta.ts):
 * - EtaChip: "⏱ ±40 dtk lagi" yang menghitung mundur tiap detik dari updated_at + " · sisa ±… " di pesan job, berhenti di
 *   "sebentar lagi". Angka per detik tidak dibacakan pembaca layar (aria-hidden); yang dibacakan teks kasar (per menit / 30 dtk).
 * - WarmBadge: "Laptop siap" / "Laptop menyiapkan mesin suara…" dari info.warm (worker lama tanpa info.warm → tidak tampil).
 * - ModelsHint: petunjuk kecil kalau ada model laptop yang belum diunduh (info.models), mis. penilai kealamian (UTMOS).
 */
export function EtaChip({ job, className = "" }: { job: EtaJob | null | undefined; className?: string }) {
  const status = job?.status ?? null;
  const message = job?.message ?? null;
  const updatedAt = job?.updated_at ?? null;
  const [now, setNow] = useState(() => serverNow());

  useEffect(() => {
    const j = { status, message, updated_at: updatedAt };
    const t0 = serverNow();
    setNow(t0);
    const left0 = etaLeft(j, t0);
    if (left0 === null || left0 <= 0) return;
    const t = setInterval(() => {
      const n = serverNow();
      setNow(n);
      if ((etaLeft(j, n) ?? 0) <= 0) clearInterval(t); // "sebentar lagi" → berhenti menghitung
    }, 1000);
    return () => clearInterval(t);
  }, [status, message, updatedAt]);

  const left = etaLeft({ status, message, updated_at: updatedAt }, now);
  if (left === null) return null;
  const done = left <= 0;
  return (
    <span
      className={`inline-flex flex-none items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ring-1 ring-inset ${done ? "bg-zinc-800/70 text-zinc-300 ring-zinc-700" : "bg-orange-500/10 text-orange-300 ring-orange-500/30"} ${className}`}
      data-job-eta={done ? 0 : Math.ceil(left)}
    >
      <span aria-hidden="true">⏱ {fmtEta(left)}</span>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {etaSpoken(left)}
      </span>
    </span>
  );
}

/** info.warm dari detak worker: true = mesin suara utama sudah dimuat & dipanaskan, false = masih menyiapkan, undefined = worker lama */
export const warmOf = (s: StudioStatus | null | undefined): boolean | undefined => (s?.worker.online && typeof s.worker.warm === "boolean" ? s.worker.warm : undefined);

export function WarmBadge({ warm }: { warm: boolean | null | undefined }) {
  if (warm === true)
    return (
      <span className="badge bg-emerald-500/10 text-emerald-400 ring-emerald-500/30" data-laptop-warm="1">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        Laptop siap
      </span>
    );
  if (warm === false)
    return (
      <span className="badge bg-amber-500/10 text-amber-400 ring-amber-500/30" data-laptop-warm="0">
        <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
        Laptop menyiapkan mesin suara…
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
