"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ReactionRow } from "@/lib/reactions";
import { ATTACH_BUCKET, type AttachmentInput, type AttachmentView } from "@/lib/attachments";

export type ChatRoom = {
  room_id: string;
  kind: "public" | "group" | "direct";
  name: string;
  other_id: string | null;
  other_name: string | null;
  last_body: string | null;
  last_at: string | null;
  last_sender: string | null;
  unread: number;
  member_count: number;
};
export type ChatMsg = { id: number; room_id: string; sender_id: string | null; body: string; created_at: string };
export type ChatPerson = {
  id: string;
  full_name: string | null;
  email: string | null;
  role?: string | null;
  avatar_url?: string | null;
  last_seen_at?: string | null;
};
export type ChatFile = AttachmentView & { chat_message_id: number };
export type Reader = { user_id: string; last_read_at: string };

const PAGE = 50;
const COLS = "id, room_id, sender_id, body, created_at";

export const personName = (p?: ChatPerson | null) => p?.full_name || p?.email?.split("@")[0] || "Anggota";

export function roomTitle(r: ChatRoom | undefined, people: Map<string, ChatPerson>) {
  if (!r) return "";
  if (r.kind === "direct") return r.other_name || personName(people.get(r.other_id ?? "")) || "Pesan pribadi";
  return r.name || "Room";
}

/**
 * Semua logika chat: daftar room, pesan room aktif, kirim, tandai dibaca.
 * Pesan baru masuk lewat Supabase Realtime; kalau Realtime tidak tersambung, otomatis cek berkala (polling).
 * `visible` = tampilan chat sedang terlihat (halaman Chat / widget terbuka) -> pesan langsung ditandai dibaca.
 */
