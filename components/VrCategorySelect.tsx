"use client";

import { useState, useTransition } from "react";
import { VR_CATEGORIES } from "@/lib/videoReview";
import { setReviewCategory } from "@/app/(app)/video-review/actions";

export default function VrCategorySelect({ id, category }: { id: number; category: string | null }) {
  const [value, setValue] = useState(category ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex items-center gap-1">
      <select
        value={value}
        disabled={pending}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          const next = e.target.value;
          const prev = value;
          setValue(next);
          start(async () => {
            const res = await setReviewCategory(id, next);
            if (res?.error) {
              setErr(res.error);
              setValue(prev);
            } else setErr(null);
          });
        }}
        className={`rounded-md border px-1.5 py-0.5 text-xs focus:outline-none ${
          value ? "border-zinc-700 bg-zinc-800 text-zinc-200" : "border-amber-700/60 bg-amber-950/30 text-amber-300"
        }`}
        aria-label="Kategori"
      >
        <option value="">— Belum dikategorikan —</option>
        {VR_CATEGORIES.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      {pending && <span className="text-xs text-zinc-500">…</span>}
      {err && <span className="text-xs text-red-400">{err}</span>}
    </span>
  );
}
