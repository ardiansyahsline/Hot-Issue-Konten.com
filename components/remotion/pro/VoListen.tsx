"use client";

import { useEffect, useRef, useState } from "react";
import { cancelVoiceJob, createVoiceJob, fetchReadyVoices, requestTts, useStudioJob, useStudioStatus, type VoiceJob, type VoiceJobLine } from "@/lib/studio/client";
import { estimateQueued, etaText, queuedText } from "@/lib/studio/eta";
import { EtaChip } from "./JobEta";
import { voSayKey, voSpeech, type LexEntry } from "@/lib/studio/pronounce";
import { heardFromResult } from "@/lib/studio/heard";
import { bankSettings } from "@/lib/studio/voiceStyle";
import { normTempo, tempoRate, type Scene, type Timeline, type VoLine, type VoTrack } from "@/lib/studio/timeline";
import { storageSrc } from "@/lib/studio/urls";
import { isTeaserScene } from "./teaserLock";
import { cleanWords, DEFAULT_VOICE, fitVo, fmtTempo, sceneVoAt, speedUpToFit, teaserWindows } from "./VoPanel";
import VoHeard, { upsertLexicon } from "./VoHeard";
import VoSpellTry from "./VoSpellTry";

type Ready = { s: "ready"; line: VoLine; label: string; engine: VoTrack["engine"]; temp: boolean; sig: string; used?: boolean };
type St =
  | { s: "idle" }
  | { s: "tts"; engine: "edge" | "elevenlabs" }
  | { s: "start" }
  | { s: "job"; id: string; voice: string; sig: string }
  | Ready
  | { s: "error"; msg: string; detail?: string; fallback?: boolean };

// satu contoh suara diputar dalam satu waktu (semua kartu adegan)
let playing: HTMLAudioElement | null = null;
const stopAll = () => {
  try {
    playing?.pause();
  } catch {}
  playing = null;
};
const errMsg = (e: unknown) => (e instanceof Error && e.message && e.message.length < 200 ? e.message : "Gagal bikin contoh suara. Coba lagi.");

/**
 * 🔊 Dengar (kartu adegan, bagian VO): bikin suara SATU kalimat VO adegan ini saja untuk dicoba, pakai mesin yang sama dengan
 * pilihan di panel Suara VO (bank suara laptop kalau nyala; premium kalau dipilih & aktif; selain itu cadangan Edge), lalu diputar
 * di browser. VO proyek tidak berubah sampai user memilih "Pakai ini". Teks yang dibaca = teks ucapan akhir (ejaan adegan +
 * 📖 kamus ejaan + angka jadi kata) — sama persis dengan yang dikirim saat "Generate ulang VO", jadi suara bank yang sudah dicoba
 * ikut dipakai ulang dari cache laptop.
 */