export function useChat(meId: string, visible: boolean, initialRoom?: string | null, onSent?: (messageId: number) => void) {
  const supabase = useMemo(() => createClient(), []);
  const [rooms, setRooms] = useState<ChatRoom[] | null>(null);
  const [people, setPeople] = useState<ChatPerson[]>([]);
  const [roomId, setRoomId] = useState<string | null>(initialRoom ?? null);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reactions, setReactions] = useState<Record<number, ReactionRow[]>>({});
  const [files, setFiles] = useState<Record<number, ChatFile[]>>({});
  const [roomFiles, setRoomFiles] = useState<ChatFile[]>([]);
  const [readers, setReaders] = useState<Reader[]>([]);
  const signed = useRef(new Map<string, { url: string; at: number }>());

  const roomRef = useRef(roomId);
  const visibleRef = useRef(visible);
  const msgsRef = useRef(msgs);
  roomRef.current = roomId;
  visibleRef.current = visible;
  msgsRef.current = msgs;

  const refreshRooms = useCallback(async () => {
    const { data, error } = await supabase.rpc("chat_overview");
    if (error) {
      setError(
        /chat_overview|function/i.test(error.message)
          ? "Fitur chat belum aktif. Admin perlu menjalankan migration-06 di Supabase."
          : error.message
      );
      setRooms((r) => r ?? []);
      return;
    }
    setError(null);
    setRooms((data ?? []) as ChatRoom[]);
  }, [supabase]);

  const markRead = useCallback(
    async (id: string) => {
      setRooms((rs) => rs?.map((r) => (r.room_id === id ? { ...r, unread: 0 } : r)) ?? rs);
      await supabase.rpc("chat_mark_read", { p_room: id });
    },
    [supabase]
  );

  // daftar orang + status online (diperbarui tiap 30 detik)
  const loadPeople = useCallback(async () => {
    const { data } = await supabase.from("profiles").select("*").order("full_name");
    if (data) setPeople(data as ChatPerson[]);
  }, [supabase]);
  useEffect(() => {
    loadPeople();
    refreshRooms();
    const t = setInterval(() => !document.hidden && loadPeople(), 30000);
    return () => clearInterval(t);
  }, [supabase, refreshRooms, loadPeople]);

  // pilih room pertama kalau belum ada yang dipilih
  useEffect(() => {
    if (!roomId && rooms?.length) setRoomId(rooms[0].room_id);
  }, [rooms, roomId]);

  // muat pesan room aktif
  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    setLoadingMsgs(true);
    setMsgs([]);
    supabase
      .from("chat_messages")
      .select(COLS)
      .eq("room_id", roomId)
      .order("id", { ascending: false })
      .limit(PAGE)
      .then(({ data }) => {
        if (cancelled) return;
        const list = ((data ?? []) as ChatMsg[]).reverse();
        setMsgs(list);
        setHasMore(list.length === PAGE);
        setLoadingMsgs(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, roomId]);

  // tandai dibaca saat room dibuka / tampilan chat terlihat
  useEffect(() => {
    if (visible && roomId) markRead(roomId);
  }, [visible, roomId, markRead]);

  const appendMsgs = useCallback((items: ChatMsg[]) => {
    if (!items.length) return;
    setMsgs((prev) => {
      const have = new Set(prev.map((m) => m.id));
      const add = items.filter((m) => m.room_id === roomRef.current && !have.has(m.id));
      return add.length ? [...prev, ...add].sort((a, b) => a.id - b.id) : prev;
    });
  }, []);

  // ambil pesan yang lebih baru dari yang sudah tampil (dipakai polling)
  const fetchNewer = useCallback(async () => {
    const id = roomRef.current;
    if (!id) return;
    const lastId = msgsRef.current.at(-1)?.id ?? 0;
    const { data } = await supabase.from("chat_messages").select(COLS).eq("room_id", id).gt("id", lastId).order("id").limit(PAGE);
    const list = (data ?? []) as ChatMsg[];
    appendMsgs(list);
    if (list.some((m) => m.sender_id !== meId) && visibleRef.current) await markRead(id);
  }, [supabase, appendMsgs, markRead, meId]);

  // Reaksi emoji untuk pesan yang sedang tampil
  const loadReactions = useCallback(async () => {
    const ids = msgsRef.current.slice(-200).map((m) => m.id);
    if (!ids.length) return;
    const { data, error } = await supabase.from("reactions").select("chat_message_id, emoji, user_id").in("chat_message_id", ids).order("id");
    if (error) return; // migration-08 belum dijalankan -> tanpa reaksi
    const next: Record<number, ReactionRow[]> = {};
    for (const r of (data ?? []) as { chat_message_id: number; emoji: string; user_id: string }[]) {
      (next[r.chat_message_id] ??= []).push({ emoji: r.emoji, user_id: r.user_id });
    }
    setReactions(next);
  }, [supabase]);

  /** link sementara untuk file (disimpan 50 menit supaya tidak minta ulang terus) */
  const signPaths = useCallback(
    async (paths: string[]) => {
      const now = Date.now();
      const need = [...new Set(paths)].filter((p) => !signed.current.has(p) || now - signed.current.get(p)!.at > 50 * 60000);
      if (need.length) {
        const { data } = await supabase.storage.from(ATTACH_BUCKET).createSignedUrls(need, 3600);
        for (const d of data ?? []) if (d.path && d.signedUrl) signed.current.set(d.path, { url: d.signedUrl, at: now });
      }
      return (p: string) => signed.current.get(p)?.url ?? null;
    },
    [supabase]
  );

  type FileRow = { id: number; path: string; name: string; size: number; mime: string | null; created_by: string | null; created_at: string; chat_message_id: number };
  const toViews = useCallback(
    async (rows: FileRow[]): Promise<ChatFile[]> => {
      const url = await signPaths(rows.map((r) => r.path));
      return rows.map((r) => {
        const u = url(r.path);
        return {
          id: r.id, name: r.name, size: Number(r.size), mime: r.mime, url: u,
          downloadUrl: u ? `${u}${u.includes("?") ? "&" : "?"}download=${encodeURIComponent(r.name)}` : null,
          created_by: r.created_by, created_by_name: null, created_at: r.created_at,
          issue_note_id: null, suggestion_comment_id: null, chat_message_id: r.chat_message_id,
        };
      });
    },
    [signPaths]
  );

  // lampiran untuk pesan yang sedang tampil
  const loadFiles = useCallback(async () => {
    const ids = msgsRef.current.slice(-200).map((m) => m.id);
    if (!ids.length) return setFiles({});
    const { data, error } = await supabase
      .from("attachments")
      .select("id, path, name, size, mime, created_by, created_at, chat_message_id")
      .in("chat_message_id", ids)
      .order("id");
    if (error) return; // migration-09 belum dijalankan
    const views = await toViews((data ?? []) as FileRow[]);
    const next: Record<number, ChatFile[]> = {};
    for (const v of views) (next[v.chat_message_id] ??= []).push(v);
    setFiles(next);
  }, [supabase, toViews]);

  // galeri "File di room ini" (12 terbaru)
  const loadRoomFiles = useCallback(async () => {
    const id = roomRef.current;
    if (!id) return;
    const { data, error } = await supabase
      .from("attachments")
      .select("id, path, name, size, mime, created_by, created_at, chat_message_id, chat_messages!inner(room_id)")
      .eq("chat_messages.room_id", id)
      .order("id", { ascending: false })
      .limit(12);
    if (error) return setRoomFiles([]);
    setRoomFiles(await toViews((data ?? []) as unknown as FileRow[]));
  }, [supabase, toViews]);

  // siapa saja sudah membaca sampai kapan (untuk "Dilihat")
  const loadReaders = useCallback(async () => {
    const id = roomRef.current;
    if (!id) return;
    const { data } = await supabase.from("chat_members").select("user_id, last_read_at").eq("room_id", id);
    setReaders((data ?? []) as Reader[]);
  }, [supabase]);

  const lastMsgId = msgs.at(-1)?.id ?? 0;
  useEffect(() => {
    loadReactions();
    loadFiles();
    loadReaders();
  }, [roomId, lastMsgId, msgs.length, loadReactions, loadFiles, loadReaders]);
  useEffect(() => {
    setRoomFiles([]);
    setReaders([]);
    loadRoomFiles();
  }, [roomId, loadRoomFiles]);

  const reactTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleReactions = useCallback(() => {
    if (reactTimer.current) clearTimeout(reactTimer.current);
    reactTimer.current = setTimeout(loadReactions, 300);
  }, [loadReactions]);

  /** klik emoji di pesan: kasih / batal (langsung tampil, lalu disimpan) */
  const toggleReaction = useCallback(
    async (msgId: number, emoji: string) => {
      const list = reactions[msgId] ?? [];
      const mine = list.some((r) => r.emoji === emoji && r.user_id === meId);
      setReactions((all) => ({
        ...all,
        [msgId]: mine ? list.filter((r) => !(r.emoji === emoji && r.user_id === meId)) : [...list, { emoji, user_id: meId }],
      }));
      const res = mine
        ? await supabase.from("reactions").delete().eq("chat_message_id", msgId).eq("user_id", meId).eq("emoji", emoji)
        : await supabase.from("reactions").insert({ chat_message_id: msgId, emoji });
      if (res.error && !/duplicate/i.test(res.error.message)) {
        setReactions((all) => ({ ...all, [msgId]: list }));
        setError(/reactions/i.test(res.error.message) ? "Reaksi belum aktif. Admin perlu menjalankan migration-08." : res.error.message);
      }
    },
    [reactions, supabase, meId]
  );

  // Realtime: pesan baru langsung muncul
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const channel = supabase
      .channel(`chat-${meId}-${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, async (payload) => {
        const m = payload.new as ChatMsg;
        if (m.room_id === roomRef.current) {
          appendMsgs([m]);
          if (visibleRef.current && m.sender_id !== meId) await markRead(m.room_id);
        }
        if (refreshTimer.current) clearTimeout(refreshTimer.current);
        refreshTimer.current = setTimeout(refreshRooms, 250);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "reactions" }, () => scheduleReactions())
      .subscribe((status) => setLive(status === "SUBSCRIBED"));
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, meId, appendMsgs, markRead, refreshRooms, scheduleReactions]);

  // Cadangan kalau Realtime tidak tersambung: cek berkala (lebih jarang kalau Realtime aktif)
  useEffect(() => {
    const t = setInterval(
      () => {
        if (document.hidden) return;
        if (!live) fetchNewer();
        if (!live && visible) loadReactions();
        if (visible) loadReaders();
        refreshRooms();
      },
      live ? 45000 : visible ? 5000 : 20000
    );
    return () => clearInterval(t);
  }, [live, visible, fetchNewer, refreshRooms, loadReactions, loadReaders]);

  const loadOlder = useCallback(async () => {
    const id = roomRef.current;
    const first = msgsRef.current[0]?.id;
    if (!id || !first) return;
    const { data } = await supabase.from("chat_messages").select(COLS).eq("room_id", id).lt("id", first).order("id", { ascending: false }).limit(PAGE);
    const older = ((data ?? []) as ChatMsg[]).reverse();
    setHasMore(older.length === PAGE);
    setMsgs((prev) => [...older, ...prev]);
  }, [supabase]);

  /** kirim teks dan/atau lampiran (file sudah ter-upload ke Storage) */
  const send = useCallback(
    async (body: string, attach: AttachmentInput[] = []) => {
      const text = body.trim().slice(0, 4000);
      const id = roomRef.current;
      if ((!text && !attach.length) || !id) return false;
      let mid: number | null = null;
      const rpc = await supabase.rpc("chat_send", { p_room: id, p_body: text, p_files: attach });
      if (!rpc.error) mid = rpc.data as number;
      else if (/chat_send|function/i.test(rpc.error.message) && !attach.length) {
        // migration-09 belum dijalankan -> cara lama (teks saja)
        const r = await supabase.from("chat_messages").insert({ room_id: id, body: text }).select("id").single();
        if (r.error) return setError(`Pesan gagal terkirim: ${r.error.message}`), false;
        mid = r.data.id as number;
      } else {
        setError(
          /chat_send|function/i.test(rpc.error.message)
            ? "Kirim lampiran di chat belum aktif. Admin perlu menjalankan migration-09."
            : `Pesan gagal terkirim: ${rpc.error.message}`
        );
        return false;
      }
      const { data } = await supabase.from("chat_messages").select(COLS).eq("id", mid).single();
      setError(null);
      if (data) {
        appendMsgs([data as ChatMsg]);
        setRooms((rs) =>
          rs?.map((r) => (r.room_id === id ? { ...r, last_body: text || "📎 Lampiran", last_at: (data as ChatMsg).created_at, unread: 0 } : r)) ?? rs
        );
      }
      if (attach.length) {
        loadFiles();
        loadRoomFiles();
      }
      onSent?.(mid!);
      return true;
    },
    [supabase, appendMsgs, loadFiles, loadRoomFiles, onSent]
  );

  const openDm = useCallback(
    async (otherId: string) => {
      const { data, error } = await supabase.rpc("chat_open_dm", { p_other: otherId });
      if (error || !data) return setError(error?.message ?? "Gagal membuka chat");
      await refreshRooms();
      setRoomId(data as string);
    },
    [supabase, refreshRooms]
  );

  const createRoom = useCallback(
    async (name: string, isPublic: boolean, members: string[]) => {
      const { data, error } = await supabase.rpc("chat_create_room", {
        p_name: name,
        p_kind: isPublic ? "public" : "group",
        p_members: members,
      });
      if (error || !data) {
        setError(error?.message ?? "Gagal membuat room");
        return false;
      }
      await refreshRooms();
      setRoomId(data as string);
      return true;
    },
    [supabase, refreshRooms]
  );

  const peopleMap = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const unreadTotal = (rooms ?? []).reduce((n, r) => n + (r.unread || 0), 0);
  const room = rooms?.find((r) => r.room_id === roomId);

  return {
    rooms, room, roomId, setRoomId, msgs, loadingMsgs, hasMore, loadOlder,
    people, peopleMap, send, openDm, createRoom, unreadTotal, live, error, setError,
    reactions, toggleReaction, files, roomFiles, readers,
  };
}
