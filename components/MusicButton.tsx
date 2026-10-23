"use client";

import { useEffect, useRef, useState } from "react";
import YtMusic from "./YtMusic";
import Meteors from "./Meteors";

type Preset = { id: string; icon: string; name: string; desc: string; prompts: { text: string; weight: number }[]; bpm: number; density: number; brightness: number };
const PRESETS: Preset[] = [
  { id: "piano", icon: "🎹", name: "Piano klasik santai", desc: "Piano solo lembut, tenang", prompts: [{ text: "gentle solo classical piano, calm, Chopin nocturne style, soft dynamics", weight: 1 }], bpm: 70, density: 0.35, brightness: 0.45 },
  { id: "strings", icon: "🎻", name: "String quartet", desc: "Biola & cello hangat", prompts: [{ text: "warm classical string quartet, relaxing, baroque, legato", weight: 1 }], bpm: 76, density: 0.45, brightness: 0.5 },
  { id: "focus", icon: "🧠", name: "Fokus kerja", desc: "Ambient klasik minim drum", prompts: [{ text: "minimal ambient classical, soft piano and strings, focus music, no percussion", weight: 1 }], bpm: 72, density: 0.3, brightness: 0.4 },
  { id: "guitar", icon: "🎸", name: "Gitar akustik", desc: "Petikan gitar akustik hangat", prompts: [{ text: "warm acoustic guitar fingerpicking, mellow, relaxing, cozy coffee shop, steel string", weight: 1 }], bpm: 78, density: 0.4, brightness: 0.5 },
  { id: "nylon", icon: "🪕", name: "Gitar klasik (nylon)", desc: "Gitar klasik lembut, ala Spanyol", prompts: [{ text: "solo classical nylon guitar, gentle, romantic, spanish guitar, calm", weight: 1 }], bpm: 72, density: 0.35, brightness: 0.45 },
  { id: "lofi", icon: "☕", name: "Lo-fi klasik", desc: "Klasik + beat santai", prompts: [{ text: "lofi hip hop with classical piano samples, chill, mellow", weight: 1 }], bpm: 80, density: 0.5, brightness: 0.45 },
];
const KEY = "cs-music";

type Session = { setWeightedPrompts(p: object): Promise<void>; setMusicGenerationConfig(p: object): Promise<void>; play(): void; pause(): void; stop(): void; close(): void; resetContext?(): void };

