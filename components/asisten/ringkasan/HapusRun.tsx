"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { hapusRun } from "@/app/(app)/asisten-review/ringkasan/actions";

/** admin: hapus run uji lama (hasil per video + laporan ikut terhapus) */
export default function HapusRun({ runId, nama }: { runId: string; nama: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const klik = () => {
    if (!window.confirm(`Hapus run "${nama}"? Hasil per video dan laporannya ikut terhapus. Tidak bisa dibatalkan.`)) return;
    setErr(null);
    start(async () => {
      const r = await hapusRun(runId);
      if (r.error) setErr(r.error);
      else router.push("/asisten-review/ringkasan");
    });
  };
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button type="button" className="btn-danger px-3 py-2 text-xs" onClick={klik} disabled={pending}>
        {pending ? "Menghapus…" : "🗑️ Hapus run"}
      </button>
      {err && (
        <span role="alert" className="max-w-[240px] text-right text-[11px] text-red-400">
          {err}
        </span>
      )}
    </span>
  );
}