export default function VoListen({ scene, timeline, onTimeline }: { scene: Scene; timeline: Timeline; onTimeline?: (fn: (t: Timeline) => Timeline) => unknown }) {
  const status = useStudioStatus();
  const [st, setSt] = useState<St>({ s: "idle" });
  const [play, setPlay] = useState(false);
  const tlRef = useRef(timeline);
  tlRef.current = timeline;
  const abortRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const jobRef = useRef<string | null>(null);

  const v = timeline.voice;
  const workerOn = !!status?.worker.online && status.engines.bank;
  const eleven = !!status?.engines.elevenlabs;
  const engine: "bank" | "edge" | "elevenlabs" = v.mode === "bank" && workerOn ? "bank" : v.mode === "elevenlabs" && eleven ? "elevenlabs" : "edge";
  // teks yang dibaca mesin: bank = + bunyi luncur ("sowal"), Edge / premium = teks ucapan biasa
  const pay = voSpeech(scene.vo, v.lexicon, engine === "bank" ? "bank" : undefined);
  const sigNow = voSayKey(scene.vo, v.lexicon);
  const busy = st.s === "tts" || st.s === "start" || st.s === "job";
  const engineName =
    engine === "bank"
      ? `bank suara · ${v.voiceName || DEFAULT_VOICE}`
      : engine === "elevenlabs"
        ? "premium ElevenLabs"
        : `cadangan Edge · ${(v.edgeVoice ?? "id-ID-ArdiNeural") === "id-ID-GadisNeural" ? "Gadis" : "Ardi"}${v.mode === "bank" ? (status === null ? "" : " (laptop mati)") : ""}`;

  // tutup kartu / pindah halaman: hentikan suara, permintaan & antrian contoh yang belum selesai
  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (audioRef.current && playing === audioRef.current) stopAll();
      if (jobRef.current) void cancelVoiceJob(jobRef.current).catch(() => {});
    },
    [],
  );

  const playSrc = (src: string) => {
    stopAll();
    try {
      const a = new Audio(src);
      // event suara lama (dihentikan karena contoh lain diputar) diabaikan
      a.onended = () => audioRef.current === a && setPlay(false);
      a.onpause = () => audioRef.current === a && setPlay(false);
      a.onplay = () => audioRef.current === a && setPlay(true);
      audioRef.current = a;
      playing = a;
      // diblokir browser (belum ada interaksi) -> cukup tombol ▶
      void a.play().catch(() => setPlay(false));
    } catch {
      setPlay(false);
    }
  };
  const stop = () => {
    if (audioRef.current && playing === audioRef.current) stopAll();
    setPlay(false);
  };

  /** "Buat ulang kalimat ini" (👂 Terdengar): contoh berikutnya langsung dipasang ke VO proyek */
  const autoUse = useRef(false);
  const [rebuildNote, setRebuildNote] = useState<string | null>(null);
  const ready = (r: Omit<Ready, "s">) => {
    const rd: Ready = { s: "ready", ...r };
    if (autoUse.current && onTimeline) {
      autoUse.current = false;
      const ok = apply(rd);
      setRebuildNote(ok ? null : "Naskah / ejaan berubah lagi selama suara dibuat — klik lagi untuk buat ulang.");
      setSt(ok ? { ...rd, used: true } : rd);
    } else setSt(rd);
    playSrc(r.line.src);
  };

  // ---------- cadangan Edge / premium: langsung dari website ----------
  const viaTts = async (eng: "edge" | "elevenlabs") => {
    const t = tlRef.current;
    const s = t.scenes.find((x) => x.id === scene.id) ?? scene;
    const p = voSpeech(s.vo, t.voice.lexicon);
    if (!p) return;
    const sig = voSayKey(s.vo, t.voice.lexicon);
    // kecepatan diatur sendiri di timeline → rate persis itu (tanpa percepat otomatis)
    const tempo = s.vo?.tempo;
    const win = isTeaserScene(s) && tempo === undefined ? teaserWindows(t).get(s.id) : undefined;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setSt({ s: "tts", engine: eng });
    try {
      const req = { text: p.text, spell: p.spell ?? undefined, voice: t.voice.edgeVoice ?? ("id-ID-ArdiNeural" as const) };
      const first = await requestTts({ ...req, engine: eng, ...(tempo !== undefined ? { rate: tempoRate(tempo) } : {}) }, ctrl.signal);
      // sama dengan VO proyek: adegan teaser dipercepat otomatis (maks 30%) supaya pas di jendelanya
      const { r, speed } =
        first.engine === "edge" && win !== undefined
          ? await speedUpToFit(first, win, async (rate) => {
              try {
                const r2 = await requestTts({ ...req, engine: "edge", rate }, ctrl.signal);
                return r2.engine === "edge" ? r2 : null;
              } catch {
                return null;
              }
            })
          : { r: first, speed: 0 };
      if (ctrl.signal.aborted) return;
      const line: VoLine = { sceneId: s.id, src: r.src, dur: r.dur, at: sceneVoAt(s), words: r.words, ...(speed > 0 ? { speed } : {}), ...(tempo !== undefined && r.engine === "edge" ? { tempo } : {}), say: sig };
      ready({ line, label: r.label, engine: r.engine, temp: r.temp, sig });
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setSt({ s: "error", msg: errMsg(e) });
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
    }
  };

  // ---------- bank suara: job 1 kalimat ke laptop lewat antrian yang sama ----------
  const viaBank = async () => {
    const t = tlRef.current;
    const s = t.scenes.find((x) => x.id === scene.id) ?? scene;
    const p = voSpeech(s.vo, t.voice.lexicon, "bank");
    if (!p) return;
    const sig = voSayKey(s.vo, t.voice.lexicon);
    const tempo = s.vo?.tempo;
    const win = isTeaserScene(s) && tempo === undefined ? teaserWindows(t).get(s.id) : undefined;
    setSt({ s: "start" });
    try {
      const voices = await fetchReadyVoices();
      const voice = voices.find((x) => x.id === t.voice.voiceId) ?? voices.find((x) => x.name === DEFAULT_VOICE) ?? voices[0];
      if (!voice) return void (await viaTts("edge"));
      const line: VoiceJobLine = { id: s.id, scene_id: s.id, text: p.text, spell: p.spell, start: 0, ...(tempo !== undefined ? { speed: tempo } : win !== undefined ? { max: win } : {}) };
      // setelan sama dengan "Generate ulang VO" → suara mentah kalimat ini dipakai ulang dari cache laptop
      const j = await createVoiceJob({ kind: "tts", project_id: null, voice_id: voice.id, engine: "auto", lines: [line], settings: bankSettings(t) });
      jobRef.current = j.id;
      setSt({ s: "job", id: j.id, voice: voice.name, sig });
    } catch (e) {
      setSt({ s: "error", msg: errMsg(e), fallback: true });
    }
  };

  const { job, missing } = useStudioJob<VoiceJob>("studio_voice_jobs", st.s === "job" ? st.id : null);
  useEffect(() => {
    if (st.s !== "job") return;
    if (missing) {
      jobRef.current = null;
      return setSt({ s: "error", msg: "Antrian contoh suara hilang. Coba lagi.", fallback: true });
    }
    if (!job || job.id !== st.id) return;
    if (job.status === "selesai") {
      jobRef.current = null;
      const l = job.result?.lines?.find((x) => x && x.scene_id === scene.id) ?? job.result?.lines?.[0];
      if (!l || typeof l.path !== "string") return setSt({ s: "error", msg: "Mesin suara selesai tapi hasilnya kosong. Coba lagi.", fallback: true });
      const tempo = normTempo(l.tempo);
      const speed = tempo === undefined ? Math.round(Number(l.speed) || 0) : 0;
      const s = tlRef.current.scenes.find((x) => x.id === scene.id) ?? scene;
      const heard = heardFromResult(l);
      ready({
        line: {
          sceneId: scene.id,
          src: storageSrc(l.path),
          dur: Math.max(0.05, Number(l.dur) || 0.05),
          at: sceneVoAt(s),
          words: cleanWords(l.words),
          ...(speed > 0 ? { speed } : {}),
          ...(tempo !== undefined ? { tempo } : {}),
          say: st.sig,
          ...(heard ? { heard } : {}),
        },
        label: `Bank suara · ${st.voice}`,
        engine: /pocket/i.test(job.engine_used ?? "") ? "pocket" : "chatterbox",
        temp: false,
        sig: st.sig,
      });
    } else if (job.status === "gagal") {
      jobRef.current = null;
      autoUse.current = false;
      setSt({ s: "error", msg: "Mesin suara di laptop gagal bikin contoh suara.", detail: job.message ?? undefined, fallback: true });
    } else if (job.status === "batal") {
      jobRef.current = null;
      autoUse.current = false;
      setSt({ s: "idle" });
    }
    // ready() memakai ref terbaru; cukup dipicu perubahan job
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, missing, st]);

  const listen = (rebuild = false) => {
    stop();
    autoUse.current = rebuild;
    setRebuildNote(null);
    if (engine === "bank") return void viaBank();
    return void viaTts(engine);
  };

  const cancel = () => {
    autoUse.current = false;
    abortRef.current?.abort();
    if (st.s === "job") {
      void cancelVoiceJob(st.id).catch(() => {});
      jobRef.current = null;
    }
    setSt({ s: "idle" });
  };

  /** antrian laptop kelamaan / laptop mati → batalkan, coba pakai cadangan Edge */
  const fallback = () => {
    if (st.s === "job") void cancelVoiceJob(st.id).catch(() => {});
    jobRef.current = null;
    void viaTts("edge");
  };

  /**
   * pasang contoh ini sebagai VO adegan di proyek (adegan lain tidak berubah; VO lengkap .mp3 dilepas karena tidak sinkron lagi).
   * false = naskah / ejaan sudah berubah sejak contoh dibuat (tidak dipasang).
   */
  function apply(r: Ready): boolean {
    if (!onTimeline) return false;
    const cur = tlRef.current.scenes.find((x) => x.id === scene.id);
    if (!cur?.vo?.text || voSayKey(cur.vo, tlRef.current.voice.lexicon) !== r.sig) return false;
    onTimeline((t) => {
      const s = t.scenes.find((x) => x.id === scene.id);
      if (!s?.vo?.text || voSayKey(s.vo, t.voice.lexicon) !== r.sig) return t;
      const order = new Map(t.scenes.map((x, i) => [x.id, i]));
      const lines = [...(t.vo?.lines ?? []).filter((l) => l.sceneId !== s.id), { ...r.line, at: sceneVoAt(s) }].sort((a, b) => (order.get(a.sceneId) ?? 0) - (order.get(b.sceneId) ?? 0));
      const prev = t.vo;
      const vo: VoTrack = prev
        ? { ...prev, lines, full: null, temp: prev.temp || r.temp, ...(prev.engine === r.engine ? {} : { label: "VO campuran (beberapa adegan beda mesin suara)" }) }
        : { jobId: null, engine: r.engine, temp: r.temp, label: r.label, lines, full: null };
      return fitVo({ ...t, vo, muteVo: false }, vo).tl;
    });
    return true;
  }
  const use = () => {
    if (st.s !== "ready" || !apply(st)) return;
    setSt({ ...st, used: true });
  };

  // ---------- 👂 Terdengar: contoh yang belum dipakai, atau VO proyek adegan ini (suara bank yang membawa teks terdengar) ----------
  const lineNow = timeline.vo?.lines.find((l) => l.sceneId === scene.id);
  // kamus sebelum perbaikan pertama di kartu ini: suara proyek tetap "sesuai naskah" walau kamusnya baru ditambah dari sini
  const lexBefore = useRef<LexEntry[] | undefined | null>(null);
  const freshSig = (sig: string | undefined) => !!sig && (sig === sigNow || (lexBefore.current !== null && sig === voSayKey(scene.vo, lexBefore.current)));
  const sampleHeard = st.s === "ready" && !st.used && freshSig(st.sig) ? st.line.heard : undefined;
  const lineFresh = freshSig(lineNow?.say);
  // `src` = kunci suara: suara baru (walau teks terdengarnya sama) → isian & catatan perbaikan di panel mulai dari awal
  const heardSrc =
    st.s === "ready" && sampleHeard ? { heard: sampleHeard, sample: true, src: st.line.src } : lineNow?.heard && lineFresh ? { heard: lineNow.heard, sample: false, src: lineNow.src } : null;
  // 🎧 Coba ejaan (dari kata yang disorot di 👂 Terdengar): hanya mode bank suara
  const [tryWord, setTryWord] = useState<string | null>(null);
  const setLexicon = (lexicon: LexEntry[] | undefined) => {
    if (lexBefore.current === null) lexBefore.current = tlRef.current.voice.lexicon;
    onTimeline?.((t) => ({ ...t, voice: { ...t.voice, lexicon: lexicon?.length ? lexicon : undefined } }));
  };
  const fixWord = (e: LexEntry): string | null => {
    if (!onTimeline) return "Kamus tidak bisa diubah dari sini.";
    const next = upsertLexicon(tlRef.current.voice.lexicon, e);
    if (!next) return "📖 Kamus ejaan sudah penuh (60 kata) — hapus kata yang tidak dipakai dulu di panel Suara VO.";
    if (lexBefore.current === null) lexBefore.current = tlRef.current.voice.lexicon;
    onTimeline((t) => {
      const n2 = upsertLexicon(t.voice.lexicon, e);
      return n2 ? { ...t, voice: { ...t.voice, lexicon: n2.length ? n2 : undefined } } : t;
    });
    return null;
  };

  if (!pay || v.mode === "none") return null;
  const pct = st.s === "job" ? Math.round((job?.progress ?? 0) * 100) : 0;
  const jobNow = st.s === "job" && job?.id === st.id ? job : null;
  const queuedMsg = jobNow?.status === "antri" ? queuedText(estimateQueued(jobNow.lines, jobNow.settings, status?.worker)) : null;
  const stale = st.s === "ready" && st.sig !== sigNow;

  return (
    <div className="space-y-1.5 rounded-xl border border-zinc-800/80 bg-zinc-950/30 px-3 py-2 text-[12px]" data-vo-listen>
      {pay.spell && (
        <p className="break-words text-[11.5px] leading-relaxed text-zinc-400" data-vo-say>
          🗣️ Dibaca mesin: <span className="text-zinc-200">“{pay.spell}”</span>
        </p>
      )}
      {heardSrc && scene.vo?.text && (
        <VoHeard
          key={heardSrc.src}
          text={scene.vo.text}
          heard={heardSrc.heard}
          spell={scene.vo.spell}
          lexicon={v.lexicon}
          sample={heardSrc.sample}
          onFix={onTimeline ? fixWord : undefined}
          onRebuild={onTimeline ? () => listen(true) : undefined}
          rebuildBusy={busy}
          rebuildNote={rebuildNote ?? (engine === "bank" ? null : `Laptop mati — dibuat ulang pakai ${engineName}.`)}
          onTry={v.mode === "bank" ? setTryWord : undefined}
        />
      )}
      {tryWord && v.mode === "bank" && scene.vo?.text && (
        <VoSpellTry key={tryWord} scene={scene} timeline={timeline} word={tryWord} onLexicon={onTimeline ? setLexicon : undefined} onClose={() => setTryWord(null)} />
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {busy ? (
          <>
            <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-zinc-400" role="status" data-vo-listen-progress>
              <span className="h-2 w-2 flex-none animate-pulse rounded-full bg-orange-500" />
              <span className="min-w-0">
                {st.s === "tts"
                  ? "Bikin contoh suara…"
                  : st.s === "start"
                    ? "Menyiapkan antrian…"
                    : job?.status === "proses"
                      ? `${etaText(job.message, "Laptop lagi bikin suara…")}${pct ? ` ${pct}%` : ""}`
                      : (queuedMsg ?? "Menunggu giliran di laptop…")}
              </span>
              {jobNow && <EtaChip job={jobNow} />}
            </span>
            {st.s !== "start" && (
              <button type="button" className="font-semibold text-red-400 hover:text-red-300" onClick={cancel}>
                Batal
              </button>
            )}
          </>
        ) : (
          <>
            <button type="button" className="btn-ghost px-2.5 py-1.5 text-[12px]" onClick={() => listen()} data-vo-listen-btn>
              🔊 {st.s === "ready" ? "Bikin lagi" : "Dengar"}
            </button>
            {st.s === "ready" && (
              <button type="button" className="btn-ghost px-2.5 py-1.5 text-[12px]" onClick={() => (play ? stop() : playSrc(st.line.src))} data-vo-play>
                {play ? "⏹ Stop" : "▶ Putar"}
              </button>
            )}
            {st.s === "ready" && onTimeline && !stale && (
              <button type="button" className="px-1 text-[12px] font-semibold text-emerald-400 hover:text-emerald-300 disabled:text-zinc-500" disabled={st.used} onClick={use} data-vo-use>
                {st.used ? "✅ Dipakai di VO proyek" : "✅ Pakai ini"}
              </button>
            )}
            <span className="min-w-0 text-[11px] text-zinc-500">
              {st.s === "ready"
                ? `${st.label}${st.line.tempo !== undefined ? ` · kecepatan ${fmtTempo(st.line.tempo)}` : st.line.speed ? ` · dipercepat ${st.line.speed}%` : ""}`
                : `Coba 1 kalimat ini · ${engineName}${scene.vo?.tempo !== undefined ? ` · ${fmtTempo(scene.vo.tempo)}` : ""}`}
            </span>
          </>
        )}
      </div>
      {st.s === "job" && !workerOn && status !== null && job?.status !== "proses" && (
        <p className="rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-300">
          Laptop mati — antrian menunggu laptop nyala.{" "}
          <button type="button" className="font-semibold underline" onClick={fallback}>
            Coba pakai cadangan
          </button>
        </p>
      )}
      {stale && <p className="text-[11px] text-amber-400">Naskah / ejaan berubah sejak contoh ini dibuat — klik &quot;Bikin lagi&quot;.</p>}
      {st.s === "ready" && !st.used && !stale && <p className="text-[10.5px] text-zinc-500">Contoh saja — VO proyek belum berubah sampai kamu pilih &quot;Pakai ini&quot;.</p>}
      {st.s === "error" && (
        <div className="space-y-1 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-[11.5px] text-red-300" role="alert">
          <p>{st.msg}</p>
          {st.detail && <p className="break-words text-[10px] text-red-300/70">Detail: {st.detail.slice(0, 200)}</p>}
          {st.fallback && (
            <button type="button" className="font-semibold underline" onClick={fallback}>
              Coba pakai suara cadangan (Edge)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
