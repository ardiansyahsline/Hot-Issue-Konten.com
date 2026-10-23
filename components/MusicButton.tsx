"use client";

import { useEffect, useRef, useState } from "react";

type Preset = { id: string; icon: string; name: string; desc: string; prompts: { text: string; weight: number }[]; bpm: number; density: number; brightness: number };
const PRESETS: Preset[] = [
  { id: "piano", icon: "🎹", name: "Piano klasik santai", desc: "Piano solo lembut, tenang", prompts: [{ text: "gentle solo classical piano, calm, Chopin nocturne style, soft dynamics", weight: 1 }], bpm: 70, density: 0.35, brightness: 0.45 },
  { id: "strings", icon: "🎻", name: "String quartet", desc: "Biola & cello hangat", prompts: [{ text: "warm classical string quartet, relaxing, baroque, legato", weight: 1 }], bpm: 76, density: 0.45, brightness: 0.5 },
  { id: "focus", icon: "🧠", name: "Fokus kerja", desc: "Ambient klasik minim drum", prompts: [{ text: "minimal ambient classical, soft piano and strings, focus music, no percussion", weight: 1 }], bpm: 72, density: 0.3, brightness: 0.4 },
  { id: "lofi", icon: "☕", name: "Lo-fi klasik", desc: "Klasik + beat santai", prompts: [{ text: "lofi hip hop with classical piano samples, chill, mellow", weight: 1 }], bpm: 80, density: 0.5, brightness: 0.45 },
];
const KEY = "cs-music";

type Session = { setWeightedPrompts(p: object): Promise<void>; setMusicGenerationConfig(p: object): Promise<void>; play(): void; pause(): void; stop(): void; close(): void; resetContext?(): void };

/** 🎵 Musik AI (Google Lyria RealTime): musik instrumental yang dibuat langsung, terus mengalir sambil kerja. */
export default function MusicButton() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "connecting" | "playing" | "paused" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [preset, setPreset] = useState(PRESETS[0].id);
  const [vol, setVol] = useState(0.6);
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const session = useRef<Session | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const gain = useRef<GainNode | null>(null);
  const nextAt = useRef(0);

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) ?? "{}");
      if (s.preset) setPreset(s.preset);
      if (typeof s.vol === "number") setVol(s.vol);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ preset, vol }));
    } catch {}
    if (gain.current) gain.current.gain.value = vol;
  }, [preset, vol]);
  useEffect(() => {
    if (!open) return;
    const r = btn.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 8, left: Math.max(8, Math.min(window.innerWidth - 308, r.right - 300)) });
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  useEffect(() => () => stopAll(), []);

  const cfgOf = (p: Preset) => ({ musicGenerationConfig: { bpm: p.bpm, density: p.density, brightness: p.brightness, guidance: 4.0, temperature: 1.1 } });

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

  const start = async (p = PRESETS.find((x) => x.id === preset) ?? PRESETS[0]) => {
    setErr(null);
    if (session.current) {
      session.current.play();
      await ctx.current?.resume();
      setState("playing");
      return;
    }
    setState("connecting");
    try {
      const r = await fetch("/api/music/key", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Musik belum disetel");
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx.current = new AC({ sampleRate: 48000 });
      gain.current = ctx.current.createGain();
      gain.current.gain.value = vol;
      gain.current.connect(ctx.current.destination);
      nextAt.current = 0;
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: j.key, apiVersion: "v1alpha" });
      const s = (await ai.live.music.connect({
        model: j.model,
        callbacks: {
          onmessage: (m: { serverContent?: { audioChunks?: { data?: string; mimeType?: string }[] }; filteredPrompt?: { filteredReason?: string } }) => {
            for (const c of m.serverContent?.audioChunks ?? []) if (c.data) playChunk(c.data, c.mimeType);
            if (m.filteredPrompt) setErr(`Prompt ditolak: ${m.filteredPrompt.filteredReason ?? "-"}`);
          },
          onerror: () => {
            setErr("Koneksi musik terputus.");
            setState("error");
          },
          onclose: () => {
            session.current = null;
            setState((x) => (x === "error" ? x : "idle"));
          },
        },
      })) as unknown as Session;
      session.current = s;
      await s.setWeightedPrompts({ weightedPrompts: p.prompts });
      await s.setMusicGenerationConfig(cfgOf(p));
      s.play();
      setState("playing");
    } catch (e) {
      setErr((e as Error).message || "Gagal memulai musik");
      setState("error");
      stopAll();
    }
  };
  const pause = async () => {
    session.current?.pause();
    await ctx.current?.suspend();
    setState("paused");
  };
  function stopAll() {
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
    const s = session.current;
    if (!s) return start(p);
    // ganti gaya: prompt baru + reset supaya tempo berubah
    await s.setWeightedPrompts({ weightedPrompts: p.prompts });
    await s.setMusicGenerationConfig(cfgOf(p));
    s.resetContext?.();
  };

  const playing = state === "playing";
  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`relative whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition ${playing ? "text-emerald-400" : "text-zinc-400 hover:text-zinc-100"}`}
        title="Musik AI santai sambil kerja"
        aria-label="Musik"
      >
        {playing ? <span className="inline-block animate-pulse">🎵</span> : "🎵"}
      </button>
      {open && (
        <div ref={box} className="fixed z-[90] w-[300px] rounded-2xl border border-zinc-800 bg-zinc-900 p-3 text-left" style={{ top: pos.top, left: pos.left, boxShadow: "var(--shadow-pop), 0 20px 40px -16px rgba(0,0,0,.4)" }}>
          <div className="flex items-center gap-2">
            <b className="text-[14px]">🎵 Musik santai</b>
            <span className="text-[11px] text-zinc-500">dibuat AI langsung, tanpa jeda</span>
          </div>
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
        </div>
      )}
    </>
  );
}
