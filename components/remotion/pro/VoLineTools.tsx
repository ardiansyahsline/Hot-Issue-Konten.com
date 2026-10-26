"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cancelVoiceJob, createVoiceJob, fetchReadyVoices, requestTts, useStudioJob, useStudioStatus, type VoiceJob, type VoiceJobLine } from "@/lib/studio/client";
import { voSayKey, voSpeech } from "@/lib/studio/pronounce";
import { normTempo, tempoRate, TEMPOS, voStartOf, type Scene, type Timeline, type VoLine, type VoTrack } from "@/lib/studio/timeline";
import { storageSrc } from "@/lib/studio/urls";
import { isTeaserScene } from "./teaserLock";
import { cleanWords, DEF_CFG, DEF_EXG, DEFAULT_VOICE, fitVo, fmtTempo, movedText, names, sceneVoAt, speedUpToFit, teaserWindows } from "./VoPanel";

type Made = { line: VoLine; engine: VoTrack["engine"]; temp: boolean; label: string };
type St =
  | { s: "idle" }
  | { s: "tts" }
  | { s: "start" }
  | { s: "job"; id: string; voice: string; sig: string; tempo: number | undefined }
  | { s: "error"; msg: string; fallback?: boolean };

const errMsg = (e: unknown) => (e instanceof Error && e.message && e.message.length < 200 ? e.message : "Gagal bikin ulang suara kalimat ini. Coba lagi.");

/**
 * 🎚️ Kecepatan satu kalimat VO (bar blok VO di Timeline): pilih 0,85×–1,3× atau Otomatis → kalimat adegan ini SAJA dibuat ulang
 * (cadangan Edge: rate "+N%"; bank suara laptop: job 1 baris dengan `speed` → atempo persis). Hasilnya mengganti baris VO adegan ini
 * (mulainya tetap), `scene.vo.tempo` ikut disimpan supaya "Generate ulang VO" memakai kecepatan yang sama, lalu VO yang jadi numpuk
 * disusun otomatis (fitVo → arrangeVo). Suara premium tidak bisa diatur kecepatannya.
 * `onApply(fn)` = ubah timeline terbaru (lewat jalur editor timeline / changeEdit).
 */
