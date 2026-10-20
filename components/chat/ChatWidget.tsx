"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import ChatThread from "./ChatThread";
import { roomTitle, useChat } from "./useChat";

/** Tombol chat melayang di pojok kanan bawah (semua halaman kecuali halaman Chat) */
export default function ChatWidget({ meId }: { meId: string }) {
  const path = usePathname();
  if (path.startsWith("/chat")) return null;
  return <Widget meId={meId} />;
}

function Widget({ meId }: { meId: string }) {
  const [open, setOpen] = useState(false);
  const [tabVisible, setTabVisible] = useState(true);
  const c = useChat(meId, open && tabVisible);

  useEffect(() => {
    const on = () => setTabVisible(!document.hidden);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  const unread = c.unreadTotal;

  return (
    <>
      {open && (
        <div
          className="card card-plain fixed bottom-24 right-4 z-40 flex w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden sm:right-6"
          style={{ height: "min(540px, calc(100vh - 140px))", boxShadow: "var(--shadow-card), 0 30px 60px -20px rgba(0,0,0,.35)" }}
          role="dialog"
          aria-label="Chat"
        >
          <header className="flex items-center gap-3 border-b border-zinc-800/80 px-4 py-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-500/10 text-[14px] font-bold text-orange-400">
              {c.room?.kind === "direct" ? roomTitle(c.room, c.peopleMap).slice(0, 1).toUpperCase() : "#"}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14.5px] font-semibold">{c.room ? roomTitle(c.room, c.peopleMap) : "Chat"}</div>
              <span className="relative inline-flex items-center gap-1 text-[12px] text-zinc-500 hover:text-zinc-300">
                ganti room{c.unreadTotal > 0 ? ` · ${c.unreadTotal} baru` : ""} ▾
              <select
                value={c.roomId ?? ""}
                onChange={(e) => c.setRoomId(e.target.value)}
                className="absolute inset-0 cursor-pointer opacity-0"
                aria-label="Ganti room"
              >
                {(c.rooms ?? []).map((r) => (
                  <option key={r.room_id} value={r.room_id}>
                    {r.kind === "direct" ? "@ " : "# "}
                    {roomTitle(r, c.peopleMap)}
                    {r.unread ? ` (${r.unread})` : ""}
                  </option>
                ))}
              </select>
              </span>
            </div>
            <Link
              href={c.roomId ? `/chat?room=${c.roomId}` : "/chat"}
              onClick={() => setOpen(false)}
              className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              title="Buka halaman Chat"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
            </Link>
            <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" aria-label="Tutup chat">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </header>
          {c.error && <div className="border-b border-red-500/20 bg-red-500/10 px-4 py-2 text-xs text-red-400">{c.error}</div>}
          <ChatThread
            meId={meId}
            msgs={c.msgs}
            people={c.peopleMap}
            loading={c.loadingMsgs}
            hasMore={c.hasMore}
            onLoadOlder={c.loadOlder}
            onSend={c.send}
            compact
            disabled={!c.roomId}
          />
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-6 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-2xl text-white transition hover:-translate-y-0.5 sm:right-6"
        style={{ backgroundImage: "linear-gradient(160deg, #fb8a3c 0%, #ea580c 100%)", boxShadow: "0 14px 30px -10px rgba(234,88,12,.6)" }}
        aria-label={open ? "Tutup chat" : `Buka chat${unread ? ` (${unread} belum dibaca)` : ""}`}
      >
        {open ? (
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
            <path d="M8.5 12h.01M12 12h.01M15.5 12h.01" />
          </svg>
        )}
        {!open && unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 min-w-[20px] rounded-full border-2 border-zinc-950 bg-red-500 px-1 text-center text-[11px] font-bold leading-4 text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
    </>
  );
}
