"use client";

import { useState, useTransition } from "react";
import { VR_STATUSES, type VrStatus } from "@/lib/videoReview";
import { setReviewStatus } from "@/app/(app)/video-review/actions";

export default function VrStatusSelect({ id, status }: { id: number; status: VrStatus }) {
  const [value, setValue] = useState<VrStatus>(status);
  const [pending, start] = useTransition();
  const cls = VR_STATUSES[value]?.cls ?? "";
  return (
    <select
      value={value}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value as VrStatus;
        setValue(next);
        start(() => setReviewStatus(id, next));
      }}
      className={`cursor-pointer appearance-none rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset focus:outline-none ${cls} ${pending ? "opacity-60" : ""}`}
      aria-label="Status"
    >
      {Object.entries(VR_STATUSES).map(([k, v]) => (
        <option key={k} value={k}>{v.label}</option>
      ))}
    </select>
  );
}
