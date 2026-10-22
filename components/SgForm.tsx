"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { SG_CATEGORIES, type SgCategory, type SuggestionRow } from "@/lib/suggestions";
import type { SgState } from "@/app/(app)/catatan/actions";
import AttachmentPicker from "./attach/AttachmentPicker";

export default function SgForm({
  action,
  suggestion,
  people,
  currentUserId,
  compact,
}: {
  action: (prev: SgState, fd: FormData) => Promise<SgState>;
  suggestion?: SuggestionRow;
  /** hanya diisi untuk admin — kalau ada, muncul pilihan "Dicatat oleh" */
  people?: { id: string; full_name: string | null; email: string | null }[];
  currentUserId: string;
  compact?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [category, setCategory] = useState<SgCategory | "">(suggestion?.category ?? "");

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="category" value={category} />
      <div>
        <div className="label">Kategori</div>
        <div className={`grid grid-cols-2 gap-2 ${compact ? "" : "sm:grid-cols-3"}`}>
          {(Object.entries(SG_CATEGORIES) as [SgCategory, (typeof SG_CATEGORIES)[SgCategory]][]).map(([k, v]) => (
            <button
              type="button"
              key={k}
              onClick={() => setCategory(k)}
              className={`rounded-xl border px-3 py-2.5 text-left transition ${
                category === k
                  ? "border-orange-500 bg-orange-500/10"
                  : "border-zinc-800 bg-zinc-950 hover:border-zinc-700"
              }`}
            >
              <div className="text-[13px] font-semibold">{v.icon} {v.label}</div>
              {!compact && <div className="mt-0.5 text-[11.5px] leading-snug text-zinc-500">{v.desc}</div>}
            </button>
          ))}
        </div>
      </div>
      <p className="-mt-2 text-[12px] text-zinc-500">
        Ada bug / error? Laporkan lewat{" "}
        <Link href="/issues/new?category=Bug%20platform" className="font-semibold text-orange-400 hover:underline">Hot Issue (Bug platform)</Link>.
      </p>
      <div>
        <label className="label" htmlFor="title">Judul</label>
        <input id="title" name="title" required defaultValue={suggestion?.title} placeholder="Ringkas, mis. “Clipper sering tanya kenapa views belum update”" className="input" />
      </div>
      <div>
        <label className="label" htmlFor="body">Detail / catatan</label>
        <textarea id="body" name="body" rows={compact ? 3 : 6} defaultValue={suggestion?.body ?? ""} placeholder="Ceritakan konteksnya, contoh kasus, atau usulan solusinya…" className="input" />
      </div>
      <div>
        <div className="label">Bukti / lampiran (opsional)</div>
        <AttachmentPicker userId={currentUserId} compact={compact} pasteGlobal />
        {suggestion && <p className="mt-1.5 text-[11.5px] text-zinc-500">Lampiran yang sudah ada bisa dilihat & dihapus di halaman detail.</p>}
      </div>
      {people && (
        <div>
          <label className="label" htmlFor="created_by">Dicatat oleh (khusus admin)</label>
          <select id="created_by" name="created_by" defaultValue={suggestion?.created_by ?? currentUserId} className="input">
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
            ))}
          </select>
        </div>
      )}
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      <div className="flex justify-end gap-2">
        {suggestion && <Link href={`/catatan/${suggestion.id}`} className="btn-ghost">Batal</Link>}
        <button disabled={pending} className="btn-primary">
          {pending ? "Menyimpan…" : suggestion ? "Simpan perubahan" : "Kirim catatan"}
        </button>
      </div>
    </form>
  );
}
