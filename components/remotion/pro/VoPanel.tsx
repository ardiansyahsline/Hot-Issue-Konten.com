"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  cancelVoiceJob,
  createVoiceJob,
  EDGE_LABEL,
  friendlyStudioError,
  recallJob,
  rememberJob,
  requestTts,
  useStudioJob,
  useStudioStatus,
  useVoices,
  type StudioVoice,
  type TtsResult,
  type VoiceJob,
  type VoiceJobLine,
} from "@/lib/studio/client";
import { MAX_DUR, MAX_TOTAL, sceneStartSecs, VO_AT, voStartOf, type EdgeVoice, type Scene, type Timeline, type VoiceMode, type VoLine, type VoTrack, type Word } from "@/lib/studio/timeline";
import { storageSrc } from "@/lib/studio/urls";
import { isTeaserScene } from "./teaserLock";

/** lisensi CC-BY-4.0 pocket-tts-indonesian mewajibkan kredit terlihat */
const POCKET_CREDIT = "pocket-tts-indonesian oleh tryzz889 (CC-BY-4.0), berbasis Pocket TTS dari Kyutai";

/**
 * VO mulai di offset adegan (`scene.vo.at`, mis. waktu target naskah teaser) atau bawaan 0,15 dtk (voStartOf);
 * adegan minimal selesai 0,25 dtk setelah VO
 */
const TAIL = 0.25;
const DEF_EXG = 0.65;
const DEF_CFG = 0.35;
const DEFAULT_VOICE = "Alif - Energik";
const NO_SCRIPT = "Belum ada naskah VO di adegan. Minta Harley tuliskan naskahnya dulu.";
const STALE = 'Naskah VO berubah selama suara dibuat, jadi suaranya tidak dipakai. Klik "Generate ulang VO".';

type Run =
  | { s: "idle" }
  | { s: "start" }
  | { s: "tts"; engine: "edge" | "elevenlabs"; done: number; total: number }
  | { s: "job"; id: string }
  | { s: "error"; msg: string; detail?: string; fallback?: boolean };

const fmt = (n: number) => String(Number(n.toFixed(2))).replace(".", ",");
const names = (l: string[]) => (l.length <= 2 ? l.join(" & ") : `${l.slice(0, -1).join(", ")} & ${l[l.length - 1]}`);
const cleanWords = (w: unknown): Word[] =>
  (Array.isArray(w) ? w : [])
    .filter((x): x is Word => !!x && typeof x === "object" && typeof (x as Word).w === "string")
    .map((x) => ({ w: x.w, s: Number(x.s) || 0, e: Number(x.e) || 0 }));
/** naskah VO adegan masih sama dengan yang dikirim ke mesin suara (teks & ejaan) */
const sameVo = (s: Scene | undefined, sent: { text: string; spell?: string | null } | undefined) =>
  !!s?.vo && !!sent && s.vo.text === sent.text && (s.vo.spell || "") === (sent.spell || "");

/** detik VO adegan `s` melewati batas aman adegan (mulai + panjang suara + 0,25 dtk − durasi); ≤ 0 = muat */
const voOverflow = (s: Scene, l: VoLine) => voStartOf(s, l) + l.dur + TAIL - s.dur;

/**
 * perpanjang adegan yang VO-nya lebih panjang (at + dur + 0,25), tetap dalam batas 20 dtk/adegan & 180 dtk total.
 * Adegan premium teaser (layout "teaser") TIDAK pernah diperpanjang: batasnya di grid ketukan 0,6 dtk (beat sync semua
 * adegan sesudahnya), jadi cukup dicatat di `over` (peringatan "VO lebih panjang dari adegan").
 */
