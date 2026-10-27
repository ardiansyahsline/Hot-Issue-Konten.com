"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cancelVoiceJob, createVoiceJob, fetchReadyVoices, useStudioJob, useStudioStatus, type VoiceJob } from "@/lib/studio/client";
import { LEX_FROM_MAX, LEX_TO_MAX, lexKey, normLexicon, type LexEntry } from "@/lib/studio/pronounce";
import { guessE, MAX_CAND, spellCandidates, type SpellCand } from "@/lib/studio/pepet";
import { spellSuggestions } from "@/lib/studio/heard";
import { buildTryJob, lexiconAfterPick, scenesToRebuild, trySource } from "@/lib/studio/spellTry";
import { bankSettings, DEFAULT_BANK_VOICE } from "@/lib/studio/voiceStyle";
import { storageSrc } from "@/lib/studio/urls";
import type { Scene, Timeline } from "@/lib/studio/timeline";

/** baris kandidat yang dicoba (otomatis maks 5 + 1 ejaan sendiri) */
const MAX_ROWS = MAX_CAND + 1;
export const LAPTOP_OFF = "Nyalakan mesin suara laptop dulu (klik NYALAKAN-MESIN-SUARA.bat).";

type Row = { id: number; text: string; why: string; kind: SpellCand["kind"] | "bebas" };
type Res = { src: string; dur: number };
type Tried = { id: number; text: string };
type St =
  | { s: "idle" }
  | { s: "start" }
  | { s: "job"; id: string; rows: Tried[] }
  | { s: "done"; rows: Tried[]; res: Record<number, Res> }
  | { s: "error"; msg: string; detail?: string };

let rowSeq = 0;
// satu hasil diputar dalam satu waktu (semua panel coba ejaan)
let playing: HTMLAudioElement | null = null;
const stopAll = () => {
  try {
    playing?.pause();
  } catch {}
  playing = null;
};

/** label kolom kiri: asli / kamus / sendiri, selain itu "ejaan 1", "ejaan 2" … */
const tagOf = (r: Row, k: number) => (r.kind === "asli" ? "asli" : r.kind === "kamus" ? "kamus" : r.kind === "bebas" ? "sendiri" : `ejaan ${k}`);
const errMsg = (e: unknown) => (e instanceof Error && e.message && e.message.length < 200 ? e.message : "Gagal menyiapkan antrian. Coba lagi.");

/**
 * 🎧 Coba ejaan (popover): kandidat ejaan satu kata (lib/studio/pepet.ts — bisa diedit / ditambah) → "Coba semua di laptop" = SATU job
 * bank suara berisi kalimat adegan itu dengan kata tersebut dieja tiap kandidat (1 versi per kalimat supaya cepat, gaya bicara sama
 * dengan proyek, benih acak sama) → tiap hasil bisa diputar → "✓ Pakai ini" = entri 📖 Kamus ejaan proyek khusus bank suara
 * ({from, to, bank}); VO adegan yang ucapannya berubah otomatis ditandai "perlu dibuat ulang" (kunci VoLine.say).
 * Job ditandai settings.purpose = "coba-ejaan" dan hasilnya TIDAK PERNAH dipasang ke VO adegan / timeline.
 */
