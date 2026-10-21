"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import AttachmentPicker from "@/components/attach/AttachmentPicker";
import { EmojiInsertButton } from "@/components/emoji/EmojiPicker";

function Submit({ label, onDone }: { label: string; onDone?: () => void }) {
  const { pending } = useFormStatus();
  const was = useRef(false);
  useEffect(() => {
    if (was.current && !pending) onDone?.();
    was.current = pending;
  }, [pending, onDone]);
  return (
    <button disabled={pending} className="btn-primary">
      {pending ? "Mengirim…" : label}
    </button>
  );
}

/** Kolom komentar / balasan: teks + tombol emoji + lampiran (Ctrl+V screenshot juga bisa) */
export default function CommentComposer({
  action,
  meId,
  parentId,
  placeholder = "Tulis komentar…",
  submitLabel = "Kirim",
  autoFocus = false,
  onDone,
  onCancel,
}: {
  action: (fd: FormData) => void | Promise<void>;
  meId: string;
  parentId?: number;
  placeholder?: string;
  submitLabel?: string;
  autoFocus?: boolean;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  return (
    <form action={action} className="space-y-2">
      {parentId && <input type="hidden" name="parent_id" value={parentId} />}
      <div className="relative">
        <textarea name="body" rows={parentId ? 2 : 3} placeholder={placeholder} autoFocus={autoFocus} className="input pr-12" />
        <span className="absolute bottom-2 right-2">
          <EmojiInsertButton field="body" className="h-8 w-8" />
        </span>
      </div>
      <AttachmentPicker userId={meId} compact clearOnReset />
      <div className="flex justify-end gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn-ghost">
            Batal
          </button>
        )}
        <Submit label={submitLabel} onDone={onDone} />
      </div>
    </form>
  );
}

/** Tombol "Balas" yang membuka kolom balasan di bawah komentar */
export function ReplyToggle({
  action,
  meId,
  parentId,
  name,
  children,
}: {
  action: (fd: FormData) => void | Promise<void>;
  meId: string;
  parentId: number;
  name: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {children}
        <button type="button" onClick={() => setOpen((o) => !o)} className="text-[12px] font-semibold text-zinc-500 hover:text-orange-400">
          Balas
        </button>
      </div>
      {open && (
        <div className="mt-2.5">
          <CommentComposer
            action={action}
            meId={meId}
            parentId={parentId}
            placeholder={`Balas ${name}…`}
            submitLabel="Balas"
            autoFocus
            onDone={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />
        </div>
      )}
    </>
  );
}
