"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { addAsReport, findSimilarIssues, type SimilarIssue } from "@/app/(app)/issues/reportActions";
import { STATUSES } from "@/lib/constants";
import { heatLevel } from "@/lib/utils";

/** Form Issue Baru: tampilkan topik aktif yang mirip + tombol "tambahkan sebagai laporan" supaya tidak dobel topik */
export default function SimilarTopics({ title }: { title: string }) {
  const [items, setItems] = useState<SimilarIssue[]>([]);
  const [hidden, setHidden] = useState(false);
  const { pending } = useFormStatus();

  useEffect(() => {
    const q = title.trim();
    if (q.length < 6) {
      setItems([]);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      findSimilarIssues(q)
        .then((r) => live && setItems(r))
        .catch(() => {});
    }, 450);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [title]);

  if (!items.length || hidden) return null;
  return (
    <div className="mt-2 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3" role="region" aria-label="Topik mirip">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12.5px] text-amber-300">
          <b>Mirip topik yang sudah ada.</b> Kalau kasusnya sama, tambahkan sebagai laporan — kontak, keterangan & bukti di form ini ikut masuk, dan topiknya makin HOT 🔥
        </p>
        <button type="button" onClick={() => setHidden(true)} className="text-[12px] text-zinc-500 hover:text-zinc-200" aria-label="Tutup saran">
          ✕
        </button>
      </div>
      <ul className="mt-2 space-y-1.5">
        {items.map((it) => (
          <li key={it.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800/80 bg-zinc-900 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] font-semibold">{it.title}</div>
              <div className="text-[11.5px] text-zinc-500">
                {it.category} · {STATUSES[it.status as keyof typeof STATUSES]?.label ?? it.status} ·{" "}
                <span className={it.report_count >= 2 ? "font-semibold text-red-400" : ""}>
                  {"🔥".repeat(Math.max(1, heatLevel(it.report_count)))} {it.report_count} laporan
                </span>
              </div>
            </div>
            <Link href={`/issues/${it.id}`} target="_blank" className="text-[12px] text-zinc-400 hover:text-zinc-100 hover:underline">
              Lihat
            </Link>
            <button
              type="submit"
              formAction={addAsReport.bind(null, it.id)}
              formNoValidate
              disabled={pending}
              className="rounded-lg bg-orange-500/15 px-2.5 py-1 text-[12px] font-semibold text-orange-400 hover:bg-orange-500/25"
            >
              + Tambahkan sebagai laporan
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
