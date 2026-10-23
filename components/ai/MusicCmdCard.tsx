"use client";

import { useEffect, useRef } from "react";
import { musicLabel, playMusic, type MusicCmd } from "@/lib/musicCmd";

const done = new Set<string>();

/** kartu kecil di chat: AI menjalankan pemutar 🎵 (otomatis untuk jawaban yang baru selesai) */
export default function MusicCmdCard({ id, cmd, fresh }: { id: string; cmd: MusicCmd; fresh: boolean }) {
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current || !fresh || done.has(id)) return;
    ran.current = true;
    done.add(id);
    playMusic(cmd);
  }, [id, cmd, fresh]);
  const stop = cmd.action === "pause" || cmd.action === "stop";
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-[12.5px]">
      <span className="min-w-0 flex-1 truncate font-semibold text-zinc-200">{musicLabel(cmd)}</span>
      {!stop && (
        <button type="button" onClick={() => playMusic(cmd)} className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[12px] font-bold text-white">
          ▶ Putar
        </button>
      )}
      <button type="button" onClick={() => playMusic({ open: true })} className="rounded-lg border border-zinc-700 px-2.5 py-1 text-[12px] font-semibold text-zinc-300">
        🎵 Buka pemutar
      </button>
    </div>
  );
}