export default function VoLineTools({ scene, timeline, onApply }: { scene: Scene; timeline: Timeline; onApply: (fn: (t: Timeline) => Timeline) => void }) {
  const uid = useId();
  const status = useStudioStatus();
  const [st, setSt] = useState<St>({ s: "idle" });
  const [note, setNote] = useState<string | null>(null);
  const cur = scene.vo?.tempo;
  const [want, setWant] = useState<number | "auto">(cur ?? "auto");
  const tlRef = useRef(timeline);
  tlRef.current = timeline;
  const abortRef = useRef<AbortController | null>(null);
  const jobRef = useRef<string | null>(null);
  // kecepatan dari luar berubah (undo, generate ulang) → pilihan ikut
  useEffect(() => setWant(cur ?? "auto"), [cur, scene.id]);
  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (jobRef.current) void cancelVoiceJob(jobRef.current).catch(() => {});
    },
    [],
  );

  const v = timeline.voice;
  const workerOn = !!status?.worker.online && status.engines.bank;
  const eleven = !!status?.engines.elevenlabs;
  const engine: "bank" | "edge" | "elevenlabs" = v.mode === "bank" && workerOn ? "bank" : v.mode === "elevenlabs" && eleven ? "elevenlabs" : "edge";
  const lineNow = timeline.vo?.lines.find((l) => l.sceneId === scene.id);
  const busy = st.s === "tts" || st.s === "start" || st.s === "job";
  const engineName =
    engine === "bank"
      ? `bank suara · ${v.voiceName || DEFAULT_VOICE}`
      : `cadangan Edge${v.mode === "bank" && status !== null ? " (laptop mati — suaranya beda)" : ""}`;
  const tempoOf = (w: number | "auto") => (w === "auto" ? undefined : w);
  const changed = tempoOf(want) !== cur || (lineNow?.tempo ?? undefined) !== cur;

  /** tempel hasil ke timeline: baris adegan ini diganti (mulai tetap), tempo disimpan, VO numpuk disusun otomatis */
  const apply = (m: Made, tempo: number | undefined, sig: string) => {
    let msg = "";
    onApply((t) => {
      const s = t.scenes.find((x) => x.id === scene.id);
      if (!s?.vo?.text || voSayKey(s.vo, t.voice.lexicon) !== sig) {
        msg = "Naskah / ejaan berubah selama suara dibuat, jadi suaranya tidak dipakai. Coba lagi.";
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
    setNote(msg || null);
    setSt({ s: "idle" });
  };

  // ---------- cadangan Edge: langsung dari website ----------
  const viaEdge = async (tempo: number | undefined) => {
    const t = tlRef.current;
    const s = t.scenes.find((x) => x.id === scene.id) ?? scene;
    const p = voSpeech(s.vo, t.voice.lexicon);
    if (!p) return;
    const sig = voSayKey(s.vo, t.voice.lexicon);
    // otomatis = sama dengan VO proyek: adegan teaser dipercepat sendiri (maks 30%) kalau kepanjangan untuk jendelanya
    const win = tempo === undefined && isTeaserScene(s) ? teaserWindows(t).get(s.id) : undefined;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setNote(null);
    setSt({ s: "tts" });
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
      apply({ line: { sceneId: s.id, src: r.src, dur: r.dur, words: r.words, ...(speed > 0 ? { speed } : {}), ...(tempo !== undefined ? { tempo } : {}), say: sig }, engine: r.engine, temp: r.temp, label: r.label }, tempo, sig);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setSt({ s: "error", msg: errMsg(e) });
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
    }
  };

  // ---------- bank suara: job 1 baris ke laptop (speed = atempo persis) ----------
  const viaBank = async (tempo: number | undefined) => {
    const t = tlRef.current;
    const s = t.scenes.find((x) => x.id === scene.id) ?? scene;
    const p = voSpeech(s.vo, t.voice.lexicon);
    if (!p) return;
    const sig = voSayKey(s.vo, t.voice.lexicon);
    const win = tempo === undefined && isTeaserScene(s) ? teaserWindows(t).get(s.id) : undefined;
    setNote(null);
    setSt({ s: "start" });
    try {
      const voices = await fetchReadyVoices();
      const voice = voices.find((x) => x.id === t.voice.voiceId) ?? voices.find((x) => x.name === DEFAULT_VOICE) ?? voices[0];
      if (!voice) return void (await viaEdge(tempo));
      const line: VoiceJobLine = { id: s.id, scene_id: s.id, text: p.text, spell: p.spell, start: 0, ...(tempo !== undefined ? { speed: tempo } : win !== undefined ? { max: win } : {}) };
      const j = await createVoiceJob({ kind: "tts", project_id: null, voice_id: voice.id, engine: "auto", lines: [line], settings: { exaggeration: t.voice.exaggeration ?? DEF_EXG, cfg_weight: t.voice.cfg ?? DEF_CFG, takes: 2 } });
      jobRef.current = j.id;
      setSt({ s: "job", id: j.id, voice: voice.name, sig, tempo });
    } catch (e) {
      setSt({ s: "error", msg: errMsg(e), fallback: true });
    }
  };

  const { job, missing } = useStudioJob<VoiceJob>("studio_voice_jobs", st.s === "job" ? st.id : null);
  useEffect(() => {
    if (st.s !== "job") return;
    if (missing) {
      jobRef.current = null;
      return setSt({ s: "error", msg: "Antrian suara hilang. Coba lagi.", fallback: true });
    }
    if (!job || job.id !== st.id) return;
    if (job.status === "selesai") {
      jobRef.current = null;
      const l = job.result?.lines?.find((x) => x && x.scene_id === scene.id) ?? job.result?.lines?.[0];
      if (!l || typeof l.path !== "string") return setSt({ s: "error", msg: "Mesin suara selesai tapi hasilnya kosong. Coba lagi.", fallback: true });
      const tempo = normTempo(l.tempo);
      // laptop belum git pull → `speed` diabaikan (suara kecepatan normal) → jangan dipakai diam-diam
      if (st.tempo !== undefined && tempo === undefined)
        return setSt({ s: "error", msg: "Mesin suara di laptop versi lama belum bisa mengatur kecepatan — jalankan git pull di laptop lalu coba lagi. Suara tidak diganti.", fallback: true });
      const speed = tempo === undefined ? Math.round(Number(l.speed) || 0) : 0;
      apply(
        {
          line: { sceneId: scene.id, src: storageSrc(l.path), dur: Math.max(0.05, Number(l.dur) || 0.05), words: cleanWords(l.words), ...(speed > 0 ? { speed } : {}), ...(tempo !== undefined ? { tempo } : {}), say: st.sig },
          engine: /pocket/i.test(job.engine_used ?? "") ? "pocket" : "chatterbox",
          temp: false,
          label: `Bank suara · ${st.voice}`,
        },
        st.tempo,
        st.sig,
      );
    } else if (job.status === "gagal") {
      jobRef.current = null;
      setSt({ s: "error", msg: `Mesin suara di laptop gagal bikin ulang kalimat ini${job.message ? ` (${job.message.slice(0, 120)})` : ""}.`, fallback: true });
    } else if (job.status === "batal") {
      jobRef.current = null;
      setSt({ s: "idle" });
    }
    // apply() memakai ref terbaru; cukup dipicu perubahan job
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, missing, st]);

  const run = (tempo: number | undefined) => (engine === "bank" ? void viaBank(tempo) : void viaEdge(tempo));
  const cancel = () => {
    abortRef.current?.abort();
    if (st.s === "job") void cancelVoiceJob(st.id).catch(() => {});
    jobRef.current = null;
    setSt({ s: "idle" });
  };
  const fallback = () => {
    if (st.s === "job") void cancelVoiceJob(st.id).catch(() => {});
    jobRef.current = null;
    void viaEdge(tempoOf(want));
  };

  if (!scene.vo?.text || v.mode === "none") return null;
  const pct = st.s === "job" ? Math.round((job?.progress ?? 0) * 100) : 0;

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
            <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-zinc-400" role="status">
              <span className="h-2 w-2 flex-none animate-pulse rounded-full bg-orange-500" />
              {st.s === "tts" ? "Bikin ulang kalimat ini…" : st.s === "start" ? "Menyiapkan antrian…" : job?.status === "proses" ? `${job.message || "Laptop lagi bikin suara…"}${pct ? ` ${pct}%` : ""}` : "Menunggu giliran di laptop…"}
            </span>
            {st.s !== "start" && (
              <button type="button" className="text-[12px] font-semibold text-red-400 hover:text-red-300" onClick={cancel}>
                Batal
              </button>
            )}
          </>
        ) : engine === "elevenlabs" ? (
          <span className="text-[11px] text-zinc-500">Suara premium tidak bisa diatur kecepatannya.</span>
        ) : (
          <button type="button" className="btn-ghost px-2.5 py-1 text-[12px]" disabled={!changed} onClick={() => run(tempoOf(want))} data-vo-tempo-apply>
            🔁 {changed ? "Terapkan" : "Sudah dipakai"}
          </button>
        )}
      </div>
      {!busy && engine !== "elevenlabs" && changed && <p className="text-[10.5px] text-zinc-500">Kalimat ini saja yang dibuat ulang · {engineName}</p>}
      {st.s === "job" && !workerOn && status !== null && job?.status !== "proses" && (
        <p className="rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-300">
          Laptop mati — antrian menunggu laptop nyala.{" "}
          <button type="button" className="font-semibold underline" onClick={fallback}>
            Pakai cadangan Edge
          </button>
        </p>
      )}
      {st.s === "error" && (
        <div className="space-y-1 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-[11.5px] text-red-300" role="alert">
          <p>{st.msg}</p>
          {st.fallback && (
            <button type="button" className="font-semibold underline" onClick={fallback}>
              Coba pakai suara cadangan (Edge)
            </button>
          )}
        </div>
      )}
      {note && !busy && (
        <p className="text-[11px] leading-relaxed text-zinc-400" role="status" data-vo-tempo-note>
          {note}
        </p>
      )}
    </div>
  );
}
