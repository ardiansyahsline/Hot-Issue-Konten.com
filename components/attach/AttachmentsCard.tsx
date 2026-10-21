"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ATTACH_BUCKET } from "@/lib/attachments";
import type { AttachTarget, AttachmentView } from "@/lib/attachments";
import { addAttachments } from "@/lib/attachmentActions";
import AttachmentGallery from "./AttachmentGallery";
import AttachmentPicker from "./AttachmentPicker";

/** Kartu "Bukti / lampiran" di halaman detail issue / catatan, dengan tombol "+ Tambah" */
export default function AttachmentsCard({
  items,
  target,
  page,
  meId,
  isAdmin,
  canAdd,
  className = "card p-5",
}: {
  items: AttachmentView[];
  target: AttachTarget;
  page: string;
  meId: string;
  isAdmin: boolean;
  canAdd: boolean;
  className?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [count, setCount] = useState({ done: 0, uploading: 0 });
  const [state, action, pending] = useActionState(addAttachments.bind(null, target, page), undefined);

  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) setAdding(false);
  }, [state]);

  // Batal: file yang sudah ter-upload tapi tidak jadi disimpan dibuang dari Storage
  const cancel = () => {
    try {
      const v = (formRef.current?.elements.namedItem("attachments") as HTMLInputElement | null)?.value ?? "[]";
      const paths = (JSON.parse(v) as { path: string }[]).map((a) => a.path);
      if (paths.length) createClient().storage.from(ATTACH_BUCKET).remove(paths);
    } catch {}
    setAdding(false);
  };

  if (!items.length && !canAdd) return null;

  return (
    <section className={`${className} space-y-3`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">
          Bukti / lampiran {items.length > 0 && <span className="text-zinc-500">({items.length})</span>}
        </h2>
        {canAdd && !adding && (
          <button type="button" onClick={() => setAdding(true)} className="text-[12.5px] font-semibold text-orange-400 hover:underline">
            + Tambah
          </button>
        )}
      </div>

      {items.length === 0 && !adding && (
        <p className="text-[13px] text-zinc-500">Belum ada lampiran. Tambahkan screenshot atau dokumen sebagai bukti.</p>
      )}

      <AttachmentGallery items={items} meId={meId} isAdmin={isAdmin} page={page} />

      {adding && (
        <form ref={formRef} action={action} className="space-y-3 rounded-2xl border border-zinc-800/80 p-3">
          <AttachmentPicker userId={meId} pasteGlobal onCountChange={(done, uploading) => setCount({ done, uploading })} />
          <div className="flex items-center justify-end gap-2">
            {state?.error && <span className="mr-auto text-xs text-red-400">{state.error}</span>}
            <button type="button" onClick={cancel} className="btn-ghost px-3 py-1.5 text-xs">Batal</button>
            <button disabled={pending || count.uploading > 0 || count.done === 0} className="btn-primary px-3 py-1.5 text-xs">
              {pending ? "Menyimpan…" : count.uploading ? "Mengupload…" : `Simpan lampiran${count.done ? ` (${count.done})` : ""}`}
            </button>
          </div>
        </form>
      )}
      {state?.ok && !adding && <p className="text-xs text-emerald-400">✓ {state.ok}</p>}
    </section>
  );
}
