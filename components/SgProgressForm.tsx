"use client";

import { useActionState, useState } from "react";
import { SG_STATUSES, type SgStatus } from "@/lib/suggestions";
import type { SgState } from "@/app/(app)/catatan/actions";

export default function SgProgressForm({
  action,
  status,
  reason,
}: {
  action: (prev: SgState, fd: FormData) => Promise<SgState>;
  status: SgStatus;
  reason: string | null;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [value, setValue] = useState<SgStatus>(status);
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="status" value={value} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(Object.entries(SG_STATUSES) as [SgStatus, (typeof SG_STATUSES)[SgStatus]][]).map(([k, v]) => (
          <button
            type="button"
            key={k}
            onClick={() => setValue(k)}
            className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-[13px] font-semibold transition ${
              value === k ? "border-orange-500 bg-orange-500/10 text-zinc-100" : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700"
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${v.dot}`} />
            {v.label}
          </button>
        ))}
      </div>
      <textarea
        name="status_reason"
        rows={2}
        defaultValue={reason ?? ""}
        placeholder={value === "rejected" ? "Alasan di-reject (wajib)…" : "Alasan / keterangan progress (opsional)…"}
        className="input"
      />
      <div className="flex items-center justify-end gap-3">
        {state && <span className={`text-sm ${state.error ? "text-red-400" : "text-emerald-400"}`}>{state.error ?? state.ok}</span>}
        <button disabled={pending} className="btn-primary">{pending ? "Menyimpan…" : "Simpan progress"}</button>
      </div>
    </form>
  );
}