export function fitVo(tl: Timeline, vo: VoTrack): { tl: Timeline; grown: string[]; tooLong: string[]; over: string[] } {
  const fps = tl.fps || 30;
  let total = tl.scenes.reduce((a, s) => a + s.dur, 0);
  const grown: string[] = [];
  const tooLong: string[] = [];
  const over: string[] = [];
  let shifted = false;
  const scenes = tl.scenes.map((s, i) => {
    const l = vo.lines.find((x) => x.sceneId === s.id);
    if (!l) return s;
    const need = s.dur + voOverflow(s, l);
    if (need <= s.dur + 1e-3) return s;
    if (isTeaserScene(s)) {
      over.push(s.name);
      return s;
    }
    const want = Math.ceil(Math.min(need, MAX_DUR) * fps) / fps;
    const dur = Math.round(Math.min(want, s.dur + Math.max(0, MAX_TOTAL - total)) * fps) / fps;
    if (need > MAX_DUR + 1e-3 || dur < want) tooLong.push(s.name);
    if (dur <= s.dur) return s;
    total += dur - s.dur;
    grown.push(s.name);
    if (i < tl.scenes.length - 1) shifted = true;
    return { ...s, dur };
  });
  // adegan bergeser -> VO lengkap (.mp3) dari worker tidak sinkron lagi
  return { tl: { ...tl, scenes, vo: shifted && vo.full ? { ...vo, full: null } : vo }, grown, tooLong, over };
}

/**
 * Panel suara VO: pilih suara (bank suara di laptop / cadangan Edge / premium ElevenLabs / tanpa VO),
 * atur ekspresi, lalu bikin VO. Worker mati / gagal -> otomatis pakai cadangan (label "VO sementara").
 */
