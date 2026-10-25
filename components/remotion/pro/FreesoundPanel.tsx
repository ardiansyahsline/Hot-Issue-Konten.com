"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { reloadStudioCatalog } from "@/lib/studio/client";
import { fmtSec } from "./planUtils";

/** satu hasil GET /api/studio/freesound (server sudah menyaring hanya CC0) */
type Hit = { id: number; name: string; username: string; dur: number; preview: string | null };

type Res = { results?: unknown; sfx?: { id?: unknown }; disabled?: boolean; error?: unknown };

const OFF = "Pencarian Freesound belum aktif (kunci API belum diisi admin).";
const NET = "Koneksi putus. Cek internet lalu coba lagi.";

/** pesan dari route (sudah awam), atau pesan umum per status */
function errOf(r: Response, j: Res | null): string {
  if (typeof j?.error === "string" && j.error.length < 160) return j.error;
  if (r.status === 401 || r.status === 403) return "Kamu belum punya akses Studio untuk ini.";
  return "Freesound lagi nggak bisa dihubungi. Coba lagi sebentar.";
}

const hitsOf = (raw: unknown): Hit[] =>
  (Array.isArray(raw) ? raw : [])
    .filter((h): h is Hit => !!h && typeof h === "object" && typeof (h as Hit).id === "number")
    .map((h) => ({ id: h.id, name: String(h.name || `SFX ${h.id}`), username: String(h.username || "anonim"), dur: Number(h.dur) || 0, preview: typeof h.preview === "string" ? h.preview : null }));

/**
 * Cari & tambah SFX gratis dari Freesound — HANYA lisensi CC0 (dicek ulang di server).
 * Tampil hanya kalau status Studio bilang Freesound aktif. Setelah ditambah: katalog dimuat ulang,
 * lalu id SFX diteruskan ke `onAdd` (dipasang sebagai cue di adegan ini). Preview berhenti saat panel ditutup.
 */
