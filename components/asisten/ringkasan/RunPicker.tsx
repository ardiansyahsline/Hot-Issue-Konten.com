"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/** pilih run + run pembanding (banding versi rubrik) → ganti alamat ?run=&banding= */
export default function RunPicker({ runs, value, pembanding }: { runs: { id: string; nama: string }[]; value: string; pembanding: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (run: string, banding: string) => {
    const q = new URLSearchParams();
    if (run) q.set("run", run);
    if (banding && banding !== run) q.set("banding", banding);
    start(() => router.push(`/asisten-review/ringkasan${q.size ? `?${q}` : ""}`));
  };
  return (
    <div className={`grid w-full gap-2 sm:w-auto sm:grid-cols-2 ${pending ? "opacity-60" : ""}`} aria-busy={pending}>
      <label className="min-w-0">
        <span className="label">Run</span>
        <select className="input py-2 sm:w-64" value={value} onChange={(e) => go(e.target.value, pembanding)}>
          {runs.map((r) => (
            <option key={r.id} value={r.id}>
              {r.nama}
            </option>
          ))}
        </select>
      </label>
      <label className="min-w-0">
        <span className="label">Bandingkan dengan</span>
        <select className="input py-2 sm:w-64" value={pembanding} onChange={(e) => go(value, e.target.value)}>
          <option value="">— tidak —</option>
          {runs
            .filter((r) => r.id !== value)
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.nama}
              </option>
            ))}
        </select>
      </label>
    </div>
  );
}
