"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { personName, type ChatMsg, type ChatPerson } from "./useChat";
import { summarize, type ReactionRow } from "@/lib/reactions";
import { ReactionPills } from "@/components/emoji/Reactions";
import { EmojiInsertButton, EmojiPanel, QuickBar } from "@/components/emoji/EmojiPicker";

const HARI = (d: Date) =>
  d.toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", weekday: "long", day: "numeric", month: "short", year: "numeric" });
const JAM = (iso: string) => new Date(iso).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" });
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

function dayLabel(iso: string) {
  const k = dayKey(iso);
  const today = dayKey(new Date().toISOString());
  const yest = dayKey(new Date(Date.now() - 86400000).toISOString());
  if (k === today) return "Hari ini";
  if (k === yest) return "Kemarin";
  return HARI(new Date(iso));
}

export function Avatar({ name, me = false, size = 28 }: { name: string; me?: boolean; size?: number }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full text-[11px] font-bold uppercase ${
        me ? "bg-orange-500/15 text-orange-400" : "bg-zinc-800 text-zinc-300"
      }`}
      style={{ width: size, height: size }}
    >
      {name.slice(0, 1)}
    </span>
  );
}

/** Daftar pesan + kolom tulis pesan (dipakai halaman Chat & widget melayang) */
export default function ChatThread({
  meId,
  msgs,
  people,
  loading,
  hasMore,
  onLoadOlder,
  onSend,
  compact = false,
  disabled = false,
  reactions = {},
  onReact,
}: {
  reactions?: Record<number, ReactionRow[]>;
  onReact?: (msgId: number, emoji: string) => void;
  meId: string;
  msgs: ChatMsg[];
  people: Map<string, ChatPerson>;
  loading: boolean;
  hasMore: boolean;
  onLoadOlder: () => void;
  onSend: (body: string) => Promise<boolean>;
  compact?: boolean;
  disabled?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const lastId = useRef<number | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [pick, setPick] = useState<{ id: number; all: boolean } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const names = new Map([...people.values()].map((p) => [p.id, personName(p)]));

  // klik di luar deretan emoji -> tutup
  useEffect(() => {
    if (!pick || pick.all) return;
    const out = (e: MouseEvent | TouchEvent) => {
      if (!(e.target as HTMLElement).closest?.("[data-react-menu]")) setPick(null);
    };
    document.addEventListener("mousedown", out);
    document.addEventListener("touchstart", out);
    return () => {
      document.removeEventListener("mousedown", out);
      document.removeEventListener("touchstart", out);
    };
  }, [pick]);

  const react = (id: number, e: string) => {
    setPick(null);
    onReact?.(id, e);
  };

  const insertEmoji = (e: string) => {
    const ta = input.current;
    const s0 = ta?.selectionStart ?? text.length;
    const s1 = ta?.selectionEnd ?? s0;
    setText((t) => t.slice(0, s0) + e + t.slice(s1));
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(s0 + e.length, s0 + e.length);
    });
  };

  // auto-scroll ke bawah kalau ada pesan baru (dan user memang sedang di bawah / pesan sendiri)
  useLayoutEffect(() => {
    const el = box.current;
    const last = msgs.at(-1);
    if (!el || !last) return;
    if (last.id !== lastId.current && (nearBottom.current || last.sender_id === meId || lastId.current === null)) {
      el.scrollTop = el.scrollHeight;
    }
    lastId.current = last.id;
  }, [msgs, meId]);

  useEffect(() => {
    lastId.current = null;
    nearBottom.current = true;
  }, [loading]);

  async function submit() {
    if (!text.trim() || sending) return;
    setSending(true);
    const ok = await onSend(text);
    setSending(false);
    if (ok) setText("");
  }

  const pad = compact ? "px-4" : "px-5";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className={`min-h-0 flex-1 space-y-1 overflow-y-auto py-4 ${pad}`}
      >
        {hasMore && !loading && (
          <div className="pb-2 text-center">
            <button onClick={onLoadOlder} className="text-xs font-semibold text-orange-400 hover:underline">
              Muat pesan sebelumnya
            </button>
          </div>
        )}
        {loading && <p className="py-10 text-center text-sm text-zinc-500">Memuat pesan…</p>}
        {!loading && msgs.length === 0 && (
          <p className="py-10 text-center text-sm text-zinc-500">Belum ada pesan. Mulai obrolan di sini 👋</p>
        )}
        {msgs.map((m, i) => {
          const prev = msgs[i - 1];
          const mine = m.sender_id === meId;
          const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
          const grouped =
            !newDay && prev && prev.sender_id === m.sender_id && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60000;
          const name = mine ? "Kamu" : personName(people.get(m.sender_id ?? ""));
          const avatarName = personName(people.get(m.sender_id ?? ""));
          return (
            <div key={m.id}>
              {newDay && (
                <div className="my-3 flex items-center gap-3 text-[11px] font-semibold text-zinc-500">
                  <span className="h-px flex-1 bg-zinc-800" />
                  {dayLabel(m.created_at)}
                  <span className="h-px flex-1 bg-zinc-800" />
                </div>
              )}
              <div className={`flex gap-2.5 ${mine ? "flex-row-reverse" : ""} ${grouped ? "mt-0.5" : "mt-3"}`}>
                {grouped ? <span className="w-7 shrink-0" /> : <Avatar name={avatarName} me={mine} />}
                <div className={`flex max-w-[78%] flex-col ${mine ? "items-end" : "items-start"}`}>
                  {!grouped && (
                    <span className="mb-1 text-[11px] text-zinc-500">
                      {name} · {JAM(m.created_at)}
                    </span>
                  )}
                  <div className={`group relative flex items-center gap-1.5 ${mine ? "flex-row-reverse" : ""}`}>
                    <div
                      className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[13.5px] leading-relaxed ${
                        mine ? "rounded-tr-md text-white" : "rounded-tl-md bg-zinc-800/70 text-zinc-100"
                      }`}
                      style={mine ? { backgroundImage: "linear-gradient(180deg, #fb8a3c 0%, #ea580c 100%)", boxShadow: "var(--shadow-primary)" } : undefined}
                      title={grouped ? JAM(m.created_at) : undefined}
                      onTouchStart={() => {
                        if (!onReact) return;
                        pressTimer.current = setTimeout(() => setPick({ id: m.id, all: false }), 450);
                      }}
                      onTouchEnd={() => pressTimer.current && clearTimeout(pressTimer.current)}
                      onTouchMove={() => pressTimer.current && clearTimeout(pressTimer.current)}
                    >
                      {m.body}
                    </div>
                    {onReact && (
                      <button
                        type="button"
                        data-react-menu
                        onClick={() => setPick(pick?.id === m.id ? null : { id: m.id, all: false })}
                        aria-label="Beri reaksi"
                        title="Beri reaksi"
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200 ${
                          pick?.id === m.id ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100"
                        }`}
                      >
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <circle cx="12" cy="12" r="9" />
                          <path d="M8.5 14.5s1.2 1.5 3.5 1.5 3.5-1.5 3.5-1.5M9 9.5h.01M15 9.5h.01" />
                        </svg>
                      </button>
                    )}
                  </div>
                  {pick?.id === m.id && !pick.all && (
                    <div data-react-menu className="z-30 mt-1.5">
                      <QuickBar onPick={(e) => react(m.id, e)} onMore={() => setPick({ id: m.id, all: true })} />
                    </div>
                  )}
                  {pick?.id === m.id && pick.all && (
                    <div className="relative z-30 mt-1.5">
                      <EmojiPanel onPick={(e) => react(m.id, e)} onClose={() => setPick(null)} />
                    </div>
                  )}
                  {(reactions[m.id]?.length ?? 0) > 0 && (
                    <div className={`mt-1 flex flex-wrap gap-1 ${mine ? "justify-end" : ""}`}>
                      <ReactionPills list={summarize(reactions[m.id], meId, names)} onToggle={(e) => onReact?.(m.id, e)} size="sm" />
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className={`flex items-end gap-2.5 border-t border-zinc-800/80 py-3 ${pad}`}
      >
        <EmojiInsertButton onPick={insertEmoji} className="h-[42px] w-[42px] shrink-0 border border-zinc-700/80" />
        <textarea
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          maxLength={4000}
          disabled={disabled}
          placeholder={compact ? "Tulis pesan…" : "Tulis pesan… (Enter untuk kirim, Shift+Enter baris baru)"}
          className="input max-h-32 min-h-[42px] resize-none"
          aria-label="Tulis pesan"
        />
        <button disabled={disabled || sending || !text.trim()} className="btn-primary h-[42px] shrink-0 px-4" aria-label="Kirim">
          {compact ? (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z" /></svg>
          ) : (
            "Kirim"
          )}
        </button>
      </form>
    </div>
  );
}