export default function FreesoundPanel({ initial = "", full, onAdd, onClose }: { initial?: string; full: boolean; onAdd: (id: string) => void; onClose: () => void }) {
  const [q, setQ] = useState(initial);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<number | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const tok = useRef(0);
  const alive = useRef(true);

  const stop = () => {
    tok.current++;
    audio.current?.pause();
    setPlaying(null);
  };

  // panel ditutup -> preview berhenti & unduhannya dibatalkan
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      tok.current++;
      const a = audio.current;
      if (a) {
        a.pause();
        a.removeAttribute("src");
        a.load();
      }
    };
  }, []);

  const play = (h: Hit) => {
    if (playing === h.id) return stop();
    if (!h.preview) return;
    const t = ++tok.current;
    try {
      const a = (audio.current ??= new Audio());
      a.pause();
      a.src = h.preview;
      a.volume = 0.7;
      a.onended = () => alive.current && tok.current === t && setPlaying(null);
      setPlaying(h.id);
      void a.play().catch(() => alive.current && tok.current === t && setPlaying(null));
    } catch {
      setPlaying(null);
    }
  };

  const search = async (e?: FormEvent) => {
    e?.preventDefault();
    const t = q.trim();
    if (!t || busy) return;
    stop();
    setBusy(true);
    setErr(null);
    setNote(null);
    try {
      const r = await fetch(`/api/studio/freesound?q=${encodeURIComponent(t)}`);
      const j = (await r.json().catch(() => null)) as Res | null;
      if (!alive.current) return;
      if (j?.disabled) return setErr(OFF);
      if (!r.ok || !Array.isArray(j?.results)) return setErr(errOf(r, j));
      setHits(hitsOf(j.results));
    } catch {
      if (alive.current) setErr(NET);
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const add = async (h: Hit) => {
    if (adding !== null || full) return;
    setAdding(h.id);
    setErr(null);
    setNote(null);
    try {
      const r = await fetch("/api/studio/freesound", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: h.id }) });
      const j = (await r.json().catch(() => null)) as Res | null;
      const id = typeof j?.sfx?.id === "string" ? j.sfx.id : null;
      if (!r.ok || !id) {
        if (alive.current) setErr(j?.disabled ? OFF : errOf(r, j));
        return;
      }
      // katalog dimuat ulang dulu (walau panel sudah ditutup): cue SFX yang belum ada di katalog dibuang saat timeline dirapikan
      const c = await reloadStudioCatalog();
      if (!alive.current) return;
      if (!c.sfx.some((m) => m.id === id)) return setErr("SFX sudah tersimpan, tapi daftar SFX belum termuat ulang. Klik Tambah lagi sebentar lagi.");
      onAdd(id);
      setNote(`✅ “${h.name}” ditambahkan ke adegan ini.`);
    } catch {
      if (alive.current) setErr(NET);
    } finally {
      if (alive.current) setAdding(null);
    }
  };

  return (
    <div className="mt-2 space-y-2 rounded-xl border border-zinc-800 p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold text-zinc-300">🌐 Cari SFX gratis (Freesound CC0)</span>
        <button type="button" className="text-[12px] font-semibold text-zinc-500 hover:text-zinc-200" onClick={onClose}>
          Tutup
        </button>
      </div>
      <form onSubmit={search} className="flex gap-1.5">
        <input
          type="search"
          enterKeyHint="search"
          className="input min-w-0 flex-1 py-2 text-[13px]"
          placeholder="Bahasa Inggris, mis. whoosh, coin, impact…"
          aria-label="Cari SFX di Freesound"
          maxLength={80}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
        <button type="submit" disabled={busy || !q.trim()} className="btn-ghost shrink-0 px-3 py-1.5 text-[12px]">
          {busy ? "⏳ Mencari…" : "Cari"}
        </button>
      </form>
      {err && (
        <p role="alert" className="text-[11.5px] text-red-400">
          {err}
        </p>
      )}
      {note && (
        <p role="status" className="text-[11.5px] text-emerald-400">
          {note}
        </p>
      )}
      {full && <p className="text-[11.5px] text-amber-400">Adegan ini sudah penuh. Hapus satu SFX dulu untuk menambah.</p>}
      {hits && (
        <ul className="max-h-72 space-y-1 overflow-y-auto pr-1">
          {hits.map((h) => (
            <li key={h.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-zinc-800/60">
              <button
                type="button"
                disabled={!h.preview}
                aria-label={playing === h.id ? `Stop ${h.name}` : `Dengar ${h.name}`}
                title={playing === h.id ? "Stop" : "Dengar"}
                className="shrink-0 rounded-md px-1.5 py-1 text-[12px] text-zinc-400 hover:text-zinc-100 disabled:opacity-40"
                onClick={() => play(h)}
              >
                {playing === h.id ? "■" : "▶"}
              </button>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-semibold text-zinc-200">{h.name}</span>
                <span className="block truncate text-[11px] text-zinc-500">
                  {fmtSec(h.dur)} · oleh {h.username} · <span className="font-semibold text-emerald-400">CC0</span>
                </span>
              </span>
              <button
                type="button"
                disabled={full || adding !== null}
                className="shrink-0 rounded-lg border border-zinc-700 px-2 py-1 text-[11.5px] font-semibold text-zinc-200 hover:border-orange-500 hover:text-orange-400 disabled:opacity-40"
                onClick={() => add(h)}
              >
                {adding === h.id ? "⏳" : "Tambah"}
              </button>
            </li>
          ))}
          {!hits.length && <li className="px-1.5 py-2 text-[12px] text-zinc-500">Tidak ketemu SFX CC0. Coba kata lain (bahasa Inggris).</li>}
        </ul>
      )}
      <p className="text-[11px] leading-snug text-zinc-500">
        Hanya SFX berlisensi <b className="text-zinc-400">CC0</b> (domain publik) dari freesound.org — bebas dipakai, termasuk komersial, tanpa wajib menyebut pembuatnya. SFX yang ditambah masuk katalog Studio.
      </p>
    </div>
  );
}
