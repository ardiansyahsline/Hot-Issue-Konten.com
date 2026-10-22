"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { saveSoundPrefs } from "@/lib/notifyActions";
import { SOUNDS, audio, playSound, type SoundName, type SoundPrefs } from "@/lib/sounds";

const ROWS: { key: "sound_chat" | "sound_mention" | "sound_issue"; title: string; sub: string }[] = [
  { key: "sound_chat", title: "Chat room & pesan pribadi", sub: "pesan baru dari orang lain" },
  { key: "sound_mention", title: "Di-mention / pesanmu dibalas", sub: "@nama, @semua, atau balasan" },
  { key: "sound_issue", title: "Hot Issue baru & laporan baru", sub: "termasuk saat topik jadi HOT" },
];

/** Akun → Bunyi notifikasi: pilih bunyi per jenis notifikasi + volume */
export default function SoundSettings({ initial }: { initial: SoundPrefs }) {
  const [p, setP] = useState<SoundPrefs>(initial);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // pakai pilihan yang tersimpan di browser kalau database belum punya kolomnya
  useEffect(() => {
    try {
      const c = localStorage.getItem("cs-sound-prefs");
      if (c) setP((cur) => ({ ...cur, ...JSON.parse(c) }));
    } catch {}
  }, []);

  const apply = (next: SoundPrefs, delay = 0) => {
    setP(next);
    try {
      localStorage.setItem("cs-sound-prefs", JSON.stringify(next));
    } catch {}
    window.dispatchEvent(new CustomEvent("cs-sound-prefs", { detail: next }));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => start(async () => setMsg(await saveSoundPrefs(next))), delay);
  };

  const test = (name: SoundName, volume = p.sound_volume) => {
    audio()?.resume().catch(() => {});
    // resume butuh sesaat setelah klik pertama
    setTimeout(() => playSound(name, volume), 30);
  };

  return (
    <div className="card space-y-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">🔔 Bunyi notifikasi</h2>
          <p className="text-[12.5px] text-zinc-500">
            Diputar saat CS Tracker terbuka (termasuk di tab belakang). Kalau tab tertutup, pop-up memakai bunyi bawaan HP / laptop.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={p.sound_on}
          aria-label="Bunyi notifikasi"
          onClick={() => apply({ ...p, sound_on: !p.sound_on })}
          className={`relative h-6 w-11 shrink-0 rounded-full transition ${p.sound_on ? "bg-orange-500" : "bg-zinc-700"}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${p.sound_on ? "left-[22px]" : "left-0.5"}`} />
        </button>
      </div>

      <div className={p.sound_on ? "space-y-4" : "pointer-events-none space-y-4 opacity-50"}>
        {ROWS.map((r) => (
          <div key={r.key} className="space-y-2 border-t border-zinc-800/80 pt-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[13.5px] font-semibold">{r.title}</div>
                <div className="text-[11.5px] text-zinc-500">{r.sub}</div>
              </div>
              <button type="button" onClick={() => test(p[r.key])} className="rounded-full border border-zinc-800 px-2.5 py-1 text-[12px] hover:border-zinc-600">
                ▶ Tes
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={r.title}>
              {(Object.keys(SOUNDS) as SoundName[]).map((s) => {
                const on = p[r.key] === s;
                return (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => {
                      apply({ ...p, [r.key]: s });
                      test(s);
                    }}
                    className={`rounded-full border px-3 py-1 text-[12.5px] font-semibold transition ${
                      on ? "border-orange-500 bg-orange-500/10 text-orange-400" : "border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                    }`}
                  >
                    {on && s !== "off" ? "♪ " : ""}
                    {SOUNDS[s]}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <label className="flex items-center gap-3 border-t border-zinc-800/80 pt-3 text-[13px]">
          <span className="w-16 text-zinc-500">Volume</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={p.sound_volume}
            onChange={(e) => apply({ ...p, sound_volume: Number(e.target.value) }, 600)}
            onPointerUp={() => test(p.sound_chat === "off" ? "ding" : p.sound_chat)}
            className="flex-1 accent-orange-500"
            aria-label="Volume bunyi"
          />
          <span className="w-10 text-right font-semibold tabular-nums">{p.sound_volume}%</span>
        </label>
      </div>

      {pending && <p className="text-xs text-zinc-500">Menyimpan…</p>}
      {!pending && msg?.error && <p className="text-xs text-amber-400">{msg.error}</p>}
      {!pending && msg?.ok && <p className="text-xs text-emerald-400">✓ {msg.ok}</p>}
    </div>
  );
}
