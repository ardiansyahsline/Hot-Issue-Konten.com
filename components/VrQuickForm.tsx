"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { VR_CATEGORIES, VR_STATUSES } from "@/lib/videoReview";
import { createReviewInline } from "@/app/(app)/video-review/actions";

/** Form "Input kasus baru" — layout melebar seperti sheet, tetap di halaman setelah simpan */
export default function VrQuickForm({ today }: { today: string }) {
  const [state, action, pending] = useActionState(createReviewInline, undefined);
  const [formKey, setFormKey] = useState(0);
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state?.ok) {
      setFormKey((k) => k + 1); // kosongkan form
      setTimeout(() => firstField.current?.focus(), 50);
    }
  }, [state]);

  return (
    <form key={formKey} action={action} className="card p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <h2 className="section-title">Input kasus baru</h2>
        <span className="text-[12px] text-zinc-500">Dicatat otomatis atas nama kamu</span>
      </div>
      <div className="grid gap-4 md:grid-cols-[160px_1.4fr_1fr_170px]">
        <div>
          <label className="label" htmlFor="q_date">Tanggal report</label>
          <input id="q_date" name="report_date" type="date" required defaultValue={today} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="q_expl">Penjelasan *</label>
          <input ref={firstField} id="q_expl" name="explanation" required placeholder="Contoh: Permintaan pengajuan banding" className="input" />
        </div>
        <div>
          <label className="label" htmlFor="q_cat">Kategori</label>
          <select id="q_cat" name="category" defaultValue="" className="input">
            <option value="">Otomatis (dari penjelasan)</option>
            {VR_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="q_status">Status</label>
          <select id="q_status" name="status" defaultValue="menunggu" className="input">
            {Object.entries(VR_STATUSES).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-4">
        <div>
          <label className="label" htmlFor="q_links">Email / link (satu per baris)</label>
          <textarea id="q_links" name="links" rows={3} placeholder={"clipper@gmail.com\nhttps://vt.tiktok.com/…"} className="input font-mono text-xs" />
        </div>
        <div>
          <label className="label" htmlFor="q_res">Penyelesaian</label>
          <textarea id="q_res" name="resolution" rows={3} placeholder="Disetujui (Irsyad)…" className="input" />
        </div>
        <div className="md:col-span-2">
          <label className="label" htmlFor="q_notes">Catatan</label>
          <textarea id="q_notes" name="notes" rows={3} placeholder={"Insight / temuan reviewer…\nArgumen clipper: (opsional)"} className="input" />
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
        {state?.error && <span className="text-sm text-red-400">{state.error}</span>}
        {state?.ok && <span className="text-sm text-emerald-400">✓ {state.ok}</span>}
        <button type="reset" className="btn-ghost">Reset</button>
        <button disabled={pending} className="btn-primary">{pending ? "Menyimpan…" : "Simpan kasus"}</button>
      </div>
    </form>
  );
}
