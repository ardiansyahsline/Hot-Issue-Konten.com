"use client";

import { useState, useTransition } from "react";
import { autoCategorize, saveCategoryNote, type ImportResult } from "@/app/(app)/video-review/actions";

export function AutoCategorizeButton({ count }: { count: number }) {
  const [res, setRes] = useState<ImportResult>(undefined);
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex items-center gap-2">
      <button disabled={pending} onClick={() => start(async () => setRes(await autoCategorize()))} className="btn-ghost text-xs">
        {pending ? "Mengkategorikan..." : `Isi kategori otomatis (${count} kosong)`}
      </button>
      {res && <span className={`text-xs ${res.error ? "text-red-400" : "text-emerald-400"}`}>{res.error ?? res.ok}</span>}
    </span>
  );
}

export function CategoryNote({ category, note, canWrite }: { category: string; note: string; canWrite: boolean }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(note);
  const [saved, setSaved] = useState(note);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!editing) {
    return (
      <div className="text-xs">
        {saved ? <p className="whitespace-pre-wrap text-zinc-300">📝 {saved}</p> : null}
        {canWrite && (
          <button onClick={() => setEditing(true)} className="mt-1 text-zinc-500 hover:text-orange-400">
            {saved ? "Edit catatan" : "+ Tambah catatan"}
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <textarea value={value} onChange={(e) => setValue(e.target.value)} rows={3} className="input text-xs" placeholder="Catatan rangkuman manual (opsional)" />
      <div className="flex items-center gap-2">
        <button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await saveCategoryNote(category, value);
              if (r?.error) setErr(r.error);
              else {
                setSaved(value.trim());
                setEditing(false);
                setErr(null);
              }
            })
          }
          className="btn-primary px-2.5 py-1 text-xs"
        >
          {pending ? "..." : "Simpan"}
        </button>
        <button onClick={() => { setValue(saved); setEditing(false); }} className="btn-ghost px-2.5 py-1 text-xs">Batal</button>
        {err && <span className="text-xs text-red-400">{err}</span>}
      </div>
    </div>
  );
}
