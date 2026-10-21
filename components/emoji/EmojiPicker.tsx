"use client";

import { useEffect, useRef, useState } from "react";
import { EMOJI_GROUPS, QUICK_EMOJI } from "@/lib/reactions";

/** Panel pilih emoji (popover). Tutup dengan klik di luar / Esc. */
export function EmojiPanel({
  onPick,
  onClose,
  className = "",
}: {
  onPick: (e: string) => void;
  onClose: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [group, setGroup] = useState(0);
  useEffect(() => {
    const out = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", out);
    document.addEventListener("touchstart", out);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", out);
      document.removeEventListener("touchstart", out);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose]);

  const [title, list] = EMOJI_GROUPS[group];
  return (
    <div
      ref={ref}
      className={`z-50 w-[300px] rounded-2xl border border-zinc-800 bg-zinc-900 p-2.5 ${className}`}
      style={{ boxShadow: "var(--shadow-pop), 0 18px 40px -16px rgba(0,0,0,.35)" }}
      role="dialog"
      aria-label="Pilih emoji"
    >
      <div className="mb-2 flex gap-1 border-b border-zinc-800 pb-2">
        {EMOJI_GROUPS.map(([t, l], i) => (
          <button
            key={t}
            type="button"
            onClick={() => setGroup(i)}
            title={t}
            className={`flex h-8 flex-1 items-center justify-center rounded-lg text-[17px] transition ${i === group ? "bg-orange-500/15" : "hover:bg-zinc-800"}`}
          >
            {l[0]}
          </button>
        ))}
      </div>
      <div className="mb-1 px-1 text-[10.5px] font-bold uppercase tracking-wider text-zinc-500">{title}</div>
      <div className="grid max-h-[210px] grid-cols-8 gap-0.5 overflow-y-auto">
        {list.map((e, i) => (
          <button
            key={`${e}-${i}`}
            type="button"
            onClick={() => onPick(e)}
            className="flex h-9 items-center justify-center rounded-lg text-[20px] transition hover:scale-110 hover:bg-zinc-800"
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Deretan emoji cepat (untuk reaksi) + tombol ⋯ untuk emoji lainnya */
export function QuickBar({ onPick, onMore }: { onPick: (e: string) => void; onMore?: () => void }) {
  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-full border border-zinc-800 bg-zinc-900 p-1"
      style={{ boxShadow: "var(--shadow-pop)" }}
    >
      {QUICK_EMOJI.map((e) => (
        <button
          key={e}
          type="button"
          onClick={() => onPick(e)}
          className="flex h-8 w-8 items-center justify-center rounded-full text-[18px] transition hover:scale-110 hover:bg-zinc-800"
          aria-label={`Reaksi ${e}`}
        >
          {e}
        </button>
      ))}
      {onMore && (
        <button type="button" onClick={onMore} className="flex h-8 w-8 items-center justify-center rounded-full text-[14px] text-zinc-500 hover:bg-zinc-800" aria-label="Emoji lainnya">
          ⋯
        </button>
      )}
    </div>
  );
}

/**
 * Tombol 😊 untuk menyisipkan emoji ke kolom ketik.
 * - `onPick` untuk input yang dikontrol React (mis. chat)
 * - `field` = nama textarea di form yang sama (form biasa / tidak dikontrol)
 */
export function EmojiInsertButton({
  onPick,
  field,
  className = "",
  up = true,
}: {
  onPick?: (e: string) => void;
  field?: string;
  className?: string;
  up?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);

  const insert = (e: string) => {
    if (onPick) onPick(e);
    else if (field) {
      const ta = btn.current?.closest("form")?.querySelector<HTMLTextAreaElement>(`textarea[name="${field}"]`);
      if (ta) {
        const s = ta.selectionStart ?? ta.value.length;
        const en = ta.selectionEnd ?? s;
        ta.value = ta.value.slice(0, s) + e + ta.value.slice(en);
        ta.focus();
        ta.setSelectionRange(s + e.length, s + e.length);
        ta.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  };

  return (
    <span className="relative inline-flex">
      <button
        ref={btn}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Sisipkan emoji"
        title="Emoji"
        className={`flex items-center justify-center rounded-xl text-[19px] transition hover:bg-zinc-800 ${open ? "bg-orange-500/10 ring-1 ring-orange-500/50" : ""} ${className}`}
      >
        😊
      </button>
      {open && (
        <EmojiPanel
          onPick={insert}
          onClose={() => setOpen(false)}
          className={`absolute left-0 ${up ? "bottom-full mb-2" : "top-full mt-2"}`}
        />
      )}
    </span>
  );
}
