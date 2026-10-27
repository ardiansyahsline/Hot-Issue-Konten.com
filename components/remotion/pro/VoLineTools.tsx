"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cancelVoiceJob, createVoiceJob, fetchReadyVoices, requestTts, useStudioJob, useStudioStatus, type VoiceJob, type VoiceJobLine } from "@/lib/studio/client";
import { voSayKey, voSpeech } from "@/lib/studio/pronounce";
import { heardFromResult } from "@/lib/studio/heard";
import { bankSettings } from "@/lib/studio/voiceStyle";
import { normTempo, tempoRate, TEMPOS, voStartOf, type Scene, type Timeline, type VoLine, type VoTrack } from "@/lib/studio/timeline";
import { storageSrc } from "@/lib/studio/urls";
import { estimateQueued, etaText, queuedText } from "@/lib/studio/eta";
import { isTeaserScene } from "./teaserLock";
import { EtaChip } from "./JobEta";
import { cleanWords, DEFAULT_VOICE, fitVo, fmtTempo, movedText, names, sceneVoAt, speedUpToFit, teaserWindows } from "./VoPanel";

type Made = { line: VoLine; engine: VoTrack["engine"]; temp: boolean; label: string };
/** buat ulang satu kalimat VO (per adegan) */
export type TempoRun =
  | { s: "tts" }
  | { s: "start" }
  | {
      s: "job";
      id: string;
      voice: string;
      sig: string;
      tempo: number | undefined;
      status?: VoiceJob["status"];
      progress?: number;
      message?: string | null;
      /** updated_at job (hitung mundur " · sisa ±…") */
      updated_at?: string | null;
      /** naskah & setelan yang dikirim (perkiraan lama pembuatan selagi antri) */
      lines?: VoiceJobLine[];
      settings?: Record<string, unknown>;
    }
  | { s: "error"; msg: string; fallback?: boolean; tempo: number | undefined };
export type TempoEngine = "bank" | "edge";

export const tempoBusy = (r: TempoRun | undefined): boolean => !!r && (r.s === "tts" || r.s === "start" || r.s === "job");

const errMsg = (e: unknown) => (e instanceof Error && e.message && e.message.length < 200 ? e.message : "Gagal bikin ulang suara kalimat ini. Coba lagi.");

/** pemantau satu job laptop (tidak menggambar apa pun) — dirender TimelineEditor, jadi tetap jalan walau bar VO ditutup */
function JobWatch({ id, onJob }: { id: string; onJob: (job: VoiceJob | null, missing: boolean) => void }) {
  const { job, missing } = useStudioJob<VoiceJob>("studio_voice_jobs", id);
  const cb = useRef(onJob);
  cb.current = onJob;
  useEffect(() => cb.current(job, missing), [job, missing]);
  return null;
}

export type VoTempo = {
  /** keadaan per id adegan (tidak ada = diam) */
  runs: Readonly<Record<string, TempoRun>>;
  /** hasil terakhir per id adegan (✅ / naskah berubah) */
  notes: Readonly<Record<string, string>>;
  run: (sceneId: string, tempo: number | undefined, engine: TempoEngine) => void;
  cancel: (sceneId: string) => void;
  /** pakai cadangan Edge (laptop mati / gagal) */
  fallback: (sceneId: string, tempo: number | undefined) => void;
  /** pemantau job laptop — taruh di pohon TimelineEditor (bukan di bar VO) */
  watchers: ReactNode;
};

/**
 * 🎚️ Kecepatan per kalimat, dipegang di level TimelineEditor (per id adegan): pilih adegan lain, tutup bar VO, pilih titik SFX, atau
 * klik blok adegan TIDAK memutus / membatalkan pembuatan suara — hasilnya tetap dipasang ke adegan pemiliknya saat selesai, dan
 * `onDone` memberi tahu (catatan timeline) kalau bar adegan itu sedang tertutup. Batal hanya lewat tombol Batal. Semua job/permintaan
 * dibatalkan kalau editor timeline ditutup (pindah proyek / keluar halaman: hasilnya tidak bisa dipasang ke mana pun) atau
 * `docKey` (id proyek) berganti.
 * `onApply(fn)` = ubah timeline terbaru (lewat jalur editor timeline / changeEdit).
 */
