"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/* eslint-disable @typescript-eslint/no-explicit-any */
type YTPlayer = {
  loadVideoById(id: string): void;
  loadPlaylist(o: { list: string; listType: "playlist"; index?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  nextVideo(): void;
  previousVideo(): void;
  setVolume(v: number): void;
  getPlayerState(): number;
  getVideoData(): { title?: string; author?: string; video_id?: string };
  getPlaylist(): string[] | null;
  destroy(): void;
};
type Track = { kind: "video" | "playlist"; id: string; list?: string; title: string; channel?: string };
type Hit = { id: string; title: string; channel: string; thumb: string };
const KEY = "cs-music-yt";

/** link YouTube / YouTube Music -> video atau playlist */
export function parseYt(raw: string): Track | null {
  const s = raw.trim();
  if (/^[\w-]{11}$/.test(s)) return { kind: "video", id: s, title: "" };
  let u: URL;
  try {
    u = new URL(s.startsWith("http") ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (!/(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)youtube-nocookie\.com$/.test(u.hostname)) return null;
  const list = u.searchParams.get("list") ?? undefined;
  let v = u.searchParams.get("v");
  if (!v && u.hostname.endsWith("youtu.be")) v = u.pathname.slice(1, 12);
  if (!v) v = u.pathname.match(/\/(?:shorts|embed|live)\/([\w-]{11})/)?.[1] ?? null;
  if (v && /^[\w-]{11}$/.test(v)) return { kind: "video", id: v, list: list && !list.startsWith("RD") ? list : undefined, title: "" };
  if (list) return { kind: "playlist", id: list, list, title: "" };
  return null;
}

let apiP: Promise<any> | null = null;
const loadApi = () =>
  (apiP ??= new Promise((res) => {
    const w = window as any;
    if (w.YT?.Player) return res(w.YT);
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      prev?.();
      res(w.YT);
    };
    const sc = document.createElement("script");
    sc.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(sc);
  }));

/**
 * ▶ YouTube / YouTube Music lewat pemutar resmi (embed). Lagu bebas: tempel link atau cari.
 * Pemutar mengambang di pojok (wajib terlihat, min. 200px, sesuai aturan YouTube), tetap jalan saat pindah halaman.
 */
export default function YtMusic({ panel, vol, onStart, stopTick }: { panel: HTMLElement | null; vol: number; onStart: () => void; stopTick: number }) {
  const [track, setTrack] = useState<Track | null>(null);
  const [playing, setPlaying] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [recent, setRecent] = useState<Track[]>([]);
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) ?? "{}");
      if (Array.isArray(s.recent)) setRecent(s.recent.slice(0, 8));
    } catch {}
  }, []);
  const remember = (t: Track) =>
    setRecent((r) => {
      const n = [t, ...r.filter((x) => x.id !== t.id)].slice(0, 8);
      try {
        localStorage.setItem(KEY, JSON.stringify({ recent: n }));
      } catch {}
      return n;
    });
  useEffect(() => player.current?.setVolume(Math.round(vol * 100)), [vol]);
  // musik AI diputar -> YouTube dijeda
  useEffect(() => {
    if (stopTick) player.current?.pauseVideo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopTick]);

  const play = async (t: Track) => {
    setMsg(null);
    onStart();
    setTrack(t);
    const YT = await loadApi();
    const go = (p: YTPlayer) => {
      p.setVolume(Math.round(vol * 100));
      if (t.kind === "playlist") p.loadPlaylist({ list: t.id, listType: "playlist" });
      else if (t.list) p.loadPlaylist({ list: t.list, listType: "playlist" }), setTimeout(() => (p.getVideoData().video_id !== t.id ? p.loadVideoById(t.id) : null), 1500);
      else p.loadVideoById(t.id);
    };
    if (player.current) return go(player.current);
    await new Promise((r) => setTimeout(r, 0));
    if (!host.current) return;
    const el = document.createElement("div");
    host.current.replaceChildren(el);
    new YT.Player(el, {
      host: "https://www.youtube-nocookie.com",
      width: "100%",
      height: "100%",
      playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1 },
      events: {
        onReady: (e: { target: YTPlayer }) => {
          player.current = e.target;
          go(e.target);
        },
        onStateChange: (e: { data: number; target: YTPlayer }) => {
          setPlaying(e.data === 1 || e.data === 3);
          if (e.data === 1) {
            const d = e.target.getVideoData();
            setTrack((x) => (x ? { ...x, title: d.title || x.title, channel: d.author || x.channel } : x));
            if (d.title) remember({ ...t, title: t.kind === "playlist" ? `Playlist · ${d.title}` : d.title, channel: d.author });
          }
        },
        onError: (e: { data: number }) => setMsg(e.data === 101 || e.data === 150 ? "Lagu ini tidak boleh diputar di luar YouTube oleh pemiliknya. Coba versi/lagu lain." : "Video tidak bisa diputar. Cek lagi link-nya."),
      },
    });
  };
  const close = () => {
    player.current?.destroy();
    player.current = null;
    if (host.current) host.current.replaceChildren();
    setTrack(null);
    setPlaying(false);
  };
  const submit = async () => {
    const t = parseYt(q);
    if (t) {
      setQ("");
      setHits([]);
      return play(t);
    }
    if (!q.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/music/yt?q=${encodeURIComponent(q)}`);
      const j = await r.json();
      if (j.error === "nokey") setMsg("Pencarian belum aktif (admin perlu isi YOUTUBE_API_KEY). Sementara tempel link lagu / playlist dari YouTube atau YouTube Music.");
      else if (j.error) setMsg(j.error);
      else {
        setHits(j.items ?? []);
        if (!j.items?.length) setMsg("Tidak ketemu, coba kata lain.");
      }
    } catch {
      setMsg("Pencarian gagal.");
    } finally {
      setBusy(false);
    }
  };
  const isList = track && (track.kind === "playlist" || track.list);

  const ui = (
    <div>
      <div className="flex gap-1.5">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Cari lagu / tempel link YouTube Music"
          className="input min-w-0 flex-1 py-1.5 text-[12.5px]"
        />
        <button type="button" onClick={submit} disabled={busy || !q.trim()} className="shrink-0 rounded-lg bg-red-600 px-2.5 text-[12px] font-bold text-white disabled:opacity-50">
          {busy ? "…" : parseYt(q) ? "▶" : "Cari"}
        </button>
      </div>
      {msg && <p className="mt-1.5 text-[11.5px] text-amber-400">{msg}</p>}
      {hits.length > 0 && (
        <div className="mt-2 max-h-[240px] space-y-0.5 overflow-y-auto">
          {hits.map((h) => (
            <button key={h.id} type="button" onClick={() => play({ kind: "video", id: h.id, title: h.title, channel: h.channel })} className={`flex w-full items-center gap-2 rounded-lg p-1 text-left hover:bg-zinc-800 ${track?.id === h.id ? "bg-red-500/10" : ""}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={h.thumb} alt="" className="h-9 w-12 shrink-0 rounded object-cover" />
              <span className="min-w-0">
                <span className="line-clamp-1 block text-[12.5px] font-semibold text-zinc-200">{h.title}</span>
                <span className="block truncate text-[11px] text-zinc-500">{h.channel}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {track && (
        <div className="mt-2 flex items-center gap-1.5 rounded-xl bg-zinc-800/60 p-2">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-semibold text-zinc-200">{track.title || "Memuat…"}</span>
            <span className="block truncate text-[11px] text-zinc-500">{track.channel || (isList ? "playlist" : "YouTube")}</span>
          </span>
          {isList && (
            <button type="button" onClick={() => player.current?.previousVideo()} className="px-1 text-[14px] text-zinc-300" aria-label="Sebelumnya">
              ⏮
            </button>
          )}
          <button type="button" onClick={() => (playing ? player.current?.pauseVideo() : (onStart(), player.current?.playVideo()))} className="rounded-lg bg-red-600 px-2 py-0.5 text-[13px] text-white" aria-label={playing ? "Jeda" : "Putar"}>
            {playing ? "⏸" : "▶"}
          </button>
          {isList && (
            <button type="button" onClick={() => player.current?.nextVideo()} className="px-1 text-[14px] text-zinc-300" aria-label="Berikutnya">
              ⏭
            </button>
          )}
          <button type="button" onClick={close} className="px-1 text-[13px] text-zinc-500" aria-label="Tutup">
            ✕
          </button>
        </div>
      )}
      {!hits.length && recent.length > 0 && (
        <div className="mt-2">
          <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Terakhir diputar</div>
          <div className="mt-1 space-y-0.5">
            {recent.map((r) => (
              <button key={r.id} type="button" onClick={() => play(r)} className="block w-full truncate rounded-lg px-1.5 py-1 text-left text-[12.5px] text-zinc-300 hover:bg-zinc-800">
                {r.kind === "playlist" ? "📃" : "♪"} {r.title}
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="mt-2 text-[10.5px] leading-snug text-zinc-500">Pakai pemutar resmi YouTube (bisa ada iklan dari YouTube). Lagu, video & playlist dari YouTube Music juga bisa — salin link lewat tombol Bagikan.</p>
    </div>
  );

  return (
    <>
      {panel && createPortal(ui, panel)}
      {/* pemutar mengambang: tetap terlihat (aturan YouTube) */}
      <div
        className={`fixed bottom-4 right-4 z-[80] overflow-hidden rounded-xl border border-zinc-800 bg-black shadow-2xl transition-all ${track ? "" : "pointer-events-none invisible"}`}
        style={{ width: "min(356px, calc(100vw - 32px))" }}
      >
        <div className="flex items-center gap-1 bg-zinc-900 px-2 py-1 text-[11px]">
          <span className={`truncate ${playing ? "text-red-400" : "text-zinc-400"}`}>{playing ? "▶" : "⏸"} {track?.title || "YouTube"}</span>
          <button type="button" onClick={close} className="ml-auto px-1 text-zinc-400 hover:text-zinc-100" aria-label="Tutup">
            ✕
          </button>
        </div>
        <div ref={host} className="h-[200px] w-full" />
      </div>
    </>
  );
}
