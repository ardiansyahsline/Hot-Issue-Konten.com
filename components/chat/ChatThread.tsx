"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { personName, type ChatFile, type ChatMsg, type ChatPerson, type Reader, type SendOpts } from "./useChat";
import UserAvatar, { isOnline } from "@/components/UserAvatar";
import { ROLES, isRole } from "@/lib/roles";
import { DocIcon } from "@/components/attach/AttachmentPicker";
import { Lightbox } from "@/components/attach/AttachmentGallery";
import { useUploads } from "@/components/attach/useUploads";
import { ATTACH_ACCEPT, fmtSize, isViewableImage, type AttachmentInput } from "@/lib/attachments";
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

export function Avatar({ name, me = false, size = 28, url, online }: { name: string; me?: boolean; size?: number; url?: string | null; online?: boolean }) {
  return <UserAvatar name={name} url={url} me={me} size={size} online={online} />;
}

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Tulisan pesan dengan @mention disorot */
function Body({ m, people, mine, meId }: { m: ChatMsg; people: Map<string, ChatPerson>; mine: boolean; meId: string }) {
  const labels = (m.mentions ?? []).map((id) => ({ id, label: `@${personName(people.get(id))}` }));
  if (m.mention_all) labels.push({ id: "*", label: "@semua" });
  if (!labels.length) return <>{m.body}</>;
  const re = new RegExp(`(${labels.map((l) => escRe(l.label)).sort((a, b) => b.length - a.length).join("|")})`, "g");
  return (
    <>
      {m.body.split(re).map((part, i) => {
        const hit = labels.find((l) => l.label === part);
        if (!hit) return <span key={i}>{part}</span>;
        const me = hit.id === meId || hit.id === "*";
        return (
          <span
            key={i}
            className={`rounded px-1 font-semibold ${mine ? "bg-white/25" : me ? "bg-orange-500/20 text-orange-500" : "bg-orange-500/10 text-orange-500"}`}
          >
            {part}
          </span>
        );
      })}
    </>
  );
}

/** potongan pesan untuk kutipan balasan */
const snippet = (m: ChatMsg | undefined, hasFiles: boolean) =>
  !m ? "Pesan tidak tersedia" : m.body?.trim() ? m.body.trim().slice(0, 140) : hasFiles ? "📎 Lampiran" : "…";