export function useVoTempo(timeline: Timeline, onApply: (fn: (t: Timeline) => Timeline) => void, opts: { docKey?: string | null; onDone?: (sceneId: string, msg: string, ok: boolean) => void } = {}): VoTempo {
  const [runs, setRuns] = useState<Record<string, TempoRun>>({});
  const runsRef = useRef(runs);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const tlRef = useRef(timeline);
  tlRef.current = timeline;
  const applyRef = useRef(onApply);
  applyRef.current = onApply;
  const doneRef = useRef(opts.onDone);
  doneRef.current = opts.onDone;
  const aborts = useRef(new Map<string, AbortController>());
  const alive = useRef(true);

  const setRun = (sid: string, st: TempoRun | null) => {
    const next = { ...runsRef.current };
    if (st) next[sid] = st;
    else delete next[sid];
    runsRef.current = next;
    setRuns(next);
  };
  const setNote = (sid: string, msg: string | null) =>
    setNotes((n) => {
      const x = { ...n };
      if (msg) x[sid] = msg;
      else delete x[sid];
      return x;
    });
  const fail = (sid: string, msg: string, fallback: boolean, tempo: number | undefined) => {
    setRun(sid, { s: "error", msg, fallback, tempo });
    const name = tlRef.current.scenes.find((x) => x.id === sid)?.name ?? "adegan";
    doneRef.current?.(sid, `⚠️ Kalimat ${name} gagal dibuat ulang — klik blok VO-nya untuk lihat & coba lagi. ${msg}`, false);
  };

  const stopAll = () => {
    for (const c of aborts.current.values()) c.abort();
    aborts.current.clear();
    for (const r of Object.values(runsRef.current)) if (r.s === "job") void cancelVoiceJob(r.id).catch(() => {});
    runsRef.current = {};
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stopAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // pindah proyek (id berganti; proyek baru yang baru tersimpan pertama kali tidak dihitung)
  const keyRef = useRef(opts.docKey ?? null);
  useEffect(() => {
    const prev = keyRef.current;
    keyRef.current = opts.docKey ?? null;
    if (prev !== null && prev !== keyRef.current) {
      stopAll();
      setRuns({});
      setNotes({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.docKey]);

  /** tempel hasil ke timeline: baris adegan ini diganti (mulai tetap), tempo disimpan, VO numpuk disusun otomatis */
  const apply = (sid: string, m: Made, tempo: number | undefined, sig: string) => {
    if (!alive.current) return;
    let msg = "";
    let ok = false;
    applyRef.current((t) => {
      const s = t.scenes.find((x) => x.id === sid);
      if (!s) {
        msg = "Adegannya sudah dihapus, jadi suara barunya tidak dipakai.";
        return t;
      }
      if (!s.vo?.text || voSayKey(s.vo, t.voice.lexicon) !== sig) {
        msg = `Naskah / ejaan ${s.name} berubah selama suara dibuat, jadi suaranya tidak dipakai. Coba lagi.`;
        return t;
      }
      const old = t.vo?.lines.find((l) => l.sceneId === s.id);
      const at = old ? voStartOf(s, old) : sceneVoAt(s);
      const order = new Map(t.scenes.map((x, i) => [x.id, i]));
      const lines = [...(t.vo?.lines ?? []).filter((l) => l.sceneId !== s.id), { ...m.line, at }].sort((a, b) => (order.get(a.sceneId) ?? 0) - (order.get(b.sceneId) ?? 0));
      const prev = t.vo;
      const vo: VoTrack = prev
        ? { ...prev, lines, full: null, temp: prev.temp || m.temp, ...(prev.engine === m.engine ? {} : { label: "VO campuran (beberapa adegan beda mesin suara)" }) }
        : { jobId: null, engine: m.engine, temp: m.temp, label: m.label, lines, full: null };
      const { tempo: _old, ...rest } = s.vo;
      void _old;
      const sc: Scene = { ...s, vo: { ...rest, ...(tempo !== undefined ? { tempo } : {}) } };
      const r = fitVo({ ...t, scenes: t.scenes.map((x) => (x.id === s.id ? sc : x)), vo, muteVo: false }, vo);
      ok = true;
      msg = [
        `✅ Kalimat ${s.name} dibuat ulang${tempo !== undefined ? ` dengan kecepatan ${fmtTempo(tempo)}` : " dengan kecepatan otomatis"}.`,
        r.moved.length ? `🪄 Disusun otomatis supaya tidak numpuk: ${movedText(r.tl, r.moved)}.` : "",
        r.clash.length ? `⛔ Masih numpuk: ${names(r.clash.map((c) => c.label))} — pilih lebih cepat, geser blok VO, atau pendekkan teks.` : "",
        r.cut.length ? `⛔ Ujung VO terpotong di akhir video: ${names(r.cut.map((c) => c.label))}.` : "",
      ]
        .filter(Boolean)
        .join(" ");
      return r.tl;
    });
    setRun(sid, null);
    setNote(sid, msg || null);
    if (msg) doneRef.current?.(sid, msg, ok);
  };

  // ---------- cadangan Edge: langsung dari website ----------
  const viaEdge = async (sid: string, tempo: number | undefined) => {
    const t = tlRef.current;
    const s = t.scenes.find((x) => x.id === sid);
    const p = voSpeech(s?.vo, t.voice.lexicon);
    if (!s || !p) return;
    const sig = voSayKey(s.vo, t.voice.lexicon);
    // otomatis = sama dengan VO proyek: adegan teaser dipercepat sendiri (maks 30%) kalau kepanjangan untuk jendelanya
    const win = tempo === undefined && isTeaserScene(s) ? teaserWindows(t).get(s.id) : undefined;
    aborts.current.get(sid)?.abort();
    const ctrl = new AbortController();
    aborts.current.set(sid, ctrl);
    setNote(sid, null);
    setRun(sid, { s: "tts" });
    try {
      const req = { text: p.text, spell: p.spell ?? undefined, voice: t.voice.edgeVoice ?? ("id-ID-ArdiNeural" as const), engine: "edge" as const };
      const first = await requestTts({ ...req, ...(tempo !== undefined ? { rate: tempoRate(tempo) } : {}) }, ctrl.signal);
      const { r, speed } =
        win !== undefined
          ? await speedUpToFit(first, win, async (rate) => {
              try {
                return await requestTts({ ...req, rate }, ctrl.signal);
              } catch {
                return null;
              }
            })
          : { r: first, speed: 0 };
      if (ctrl.signal.aborted) return;
      apply(sid, { line: { sceneId: sid, src: r.src, dur: r.dur, words: r.words, ...(speed > 0 ? { speed } : {}), ...(tempo !== undefined ? { tempo } : {}), say: sig }, engine: r.engine, temp: r.temp, label: r.label }, tempo, sig);
    } catch (e) {
      if (ctrl.signal.aborted || !alive.current) return;
      fail(sid, errMsg(e), false, tempo);
    } finally {
      if (aborts.current.get(sid) === ctrl) aborts.current.delete(sid);
    }
  };

  // ---------- bank suara: job 1 baris ke laptop (speed = atempo persis) ----------
  const viaBank = async (sid: string, tempo: number | undefined) => {
    const t = tlRef.current;
    const s = t.scenes.find((x) => x.id === sid);
    // teks ucapan versi bank (+ bunyi luncur) & setelan gaya bicara sama dengan "Generate ulang VO" (cache laptop terpakai)
    const p = voSpeech(s?.vo, t.voice.lexicon, "bank");
    if (!s || !p) return;
    const sig = voSayKey(s.vo, t.voice.lexicon);
    const win = tempo === undefined && isTeaserScene(s) ? teaserWindows(t).get(s.id) : undefined;
    setNote(sid, null);
    setRun(sid, { s: "start" });
    try {
      const voices = await fetchReadyVoices();
      if (!alive.current || runsRef.current[sid]?.s !== "start") return;
      const voice = voices.find((x) => x.id === t.voice.voiceId) ?? voices.find((x) => x.name === DEFAULT_VOICE) ?? voices[0];
      if (!voice) return void (await viaEdge(sid, tempo));
      const line: VoiceJobLine = { id: sid, scene_id: sid, text: p.text, spell: p.spell, start: 0, ...(tempo !== undefined ? { speed: tempo } : win !== undefined ? { max: win } : {}) };
      const settings = bankSettings(t);
      const j = await createVoiceJob({ kind: "tts", project_id: null, voice_id: voice.id, engine: "auto", lines: [line], settings });
      // editor ditutup / dibatalkan selagi antrian dibuat → job-nya langsung dibatalkan
      if (!alive.current || runsRef.current[sid]?.s !== "start") return void cancelVoiceJob(j.id).catch(() => {});
      setRun(sid, { s: "job", id: j.id, voice: voice.name, sig, tempo, lines: [line], settings });
    } catch (e) {
      if (!alive.current) return;
      fail(sid, errMsg(e), true, tempo);
    }
  };

  const onJob = (sid: string, jobId: string, job: VoiceJob | null, missing: boolean) => {
    const r = runsRef.current[sid];
    if (!r || r.s !== "job" || r.id !== jobId) return;
    if (missing) return fail(sid, "Antrian suara hilang. Coba lagi.", true, r.tempo);
    if (!job || job.id !== jobId) return;
    if (job.status === "selesai") {
      const l = job.result?.lines?.find((x) => x && x.scene_id === sid) ?? job.result?.lines?.[0];
      if (!l || typeof l.path !== "string") return fail(sid, "Mesin suara selesai tapi hasilnya kosong. Coba lagi.", true, r.tempo);
      const tempo = normTempo(l.tempo);
      // laptop belum git pull → `speed` diabaikan (suara kecepatan normal) → jangan dipakai diam-diam
      if (r.tempo !== undefined && tempo === undefined)
        return fail(sid, "Mesin suara di laptop versi lama belum bisa mengatur kecepatan — jalankan git pull di laptop lalu coba lagi. Suara tidak diganti.", true, r.tempo);
      const speed = tempo === undefined ? Math.round(Number(l.speed) || 0) : 0;
      const heard = heardFromResult(l);
      apply(
        sid,
        {
          line: {
            sceneId: sid,
            src: storageSrc(l.path),
            dur: Math.max(0.05, Number(l.dur) || 0.05),
            words: cleanWords(l.words),
            ...(speed > 0 ? { speed } : {}),
            ...(tempo !== undefined ? { tempo } : {}),
            say: r.sig,
            ...(heard ? { heard } : {}),
          },
          engine: /pocket/i.test(job.engine_used ?? "") ? "pocket" : "chatterbox",
          temp: false,
          label: `Bank suara · ${r.voice}`,
        },
        r.tempo,
        r.sig,
      );
    } else if (job.status === "gagal") {
      fail(sid, `Mesin suara di laptop gagal bikin ulang kalimat ini${job.message ? ` (${job.message.slice(0, 120)})` : ""}.`, true, r.tempo);
    } else if (job.status === "batal") {
      setRun(sid, null);
    } else if (r.status !== job.status || r.progress !== job.progress || r.message !== job.message || r.updated_at !== job.updated_at) {
      setRun(sid, { ...r, status: job.status, progress: job.progress, message: job.message, updated_at: job.updated_at ?? null });
    }
  };

  const run = (sid: string, tempo: number | undefined, engine: TempoEngine) => {
    if (tempoBusy(runsRef.current[sid])) return;
    void (engine === "bank" ? viaBank(sid, tempo) : viaEdge(sid, tempo));
  };
  const cancel = (sid: string) => {
    const r = runsRef.current[sid];
    aborts.current.get(sid)?.abort();
    aborts.current.delete(sid);
    if (r?.s === "job") void cancelVoiceJob(r.id).catch(() => {});
    setRun(sid, null);
  };
  const fallback = (sid: string, tempo: number | undefined) => {
    const r = runsRef.current[sid];
    if (r?.s === "job") void cancelVoiceJob(r.id).catch(() => {});
    setRun(sid, null);
    void viaEdge(sid, tempo);
  };

  const watchers = Object.entries(runs).flatMap(([sid, r]) => (r.s === "job" ? [<JobWatch key={`${sid}:${r.id}`} id={r.id} onJob={(j, m) => onJob(sid, r.id, j, m)} />] : []));
  return { runs, notes, run, cancel, fallback, watchers };
}

/**
 * 🎚️ Kecepatan satu kalimat VO (bar blok VO di Timeline): pilih 0,85×–1,3× atau Otomatis → kalimat adegan ini SAJA dibuat ulang
 * (cadangan Edge: rate "+N%"; bank suara laptop: job 1 baris dengan `speed` → atempo persis). Hasilnya mengganti baris VO adegan ini
 * (mulainya tetap), `scene.vo.tempo` ikut disimpan supaya "Generate ulang VO" memakai kecepatan yang sama, lalu VO yang jadi numpuk
 * disusun otomatis (fitVo → arrangeVo). Suara premium tidak bisa diatur kecepatannya.
 * Keadaan pembuatan suara ada di `tools` (useVoTempo di TimelineEditor), jadi bar boleh ditutup / pindah adegan selagi suara dibuat.
 * Pasang dengan `key={scene.id}` supaya pilihan kecepatan tidak terbawa ke adegan lain.
 */
export default function VoLineTools({ scene, timeline, tools }: { scene: Scene; timeline: Timeline; tools: VoTempo }) {
  const uid = useId();
  const status = useStudioStatus();
  const cur = scene.vo?.tempo;
  const [want, setWant] = useState<number | "auto">(cur ?? "auto");
  // kecepatan dari luar berubah (undo, generate ulang) → pilihan ikut
  useEffect(() => setWant(cur ?? "auto"), [cur]);

  const v = timeline.voice;
  const workerOn = !!status?.worker.online && status.engines.bank;
  const eleven = !!status?.engines.elevenlabs;
  const engine: TempoEngine | "elevenlabs" = v.mode === "bank" && workerOn ? "bank" : v.mode === "elevenlabs" && eleven ? "elevenlabs" : "edge";
  const lineNow = timeline.vo?.lines.find((l) => l.sceneId === scene.id);
  const st = tools.runs[scene.id];
  const note = tools.notes[scene.id];
  const busy = tempoBusy(st);
  const engineName =
    engine === "bank"
      ? `bank suara · ${v.voiceName || DEFAULT_VOICE}`
      : `cadangan Edge${v.mode === "bank" && status !== null ? " (laptop mati — suaranya beda)" : ""}`;
  const tempoOf = (w: number | "auto") => (w === "auto" ? undefined : w);
  const changed = tempoOf(want) !== cur || (lineNow?.tempo ?? undefined) !== cur;

  if (!scene.vo?.text || v.mode === "none") return null;
  const job = st?.s === "job" ? st : null;
  const pct = job ? Math.round((job.progress ?? 0) * 100) : 0;
  const queuedMsg = job && (job.status ?? "antri") === "antri" ? queuedText(estimateQueued(job.lines, job.settings, status?.worker)) : null;

  return (
    <div className="space-y-1.5" data-vo-tempo>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <label htmlFor={`${uid}-tempo`} className="text-[11.5px] font-semibold text-zinc-300">
          🎚️ Kecepatan
        </label>
        <select
          id={`${uid}-tempo`}
          className="input w-auto py-1 pl-2 pr-7 text-[12px]"
          value={want === "auto" ? "auto" : String(want)}
          disabled={busy || engine === "elevenlabs"}
          onChange={(e) => setWant(e.target.value === "auto" ? "auto" : (normTempo(e.target.value) ?? "auto"))}
          data-vo-tempo-select
        >
          <option value="auto">Otomatis</option>
          {TEMPOS.map((f) => (
            <option key={f} value={String(f)}>
              {fmtTempo(f)}
              {f === 1 ? " (normal)" : f < 1 ? " (lebih pelan)" : ""}
            </option>
          ))}
        </select>
        {busy ? (
          <>
            <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[11.5px] text-zinc-400" role="status" data-vo-tempo-busy>
              <span className="h-2 w-2 flex-none animate-pulse rounded-full bg-orange-500" />
              <span className="min-w-0">
                {st?.s === "tts"
                  ? "Bikin ulang kalimat ini…"
                  : st?.s === "start"
                    ? "Menyiapkan antrian…"
                    : job?.status === "proses"
                      ? `${etaText(job.message, "Laptop lagi bikin suara…")}${pct ? ` ${pct}%` : ""}`
                      : (queuedMsg ?? "Menunggu giliran di laptop…")}
              </span>
              {job && <EtaChip job={job} />}
            </span>
            {st?.s !== "start" && (
              <button type="button" className="text-[12px] font-semibold text-red-400 hover:text-red-300" onClick={() => tools.cancel(scene.id)} data-vo-tempo-cancel>
                Batal
              </button>
            )}
          </>
        ) : engine === "elevenlabs" ? (
          <span className="text-[11px] text-zinc-500">Suara premium tidak bisa diatur kecepatannya.</span>
        ) : (
          <button type="button" className="btn-ghost px-2.5 py-1 text-[12px]" disabled={!changed} onClick={() => tools.run(scene.id, tempoOf(want), engine)} data-vo-tempo-apply>
            🔁 {changed ? "Terapkan" : "Sudah dipakai"}
          </button>
        )}
      </div>
      {!busy && engine !== "elevenlabs" && changed && <p className="text-[10.5px] text-zinc-500">Kalimat ini saja yang dibuat ulang · {engineName}</p>}
      {busy && <p className="text-[10.5px] text-zinc-500">Bar ini boleh ditutup — suaranya tetap dipasang ke adegan ini kalau sudah jadi.</p>}
      {job && !workerOn && status !== null && job.status !== "proses" && (
        <p className="rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-300">
          Laptop mati — antrian menunggu laptop nyala.{" "}
          <button type="button" className="font-semibold underline" onClick={() => tools.fallback(scene.id, job.tempo)}>
            Pakai cadangan Edge
          </button>
        </p>
      )}
      {st?.s === "error" && (
        <div className="space-y-1 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-[11.5px] text-red-300" role="alert">
          <p>{st.msg}</p>
          {st.fallback && (
            <button type="button" className="font-semibold underline" onClick={() => tools.fallback(scene.id, st.tempo)}>
              Coba pakai suara cadangan (Edge)
            </button>
          )}
        </div>
      )}
      {note && !busy && st?.s !== "error" && (
        <p className="text-[11px] leading-relaxed text-zinc-400" role="status" data-vo-tempo-note>
          {note}
        </p>
      )}
    </div>
  );
}