export default function VoPanel({ timeline: tl, onChange, projectId }: { timeline: Timeline; onChange: (tl: Timeline) => void; projectId: string | null }) {
  const uid = useId();
  const status = useStudioStatus();
  const { voices, loaded, error: voiceErr } = useVoices();
  const ready = useMemo(() => voices.filter((x) => x.status === "siap"), [voices]);
  const pending = voices.filter((x) => x.status === "baru" || x.status === "diproses").length;
  const [run, setRun] = useState<Run>({ s: "idle" });
  const [note, setNote] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const handled = useRef<string | null>(null);
  /** job bank yang dibuat di panel ini selama halaman terbuka (bukan job lama yang diingat dari localStorage) */
  const startedHere = useRef(new Set<string>());
  const tlRef = useRef(tl);
  tlRef.current = tl;
  const voicesRef = useRef(voices);
  voicesRef.current = voices;
  const jobKey = `studio-vo-job:${projectId ?? "baru"}`;

  const v = tl.voice;
  const mode: VoiceMode = v.mode;
  const workerOn = !!status?.worker.online && status.engines.bank;
  const eleven = !!status?.engines.elevenlabs;
  const bankVoice: StudioVoice | null = ready.find((x) => x.id === v.voiceId) ?? ready.find((x) => x.name === DEFAULT_VOICE) ?? ready[0] ?? null;
  const voScenes = tl.scenes.filter((s) => s.vo?.text);
  const busy = run.s === "start" || run.s === "tts" || run.s === "job";
  // adegan teaser yang VO-nya lewat batas adegan (tidak diperpanjang — durasi dikunci di ketukan) -> peringatan tetap terlihat
  const overNow = useMemo(
    () =>
      tl.scenes.flatMap((s) => {
        const l = tl.vo?.lines.find((x) => x.sceneId === s.id);
        const o = l && s.vo?.text && isTeaserScene(s) ? voOverflow(s, l) : 0;
        return o > 1e-3 ? [`${s.name} (+${fmt(o)} dtk)`] : [];
      }),
    [tl.scenes, tl.vo],
  );
  // offset mulai VO per adegan (mis. teaser: waktu target naskah) -> sebutkan contoh yang paling jauh
  const lateVo = voScenes.reduce<Scene | null>((a, s) => (s.vo?.at !== undefined && s.vo.at > (a?.vo?.at ?? VO_AT) + 1e-3 ? s : a), null);

  // ekspresi: digeser lokal, disimpan ke timeline saat dilepas
  const [exg, setExg] = useState(v.exaggeration ?? DEF_EXG);
  const [cfg, setCfg] = useState(v.cfg ?? DEF_CFG);
  useEffect(() => setExg(v.exaggeration ?? DEF_EXG), [v.exaggeration]);
  useEffect(() => setCfg(v.cfg ?? DEF_CFG), [v.cfg]);

  const setVoice = (patch: Partial<Timeline["voice"]>) => onChange({ ...tlRef.current, voice: { ...tlRef.current.voice, ...patch } });

  // lanjutkan memantau job yang masih jalan setelah halaman dimuat ulang / ganti proyek
  useEffect(() => {
    setRun((r) => {
      if (r.s !== "idle" && r.s !== "error") return r;
      const id = recallJob(jobKey);
      return id ? { s: "job", id } : r;
    });
  }, [jobKey]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // ---------------- selesai: tempel VO ke timeline ----------------
  const finish = (t: Timeline, vo: VoTrack, extra: string[] = []) => {
    const r = fitVo({ ...t, vo, muteVo: false }, vo);
    onChange(r.tl);
    const msgs = extra.filter(Boolean);
    if (r.grown.length) msgs.push(`Adegan ${names(r.grown)} diperpanjang otomatis supaya VO-nya muat.`);
    if (r.tooLong.length) msgs.push(`VO adegan ${names(r.tooLong)} masih kepanjangan — pendekkan naskahnya.`);
    if (r.over.length) msgs.push(`⚠️ VO lebih panjang dari adegan ${names(r.over)}. Durasi adegan teaser dikunci di ketukan musik (tidak diperpanjang), jadi suaranya nyambung ke adegan berikutnya — pendekkan naskah atau naikkan Tempo kalau mengganggu.`);
    const miss = r.tl.scenes.filter((s) => s.vo?.text && !vo.lines.some((l) => l.sceneId === s.id)).length;
    if (miss) msgs.push(`${miss} adegan belum ada suaranya — klik "Generate ulang VO".`);
    setNote(msgs.length ? msgs.join(" ") : "✅ VO siap. Putar preview untuk dengar.");
    setRun({ s: "idle" });
  };

  const applyJob = (j: VoiceJob) => {
    const t = tlRef.current;
    const starts = sceneStartSecs(t);
    const at = new Map(t.scenes.map((s, i) => [s.id, i]));
    // naskah yang dikirim: adegan yang naskahnya berubah / dihapus selama job jalan tidak ditempeli suara lama
    const sent = Array.isArray(j.lines) && j.lines.length ? new Map(j.lines.map((l) => [l.scene_id, l])) : null;
    const got = (j.result?.lines ?? []).filter((l) => !!l && typeof l.path === "string" && at.has(l.scene_id));
    const ok = got.filter((l) => !sent || sameVo(t.scenes[at.get(l.scene_id)!], sent.get(l.scene_id)));
    // mulai VO = offset adegan (scene.vo.at) / bawaan — sama dengan `start` yang dikirim ke laptop (VO lengkap .mp3)
    const lines: VoLine[] = ok.map((l) => ({ sceneId: l.scene_id, src: storageSrc(l.path), dur: Math.max(0.05, Number(l.dur) || 0.05), at: voStartOf(t.scenes[at.get(l.scene_id)!]), words: cleanWords(l.words) }));
    if (!lines.length) {
      setRun(got.length ? { s: "error", msg: STALE } : { s: "error", msg: "Mesin suara selesai tapi hasilnya kosong. Coba generate ulang.", fallback: true });
      return;
    }
    // VO lengkap (.mp3) hanya dipakai kalau semua baris yang diminta terpakai & posisi adegannya tidak bergeser
    const fullOk =
      !!sent &&
      ok.length === sent.size &&
      ok.every((l) => Math.abs(Number(l.start ?? sent.get(l.scene_id)?.start) - (starts[at.get(l.scene_id)!] + voStartOf(t.scenes[at.get(l.scene_id)!]))) < 2e-3);
    const name = voicesRef.current.find((x) => x.id === j.voice_id)?.name ?? t.voice.voiceName ?? "Bank suara";
    finish(t, {
      jobId: j.id,
      engine: /pocket/i.test(j.engine_used ?? "") ? "pocket" : "chatterbox",
      temp: false,
      label: `Bank suara · ${name}`,
      lines,
      full: fullOk && j.result?.full_path ? storageSrc(j.result.full_path) : null,
    });
  };

  // ---------------- pantau job suara di laptop ----------------
  const { job, missing } = useStudioJob<VoiceJob>("studio_voice_jobs", run.s === "job" ? run.id : null);
  useEffect(() => {
    if (run.s !== "job") return;
    if (missing) {
      rememberJob(jobKey, null);
      setRun({ s: "idle" });
      return;
    }
    if (!job || job.id !== run.id || handled.current === job.id) return;
    if (job.kind !== "tts" || job.status === "batal") {
      handled.current = job.id;
      rememberJob(jobKey, null);
      setRun({ s: "idle" });
    } else if (job.status === "selesai") {
      handled.current = job.id;
      rememberJob(jobKey, null);
      applyJob(job);
    } else if (job.status === "gagal") {
      handled.current = job.id;
      rememberJob(jobKey, null);
      // job lama (diingat dari localStorage / tab atau perangkat lain) atau suara sudah bukan bank -> jangan timpa VO diam-diam,
      // cukup tampilkan error + tombol cadangan
      if (!startedHere.current.has(job.id) || tlRef.current.voice.mode !== "bank") {
        setRun({ s: "error", msg: "Mesin suara di laptop gagal bikin VO.", detail: job.message ?? undefined, fallback: true });
        return;
      }
      // mesin laptop gagal -> otomatis cadangan Edge (sama seperti saat laptop mati); pesan umum laptop ("…pakai cadangan") tidak diulang
      const why = job.message && !/cadangan/i.test(job.message) ? ` (${job.message.slice(0, 160).replace(/\.$/, "")})` : "";
      void genTts("edge", `Mesin suara laptop gagal bikin VO${why} — sementara pakai suara cadangan (VO sementara). Suara bank bisa dicoba lagi nanti lewat "Generate ulang VO".`);
    }
    // applyJob membaca ref terbaru, cukup dipicu perubahan job
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, missing, run, jobKey]);

  // ---------------- cadangan Edge / premium ElevenLabs (langsung dari website) ----------------
  const genTts = async (engine: "edge" | "elevenlabs", why?: string) => {
    const t0 = tlRef.current;
    const items = t0.scenes.filter((s) => s.vo?.text);
    if (!items.length) return setRun({ s: "error", msg: NO_SCRIPT });
    const edgeVoice: EdgeVoice = t0.voice.edgeVoice ?? "id-ID-ArdiNeural";
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setNote(null);
    setRun({ s: "tts", engine, done: 0, total: items.length });
    const out: VoLine[] = [];
    const results: TtsResult[] = [];
    let fail = 0;
    let lastErr = "";
    let k = 0;
    // 2 adegan sekaligus (layanan cadangan jangan dibanjiri)
    const lane = async () => {
      while (k < items.length && !ctrl.signal.aborted) {
        const s = items[k++];
        try {
          const r = await requestTts({ text: s.vo!.text, spell: s.vo!.spell || undefined, engine, voice: edgeVoice }, ctrl.signal);
          out.push({ sceneId: s.id, src: r.src, dur: r.dur, at: voStartOf(s), words: r.words });
          results.push(r);
        } catch (e) {
          if (ctrl.signal.aborted) return;
          fail++;
          lastErr = e instanceof Error ? e.message : String(e);
        }
        setRun((r) => (r.s === "tts" ? { ...r, done: r.done + 1 } : r));
      }
    };
    await Promise.all([lane(), lane()]);
    if (abortRef.current === ctrl) abortRef.current = null;
    if (ctrl.signal.aborted) return setRun({ s: "idle" });
    if (!out.length) return setRun({ s: "error", msg: lastErr || "Gagal bikin suara. Coba lagi." });
    const t = tlRef.current;
    // naskah adegan diubah selama suara dibuat -> suara lamanya tidak dipakai
    const sent = new Map(items.map((s) => [s.id, s.vo!]));
    const fresh = out.filter((l) => sameVo(t.scenes.find((s) => s.id === l.sceneId), sent.get(l.sceneId)));
    if (!fresh.length) return setRun({ s: "error", msg: STALE });
    const order = new Map(t.scenes.map((s, i) => [s.id, i]));
    fresh.sort((a, b) => (order.get(a.sceneId) ?? 0) - (order.get(b.sceneId) ?? 0));
    const used: "edge" | "elevenlabs" = results.some((r) => r.engine === "edge") ? "edge" : "elevenlabs";
    const label = results.find((r) => r.engine === used)?.label || (used === "edge" ? EDGE_LABEL : "Premium");
    // mode bank tetap bank (nanti tinggal "Generate ulang VO" saat laptop nyala)
    const voice = engine === "elevenlabs" ? { ...t.voice, mode: "elevenlabs" as const } : t.voice.mode === "bank" ? t.voice : { ...t.voice, mode: "edge" as const };
    finish({ ...t, voice }, { jobId: null, engine: used, temp: results.some((r) => r.temp), label, lines: fresh, full: null }, [
      why ?? "",
      engine === "elevenlabs" && used === "edge" ? "Premium sedang tidak bisa dipakai — dipakai suara cadangan." : "",
      fail ? `${fail} adegan gagal dibuat suaranya.` : "",
    ]);
  };

  // ---------------- bank suara lewat mesin di laptop ----------------
  const genBank = async (voice: StudioVoice) => {
    const t0 = tlRef.current;
    const t: Timeline = { ...t0, voice: { ...t0.voice, mode: "bank", voiceId: voice.id, voiceName: voice.name, exaggeration: exg, cfg } };
    const starts = sceneStartSecs(t);
    const lines: VoiceJobLine[] = t.scenes.flatMap((s, i) =>
      s.vo?.text ? [{ id: s.id, scene_id: s.id, text: s.vo.text, spell: s.vo.spell ?? null, start: Math.round((starts[i] + voStartOf(s)) * 1000) / 1000 }] : [],
    );
    if (!lines.length) return setRun({ s: "error", msg: NO_SCRIPT });
    onChange(t);
    setNote(null);
    setRun({ s: "start" });
    try {
      const j = await createVoiceJob({ kind: "tts", project_id: projectId, voice_id: voice.id, engine: "auto", lines, settings: { exaggeration: exg, cfg_weight: cfg, takes: 2 } });
      handled.current = null;
      startedHere.current.add(j.id);
      rememberJob(jobKey, j.id);
      setRun({ s: "job", id: j.id });
    } catch (e) {
      // antrian belum bisa dipakai -> langsung cadangan
      await genTts("edge", `${e instanceof Error ? e.message : friendlyStudioError(e)} Sementara pakai suara cadangan.`);
    }
  };

  const generate = (preferBank = false) => {
    setNote(null);
    if (!voScenes.length) return setRun({ s: "error", msg: NO_SCRIPT });
    const m = preferBank ? "bank" : mode;
    if (m === "bank") {
      if (workerOn && bankVoice) return void genBank(bankVoice);
      return void genTts("edge", !workerOn ? `Mesin suara laptop ${status?.worker.online ? "belum bisa dipakai" : "mati"} — sementara pakai suara cadangan.` : "Belum ada suara siap di bank — sementara pakai suara cadangan.");
    }
    if (m === "elevenlabs") return void genTts(eleven ? "elevenlabs" : "edge", eleven ? undefined : "Premium belum aktif — pakai suara cadangan.");
    return void genTts("edge");
  };

  const cancel = async () => {
    if (run.s === "tts") return abortRef.current?.abort();
    if (run.s !== "job") return;
    handled.current = run.id;
    rememberJob(jobKey, null);
    setRun({ s: "idle" });
    try {
      await cancelVoiceJob(run.id);
    } catch (e) {
      setNote(friendlyStudioError(e));
    }
  };

  /** laptop mati saat antri -> batalkan antrian lalu pakai cadangan */
  const fallbackNow = async () => {
    if (run.s === "job") {
      handled.current = run.id;
      rememberJob(jobKey, null);
      void cancelVoiceJob(run.id).catch(() => {});
    }
    await genTts("edge", "Dipakai suara cadangan dulu (VO sementara).");
  };

  const commitExg = (val: number) => val !== (v.exaggeration ?? DEF_EXG) && setVoice({ exaggeration: val });
  const commitCfg = (val: number) => val !== (v.cfg ?? DEF_CFG) && setVoice({ cfg: val });

  const opt = (id: VoiceMode, title: string, sub: string, children?: ReactNode) => (
    <label key={id} className={`block cursor-pointer rounded-xl border px-3 py-2.5 transition ${mode === id ? "border-orange-500 bg-orange-500/10" : "border-zinc-800 hover:border-zinc-700"} ${busy ? "cursor-not-allowed opacity-80" : ""}`}>
      <div className="flex items-start gap-2.5">
        <input type="radio" name={`vo-${uid}`} className="mt-1 h-4 w-4 flex-none accent-orange-500" checked={mode === id} disabled={busy} onChange={() => setVoice({ mode: id })} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{title}</div>
          <div className="text-[11px] text-zinc-500">{sub}</div>
          {mode === id && children}
        </div>
      </div>
    </label>
  );

  const gpu = status?.worker.gpu;
  const queue = status?.worker.queue ?? 0;
  const jobPct = run.s === "job" ? Math.round((job?.progress ?? 0) * 100) : 0;
  const ttsPct = run.s === "tts" ? Math.round((run.done / Math.max(1, run.total)) * 100) : 0;

  return (
    <div className="card min-w-0 space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="label mb-0">Suara (VO)</div>
        {tl.vo?.lines.length && mode !== "none" ? (
          tl.vo.temp ? <span className="badge bg-amber-500/10 text-amber-400 ring-amber-500/30">VO sementara</span> : <span className="badge bg-emerald-500/10 text-emerald-400 ring-emerald-500/30">VO siap</span>
        ) : null}
      </div>

      <div className="flex items-center gap-2 text-xs text-zinc-400">
        <span className={`h-2 w-2 flex-none rounded-full ${workerOn ? "bg-emerald-400" : "bg-zinc-500"}`} />
        <span>
          {status === null
            ? "Cek mesin suara laptop…"
            : workerOn
              ? `Mesin suara laptop: nyala${gpu ? ` (GPU ${gpu})` : ""}${queue ? ` · ${queue} antrian` : ""}`
              : status.worker.online
                ? "Mesin suara laptop: belum bisa dipakai — pakai cadangan"
                : "Mesin suara laptop: mati — pakai cadangan"}
        </span>
      </div>

      <div className="space-y-2">
        {opt(
          "bank",
          "🎙️ Bank suara",
          "Suara asli dari bank, dibikin di laptop — paling natural",
          <div className="mt-2 space-y-2.5">
            {!loaded ? (
              <p className="text-xs text-zinc-500">Memuat bank suara…</p>
            ) : voiceErr ? (
              <p className="text-xs text-amber-400">{voiceErr}</p>
            ) : !ready.length ? (
              <p className="text-xs text-zinc-400">
                Belum ada suara yang siap{pending ? ` (${pending} masih diproses)` : ""}. Tambah rekaman di tab <b>🎙️ Bank suara</b>.
              </p>
            ) : (
              <select className="input py-2 text-[13px]" value={bankVoice?.id ?? ""} disabled={busy} onChange={(e) => {
                const pick = ready.find((x) => x.id === e.target.value);
                if (pick) setVoice({ voiceId: pick.id, voiceName: pick.name });
              }}>
                {ready.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                    {x.style ? ` — ${x.style}` : ""}
                  </option>
                ))}
              </select>
            )}
            <div>
              <div className="flex justify-between text-xs">
                <span className="font-semibold text-zinc-300">Ekspresi</span>
                <span className="tabular-nums text-zinc-400">{fmt(exg)}</span>
              </div>
              <input
                type="range"
                min={0.25}
                max={1}
                step={0.05}
                value={exg}
                disabled={busy}
                aria-label="Ekspresi"
                className="w-full accent-orange-500"
                onChange={(e) => setExg(Number(e.target.value))}
                onPointerUp={(e) => commitExg(Number(e.currentTarget.value))}
                onKeyUp={(e) => commitExg(Number(e.currentTarget.value))}
                onBlur={(e) => commitExg(Number(e.currentTarget.value))}
              />
              <p className="text-[10px] text-zinc-500">Saran 0,6–0,7. Makin tinggi makin semangat.</p>
            </div>
            <div>
              <div className="flex justify-between text-xs">
                <span className="font-semibold text-zinc-300">Tempo</span>
                <span className="tabular-nums text-zinc-400">{fmt(cfg)}</span>
              </div>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={cfg}
                disabled={busy}
                aria-label="Tempo"
                className="w-full accent-orange-500"
                onChange={(e) => setCfg(Number(e.target.value))}
                onPointerUp={(e) => commitCfg(Number(e.currentTarget.value))}
                onKeyUp={(e) => commitCfg(Number(e.currentTarget.value))}
                onBlur={(e) => commitCfg(Number(e.currentTarget.value))}
              />
              <p className="text-[10px] text-zinc-500">Saran 0,3–0,4. Lebih kecil = bicara lebih santai.</p>
            </div>
            {(exg !== DEF_EXG || cfg !== DEF_CFG) && (
              <button type="button" className="text-[11px] font-semibold text-zinc-500 hover:text-zinc-300" disabled={busy} onClick={() => setVoice({ exaggeration: DEF_EXG, cfg: DEF_CFG })}>
                ↺ Pakai saran
              </button>
            )}
            {!workerOn && status !== null && <p className="text-[11px] text-amber-400">{status.worker.online ? "Mesin suara laptop belum bisa dipakai" : "Laptop mati"} — sementara dibikin pakai suara cadangan.</p>}
          </div>,
        )}
        {opt(
          "edge",
          "🛟 Cadangan Edge (Ardi / Gadis)",
          "Layanan tidak resmi — untuk VO sementara",
          <div className="mt-2 flex gap-2">
            {(
              [
                ["id-ID-ArdiNeural", "Ardi (cowok)"],
                ["id-ID-GadisNeural", "Gadis (cewek)"],
              ] as [EdgeVoice, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                disabled={busy}
                onClick={() => setVoice({ edgeVoice: id })}
                className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-semibold transition ${(v.edgeVoice ?? "id-ID-ArdiNeural") === id ? "border-orange-500 bg-orange-500/15 text-orange-300" : "border-zinc-700 text-zinc-400 hover:border-zinc-600"}`}
              >
                {label}
              </button>
            ))}
          </div>,
        )}
        {(eleven || mode === "elevenlabs") && opt("elevenlabs", "⭐ Premium ElevenLabs", eleven ? "Berbayar, kualitas studio" : "Belum aktif — akan pakai cadangan")}
        {opt("none", "🔇 Tanpa VO", "Musik + SFX + teks saja (subtitle ikut mati)")}
      </div>

      {/* VO yang sudah ada */}
      {tl.vo?.lines.length && mode !== "none" ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 truncate text-zinc-300">{tl.vo.label ?? (tl.vo.temp ? EDGE_LABEL : "VO")}</span>
            <button type="button" className="font-semibold text-zinc-500 hover:text-red-400" disabled={busy} onClick={() => onChange({ ...tlRef.current, vo: null })}>
              Hapus VO
            </button>
          </div>
          <div className="mt-0.5 text-zinc-500">
            {tl.vo.lines.length}/{voScenes.length || tl.vo.lines.length} adegan bersuara
          </div>
          {tl.vo.engine === "pocket" && <div className="mt-0.5 text-zinc-500">Kredit suara: {POCKET_CREDIT}</div>}
          {overNow.length > 0 && (
            <div className="mt-1.5 rounded-lg bg-amber-500/10 px-2.5 py-2 text-amber-300" data-vo-over>
              ⚠️ VO lebih panjang dari adegan: {names(overNow)}. Durasi adegan teaser tidak diubah (dikunci di ketukan musik) — pendekkan naskah atau naikkan Tempo.
            </div>
          )}
          {tl.vo.temp && workerOn && bankVoice && !busy && (
            <div className="mt-2 rounded-lg bg-emerald-500/10 px-2.5 py-2 text-emerald-300">
              Mesin suara laptop sudah nyala. Ganti ke suara asli dari bank biar lebih natural.
              <button type="button" className="mt-1.5 block font-semibold text-emerald-200 underline" onClick={() => generate(true)}>
                🔁 Generate ulang VO pakai {bankVoice.name}
              </button>
            </div>
          )}
        </div>
      ) : null}

      {/* tombol + progres */}
      {mode === "none" ? (
        <p className="text-[11px] text-zinc-500">Video tanpa voice over. Pilih suara di atas kalau mau pakai VO.</p>
      ) : busy ? (
        <div className="space-y-1.5">
          <div className="h-2.5 overflow-hidden rounded-full bg-zinc-800">
            <div className={`h-full rounded-full bg-orange-500 transition-[width] ${run.s === "start" || (run.s === "job" && !jobPct) ? "w-1/12 animate-pulse" : ""}`} style={run.s === "tts" ? { width: `${ttsPct}%` } : run.s === "job" && jobPct ? { width: `${jobPct}%` } : undefined} />
          </div>
          <div className="flex items-center justify-between gap-2 text-xs text-zinc-400">
            <span className="min-w-0">
              {run.s === "start"
                ? "Menyiapkan antrian…"
                : run.s === "tts"
                  ? `Bikin suara ${run.done}/${run.total}…`
                  : job?.status === "proses"
                    ? `${job.message || "Laptop lagi bikin suara…"} ${jobPct ? `${jobPct}%` : ""}`
                    : "Menunggu giliran di laptop…"}
            </span>
            {run.s !== "start" && (
              <button type="button" className="flex-none font-semibold text-red-400 hover:text-red-300" onClick={cancel}>
                Batal
              </button>
            )}
          </div>
          {run.s === "job" && !workerOn && status !== null && job?.status !== "proses" && (
            <div className="rounded-lg bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-300">
              Laptop mati — antrian menunggu laptop nyala.{" "}
              <button type="button" className="font-semibold underline" onClick={fallbackNow}>
                Pakai cadangan sekarang
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          {lateVo?.vo?.at !== undefined && (
            <p className="text-[11px] text-zinc-500" data-vo-offset>
              ⏱️ VO tiap adegan mulai sesuai waktu naskah (mis. {lateVo.name}: {fmt(lateVo.vo.at)} dtk setelah adegan mulai).
            </p>
          )}
          <button type="button" className="btn-primary w-full" disabled={!voScenes.length} onClick={() => generate()}>
            {tl.vo?.lines.length ? "🔁 Generate ulang VO" : "🎙️ Bikin suara VO"}
          </button>
          {!voScenes.length && <p className="text-[11px] text-zinc-500">Belum ada naskah VO — minta Harley tuliskan dulu.</p>}
        </>
      )}

      {run.s === "error" && (
        <div className="space-y-1.5 rounded-lg bg-red-500/10 px-2.5 py-2 text-xs text-red-300">
          <p>{run.msg}</p>
          {run.detail && <p className="break-words text-[10px] text-red-300/70">Detail: {run.detail.slice(0, 200)}</p>}
          {run.fallback && (
            <button type="button" className="font-semibold underline" onClick={() => genTts("edge", "Dipakai suara cadangan (VO sementara).")}>
              Pakai suara cadangan (Edge)
            </button>
          )}
        </div>
      )}
      {note && !busy && <p className="text-[11px] leading-relaxed text-zinc-400">{note}</p>}
    </div>
  );
}