export default function VoSpellTry({
  scene,
  timeline,
  word,
  onLexicon,
  onClose,
}: {
  scene: Scene;
  timeline: Timeline;
  /** kata seperti di naskah */
  word: string;
  /** simpan kamus ejaan proyek yang baru (undefined = kosong) */
  onLexicon?: (lex: LexEntry[] | undefined) => void;
  onClose: () => void;
}) {
  const uid = useId();
  const status = useStudioStatus();
  const workerOn = !!status?.worker.online && status.engines.bank;
  const tlRef = useRef(timeline);
  tlRef.current = timeline;
  const wordKey = word.toLowerCase().slice(0, LEX_FROM_MAX);
  const guess = useMemo(() => guessE(word), [word]);
  const lex = timeline.voice.lexicon;
  const own = normLexicon(lex ?? []).find((e) => lexKey(e.from) === lexKey(word));

  const [rows, setRows] = useState<Row[]>(() => {
    const base = spellCandidates(word, { current: own?.to });
    // kata tanpa huruf e (dari 👂 Terdengar): saran bunyi luncur / suku kata
    if (guess.kind === "tanpa-e") for (const s of spellSuggestions(word, lex)) if (base.length < MAX_CAND && !base.some((c) => c.text === s)) base.push({ text: s, why: "Saran: bunyi luncur / suku kata dipisah.", kind: "ragu" });
    return base.map((c) => ({ id: ++rowSeq, ...c }));
  });
  const [st, setSt] = useState<St>({ s: "idle" });
  const [play, setPlay] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ to: string; scenes: string[]; same: boolean } | null>(null);
  const jobRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const busy = st.s === "start" || st.s === "job";

  const alive = useRef(true);
  // tutup panel / pindah halaman: hentikan suara & batalkan antrian yang belum selesai
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (audioRef.current && playing === audioRef.current) stopAll();
      if (jobRef.current) void cancelVoiceJob(jobRef.current).catch(() => {});
    };
  }, []);

  const src = scene.vo?.text ? trySource(scene.vo, word) : null;
  const rowsOk = rows.filter((r) => r.text.trim() && /\p{L}/u.test(r.text));

  const run = async () => {
    setErr(null);
    setPicked(null);
    const t = tlRef.current;
    const s = t.scenes.find((x) => x.id === scene.id) ?? scene;
    const built = buildTryJob(s, word, rowsOk, t.voice.lexicon, bankSettings(t));
    if ("error" in built) return setSt({ s: "error", msg: built.error });
    setSt({ s: "start" });
    try {
      const voices = await fetchReadyVoices();
      const voice = voices.find((x) => x.id === t.voice.voiceId) ?? voices.find((x) => x.name === DEFAULT_BANK_VOICE) ?? voices[0];
      if (!voice) return setSt({ s: "error", msg: "Belum ada suara yang siap di bank suara. Tambah rekaman di tab 🎙️ Bank suara." });
      // SATU job: kalimat yang sama, satu baris per ejaan (penanda settings.purpose → tidak pernah dipasang ke VO adegan)
      const j = await createVoiceJob({ kind: "tts", project_id: null, voice_id: voice.id, engine: "auto", lines: built.lines, settings: built.settings });
      // panel sudah ditutup selagi antrian dibuat → jangan biarkan laptop mengerjakannya
      if (!alive.current) return void cancelVoiceJob(j.id).catch(() => {});
      jobRef.current = j.id;
      setSt({ s: "job", id: j.id, rows: built.rows });
    } catch (e) {
      setSt({ s: "error", msg: errMsg(e) });
    }
  };

  const { job, missing } = useStudioJob<VoiceJob>("studio_voice_jobs", st.s === "job" ? st.id : null);
  useEffect(() => {
    if (st.s !== "job") return;
    if (missing) {
      jobRef.current = null;
      return setSt({ s: "error", msg: "Antrian coba ejaan hilang. Coba lagi." });
    }
    if (!job || job.id !== st.id) return;
    if (job.status === "selesai") {
      jobRef.current = null;
      const res: Record<number, Res> = {};
      for (const l of job.result?.lines ?? []) {
        const r = st.rows.find((x) => `coba-${x.id}` === l?.id);
        if (r && typeof l.path === "string") res[r.id] = { src: storageSrc(l.path), dur: Math.max(0.05, Number(l.dur) || 0.05) };
      }
      setSt(Object.keys(res).length ? { s: "done", rows: st.rows, res } : { s: "error", msg: "Mesin suara selesai tapi hasilnya kosong. Coba lagi." });
    } else if (job.status === "gagal") {
      jobRef.current = null;
      setSt({ s: "error", msg: "Mesin suara di laptop gagal membuat contoh ejaan.", detail: job.message ?? undefined });
    } else if (job.status === "batal") {
      jobRef.current = null;
      setSt({ s: "idle" });
    }
  }, [job, missing, st]);

  const cancel = () => {
    if (st.s === "job") void cancelVoiceJob(st.id).catch(() => {});
    jobRef.current = null;
    setSt({ s: "idle" });
  };

  const playRow = (id: number, url: string) => {
    if (play === id && audioRef.current && playing === audioRef.current) {
      stopAll();
      return setPlay(null);
    }
    stopAll();
    try {
      const a = new Audio(url);
      a.onended = () => audioRef.current === a && setPlay(null);
      a.onpause = () => audioRef.current === a && setPlay(null);
      audioRef.current = a;
      playing = a;
      setPlay(id);
      void a.play().catch(() => setPlay(null));
    } catch {
      setPlay(null);
    }
  };

  /** pilih ejaan → 📖 Kamus ejaan proyek (khusus bank suara); tulisan asli = hapus ejaan kata ini dari kamus proyek */
  const use = (r: Row) => {
    if (!onLexicon) return;
    setErr(null);
    const t = tlRef.current;
    const { next, same } = lexiconAfterPick(t.voice.lexicon, word, r.text);
    if (!next) return setErr("📖 Kamus ejaan sudah penuh (60 kata) — hapus kata yang tidak dipakai dulu di panel Suara VO.");
    // VO adegan yang ucapannya berubah karena ejaan ini → peringatan "perlu dibuat ulang" (VoLine.say beda) muncul sendiri
    const scenes = same ? [] : scenesToRebuild(t, t.voice.lexicon, next);
    if (!same) onLexicon(next.length ? next : undefined);
    setPicked({ to: r.text.replace(/\s+/g, " ").trim(), scenes, same });
  };

  const edit = (id: number, text: string) => {
    setRows((x) => x.map((r) => (r.id === id ? { ...r, text } : r)));
    setPicked(null);
  };
  const res = st.s === "done" ? st.res : null;
  const tried = st.s === "done" ? st.rows : st.s === "job" ? st.rows : null;
  const resOf = (r: Row) => {
    const t = tried?.find((x) => x.id === r.id);
    // hasil hanya untuk ejaan yang belum diubah sejak dicoba
    return res && t && t.text === r.text.replace(/\s+/g, " ").trim().slice(0, LEX_TO_MAX) ? res[r.id] : undefined;
  };
  const pct = st.s === "job" ? Math.round((job?.progress ?? 0) * 100) : 0;
  const guessTxt =
    guess.kind === "pepet"
      ? "huruf e dibaca ə (pepet, seperti “bareng”)"
      : guess.kind === "taling"
        ? "huruf e dibaca é (taling, seperti “enak”)"
        : guess.kind === "campur"
          ? "ada e pepet (ə) dan e taling (é)"
          : guess.kind === "ragu"
            ? "belum yakin e-nya pepet atau taling"
            : "tidak ada huruf e — coba ejaan lain";

  return (
    <div role="dialog" aria-labelledby={`${uid}-t`} className="relative mt-2 space-y-2 rounded-xl border border-orange-500/40 bg-zinc-950 px-3 py-2.5 text-[12px] shadow-[var(--shadow-pop)]" data-spell-try={wordKey}>
      <span aria-hidden className="absolute -top-[7px] left-6 h-3 w-3 rotate-45 border-l border-t border-orange-500/40 bg-zinc-950" />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p id={`${uid}-t`} className="text-[13px] font-semibold text-zinc-100">
            🎧 Coba ejaan “{word}”
          </p>
          <p className="text-[11px] leading-snug text-zinc-500" data-spell-guess={guess.kind}>
            Tebakan: {guessTxt}. {guess.kind !== "tanpa-e" ? guess.why : ""}
          </p>
        </div>
        <button type="button" className="-mr-1 h-8 w-8 flex-none rounded-lg text-[14px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" aria-label="Tutup coba ejaan" onClick={onClose} data-spell-close>
          ✕
        </button>
      </div>

      <ul className="space-y-1.5">
        {rows.map((r, i) => {
          const out = resOf(r);
          const tag = tagOf(r, rows.slice(0, i + 1).filter((x) => x.kind !== "asli" && x.kind !== "kamus" && x.kind !== "bebas").length);
          const isPicked = picked && !picked.same && picked.to === r.text;
          return (
            <li key={r.id} className={`rounded-lg border px-2 py-1.5 ${isPicked ? "border-emerald-500/50 bg-emerald-500/10" : "border-zinc-800 bg-zinc-900/60"}`} data-spell-row={r.kind}>
              <div className="flex items-center gap-1.5">
                <span className="w-12 flex-none text-center text-[10px] font-semibold uppercase leading-tight tracking-wide text-zinc-500" title={r.why}>
                  {tag}
                </span>
                <input
                  className="input min-w-0 flex-1 px-2.5 py-1.5 text-[13px]"
                  value={r.text}
                  maxLength={LEX_TO_MAX}
                  disabled={busy}
                  aria-label={`${tag[0].toUpperCase()}${tag.slice(1)} untuk “${word}”`}
                  placeholder="Tulis seperti diucapkan"
                  onChange={(e) => edit(r.id, e.target.value)}
                  data-spell-input
                />
                {r.kind !== "asli" && (
                  <button
                    type="button"
                    className="h-8 w-8 flex-none rounded-lg text-[12px] text-zinc-500 hover:bg-zinc-800 hover:text-red-400 disabled:opacity-40"
                    aria-label={`Hapus ejaan ${r.text || "kosong"}`}
                    disabled={busy}
                    onClick={() => setRows((x) => x.filter((y) => y.id !== r.id))}
                  >
                    ✕
                  </button>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 pl-[3.375rem]">
                <span className="min-w-0 flex-1 basis-40 text-[10.5px] leading-snug text-zinc-500">{r.why}</span>
                {out && (
                  <span className="flex flex-none items-center gap-1">
                    <button type="button" className="btn-ghost px-2 py-1 text-[11.5px]" onClick={() => playRow(r.id, out.src)} data-spell-play>
                      {play === r.id ? "⏹ Stop" : "▶ Putar"}
                    </button>
                    {onLexicon && (
                      <button type="button" className="rounded-lg px-2 py-1 text-[11.5px] font-semibold text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300" onClick={() => use(r)} data-spell-use>
                        {isPicked ? "✅ Dipakai" : "✓ Pakai ini"}
                      </button>
                    )}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {rows.length < MAX_ROWS && !busy && (
        <button type="button" className="text-[12px] font-semibold text-orange-400 hover:text-orange-300" onClick={() => setRows((x) => [...x, { id: ++rowSeq, text: "", why: "Ejaan buatanmu sendiri.", kind: "bebas" }])} data-spell-add>
          ＋ Ejaan sendiri
        </button>
      )}

      {busy ? (
        <div className="space-y-1" role="status">
          <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
            <div className={`h-full rounded-full bg-orange-500 transition-[width] ${pct ? "" : "w-1/12 animate-pulse"}`} style={pct ? { width: `${pct}%` } : undefined} />
          </div>
          <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-400" data-spell-progress>
            <span className="min-w-0">
              {st.s === "start" ? "Menyiapkan antrian…" : job?.status === "proses" ? `${job.message || "Laptop lagi bikin suara…"}${pct ? ` ${pct}%` : ""}` : "Menunggu giliran di laptop…"}
            </span>
            {st.s === "job" && (
              <button type="button" className="flex-none font-semibold text-red-400 hover:text-red-300" onClick={cancel}>
                Batal
              </button>
            )}
          </div>
          {st.s === "job" && !workerOn && status !== null && job?.status !== "proses" && <p className="text-[11px] text-amber-300">Laptop mati — antrian menunggu laptop nyala.</p>}
        </div>
      ) : (
        <div className="space-y-1">
          <button type="button" className="btn-primary w-full py-2 text-[12.5px]" disabled={!workerOn || rowsOk.length < 2 || !src} onClick={() => void run()} data-spell-run>
            🎧 Coba semua di laptop{rowsOk.length ? ` (${rowsOk.length} ejaan)` : ""}
          </button>
          {status === null ? (
            <p className="text-[11px] text-zinc-500">Cek mesin suara laptop…</p>
          ) : !workerOn ? (
            <p className="rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-300" data-spell-off>
              {LAPTOP_OFF}
            </p>
          ) : src ? (
            <p className="break-words text-[10.5px] leading-snug text-zinc-500">
              Satu antrian, 1 versi per ejaan, gaya bicara proyek. Kalimat: “{src.text.length > 120 ? `${src.text.slice(0, 117)}…` : src.text}”
            </p>
          ) : null}
        </div>
      )}

      {st.s === "error" && (
        <div className="rounded-lg bg-red-500/10 px-2.5 py-1.5 text-[11.5px] text-red-300" role="alert" data-spell-error>
          <p>{st.msg}</p>
          {st.detail && <p className="break-words text-[10px] text-red-300/70">Detail: {st.detail.slice(0, 200)}</p>}
        </div>
      )}
      {err && (
        <p className="text-[11px] text-red-400" role="alert">
          {err}
        </p>
      )}
      {picked && (
        <div className="rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-[11.5px] leading-relaxed text-emerald-300" role="status" data-spell-done>
          {picked.same ? (
            <p>Sudah begitu sekarang — kamus tidak berubah.</p>
          ) : (
            <p>
              {picked.to.toLowerCase() === wordKey ? `✅ “${wordKey}” dibaca seperti tulisannya (ejaan lamanya di 📖 Kamus dilepas).` : `✅ Masuk 📖 Kamus ejaan (khusus bank suara): ${wordKey} → ${picked.to}.`}{" "}
              {picked.scenes.length ? `VO adegan ${picked.scenes.join(", ")} perlu dibuat ulang — klik "Generate ulang VO" di panel Suara VO.` : "Dipakai saat VO dibuat berikutnya."}
            </p>
          )}
        </div>
      )}
      {res && !picked && <p className="text-[10.5px] text-zinc-500">Hasil coba hanya untuk didengar — VO adegan tidak berubah sampai kamu pilih &quot;✓ Pakai ini&quot; lalu buat ulang VO.</p>}
    </div>
  );
}
