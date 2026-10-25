"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MusicCmd } from "@/lib/musicCmd";

/* eslint-disable @typescript-eslint/no-explicit-any */
type YTPlayer = {
  loadVideoById(id: string): void;
  loadPlaylist(o: { list: string; listType: "playlist"; index?: number } | string[], index?: number): void;
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
type Track = { kind: "video" | "playlist" | "queue"; id: string; list?: string; ids?: string[]; title: string; channel?: string };
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
 * Pemutar tidak ditampilkan (cuma suara), kontrol di panel 🎵; tetap jalan saat pindah halaman.
 */

export default function YtMusic({ panel, vol, onStart, stopTick, onPlaying, cmd }: { panel: HTMLElement | null; vol: number; onStart: () => void; stopTick: number; onPlaying?: (on: boolean) => void; cmd?: (MusicCmd & { n: number }) | null }) {
  const [track, setTrack] = useState<Track | null>(null);
  const cur = useRef<Track | null>(null);
  const [topTab, setTopTab] = useState<"id" | "global">("id");
  const [tops, setTops] = useState<Record<string, Hit[] | string>>({});
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
        localStorage.setItem(KEY, JSON.stringify({ ...JSON.parse(localStorage.getItem(KEY) ?? "{}"), recent: n }));
      } catch {}
      return n;
    });
  useEffect(() => player.current?.setVolume(Math.round(vol * 100)), [vol]);
  useEffect(() => onPlaying?.(playing), [playing, onPlaying]);
  // top 10 trending (diambil sekali per buka, server cache 3 jam)
  useEffect(() => {
    if (!panel || tops[topTab]) return;
    setTops((t) => ({ ...t, [topTab]: "loading" }));
    fetch(`/api/music/yt?top=${topTab}`)
      .then((r) => r.json())
      .then((j) => setTops((t) => ({ ...t, [topTab]: j.error === "nokey" ? "Daftar trending aktif setelah admin isi YOUTUBE_API_KEY." : j.error || j.items || [] })))
      .catch(() => setTops((t) => ({ ...t, [topTab]: "Gagal memuat trending." })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, topTab]);
  // musik AI diputar -> YouTube dijeda
  useEffect(() => {
    if (stopTick) player.current?.pauseVideo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopTick]);

  const play = async (t: Track) => {
    setMsg(null);
    onStart();
    setTrack(t);
    cur.current = t;
    const YT = await loadApi();
    const go = (p: YTPlayer) => {
      p.setVolume(Math.round(vol * 100));
      if (t.kind === "queue" && t.ids) p.loadPlaylist(t.ids, Math.max(0, t.ids.indexOf(t.id)));
      else if (t.kind === "playlist") p.loadPlaylist({ list: t.id, listType: "playlist" });
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
            const c = cur.current;
            if (d.title && c) remember(c.kind === "queue" ? { kind: "video", id: d.video_id || c.id, title: d.title, channel: d.author } : { ...c, title: c.kind === "playlist" ? `Playlist · ${d.title}` : d.title, channel: d.author });
          }
        },
        onError: (e: { data: number; target: YTPlayer }) => {
          // di antrean (top 10 / playlist): lagu yang diblokir pemiliknya dilewati otomatis
          if (cur.current && cur.current.kind !== "video") return void setTimeout(() => e.target.nextVideo(), 800);
          setMsg(e.data === 101 || e.data === 150 ? "Lagu ini tidak boleh diputar di luar YouTube oleh pemiliknya. Coba versi/lagu lain." : "Video tidak bisa diputar. Cek lagi link-nya.");
        },
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
  // perintah dari chat AI
  useEffect(() => {
    if (!cmd) return;
    if (cmd.action === "pause" || cmd.action === "stop") return void player.current?.pauseVideo();
    if (cmd.action === "play" && !cmd.query && !cmd.top && !cmd.url) return void (track && (onStart(), player.current?.playVideo()));
    const t = cmd.url ? parseYt(cmd.url) : null;
    if (t) return void play(t);
    if (cmd.top) {
      setTopTab(cmd.top);
      void fetch(`/api/music/yt?top=${cmd.top}`)
        .then((r) => r.json())
        .then((j) => {
          if (j.error) return setMsg(j.error === "nokey" ? "Daftar trending aktif setelah admin isi YOUTUBE_API_KEY." : j.error);
          const items: Hit[] = j.items ?? [];
          setTops((x) => ({ ...x, [cmd.top!]: items }));
          if (items[0]) play({ kind: "queue", id: items[0].id, ids: items.map((x) => x.id), title: items[0].title, channel: items[0].channel });
        })
        .catch(() => setMsg("Gagal memuat trending."));
      return;
    }
    if (cmd.query) {
      void fetch(`/api/music/yt?q=${encodeURIComponent(cmd.query)}`)
        .then((r) => r.json())
        .then((j) => {
          if (j.error) return setMsg(j.error === "nokey" ? "Pencarian belum aktif (admin perlu isi YOUTUBE_API_KEY). Tempel link lagu di menu 🎵." : j.error);
          const items: Hit[] = j.items ?? [];
          setHits(items);
          if (!items[0]) return setMsg(`“${cmd.query}” tidak ketemu di YouTube.`);
          play({ kind: "queue", id: items[0].id, ids: items.map((x) => x.id), title: items[0].title, channel: items[0].channel });
        })
        .catch(() => setMsg("Pencarian gagal."));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmd?.n]);
  const isList = track && (track.kind !== "video" || track.list);
  const topList = tops[topTab];

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
      {!hits.length && (
        <div className="mt-2.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">🔥 Top 10 trending</span>
            <div className="ml-auto flex rounded-full bg-zinc-800 p-0.5 text-[11px] font-semibold">
              {(
                [
                  ["id", "🇮🇩 Indo"],
                  ["global", "🌍 Global"],
                ] as const
              ).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setTopTab(k)} className={`rounded-full px-2 py-0.5 ${topTab === k ? "bg-red-600 text-white" : "text-zinc-400"}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          {topList === "loading" || !topList ? (
            <p className="mt-1.5 text-[11.5px] text-zinc-500">Memuat…</p>
          ) : typeof topList === "string" ? (
            <p className="mt-1.5 text-[11.5px] text-zinc-500">{topList}</p>
          ) : (
            <div className="mt-1 max-h-[230px] space-y-0.5 overflow-y-auto">
              {topList.map((h, i) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => play({ kind: "queue", id: h.id, ids: topList.map((x) => x.id), title: h.title, channel: h.channel })}
                  className={`flex w-full items-center gap-2 rounded-lg p-1 text-left hover:bg-zinc-800 ${track?.title === h.title ? "bg-red-500/10" : ""}`}
                >
                  <b className="w-4 shrink-0 text-center text-[12px] text-zinc-500">{i + 1}</b>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={h.thumb} alt="" className="h-8 w-11 shrink-0 rounded object-cover" />
                  <span className="min-w-0">
                    <span className="line-clamp-1 block text-[12.5px] font-semibold text-zinc-200">{h.title}</span>
                    <span className="block truncate text-[11px] text-zinc-500">{h.channel}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {Array.isArray(topList) && topList.length > 0 && <p className="mt-1 text-[10.5px] text-zinc-500">Klik satu lagu → 10 lagu diputar berurutan. Sumber: chart resmi YouTube{topTab === "global" ? " (gabungan US, UK, Korea, Jepang, Brasil, India)" : " Indonesia"}.</p>}
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
      <p className="mt-2 text-[10.5px] leading-snug text-zinc-500">Diputar lewat YouTube (cuma suara, bisa ada iklan suara dari YouTube). Lagu, video & playlist dari YouTube Music juga bisa — salin link lewat tombol Bagikan.</p>
    </div>
  );

  return (
    <>
      {panel && createPortal(ui, panel)}
      {/* pemutar YouTube tidak ditampilkan (hanya suara); kontrol ada di panel 🎵.
          Ukurannya sengaja 640×360: pemutar yang terlalu kecil dikasih YouTube kualitas rendah (suara ikut kurang jernih) */}
      <div aria-hidden className="pointer-events-none fixed bottom-0 right-0 overflow-hidden" style={{ width: 640, height: 360, opacity: 0, zIndex: -5 }}>
        <div ref={host} className="h-full w-full" />
      </div>
    </>
  );
}