/** 🎵 Musik AI (Google Lyria RealTime): musik instrumental yang dibuat langsung, terus mengalir sambil kerja. */
export default function MusicButton() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"ai" | "yt">("ai");
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const [ytStop, setYtStop] = useState(0);
  const [ytOn, setYtOn] = useState(false);
  const [state, setState] = useState<"idle" | "connecting" | "playing" | "paused" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [preset, setPreset] = useState(PRESETS[0].id);
  const [vol, setVol] = useState(0.6);
  // prompt sendiri: dipadukan dengan gaya yang dipilih (prompt sendiri lebih dominan)
  const [custom, setCustom] = useState("");
  const [active, setActive] = useState("");
  const [bpm, setBpm] = useState<number | null>(null);
  const [noDrums, setNoDrums] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const session = useRef<Session | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const gain = useRef<GainNode | null>(null);
  const nextAt = useRef(0);
  // auto-sambung lagi: musik jalan terus sampai user sendiri yang pause/stop
  const want = useRef(false);
  const gen = useRef(0);
  const lastChunk = useRef(0);
  const retry = useRef(0);
  const retryT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<{ prompts: object[]; cfg: object }>({ prompts: [], cfg: {} });

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) ?? "{}");
      if (s.preset) setPreset(s.preset);
      if (typeof s.vol === "number") setVol(s.vol);
      if (typeof s.custom === "string") {
        setCustom(s.custom);
        setActive(s.custom);
      }
      if (typeof s.bpm === "number") setBpm(s.bpm);
      if (s.noDrums) setNoDrums(true);
      if (s.tab === "yt") setTab("yt");
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ preset, vol, custom: active, bpm, noDrums, tab }));
    } catch {}
    if (gain.current) gain.current.gain.value = vol;
  }, [preset, vol, active, bpm, noDrums, tab]);
  useEffect(() => {
    if (!open) return;
    const r = btn.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 8, left: Math.max(8, Math.min(window.innerWidth - 308, r.right - 300)) });
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  useEffect(() => () => stopAll(), []);
  // penjaga: kalau koneksi diam/putus atau audio disuspend browser, sambungkan & lanjutkan lagi
  useEffect(() => {
    const t = setInterval(() => {
      if (!want.current) return;
      if (ctx.current && ctx.current.state !== "running") ctx.current.resume().catch(() => {});
      if (session.current && lastChunk.current && Date.now() - lastChunk.current > 20000) reconnect();
    }, 5000);
    const vis = () => want.current && ctx.current?.state !== "running" && ctx.current?.resume().catch(() => {});
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("focus", vis);
    window.addEventListener("online", () => want.current && !session.current && reconnect());
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("focus", vis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cfgOf = (p: Preset, b = bpm, nd = noDrums) => ({ musicGenerationConfig: { bpm: b ?? p.bpm, density: p.density, brightness: p.brightness, guidance: 4.0, temperature: 1.1, muteDrums: nd } });
  const promptsOf = (p: Preset, c = active) => (c.trim() ? [{ text: c.trim().slice(0, 400), weight: 1.4 }, ...p.prompts.map((x) => ({ ...x, weight: 0.5 }))] : p.prompts);

  // potongan audio PCM 16-bit -> dijadwalkan berurutan (ada jeda penyangga ±1 detik supaya tidak putus-putus)
  const playChunk = (b64: string, mime?: string) => {
    const ac = ctx.current;
    if (!ac || !gain.current) return;
    const rate = Number(mime?.match(/rate=(\d+)/)?.[1] ?? 48000);
    const ch = Number(mime?.match(/channels=(\d+)/)?.[1] ?? 2);
    const bin = atob(b64);
    const n = Math.floor(bin.length / 2);
    const frames = Math.floor(n / ch);
    const buf = ac.createBuffer(ch, frames, rate);
    for (let c = 0; c < ch; c++) {
      const out = buf.getChannelData(c);
      for (let i = 0; i < frames; i++) {
        const k = (i * ch + c) * 2;
        let v = bin.charCodeAt(k) | (bin.charCodeAt(k + 1) << 8);
        if (v >= 0x8000) v -= 0x10000;
        out[i] = v / 32768;
      }
    }
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(gain.current);
    const now = ac.currentTime;
    if (nextAt.current < now + 0.05) nextAt.current = now + 1.0;
    src.start(nextAt.current);
    nextAt.current += buf.duration;
  };

  /** buka sesi Lyria baru memakai setelan terakhir (AudioContext dipakai ulang) */
  const connect = async () => {
    const g = ++gen.current;
    const r = await fetch("/api/music/key", { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "Musik belum disetel");
    if (!ctx.current) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx.current = new AC({ sampleRate: 48000 });
      gain.current = ctx.current.createGain();
      gain.current.gain.value = vol;
      gain.current.connect(ctx.current.destination);
      nextAt.current = 0;
    }
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: j.key, apiVersion: "v1alpha" });
    const s = (await ai.live.music.connect({
      model: j.model,
      callbacks: {
        onmessage: (m: { serverContent?: { audioChunks?: { data?: string; mimeType?: string }[] }; filteredPrompt?: { filteredReason?: string } }) => {
          if (g !== gen.current) return;
          for (const c of m.serverContent?.audioChunks ?? [])
            if (c.data) {
              lastChunk.current = Date.now();
              retry.current = 0;
              playChunk(c.data, c.mimeType);
            }
          if (m.filteredPrompt) setErr(`Prompt ditolak: ${m.filteredPrompt.filteredReason ?? "-"}`);
        },
        onerror: () => {
          if (g === gen.current) lost();
        },
        onclose: () => {
          if (g === gen.current) lost();
        },
      },
    })) as unknown as Session;
    if (g !== gen.current) return s.close();
    session.current = s;
    lastChunk.current = Date.now();
    await s.setWeightedPrompts({ weightedPrompts: latest.current.prompts });
    await s.setMusicGenerationConfig(latest.current.cfg);
    s.play();
    await ctx.current?.resume();
  };
  /** sesi putus (batas waktu server / jaringan / laptop tidur) -> sambung lagi otomatis kalau user masih mau dengar */
  function lost() {
    session.current = null;
    if (!want.current) return setState((x) => (x === "error" ? x : "idle"));
    reconnect();
  }
  function reconnect() {
    if (retryT.current) return;
    try {
      gen.current++;
      session.current?.close();
    } catch {}
    session.current = null;
    const wait = Math.min(15000, 800 * 2 ** retry.current++);
    retryT.current = setTimeout(async () => {
      retryT.current = null;
      if (!want.current) return;
      try {
        await connect();
        setErr(null);
        setState("playing");
      } catch {
        reconnect();
      }
    }, wait);
  }

  const start = async (p = PRESETS.find((x) => x.id === preset) ?? PRESETS[0]) => {
    setErr(null);
    want.current = true;
    setYtStop((n) => n + 1);
    latest.current = { prompts: promptsOf(p), cfg: cfgOf(p) };
    if (session.current) {
      lastChunk.current = Date.now();
      session.current.play();
      await ctx.current?.resume();
      setState("playing");
      return;
    }
    setState("connecting");
    try {
      retry.current = 0;
      await connect();
      setState("playing");
    } catch (e) {
      want.current = false;
      setErr((e as Error).message || "Gagal memulai musik");
      setState("error");
      stopAll();
    }
  };
  const pause = async () => {
    want.current = false;
    session.current?.pause();
    await ctx.current?.suspend();
    setState("paused");
  };
  function stopAll() {
    want.current = false;
    gen.current++;
    if (retryT.current) clearTimeout(retryT.current);
    retryT.current = null;
    try {
      session.current?.stop();
      session.current?.close();
    } catch {}
    session.current = null;
    ctx.current?.close().catch(() => {});
    ctx.current = null;
    gain.current = null;
  }
  const choose = async (p: Preset) => {
    setPreset(p.id);
    latest.current = { prompts: promptsOf(p), cfg: cfgOf(p) };
    const s = session.current;
    if (!s) return start(p);
    // ganti gaya: prompt baru + reset supaya tempo berubah
    await s.setWeightedPrompts({ weightedPrompts: promptsOf(p) });
    await s.setMusicGenerationConfig(cfgOf(p));
    s.resetContext?.();
  };
  const cur = () => PRESETS.find((x) => x.id === preset) ?? PRESETS[0];
  /** terapkan prompt sendiri (tanpa reset: transisi halus) */
  const applyCustom = async (text: string) => {
    setActive(text);
    latest.current = { ...latest.current, prompts: promptsOf(cur(), text) };
    const s = session.current;
    if (!s) return start(cur());
    await s.setWeightedPrompts({ weightedPrompts: promptsOf(cur(), text) });
  };
  /** tempo / drum berubah -> perlu reset konteks (transisi agak mendadak) */
  const applyCfg = async (b: number | null, nd: boolean) => {
    setBpm(b);
    setNoDrums(nd);
    latest.current = { ...latest.current, cfg: cfgOf(cur(), b, nd) };
    const s = session.current;
    if (!s) return;
    await s.setMusicGenerationConfig(cfgOf(cur(), b, nd));
    s.resetContext?.();
  };

  const playing = state === "playing";
  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`relative whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition ${playing || ytOn ? "text-emerald-400" : "text-zinc-400 hover:text-zinc-100"}`}
        title="Musik sambil kerja: AI atau YouTube"
        aria-label="Musik"
      >
        {playing || ytOn ? <span className="inline-block animate-pulse">🎵</span> : "🎵"}
      </button>
      {open && (
        <div ref={box} className="fixed z-[90] max-h-[calc(100vh-80px)] w-[300px] overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-900 p-3 text-left" style={{ top: pos.top, left: pos.left, boxShadow: "var(--shadow-pop), 0 20px 40px -16px rgba(0,0,0,.4)" }}>
          <div className="flex items-center gap-2">
            <b className="text-[14px]">🎵 Musik</b>
            <div className="ml-auto flex rounded-full bg-zinc-800 p-0.5 text-[12px] font-semibold">
              {(
                [
                  ["ai", "✨ Musik AI"],
                  ["yt", "▶ YouTube"],
                ] as const
              ).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setTab(k)} className={`rounded-full px-2.5 py-1 ${tab === k ? (k === "yt" ? "bg-red-600 text-white" : "bg-emerald-600 text-white") : "text-zinc-400"}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div ref={setPanel} className={tab === "yt" ? "mt-2.5" : "hidden"} />
          {tab === "ai" && (
          <>
          <p className="mt-1 text-[11px] text-zinc-500">Instrumental dibuat AI langsung, tanpa jeda</p>
          <div className="mt-2 space-y-1">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => choose(p)}
                className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left ${preset === p.id ? "bg-emerald-500/10 ring-1 ring-emerald-500/40" : "hover:bg-zinc-800"}`}
              >
                <span className="text-[18px]">{p.icon}</span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-zinc-200">{p.name}</span>
                  <span className="block text-[11px] text-zinc-500">{p.desc}</span>
                </span>
                {preset === p.id && playing && <span className="ml-auto text-[11px] font-bold text-emerald-400">▶ diputar</span>}
              </button>
            ))}
          </div>
          <div className="mt-2.5 rounded-xl border border-zinc-800 p-2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">✍️ Setir sendiri</div>
            <textarea
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  applyCustom(custom);
                }
              }}
              rows={2}
              maxLength={400}
              placeholder="mis. gitar akustik hujan sore, lembut · gamelan modern santai · epic orchestral"
              className="input mt-1 resize-none py-1.5 text-[12.5px]"
            />
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <button type="button" onClick={() => applyCustom(custom)} disabled={!custom.trim() || state === "connecting"} className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[12px] font-bold text-white disabled:opacity-50">
                {session.current ? "Terapkan" : "▶ Putar ini"}
              </button>
              {active && (
                <button
                  type="button"
                  onClick={() => {
                    setCustom("");
                    applyCustom("");
                  }}
                  className="rounded-lg border border-zinc-800 px-2.5 py-1 text-[12px] font-semibold text-zinc-400"
                >
                  Hapus
                </button>
              )}
              {active && <span className="truncate text-[11px] text-emerald-400">aktif: “{active.slice(0, 40)}{active.length > 40 ? "…" : ""}”</span>}
            </div>
            <div className="mt-2 flex items-center gap-2 text-[11.5px] text-zinc-500">
              <span className="w-[66px] shrink-0">Tempo {bpm ?? cur().bpm}</span>
              <input
                type="range"
                min={60}
                max={160}
                step={2}
                value={bpm ?? cur().bpm}
                onChange={(e) => setBpm(Number(e.target.value))}
                onMouseUp={(e) => applyCfg(Number((e.target as HTMLInputElement).value), noDrums)}
                onTouchEnd={(e) => applyCfg(Number((e.target as HTMLInputElement).value), noDrums)}
                className="flex-1 accent-emerald-500"
                aria-label="Tempo (BPM)"
              />
              <label className="flex shrink-0 items-center gap-1">
                <input type="checkbox" checked={noDrums} onChange={(e) => applyCfg(bpm, e.target.checked)} className="accent-emerald-500" />
                tanpa drum
              </label>
            </div>
            <p className="mt-1 text-[10.5px] text-zinc-500">Bahasa Indonesia boleh, bahasa Inggris biasanya lebih pas. Instrumental saja (tanpa vokal).</p>
          </div>
          <div className="mt-3 flex items-center gap-2">
            {playing ? (
              <button type="button" onClick={pause} className="rounded-xl bg-zinc-800 px-3 py-1.5 text-[12.5px] font-bold text-zinc-100">
                ⏸ Jeda
              </button>
            ) : (
              <button type="button" onClick={() => start()} disabled={state === "connecting"} className="rounded-xl bg-emerald-600 px-3 py-1.5 text-[12.5px] font-bold text-white disabled:opacity-60">
                {state === "connecting" ? "Menyiapkan…" : state === "paused" ? "▶ Lanjut" : "▶ Putar"}
              </button>
            )}
            {(playing || state === "paused") && (
              <button
                type="button"
                onClick={() => {
                  stopAll();
                  setState("idle");
                }}
                className="rounded-xl border border-zinc-800 px-3 py-1.5 text-[12.5px] font-bold text-zinc-300"
              >
                ⏹ Stop
              </button>
            )}
            <label className="ml-auto flex items-center gap-1.5 text-[12px] text-zinc-500">
              🔈
              <input type="range" min={0} max={1} step={0.05} value={vol} onChange={(e) => setVol(Number(e.target.value))} className="w-20 accent-emerald-500" aria-label="Volume" />
            </label>
          </div>
          {err && <p className="mt-2 text-[11.5px] text-red-400">{err}</p>}
          <p className="mt-2 text-[10.5px] leading-snug text-zinc-500">Instrumental dari Google Lyria (eksperimental). Musik tetap jalan saat pindah halaman.</p>
          </>
          )}
          {tab === "yt" && (
            <label className="mt-2 flex items-center gap-1.5 text-[12px] text-zinc-500">
              🔈 Volume
              <input type="range" min={0} max={1} step={0.05} value={vol} onChange={(e) => setVol(Number(e.target.value))} className="flex-1 accent-red-500" aria-label="Volume" />
            </label>
          )}
        </div>
      )}
      <Meteors on={playing || ytOn} />
      <YtMusic
        panel={open && tab === "yt" ? panel : null}
        vol={vol}
        stopTick={ytStop}
        onPlaying={setYtOn}
        onStart={() => {
          if (want.current || session.current) {
            pause();
          }
        }}
      />
    </>
  );
}
