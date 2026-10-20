"use client";

import Link from "next/link";
import { useActionState } from "react";
import { VR_CATEGORIES, VR_STATUSES } from "@/lib/videoReview";
import type { VideoReviewRow } from "@/lib/types";
import type { VrFormState } from "@/app/(app)/video-review/actions";

export default function VrForm({
  action,
  review,
  today,
}: {
  action: (prev: VrFormState, fd: FormData) => Promise<VrFormState>;
  review?: VideoReviewRow;
  today: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="space-y-5">
      <div className="card space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="report_date">Tanggal report *</label>
            <input id="report_date" name="report_date" type="date" required defaultValue={review?.report_date ?? today} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="category">Kategori</label>
            <select id="category" name="category" defaultValue={review?.category ?? ""} className="input">
              <option value="">Otomatis (dari penjelasan)</option>
              {VR_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="status">Status</label>
            <select id="status" name="status" defaultValue={review?.status ?? "menunggu"} className="input">
              {Object.entries(VR_STATUSES).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="explanation">Penjelasan *</label>
          <input
            id="explanation"
            name="explanation"
            required
            defaultValue={review?.explanation}
            placeholder="Contoh: Permintaan pengajuan banding"
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="links">Email / link video</label>
          <textarea
            id="links"
            name="links"
            rows={4}
            defaultValue={review?.links.map((l) => l.value).join("\n")}
            placeholder={"Satu per baris, contoh:\nclipper@gmail.com\nhttps://vt.tiktok.com/xxxx/"}
            className="input font-mono text-xs"
          />
        </div>
      </div>

      <div className="card space-y-4 p-5">
        <div>
          <label className="label" htmlFor="resolution">Penyelesaian</label>
          <textarea id="resolution" name="resolution" rows={2} defaultValue={review?.resolution ?? ""} placeholder="Contoh: Disetujui (Irsyad) / Belum ada respons" className="input" />
        </div>
        <div>
          <label className="label" htmlFor="notes">Catatan</label>
          <textarea id="notes" name="notes" rows={4} defaultValue={review?.notes ?? ""} placeholder={"Insight / temuan reviewer…\nArgumen clipper: (opsional)"} className="input" />
        </div>
      </div>

      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}

      <div className="flex justify-end gap-2">
        <Link href={review ? `/video-review/${review.id}` : "/video-review"} className="btn-ghost">Batal</Link>
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Menyimpan..." : review ? "Simpan perubahan" : "Simpan kasus"}
        </button>
      </div>
    </form>
  );
}
