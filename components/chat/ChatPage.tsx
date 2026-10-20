"use client";

import { useEffect, useState } from "react";
import ChatThread, { Avatar } from "./ChatThread";
import { personName, roomTitle, useChat, type ChatRoom } from "./useChat";

function Badge({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="ml-auto min-w-[20px] rounded-full bg-orange-500 px-1.5 text-center text-[11px] font-bold leading-5 text-white">
      {n > 99 ? "99+" : n}
    </span>
  );
}

function RoomIcon({ room, name }: { room: ChatRoom; name: string }) {
  if (room.kind === "direct") return <Avatar name={name} />;
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-[13px] font-bold text-zinc-400">
      #
    </span>
  );
}

const roomSub = (r: ChatRoom) =>
  r.kind === "public" ? "Room bersama · semua anggota" : r.kind === "group" ? `Room · ${r.member_count} anggota` : "Pesan pribadi";

export default function ChatPage({ meId, initialRoom }: { meId: string; initialRoom?: string | null }) {
  const [visible, setVisible] = useState(true);
  const c = useChat(meId, visible, initialRoom);
  const [q, setQ] = useState("");
  const [panel, setPanel] = useState<"none" | "dm" | "room">("none");
  const [mobileList, setMobileList] = useState(!initialRoom);

  // pesan dianggap "dibaca" hanya saat tab browser terlihat
  useEffect(() => {
    const on = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);

  const term = q.trim().toLowerCase();
  const rooms = (c.rooms ?? []).filter((r) => !term || roomTitle(r, c.peopleMap).toLowerCase().includes(term));
  const groupRooms = rooms.filter((r) => r.kind !== "direct");
  const dmRooms = rooms.filter((r) => r.kind === "direct");
  const others = c.people.filter((p) => p.id !== meId);
  const dmWith = new Set((c.rooms ?? []).filter((r) => r.kind === "direct").map((r) => r.other_id));
  const peopleHits = term
    ? others.filter((p) => !dmWith.has(p.id) && `${p.full_name ?? ""} ${p.email ?? ""}`.toLowerCase().includes(term))
    : [];

  const pick = (id: string) => {
    c.setRoomId(id);
    setPanel("none");
    setMobileList(false);
  };

  const item = (r: ChatRoom) => {
    const title = roomTitle(r, c.peopleMap);
    const active = r.room_id === c.roomId;
    return (
      <button
        key={r.room_id}
        onClick={() => pick(r.room_id)}
        className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition ${
          active ? "bg-orange-500/10" : "hover:bg-zinc-800/50"
        }`}
      >
        <RoomIcon room={r} name={title} />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[13.5px] ${active ? "font-semibold text-orange-400" : r.unread ? "font-semibold" : ""}`}>
            {title}
          </span>
          {r.last_body && (
            <span className="block truncate text-[11.5px] text-zinc-500">
              {r.kind !== "direct" && r.last_sender ? `${r.last_sender.split(" ")[0]}: ` : ""}
              {r.last_body}
            </span>
          )}
        </span>
        <Badge n={r.unread} />
      </button>
    );
  };

  return (
    <div
      className="card grid overflow-hidden md:grid-cols-[300px_1fr]"
      style={{ height: "calc(100vh - 210px)", minHeight: 480 }}
    >
      {/* Sidebar: room & pesan pribadi */}
      <aside className={`min-h-0 flex-col border-r border-zinc-800/80 ${mobileList ? "flex" : "hidden md:flex"}`}>
        <div className="p-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari orang / room…" className="input" />
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-4">
          <div>
            <div className="label px-1">Room</div>
            <div className="space-y-0.5">
              {c.rooms === null && <p className="px-2 py-2 text-xs text-zinc-500">Memuat…</p>}
              {groupRooms.map(item)}
            </div>
            <button onClick={() => setPanel(panel === "room" ? "none" : "room")} className="mt-1 px-2.5 text-[12.5px] font-semibold text-orange-400 hover:underline">
              + Buat room
            </button>
            {panel === "room" && <NewRoom c={c} meId={meId} onDone={() => { setPanel("none"); setMobileList(false); }} />}
          </div>

          <div>
            <div className="label px-1">Pesan pribadi</div>
            <div className="space-y-0.5">
              {dmRooms.map(item)}
              {peopleHits.map((p) => (
                <button
                  key={p.id}
                  onClick={() => c.openDm(p.id).then(() => setMobileList(false))}
                  className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-zinc-800/50"
                >
                  <Avatar name={personName(p)} />
                  <span className="min-w-0 flex-1 truncate text-[13.5px]">{personName(p)}</span>
                  <span className="text-[11px] text-orange-400">Chat</span>
                </button>
              ))}
            </div>
            <button onClick={() => setPanel(panel === "dm" ? "none" : "dm")} className="mt-1 px-2.5 text-[12.5px] font-semibold text-orange-400 hover:underline">
              + Chat baru
            </button>
            {panel === "dm" && (
              <div className="mt-2 max-h-64 space-y-0.5 overflow-y-auto rounded-xl border border-zinc-800/80 p-1.5">
                {others.length === 0 && <p className="p-2 text-xs text-zinc-500">Belum ada anggota lain.</p>}
                {others.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => c.openDm(p.id).then(() => { setPanel("none"); setMobileList(false); })}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-zinc-800/50"
                  >
                    <Avatar name={personName(p)} size={24} />
                    <span className="min-w-0 flex-1 truncate text-[13px]">{personName(p)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Percakapan */}
      <section className={`min-h-0 flex-col ${mobileList ? "hidden md:flex" : "flex"}`}>
        {c.room ? (
          <>
            <header className="flex items-center gap-3 border-b border-zinc-800/80 px-5 py-3.5">
              <button onClick={() => setMobileList(true)} className="text-zinc-400 md:hidden" aria-label="Kembali">←</button>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-500/10 text-[14px] font-bold text-orange-400">
                {c.room.kind === "direct" ? roomTitle(c.room, c.peopleMap).slice(0, 1).toUpperCase() : "#"}
              </span>
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold">{roomTitle(c.room, c.peopleMap)}</div>
                <div className="text-[12px] text-zinc-500">
                  {roomSub(c.room)}
                  {!c.live && <span title="Realtime tidak tersambung, pesan dicek tiap beberapa detik"> · sinkron otomatis</span>}
                </div>
              </div>
            </header>
            {c.error && <div className="border-b border-red-500/20 bg-red-500/10 px-5 py-2 text-xs text-red-400">{c.error}</div>}
            <ChatThread
              meId={meId}
              msgs={c.msgs}
              people={c.peopleMap}
              loading={c.loadingMsgs}
              hasMore={c.hasMore}
              onLoadOlder={c.loadOlder}
              onSend={c.send}
            />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-zinc-500">
            {c.error ?? (c.rooms === null ? "Memuat chat…" : "Pilih room atau mulai chat baru.")}
          </div>
        )}
      </section>
    </div>
  );
}

function NewRoom({ c, meId, onDone }: { c: ReturnType<typeof useChat>; meId: string; onDone: () => void }) {
  const [name, setName] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [members, setMembers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const others = c.people.filter((p) => p.id !== meId);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setBusy(true);
        const ok = await c.createRoom(name.trim(), isPublic, isPublic ? [] : members);
        setBusy(false);
        if (ok) onDone();
      }}
      className="mt-2 space-y-2.5 rounded-xl border border-zinc-800/80 p-3"
    >
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama room, mis. shift-malam" className="input" maxLength={60} autoFocus />
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="accent-orange-500" />
        Terbuka untuk semua anggota
      </label>
      {!isPublic && (
        <div className="max-h-40 space-y-1 overflow-y-auto">
          {others.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={members.includes(p.id)}
                onChange={(e) => setMembers((m) => (e.target.checked ? [...m, p.id] : m.filter((x) => x !== p.id)))}
                className="accent-orange-500"
              />
              {personName(p)}
            </label>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => onDone()} className="btn-ghost px-3 py-1.5 text-xs">Batal</button>
        <button disabled={busy || !name.trim()} className="btn-primary px-3 py-1.5 text-xs">{busy ? "Membuat…" : "Buat room"}</button>
      </div>
    </form>
  );
}
