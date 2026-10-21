"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ReactionRow } from "@/lib/reactions";

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
export type ChatPerson = { id: string; full_name: string | null; email: string | null };

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
export function useChat(meId: string, visible: boolean, initialRoom?: string | null) {
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

  // daftar orang (sekali)
  useEffect(() => {
    supabase
      .from("profiles")
      .select("id, full_name, email")
      .order("full_name")
      .then(({ data }) => setPeople((data ?? []) as ChatPerson[]));
    refreshRooms();
  }, [supabase, refreshRooms]);

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

  const lastMsgId = msgs.at(-1)?.id ?? 0;
  useEffect(() => {
    loadReactions();
  }, [roomId, lastMsgId, msgs.length, loadReactions]);

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
        refreshRooms();
      },
      live ? 45000 : visible ? 5000 : 20000
    );
    return () => clearInterval(t);
  }, [live, visible, fetchNewer, refreshRooms, loadReactions]);

  const loadOlder = useCallback(async () => {
    const id = roomRef.current;
    const first = msgsRef.current[0]?.id;
    if (!id || !first) return;
    const { data } = await supabase.from("chat_messages").select(COLS).eq("room_id", id).lt("id", first).order("id", { ascending: false }).limit(PAGE);
    const older = ((data ?? []) as ChatMsg[]).reverse();
    setHasMore(older.length === PAGE);
    setMsgs((prev) => [...older, ...prev]);
  }, [supabase]);

  const send = useCallback(
    async (body: string) => {
      const text = body.trim();
      const id = roomRef.current;
      if (!text || !id) return false;
      const { data, error } = await supabase.from("chat_messages").insert({ room_id: id, body: text.slice(0, 4000) }).select(COLS).single();
      if (error || !data) {
        setError(`Pesan gagal terkirim: ${error?.message ?? "coba lagi"}`);
        return false;
      }
      setError(null);
      appendMsgs([data as ChatMsg]);
      setRooms((rs) =>
        rs?.map((r) => (r.room_id === id ? { ...r, last_body: text, last_at: (data as ChatMsg).created_at, unread: 0 } : r)) ?? rs
      );
      return true;
    },
    [supabase, appendMsgs]
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
    reactions, toggleReaction,
  };
}