/** Lampiran di dalam pesan: gambar (klik = perbesar) + dokumen */
function MsgFiles({ list, mine, onOpen }: { list: ChatFile[]; mine: boolean; onOpen: (f: ChatFile) => void }) {
  const imgs = list.filter((f) => isViewableImage(f.mime) && f.url);
  const docs = list.filter((f) => !(isViewableImage(f.mime) && f.url));
  return (
    <div className={`flex flex-col gap-1.5 ${mine ? "items-end" : "items-start"}`}>
      {imgs.length > 0 && (
        <div className={`grid gap-1 ${imgs.length > 1 ? "grid-cols-2" : ""}`} style={{ width: imgs.length > 1 ? 260 : 240 }}>
          {imgs.map((f) => (
            <button key={f.id} type="button" onClick={() => onOpen(f)} className="overflow-hidden rounded-xl ring-1 ring-zinc-800" title={f.name}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.url!} alt={f.name} loading="lazy" className={`w-full object-cover ${imgs.length > 1 ? "aspect-square" : "max-h-72"}`} />
            </button>
          ))}
        </div>
      )}
      {docs.map((f) => (
        <div key={f.id} className="flex max-w-[280px] items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/60 px-3 py-2.5">
          <DocIcon name={f.name} mime={f.mime} />
          <div className="min-w-0">
            <a href={f.url ?? undefined} target="_blank" rel="noreferrer" className="block truncate text-[13px] font-medium hover:text-orange-400">{f.name}</a>
            <div className="text-[11.5px] text-zinc-500">
              {fmtSize(f.size)}
              {f.downloadUrl && (
                <>
                  {" · "}
                  <a href={f.downloadUrl} className="font-semibold text-orange-400">Unduh</a>
                </>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
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
  files = {},
  readers = [],
  direct = false,
  members = [],
  refs = {},
}: {
  /** anggota room (untuk daftar @mention) */
  members?: ChatPerson[];
  /** pesan lama yang dibalas tapi belum termuat */
  refs?: Record<number, ChatMsg>;
  files?: Record<number, ChatFile[]>;
  readers?: Reader[];
  /** pesan pribadi: "Dilihat" tanpa angka */
  direct?: boolean;
  reactions?: Record<number, ReactionRow[]>;
  onReact?: (msgId: number, emoji: string) => void;
  meId: string;
  msgs: ChatMsg[];
  people: Map<string, ChatPerson>;
  loading: boolean;
  hasMore: boolean;
  onLoadOlder: () => void;
  onSend: (body: string, files: AttachmentInput[], opts?: SendOpts) => Promise<boolean>;
  compact?: boolean;
  disabled?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const lastId = useRef<number | null>(null);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMsg | null>(null);
  const [flash, setFlash] = useState<number | null>(null);
  // @mention: query yang sedang diketik + orang yang sudah dipilih
  const [mq, setMq] = useState<{ start: number; q: string } | null>(null);
  const [mIdx, setMIdx] = useState(0);
  const [chosen, setChosen] = useState<Map<string, string>>(new Map());
  const [sending, setSending] = useState(false);
  const [pick, setPick] = useState<{ id: number; all: boolean } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const names = new Map([...people.values()].map((p) => [p.id, personName(p)]));
  const up = useUploads(meId);
  const fileInput = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [viewer, setViewer] = useState<{ list: ChatFile[]; i: number } | null>(null);

  /** orang lain yang sudah membaca sampai pesan ini */
  const seenBy = (m: ChatMsg) =>
    readers.filter((r) => r.user_id !== meId && r.user_id !== m.sender_id && r.last_read_at >= m.created_at).map((r) => names.get(r.user_id) ?? "Anggota");
  const seenText = (m: ChatMsg) => {
    const who = seenBy(m);
    if (!who.length) return null;
    return (
      <span className="text-sky-400" title={`Dilihat oleh ${who.join(", ")}`}>
        {direct ? "Dilihat" : `Dilihat ${who.length}`}
      </span>
    );
  };
  const lastMineId = [...msgs].reverse().find((m) => m.sender_id === meId)?.id;

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

  const msgById = (id: number) => msgs.find((x) => x.id === id) ?? refs[id];
  const jumpTo = (id: number) => {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlash(id);
    setTimeout(() => setFlash(null), 1600);
  };
  const startReply = (m: ChatMsg) => {
    setReplyTo(m);
    setPick(null);
    requestAnimationFrame(() => input.current?.focus());
  };

  // daftar saran @mention
  const mentionList = (() => {
    if (!mq) return [] as { id: string; label: string; sub: string; person?: ChatPerson }[];
    const q = mq.q.toLowerCase();
    const list: { id: string; label: string; sub: string; person?: ChatPerson }[] = members
      .filter((p) => p.id !== meId && personName(p).toLowerCase().includes(q))
      .slice(0, 6)
      .map((p) => ({ id: p.id, label: personName(p), sub: p.role ?? "", person: p }));
    if (!direct && "semua".startsWith(q)) list.push({ id: "*", label: "semua", sub: "semua anggota room" } as (typeof list)[number]);
    return list;
  })();
  const detectMention = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const m = before.match(/(^|\s)@([^\s@]{0,24})$/);
    if (m) {
      setMq({ start: caret - m[2].length - 1, q: m[2] });
      setMIdx(0);
    } else setMq(null);
  };
  const pickMention = (item: { id: string; label: string }) => {
    if (!mq) return;
    const caret = input.current?.selectionStart ?? text.length;
    const insert = `@${item.label} `;
    const next = text.slice(0, mq.start) + insert + text.slice(caret);
    setText(next);
    setChosen((c) => new Map(c).set(item.id, item.label));
    setMq(null);
    const pos = mq.start + insert.length;
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(pos, pos);
    });
  };

  async function submit() {
    if ((!text.trim() && !up.done.length) || sending || up.uploading) return;
    setSending(true);
    const mentions = [...chosen.entries()].filter(([id, label]) => id !== "*" && text.includes(`@${label}`)).map(([id]) => id);
    const mentionAll = !direct && /(^|\s)@semua(\s|$|[.,!?])/.test(text);
    const ok = await onSend(text, up.done, { replyTo: replyTo?.id ?? null, mentions, mentionAll });
    setSending(false);
    if (ok) {
      setText("");
      up.clear();
      setReplyTo(null);
      setChosen(new Map());
      setMq(null);
    }
  }

  const pad = compact ? "px-4" : "px-3 sm:px-5";
  // layar sempit (HP): placeholder pendek supaya tidak terpotong jadi 2 baris
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  return (
    <div
      className={`relative flex min-h-0 flex-1 flex-col ${drag ? "ring-2 ring-inset ring-orange-500/60" : ""}`}
      onDragOver={(e) => {
        if (disabled || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDrag(false);
        up.addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {drag && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-orange-500/5 text-[14px] font-semibold text-orange-400">
          Lepaskan file untuk dilampirkan
        </div>
      )}
      {viewer && <Lightbox images={viewer.list} index={viewer.i} onIndex={(i) => setViewer((v) => (v ? { ...v, i } : v))} onClose={() => setViewer(null)} />}
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
            <div key={m.id} id={`msg-${m.id}`} className={`rounded-xl transition-colors duration-700 ${flash === m.id ? "bg-orange-500/10" : ""}`}>
              {newDay && (
                <div className="my-3 flex items-center gap-3 text-[11px] font-semibold text-zinc-500">
                  <span className="h-px flex-1 bg-zinc-800" />
                  {dayLabel(m.created_at)}
                  <span className="h-px flex-1 bg-zinc-800" />
                </div>
              )}
              <div className={`flex gap-2.5 ${mine ? "flex-row-reverse" : ""} ${grouped ? "mt-0.5" : "mt-3"}`}>
                {grouped ? <span className="w-7 shrink-0" /> : <Avatar name={avatarName} me={mine} url={people.get(m.sender_id ?? "")?.avatar_url} />}
                <div className={`flex max-w-[78%] flex-col ${mine ? "items-end" : "items-start"}`}>
                  {!grouped && (
                    <span className="mb-1 text-[11px] text-zinc-500">
                      {name} · {JAM(m.created_at)}
                      {mine && seenText(m) && <> · {seenText(m)}</>}
                    </span>
                  )}
                  <div className={`group relative flex items-center gap-1.5 ${mine ? "flex-row-reverse" : ""}`}>
                    <div
                      className={`flex flex-col gap-1.5 ${mine ? "items-end" : "items-start"}`}
                      title={grouped ? JAM(m.created_at) : undefined}
                      onTouchStart={() => {
                        if (!onReact) return;
                        pressTimer.current = setTimeout(() => setPick({ id: m.id, all: false }), 450);
                      }}
                      onTouchEnd={() => pressTimer.current && clearTimeout(pressTimer.current)}
                      onTouchMove={() => pressTimer.current && clearTimeout(pressTimer.current)}
                    >
                      {(files[m.id]?.length ?? 0) > 0 && (
                        <MsgFiles
                          list={files[m.id]}
                          mine={mine}
                          onOpen={(f) => {
                            const imgs = files[m.id].filter((x) => isViewableImage(x.mime) && x.url);
                            setViewer({ list: imgs, i: Math.max(0, imgs.findIndex((x) => x.id === f.id)) });
                          }}
                        />
                      )}
                      {(m.body || m.reply_to) && (
                        <div
                          className={`whitespace-pre-wrap break-words rounded-2xl text-[13.5px] leading-relaxed ${m.reply_to ? "p-1.5" : "px-3.5 py-2"} ${
                            mine ? "rounded-tr-md text-white" : "rounded-tl-md bg-zinc-800/70 text-zinc-100"
                          }`}
                          style={mine ? { backgroundImage: "linear-gradient(180deg, #fb8a3c 0%, #ea580c 100%)", boxShadow: "var(--shadow-primary)" } : undefined}
                        >
                          {m.reply_to && (() => {
                            const q = msgById(m.reply_to);
                            const who = q ? (q.sender_id === meId ? "Kamu" : personName(people.get(q.sender_id ?? ""))) : "";
                            return (
                              <button
                                type="button"
                                onClick={() => jumpTo(m.reply_to!)}
                                className={`mb-1 block w-full rounded-xl border-l-4 px-3 py-1.5 text-left ${
                                  mine ? "border-white/80 bg-white/15" : "border-orange-500 bg-zinc-950/50"
                                }`}
                                title="Lihat pesan asli"
                              >
                                <span className={`block text-[11.5px] font-semibold ${mine ? "text-white" : "text-orange-400"}`}>{who || "Pesan"}</span>
                                <span className={`block truncate text-[12px] ${mine ? "text-white/80" : "text-zinc-400"}`}>
                                  {snippet(q, !!q && (files[q.id]?.length ?? 0) > 0)}
                                </span>
                              </button>
                            );
                          })()}
                          {m.body && (
                            <div className={m.reply_to ? "px-2 pb-0.5" : ""}>
                              <Body m={m} people={people} mine={mine} meId={meId} />
                            </div>
                          )}
                        </div>
                      )}
                      {!m.body && !(files[m.id]?.length) && <span className="text-[12px] italic text-zinc-500">📎 Lampiran</span>}
                    </div>
                    <button
                      type="button"
                      onClick={() => startReply(m)}
                      aria-label="Balas pesan"
                      title="Balas"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-zinc-500 opacity-0 transition hover:bg-zinc-800 hover:text-zinc-200 focus:opacity-100 group-hover:opacity-100"
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 14 4 9l5-5" />
                        <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
                      </svg>
                    </button>
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
                    <div data-react-menu className="z-30 mt-1.5 flex flex-wrap items-center gap-1.5">
                      <QuickBar onPick={(e) => react(m.id, e)} onMore={() => setPick({ id: m.id, all: true })} />
                      <button
                        type="button"
                        onClick={() => startReply(m)}
                        className="rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-[12.5px] font-semibold text-zinc-300"
                        style={{ boxShadow: "var(--shadow-pop)" }}
                      >
                        ↩︎ Balas
                      </button>
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
                  {mine && grouped && m.id === lastMineId && seenText(m) && <span className="mt-0.5 text-[11px]">{seenText(m)}</span>}
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
        className={`border-t border-zinc-800/80 py-3 ${pad}`}
      >
        {replyTo && (
          <div className="mb-2 flex items-center gap-3 rounded-xl border-l-4 border-orange-500 bg-zinc-950/60 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-[11.5px] font-semibold text-orange-400">
                Membalas {replyTo.sender_id === meId ? "diri sendiri" : personName(people.get(replyTo.sender_id ?? ""))}
              </div>
              <div className="truncate text-[12px] text-zinc-400">{snippet(replyTo, (files[replyTo.id]?.length ?? 0) > 0)}</div>
            </div>
            <button type="button" onClick={() => setReplyTo(null)} aria-label="Batal membalas" className="text-zinc-500 hover:text-zinc-200">
              ✕
            </button>
          </div>
        )}
        {/* lampiran yang akan dikirim */}
        {(up.items.length > 0 || up.notice) && (
          <div className="mb-2 flex flex-wrap gap-2">
            {up.items.map((it) =>
              it.preview ? (
                <span key={it.key} className="relative h-14 w-14 overflow-hidden rounded-xl ring-1 ring-zinc-800" title={it.error ?? it.name}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={it.preview} alt={it.name} className={`h-full w-full object-cover ${it.status !== "done" ? "opacity-50" : ""}`} />
                  {it.status === "uploading" && <span className="absolute inset-0 m-auto h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-orange-500" />}
                  {it.status === "error" && <span className="absolute inset-x-0 bottom-0 bg-red-600/90 px-1 text-[9px] font-semibold text-white">{it.error}</span>}
                  <button type="button" onClick={() => up.remove(it)} aria-label={`Hapus ${it.name}`} className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-950/85 text-[10px] text-white">✕</button>
                </span>
              ) : (
                <span key={it.key} className={`flex h-14 max-w-[220px] items-center gap-2 rounded-xl border px-2.5 ${it.status === "error" ? "border-red-500/50" : "border-zinc-800"}`}>
                  <DocIcon name={it.name} mime={it.mime} size={30} />
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-medium">{it.name}</span>
                    <span className={`block text-[10.5px] ${it.status === "error" ? "text-red-400" : "text-zinc-500"}`}>
                      {it.status === "error" ? it.error : it.status === "uploading" ? "Mengupload…" : fmtSize(it.size)}
                    </span>
                  </span>
                  <button type="button" onClick={() => up.remove(it)} aria-label={`Hapus ${it.name}`} className="text-[11px] text-zinc-500 hover:text-red-400">✕</button>
                </span>
              )
            )}
            {up.notice && <span className="self-center text-[11.5px] text-amber-400">{up.notice}</span>}
          </div>
        )}
        <div className="relative flex items-end gap-2">
          {mq && mentionList.length > 0 && (
            <div
              className="absolute bottom-full left-0 z-40 mb-2 w-72 max-w-full rounded-2xl border border-zinc-800 bg-zinc-900 p-1.5"
              style={{ boxShadow: "var(--shadow-pop), 0 18px 40px -16px rgba(0,0,0,.35)" }}
              role="listbox"
              aria-label="Sebut anggota"
            >
              <div className="px-2 py-1 text-[10.5px] font-bold uppercase tracking-wider text-zinc-500">Sebut anggota</div>
              {mentionList.map((it, i) => (
                <button
                  key={it.id}
                  type="button"
                  role="option"
                  aria-selected={i === mIdx}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickMention(it);
                  }}
                  onMouseEnter={() => setMIdx(i)}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left ${i === mIdx ? "bg-orange-500/10" : ""}`}
                >
                  {it.person ? (
                    <UserAvatar name={it.label} url={it.person.avatar_url} size={26} online={isOnline(it.person.last_seen_at)} />
                  ) : (
                    <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-orange-500/15 text-[11px] font-bold text-orange-400">@</span>
                  )}
                  <span className="truncate text-[13px] font-semibold">{it.label}</span>
                  <span className="truncate text-[11px] text-zinc-500">{isRole(it.sub) ? ROLES[it.sub].label : it.sub}</span>
                </button>
              ))}
            </div>
          )}
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={ATTACH_ACCEPT}
            className="hidden"
            onChange={(e) => {
              up.addFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => fileInput.current?.click()}
            aria-label="Lampirkan file"
            title="Lampirkan gambar / dokumen"
            className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl border border-zinc-700/80 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.4 11.6-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />
            </svg>
          </button>
          {/* HP: tombol emoji disembunyikan (keyboard HP sudah punya emoji) supaya kolom ketik & tombol Kirim muat */}
          {!compact && (
            <span className="hidden shrink-0 sm:inline-flex">
              <EmojiInsertButton onPick={insertEmoji} className="h-[42px] w-[42px] shrink-0 border border-zinc-700/80" />
            </span>
          )}
          <textarea
            ref={input}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              detectMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
            }}
            onClick={(e) => detectMention(text, e.currentTarget.selectionStart ?? text.length)}
            onBlur={() => setTimeout(() => setMq(null), 150)}
            onPaste={(e) => {
              const fl = Array.from(e.clipboardData?.files ?? []);
              if (fl.length) {
                e.preventDefault();
                up.addFiles(fl);
              }
            }}
            onKeyDown={(e) => {
              if (mq && mentionList.length) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  setMIdx((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + mentionList.length) % mentionList.length);
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  pickMention(mentionList[Math.min(mIdx, mentionList.length - 1)]);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setMq(null);
                  return;
                }
              }
              if (e.key === "Escape" && replyTo) setReplyTo(null);
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            maxLength={4000}
            disabled={disabled}
            placeholder={compact || narrow ? "Tulis pesan…" : "Tulis pesan… (Enter kirim · Shift+Enter baris baru · Ctrl+V screenshot)"}
            className="input max-h-32 min-h-[42px] min-w-0 flex-1 resize-none"
            aria-label="Tulis pesan"
          />
          {compact && <EmojiInsertButton onPick={insertEmoji} alignRight className="h-[42px] w-9 shrink-0" />}
          <button
            disabled={disabled || sending || up.uploading > 0 || (!text.trim() && !up.done.length)}
            className={`btn-primary h-[42px] shrink-0 ${compact ? "px-4" : "px-3.5 sm:px-4"}`}
            aria-label="Kirim"
          >
            {compact ? (
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z" /></svg>
            ) : up.uploading ? (
              "Upload…"
            ) : (
              <>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" className="sm:hidden"><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z" /></svg>
                <span className="hidden sm:inline">Kirim</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
