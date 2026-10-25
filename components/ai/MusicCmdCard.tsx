"use client";

import { useEffect, useRef, useState } from "react";
import { getMusicState, lastMusicKey, musicKey, musicLabel, playMusic, type MusicCmd, type MusicState } from "@/lib/musicCmd";

const done = new Set<string>();
/** kartu yang terakhir dijeda lewat tombol di chat (supaya "Lanjut" melanjutkan, bukan memutar ulang) */
let pausedKey = "";

/** equalizer kecil yang bergerak mengikuti tempo musik (musik AI pakai BPM-nya; YouTube tempo umum) */
function Bars({ bpm }: { bpm?: number | null }) {
  const beat = 60 / Math.max(60, Math.min(160, bpm || 96)); // detik per ketukan
  return (
    <span className="flex h-4 items-end gap-[2px]" aria-hidden>
      {[0.9, 0.55, 1, 0.7].map((h, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-emerald-500"
          style={{ height: `${h * 100}%`, transformOrigin: "bottom", animation: `mc-eq ${beat * (i % 2 ? 1 : 0.5)}s ease-in-out ${i * 0.09}s infinite alternate` }}
        />
      ))}
      <style>{`@keyframes mc-eq{from{transform:scaleY(.25)}to{transform:scaleY(1)}}`}</style>
    </span>
  );
}

/** kartu kecil di chat: AI menjalankan pemutar 🎵 (otomatis untuk jawaban yang baru selesai) */
export default function MusicCmdCard({ id, cmd, fresh }: { id: string; cmd: MusicCmd; fresh: boolean }) {
  const ran = useRef(false);
  const key = musicKey(cmd);
  const [st, setSt] = useState<MusicState>(() => getMusicState());
  const [, bump] = useState(0);
  useEffect(() => {
    const h = (e: Event) => setSt((e as CustomEvent<MusicState>).detail);
    window.addEventListener("cs-music-state", h);
    return () => window.removeEventListener("cs-music-state", h);
  }, []);
  useEffect(() => {
    if (ran.current || !fresh || done.has(id)) return;
    ran.current = true;
    done.add(id);
    playMusic(cmd);
    bump((n) => n + 1);
  }, [id, cmd, fresh]);

  const stop = cmd.action === "pause" || cmd.action === "stop";
  const mine = !stop && lastMusicKey() === key; // lagu di kartu ini yang sedang dipegang pemutar
  const onAir = mine && st.playing;
  const act = (c: MusicCmd, paused = "") => {
    pausedKey = paused;
    playMusic(c);
    bump((n) => n + 1);
  };
  const btn = "rounded-lg px-2.5 py-1 text-[12px] font-bold";
  return (
    <div className={`mt-2 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-[12.5px] transition ${onAir ? "border-emerald-500/40 bg-emerald-500/5" : "border-zinc-800 bg-zinc-900/60"}`}>
      {/* HP: judul satu baris penuh, tombol di bawahnya; layar lebar: sebaris */}
      <span className="flex min-w-0 basis-full items-center gap-2 sm:basis-0 sm:flex-1">
        {onAir && <Bars bpm={st.bpm} />}
        <span className="min-w-0 truncate font-semibold text-zinc-200">{musicLabel(cmd)}</span>
        {onAir && <span className="shrink-0 text-[11px] font-medium text-emerald-500">sedang diputar</span>}
        {mine && !st.playing && pausedKey === key && <span className="shrink-0 text-[11px] font-medium text-zinc-500">dijeda</span>}
      </span>
      {!stop &&
        (onAir ? (
          <>
            <button type="button" onClick={() => act({ action: "pause" }, key)} className={`${btn} border border-zinc-700 text-zinc-200`}>
              ⏸ Jeda
            </button>
            <button type="button" onClick={() => act({ action: "stop" })} className={`${btn} border border-zinc-700 text-zinc-200`}>
              ⏹ Stop
            </button>
          </>
        ) : (
          <button
            type="button"
            // dijeda dari kartu ini -> lanjutkan; selain itu putar (lagu lain yang sedang main otomatis berhenti, tidak dobel)
            onClick={() => act(mine && pausedKey === key ? { action: "play" } : cmd)}
            className={`${btn} bg-emerald-600 text-white`}
          >
            ▶ {mine && pausedKey === key ? "Lanjut" : "Putar"}
          </button>
        ))}
      <button type="button" onClick={() => playMusic({ open: true })} className={`${btn} border border-zinc-700 font-semibold text-zinc-300`}>
        🎵 Buka pemutar
      </button>
    </div>
  );
}
