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
import {
  arrangeVo,
  MAX_DUR,
  MAX_SPEEDUP,
  MAX_TOTAL,
  normTempo,
  sceneStartSecs,
  speedupPct,
  tempoRate,
  VO_AT,
  voClashes,
  voCutoffs,
  voSpeechEnd,
  voStartOf,
  voWindows,
  type EdgeVoice,
  type Scene,
  type Timeline,
  type VoiceMode,
  type VoLine,
  type VoMove,
  type VoTrack,
  type Word,
} from "@/lib/studio/timeline";
import { storageSrc } from "@/lib/studio/urls";
import { teaserVoAt } from "@/lib/studio/teaserLock";
import { DEFAULT_LEXICON, LEX_FROM_MAX, LEX_TO_MAX, MAX_LEXICON, legacySayKey, normLexicon, sameSpeech, voSayKey, voSpeech, type LexEntry } from "@/lib/studio/pronounce";
import { heardFromResult } from "@/lib/studio/heard";
import {
  bankSettings,
  CFG_MAX,
  CFG_MIN,
  EXG_MAX,
  EXG_MIN,
  isTeaserTimeline,
  presetOf,
  TEMP_MAX,
  TEMP_MIN,
  VOICE_PRESETS,
  voicePatch,
  voiceStyle,
  type VoicePreset,
  type VoiceStyle,
} from "@/lib/studio/voiceStyle";
import { isTeaserScene } from "./teaserLock";
import { DEFAULT_DIRECTOR } from "./DirectorPicker";

/** lisensi CC-BY-4.0 pocket-tts-indonesian mewajibkan kredit terlihat */
const POCKET_CREDIT = "pocket-tts-indonesian oleh tryzz889 (CC-BY-4.0), berbasis Pocket TTS dari Kyutai";

/**
 * VO mulai di offset adegan (`scene.vo.at`, mis. waktu target naskah teaser) atau bawaan 0,15 dtk (voStartOf);
 * adegan minimal selesai 0,25 dtk setelah VO
 */
const TAIL = 0.25;
export const DEFAULT_VOICE = "Alif - Energik";
/** naskah VO kosong — ditulis oleh sutradara yang sedang dipakai proyek ini (bawaan Harley) */
const noScript = (who: string) => `Belum ada naskah VO di adegan. Minta ${who} tuliskan naskahnya dulu.`;
const STALE = 'Naskah VO atau kamus ejaan berubah selama suara dibuat, jadi suaranya tidak dipakai. Klik "Generate ulang VO".';

type Run =
  | { s: "idle" }
  | { s: "start" }
  | { s: "tts"; engine: "edge" | "elevenlabs"; done: number; total: number }
  | { s: "job"; id: string }
  | { s: "error"; msg: string; detail?: string; fallback?: boolean };

const fmt = (n: number) => String(Number(n.toFixed(2))).replace(".", ",");
/** 1,1 → "1,1×" */
export const fmtTempo = (f: number) => `${String(Number(f.toFixed(2))).replace(".", ",")}×`;
export const names = (l: string[]) => (l.length <= 2 ? l.join(" & ") : `${l.slice(0, -1).join(", ")} & ${l[l.length - 1]}`);
export const cleanWords = (w: unknown): Word[] =>
  (Array.isArray(w) ? w : [])
    .filter((x): x is Word => !!x && typeof x === "object" && typeof (x as Word).w === "string")
    .map((x) => ({ w: x.w, s: Number(x.s) || 0, e: Number(x.e) || 0 }));
/**
 * naskah VO adegan masih sama dengan yang dikirim ke mesin suara: teks subtitle & teks ucapan AKHIR (ejaan adegan + kamus ejaan
 * proyek + angka jadi kata, voSpeech) — ubah kamus selama suara dibuat → suaranya tidak dipakai (STALE).
 * `bank` = job laptop: teks ucapan versi bank (+ bunyi luncur); job lama (dikirim sebelum ada bunyi luncur) juga diterima.
 */
const sameVo = (s: Scene | undefined, sent: { text: string; spell?: string | null } | undefined, lex: LexEntry[] | undefined, bank = false) =>
  sameSpeech(voSpeech(s?.vo, lex), sent) || (bank && sameSpeech(voSpeech(s?.vo, lex, "bank"), sent));

/** mulai VO adegan untuk VO BARU: offset adegan; proyek teaser lama (tersimpan sebelum ada vo.at) memakai detik naskah shot-nya */
export const sceneVoAt = (s: Scene): number => s.vo?.at ?? (isTeaserScene(s) ? teaserVoAt(s.layout.shot) : undefined) ?? voStartOf(s);
/**
 * detik VO adegan `s` melewati batas aman adegan (mulai + panjang UCAPAN + 0,25 dtk − durasi); ≤ 0 = muat.
 * Ucapan = voSpeechEnd (kata terakhir + 0,12 dtk): hening di ujung file tidak dihitung.
 */
const voOverflow = (s: Scene, l: VoLine) => voStartOf(s, l) + voSpeechEnd(l) + TAIL - s.dur;
/** toleransi ujung adegan untuk "lewat batas" — sama dengan blok VO merah di TimelineEditor (at + ucapan + 0,05 > dur adegan) */
const EDGE = 0.05;
/** detik ucapan VO selesai sesudah adegan habis (negatif = selesai sebelum adegan habis) */
const voPast = (s: Scene, l: VoLine) => voStartOf(s, l) + voSpeechEnd(l) - s.dur;
/** jendela ucapan VO baru per adegan teaser (id adegan → detik): sampai VO adegan berikutnya mulai − 0,1 dtk (voWindows) */
export const teaserWindows = (t: Timeline): Map<string, number> => {
  const w = voWindows(t, sceneVoAt);
  return new Map(t.scenes.flatMap((s, i) => (isTeaserScene(s) && w[i] !== null ? [[s.id, w[i] as number] as const] : [])));
};
/**
 * Minta ulang suara Edge lebih cepat sampai ucapannya (voSpeechEnd) muat di `win` detik: rate "+N%" dari speedupPct
 * (N = ceil((ucapan/jendela − 1)·100) + 3, maks 30%), paling banyak 3× minta ulang. `again(rate)` null = gagal → pakai versi terakhir.
 * Di 30% masih belum muat → versi 30% dipakai (peringatan tetap muncul dari voClashes / teaserVoFit).
 */
export async function speedUpToFit<R extends Pick<VoLine, "dur" | "words">>(first: R, win: number, again: (rate: string) => Promise<R | null>): Promise<{ r: R; speed: number }> {
  let r = first;
  let speed = 0;
  for (let k = 0; k < 3 && speed < MAX_SPEEDUP; k++) {
    const pct = speedupPct(voSpeechEnd(r), win, speed);
    if (pct <= speed) break;
    const r2 = await again(`+${pct}%`);
    if (!r2) break;
    r = r2;
    speed = pct;
  }
  return { r, speed };
}

/**
 * ringkasan VO yang dipercepat otomatis: "3 kalimat dipercepat ±12–25%" + adegan yang sudah mentok 30% tapi masih belum muat.
 * Baris yang kecepatannya diatur sendiri (VoLine.tempo) tidak dihitung.
 */
export function speedInfo(t: Timeline): { text: string | null; maxed: string[] } {
  const lines = (t.vo?.lines ?? []).filter((l) => (l.speed ?? 0) > 0 && l.tempo === undefined && t.scenes.some((s) => s.id === l.sceneId && s.vo?.text));
  if (!lines.length) return { text: null, maxed: [] };
  const pcts = lines.map((l) => l.speed as number);
  const lo = Math.min(...pcts);
  const hi = Math.max(...pcts);
  const w = teaserWindows(t);
  const maxed = lines
    .filter((l) => (l.speed ?? 0) >= MAX_SPEEDUP && voSpeechEnd(l) > (w.get(l.sceneId) ?? Infinity) + 1e-3)
    .map((l) => t.scenes.find((s) => s.id === l.sceneId)?.name ?? "");
  return { text: `${lines.length} kalimat dipercepat ±${lo === hi ? lo : `${lo}–${hi}`}% supaya pas ketukan musik`, maxed: maxed.filter(Boolean) };
}
/** adegan teaser: "lewat" = suara keluar dari adegan (ambang TimelineEditor), "mepet" = muat tapi jeda < 0,25 dtk, "muat" */
export const teaserVoFit = (s: Scene, l: VoLine): "lewat" | "mepet" | "muat" => {
  const p = voPast(s, l);
  return p + EDGE > 1e-6 ? "lewat" : p + TAIL > 1e-3 ? "mepet" : "muat";
};
/** VO yang ucapannya masih bunyi saat VO adegan berikutnya mulai: id adegan pemilik + label "Reveal → Dashboard (0,9 dtk)" */
export type VoClash = { id: string; label: string };
export const voClashList = (tl: Timeline): VoClash[] =>
  voClashes(tl).map((c) => ({ id: tl.scenes[c.scene].id, label: `${tl.scenes[c.scene].name} → ${tl.scenes[c.next].name} (${fmt(Math.max(0.01, c.sec))} dtk)` }));
/** VO yang ucapannya belum selesai saat video habis (voCutoffs): id adegan + label "Outro (0,5 dtk)" = detik ucapan yang terpotong */
export const voCutList = (tl: Timeline): VoClash[] =>
  voCutoffs(tl).map((c) => ({ id: tl.scenes[c.scene].id, label: `${tl.scenes[c.scene].name} (${fmt(Math.max(0.01, c.sec))} dtk)` }));
/**
 * kalimat peringatan VO adegan teaser yang lebih panjang dari adegannya tapi tidak menabrak VO lain & tidak terpotong:
 * `next` = ujung suaranya nyambung ke awal adegan berikutnya, `tail` = adegan terakhir, ujung suaranya masuk ekor hening akhir video
 */
export const overText = (next: string[], tail: string[]): string =>
  [
    next.length
      ? `⚠️ VO lebih panjang dari adegan: ${names(next)}. Durasi adegan teaser tidak diubah (dikunci di ketukan musik), jadi ujung suaranya nyambung ke awal adegan berikutnya — tidak menabrak VO lain.`
      : "",
    tail.length
      ? `⚠️ VO adegan terakhir lebih panjang dari adegannya: ${names(tail)}. Durasi adegan teaser tidak diubah (dikunci di ketukan musik), jadi ujung suaranya masuk ke ekor hening di akhir video — tidak terpotong.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
/** saran mengatur sendiri di timeline (geser blok VO / atur kecepatan per kalimat) */
const TL_TIP = "Atau atur sendiri di Timeline: klik blok VO lalu geser mulainya / pilih kecepatan kalimat itu.";
/**
 * saran untuk VO yang menabrak / terpotong di akhir video: sudah dipercepat & disusun (mentok) / suara premium (tidak bisa
 * dipercepat) / adegan biasa / VO lama (generate ulang) — plus saran mengatur sendiri di timeline
 */
export function clashTip(tl: Timeline, ids: string[], what: "menabrak" | "terpotong" = "menabrak"): string {
  const lines = (tl.vo?.lines ?? []).filter((l) => ids.includes(l.sceneId));
  if (lines.some((l) => l.tempo !== undefined))
    return `Kecepatan kalimat itu diatur sendiri — pilih yang lebih cepat di Timeline (klik blok VO), geser mulainya, atau pendekkan teks VO-nya.`;
  if (lines.some((l) => (l.speed ?? 0) > 0))
    return `Suaranya sudah dipercepat otomatis (maks ${MAX_SPEEDUP}%) dan disusun ulang tapi masih belum muat — pendekkan teks VO adegan itu, atau coba suara lain. ${TL_TIP}`;
  if (tl.vo?.engine === "elevenlabs") return `Suara premium tidak bisa dipercepat otomatis — pendekkan teks VO adegan itu lalu generate ulang. ${TL_TIP}`;
  if (!tl.scenes.some((s) => ids.includes(s.id) && isTeaserScene(s))) return `Pendekkan teks VO adegan itu atau tambah durasi adegannya, lalu generate ulang. ${TL_TIP}`;
  return `Klik "Generate ulang VO": jeda dipadatkan & VO adegan teaser dipercepat otomatis (maks ${MAX_SPEEDUP}%) supaya pas ketukan musik. Kalau masih ${what}, pendekkan teks VO adegan itu. ${TL_TIP}`;
}

/** "Reveal mulai 0,2 dtk lebih lambat, Hook 0,1 dtk lebih awal" */
export function movedText(tl: Pick<Timeline, "scenes">, moved: VoMove[]): string {
  return moved
    .map((m) => {
      const d = m.to - m.from;
      return `${tl.scenes[m.scene]?.name ?? "VO"} mulai ${fmt(Math.max(0.01, Math.abs(d)))} dtk lebih ${d > 0 ? "lambat" : "awal"}`;
    })
    .join(", ");
}

/**
 * perpanjang adegan yang ucapan VO-nya lebih panjang (at + ucapan asli + 0,25 — hening di ujung file tidak dihitung), tetap dalam batas
 * 20 dtk/adegan & 180 dtk total. Lalu VO yang masih numpuk / terpotong di akhir video disusun otomatis (arrangeVo: mulai VO digeser
 * sesedikit mungkin di dalam adegannya) — `moved` = VO yang digeser; `clash` / `cut` = yang tetap tidak muat sesudahnya.
 * Adegan premium teaser (layout "teaser") TIDAK pernah diperpanjang: batasnya di grid ketukan 0,6 dtk (beat sync semua
 * adegan sesudahnya), jadi cukup dicatat: `over` (suara keluar dari adegan, ambang sama dengan TimelineEditor), `tight` (muat tapi
 * jeda ke akhir adegan < 0,25 dtk), `clash` (masih bunyi saat VO adegan berikutnya mulai → dua suara bersamaan), dan `cut`
 * (ucapan belum selesai saat video habis → ujung kalimat terpotong, mis. Outro teaser yang tetap kepanjangan walau dipercepat 30%).
 */
export function fitVo(
  tl: Timeline,
  vo: VoTrack,
): { tl: Timeline; grown: string[]; tooLong: string[]; over: string[]; tight: string[]; clash: VoClash[]; cut: VoClash[]; moved: VoMove[]; before: number; after: number } {
  const fps = tl.fps || 30;
  let total = tl.scenes.reduce((a, s) => a + s.dur, 0);
  const grown: string[] = [];
  const tooLong: string[] = [];
  const over: string[] = [];
  const tight: string[] = [];
  let shifted = false;
  const scenes = tl.scenes.map((s, i) => {
    const l = vo.lines.find((x) => x.sceneId === s.id);
    if (!l) return s;
    if (isTeaserScene(s)) {
      const f = teaserVoFit(s, l);
      if (f === "lewat") over.push(s.name);
      else if (f === "mepet") tight.push(s.name);
      return s;
    }
    const need = s.dur + voOverflow(s, l);
    if (need <= s.dur + 1e-3) return s;
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
  const grownTl: Timeline = { ...tl, scenes, vo: shifted && vo.full ? { ...vo, full: null } : vo };
  // langkah terakhir anti-numpuk: susun mulai VO (setelah jeda dipadatkan & dipercepat maks 30% di mesin suara)
  const { tl: out, moved, before, after } = arrangeVo(grownTl);
  // catatan lewat / mepet dihitung ulang dari posisi baru
  const over2 = over.length || tight.length ? out.scenes.filter((s) => isTeaserScene(s) && vo.lines.some((l) => l.sceneId === s.id)) : [];
  const fit2 = new Map(over2.map((s) => [s.name, teaserVoFit(s, out.vo!.lines.find((l) => l.sceneId === s.id)!)] as const));
  return {
    tl: out,
    grown,
    tooLong,
    over: moved.length ? [...fit2].filter(([, f]) => f === "lewat").map(([n]) => n) : over,
    tight: moved.length ? [...fit2].filter(([, f]) => f === "mepet").map(([n]) => n) : tight,
    clash: voClashList(out),
    cut: voCutList(out),
    moved,
    before,
    after,
  };
}

/**
 * Panel suara VO: pilih suara (bank suara di laptop / cadangan Edge / premium ElevenLabs / tanpa VO),
 * atur ekspresi, lalu bikin VO. Worker mati / gagal -> otomatis pakai cadangan (label "VO sementara").
 */
export default function VoPanel({
  timeline: tl,
  onChange,
  projectId,
  director,
}: {
  timeline: Timeline;
  onChange: (tl: Timeline) => void;
  projectId: string | null;
  /** nama sutradara aktif (activeDirector di DirectorPicker); kosong = Harley */
  director?: string;
}) {
  const who = director?.trim() || DEFAULT_DIRECTOR;
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
  // adegan teaser yang VO-nya lewat / mepet batas adegan (tidak diperpanjang — durasi dikunci di ketukan) & VO yang menabrak
  // VO adegan berikutnya -> peringatan tetap terlihat
  // VO yang terpotong di akhir video -> peringatan merah tersendiri
  const { overNow, tightNow, clashNow, clashSec, clashHint, cutNow, cutHint, fast, arranged, tempos } = useMemo(() => {
    const clashNow = voClashList(tl);
    const cutNow = voCutList(tl);
    const overNext: string[] = [];
    const overTail: string[] = [];
    const tightNow: string[] = [];
    tl.scenes.forEach((s, i) => {
      const l = tl.vo?.lines.find((x) => x.sceneId === s.id);
      if (!l?.src || !s.vo?.text || !isTeaserScene(s)) return;
      const f = teaserVoFit(s, l);
      const p = voPast(s, l);
      // sudah masuk peringatan "menabrak" / "terpotong"
      if (f === "lewat" && (clashNow.some((c) => c.id === s.id) || cutNow.some((c) => c.id === s.id))) return;
      if (f === "lewat") (i === tl.scenes.length - 1 ? overTail : overNext).push(p > 5e-3 ? `${s.name} (+${fmt(p)} dtk)` : `${s.name} (pas di ujung)`);
      else if (f === "mepet") tightNow.push(`${s.name} (sisa ${fmt(Math.max(0, -p))} dtk)`);
    });
    return {
      overNow: overText(overNext, overTail),
      tightNow,
      clashNow: clashNow.map((c) => c.label),
      // total detik dua suara bersamaan (semua pasangan)
      clashSec: voClashes(tl).reduce((a, c) => a + c.sec, 0),
      clashHint: clashNow.length ? clashTip(tl, clashNow.map((c) => c.id)) : "",
      cutNow: cutNow.map((c) => c.label),
      cutHint: cutNow.length ? clashTip(tl, cutNow.map((c) => c.id), "terpotong") : "",
      fast: speedInfo(tl),
      // VO numpuk / terpotong yang masih bisa dirapikan dengan menggeser mulainya (tombol 🪄 Susun otomatis)
      arranged: clashNow.length || cutNow.length ? arrangeVo(tl) : null,
      // kalimat yang kecepatannya diatur sendiri di timeline
      tempos: (tl.vo?.lines ?? []).flatMap((l) => {
        const sc = tl.scenes.find((x) => x.id === l.sceneId);
        return l.tempo !== undefined && sc?.vo?.text ? [`${sc.name} ${fmtTempo(l.tempo)}`] : [];
      }),
    };
  }, [tl]);
  /** 🪄 Susun otomatis: geser mulai VO yang numpuk sesedikit mungkin (arrangeVo), laporkan jujur yang tetap tidak muat */
  const arrangeNow = () => {
    const r = arrangeVo(tlRef.current);
    if (!r.moved.length) return;
    onChange(r.tl);
    setNote(
      `🪄 Disusun otomatis: ${movedText(r.tl, r.moved)}.${r.after > 1e-3 ? ` Suara numpuk berkurang ${fmt(r.before)} → ${fmt(r.after)} dtk — sisanya lihat peringatan merah.` : " Sekarang tidak ada suara yang numpuk."}`,
    );
  };
  // VO yang dibuat dari naskah / ejaan lama: kunci teks ucapan saat dibuat (VoLine.say) beda dengan naskah + kamus ejaan sekarang.
  // Baris tanpa `say` (dibuat sebelum ada kamus ejaan): mesin dulu menerima ejaan / teks apa adanya → dianggap lama kalau teks ucapan
  // sekarang berbeda (kamus / angka / ejaan teaser baru mengubahnya; ejaan teaser yang di-upgrade diberi kunci lama saat dimuat)
  const oldSay = useMemo(
    () =>
      (tl.vo?.lines ?? []).flatMap((l) => {
        const s = tl.scenes.find((x) => x.id === l.sceneId);
        if (!l.src || !s?.vo?.text) return [];
        const made = l.say || legacySayKey(s.vo.text, s.vo.spell);
        return made !== voSayKey(s.vo, tl.voice.lexicon) ? [s.name] : [];
      }),
    [tl],
  );
  // offset mulai VO per adegan (mis. teaser: waktu target naskah) -> sebutkan contoh yang paling jauh
  const lateVo = voScenes.reduce<Scene | null>((a, s) => (s.vo?.at !== undefined && s.vo.at > (a?.vo?.at ?? VO_AT) + 1e-3 ? s : a), null);

  // gaya bicara bank suara: preset (Natural / Promo / Tenang) atau Kustom (slider digeser lokal, disimpan saat dilepas)
  const teaser = isTeaserTimeline(tl);
  const style = voiceStyle(v, teaser);
  const [exg, setExg] = useState(style.exaggeration);
  const [cfg, setCfg] = useState(style.cfg);
  const [temp, setTemp] = useState(style.temperature);
  useEffect(() => setExg(style.exaggeration), [style.exaggeration]);
  useEffect(() => setCfg(style.cfg), [style.cfg]);
  useEffect(() => setTemp(style.temperature), [style.temperature]);

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
    if (r.moved.length)
      msgs.push(
        r.after > 1e-3
          ? `🪄 Mulai VO digeser supaya numpuknya berkurang (${fmt(r.before)} → ${fmt(r.after)} dtk): ${movedText(r.tl, r.moved)}.`
          : `🪄 Disusun otomatis supaya suara tidak numpuk: ${movedText(r.tl, r.moved)}.`,
      );
    if (r.clash.length)
      msgs.push(
        `⛔ VO tetap menabrak VO adegan berikutnya${r.moved.length ? " walau sudah disusun ulang" : ""}: ${names(r.clash.map((c) => c.label))} — dua suara bunyi bersamaan (durasi adegan teaser dikunci di ketukan musik). ${clashTip(r.tl, r.clash.map((c) => c.id))}`,
      );
    if (r.cut.length)
      msgs.push(`⛔ Ujung VO terpotong di akhir video: ${names(r.cut.map((c) => c.label))} — videonya habis sebelum kalimatnya selesai, jadi kata terakhir tidak terdengar. ${clashTip(r.tl, r.cut.map((c) => c.id), "terpotong")}`);
    const last = r.tl.scenes.length - 1;
    const overOnly = r.tl.scenes
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => r.over.includes(s.name) && !r.clash.some((c) => c.id === s.id) && !r.cut.some((c) => c.id === s.id));
    const overMsg = overText(overOnly.filter((x) => x.i !== last).map((x) => x.s.name), overOnly.filter((x) => x.i === last).map((x) => x.s.name));
    if (overMsg) msgs.push(overMsg);
    if (r.tight.length) msgs.push(`VO adegan ${names(r.tight)} mepet di ujung adegan (jeda < 0,25 dtk sebelum pindah adegan) — masih muat, tapi napasnya pendek.`);
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
    const lex = t.voice.lexicon;
    const ok = got.filter((l) => !sent || sameVo(t.scenes[at.get(l.scene_id)!], sent.get(l.scene_id), lex, true));
    // kecepatan diatur sendiri tapi laptop belum mengenal `speed` (belum git pull) → suaranya kecepatan normal, dilaporkan jujur
    const oldWorker = ok.some((l) => sent?.get(l.scene_id)?.speed !== undefined && normTempo(l.tempo) === undefined);
    // mulai VO = offset adegan (scene.vo.at) / bawaan — sama dengan `start` yang dikirim ke laptop (VO lengkap .mp3)
    const lines: VoLine[] = ok.map((l) => {
      const tempo = normTempo(l.tempo);
      const speed = tempo === undefined ? Math.round(Number(l.speed) || 0) : 0;
      const sc = t.scenes[at.get(l.scene_id)!];
      // `say` hanya kalau naskah yang dikirim diketahui (job lama tanpa `lines` → tidak tahu teks ucapannya)
      const say = sent ? voSayKey(sc.vo, lex) : "";
      // teks yang terdengar oleh pengecek ucapan di laptop (untuk sorot salah dengar di kartu adegan)
      const heard = heardFromResult(l);
      return {
        sceneId: l.scene_id,
        src: storageSrc(l.path),
        dur: Math.max(0.05, Number(l.dur) || 0.05),
        at: sceneVoAt(sc),
        words: cleanWords(l.words),
        ...(speed > 0 ? { speed } : {}),
        ...(tempo !== undefined ? { tempo } : {}),
        ...(say ? { say } : {}),
        ...(heard ? { heard } : {}),
      };
    });
    if (!lines.length) {
      setRun(got.length ? { s: "error", msg: STALE } : { s: "error", msg: "Mesin suara selesai tapi hasilnya kosong. Coba generate ulang.", fallback: true });
      return;
    }
    // VO lengkap (.mp3) hanya dipakai kalau semua baris yang diminta terpakai & posisi adegannya tidak bergeser
    const fullOk =
      !!sent &&
      ok.length === sent.size &&
      ok.every((l) => Math.abs(Number(l.start ?? sent.get(l.scene_id)?.start) - (starts[at.get(l.scene_id)!] + sceneVoAt(t.scenes[at.get(l.scene_id)!]))) < 2e-3);
    const name = voicesRef.current.find((x) => x.id === j.voice_id)?.name ?? t.voice.voiceName ?? "Bank suara";
    const squeezed = ok.filter((l) => (Number(l.squeeze) || 0) > 0.005).length;
    finish(
      t,
      {
        jobId: j.id,
        engine: /pocket/i.test(j.engine_used ?? "") ? "pocket" : "chatterbox",
        temp: false,
        label: `Bank suara · ${name}`,
        lines,
        full: fullOk && j.result?.full_path ? storageSrc(j.result.full_path) : null,
      },
      [
        squeezed ? `✂️ Jeda di dalam ${squeezed} kalimat dipadatkan dulu supaya pas tanpa mempercepat suara terlalu banyak.` : "",
        oldWorker ? "⚠️ Mesin suara di laptop versi lama belum bisa mengatur kecepatan per kalimat — suaranya kecepatan normal. Jalankan git pull di laptop lalu buat ulang." : "",
      ],
    );
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
    if (!items.length) return setRun({ s: "error", msg: noScript(who) });
    const edgeVoice: EdgeVoice = t0.voice.edgeVoice ?? "id-ID-ArdiNeural";
    // teks ucapan akhir per adegan (ejaan adegan + kamus ejaan + angka jadi kata); subtitle tetap vo.text
    const lex0 = t0.voice.lexicon;
    const sent = new Map(items.map((s) => [s.id, voSpeech(s.vo, lex0)!]));
    // adegan teaser (durasi dikunci di ketukan): jendela ucapan sampai VO adegan berikutnya mulai − 0,1 dtk
    const wins = teaserWindows(t0);
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
          const p = sent.get(s.id)!;
          const req = { text: p.text, spell: p.spell ?? undefined, voice: edgeVoice };
          // kecepatan diatur sendiri (scene.vo.tempo) → rate Edge persis itu, tanpa percepat otomatis
          const tempo = s.vo?.tempo;
          const first = await requestTts({ ...req, engine, ...(tempo !== undefined ? { rate: tempoRate(tempo) } : {}) }, ctrl.signal);
          // Edge: ucapan lebih panjang dari jendela adegan teaser → minta ulang lebih cepat (rate "+N%", maks 30%).
          // Premium (ElevenLabs) tidak punya pengatur tempo → tidak dipercepat. Gagal minta ulang → pakai versi terakhir yang ada.
          const win = first.engine === "edge" && tempo === undefined ? wins.get(s.id) : undefined;
          const { r, speed } =
            win === undefined
              ? { r: first, speed: 0 }
              : await speedUpToFit(first, win, async (rate) => {
                  try {
                    const r2 = await requestTts({ ...req, engine: "edge", rate }, ctrl.signal);
                    return r2.engine === "edge" ? r2 : null;
                  } catch {
                    return null;
                  }
                });
          if (ctrl.signal.aborted) return;
          out.push({
            sceneId: s.id,
            src: r.src,
            dur: r.dur,
            at: sceneVoAt(s),
            words: r.words,
            ...(speed > 0 ? { speed } : {}),
            ...(tempo !== undefined && r.engine === "edge" ? { tempo } : {}),
            say: voSayKey(s.vo, lex0),
          });
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
    // naskah adegan / kamus ejaan diubah selama suara dibuat -> suara lamanya tidak dipakai
    const fresh = out.filter((l) => sameVo(t.scenes.find((s) => s.id === l.sceneId), sent.get(l.sceneId), t.voice.lexicon));
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
    const t: Timeline = { ...t0, voice: { ...t0.voice, mode: "bank", voiceId: voice.id, voiceName: voice.name } };
    const starts = sceneStartSecs(t);
    // adegan teaser: `max` = jendela ucapan (detik) → laptop mempercepat suara yang lebih panjang (atempo, maks 1,3×, nada tetap)
    const wins = teaserWindows(t);
    // `spell` = teks ucapan akhir versi bank (ejaan adegan + kamus ejaan + angka jadi kata + bunyi luncur "sowal") → laptop lama
    // pun langsung memakai ejaan baru. Kecepatan diatur sendiri (scene.vo.tempo) → `speed` (atempo persis, `max` tidak dikirim)
    const lines: VoiceJobLine[] = t.scenes.flatMap((s, i) => {
      const p = voSpeech(s.vo, t.voice.lexicon, "bank");
      if (!p) return [];
      const max = wins.get(s.id);
      const tempo = s.vo?.tempo;
      return [
        {
          id: s.id,
          scene_id: s.id,
          text: p.text,
          spell: p.spell,
          start: Math.round((starts[i] + sceneVoAt(s)) * 1000) / 1000,
          ...(tempo !== undefined ? { speed: tempo } : max !== undefined ? { max } : {}),
        },
      ];
    });
    if (!lines.length) return setRun({ s: "error", msg: noScript(who) });
    onChange(t);
    setNote(null);
    setRun({ s: "start" });
    try {
      // gaya bicara (preset / kustom) → ekspresi, tempo, variasi + 3 versi per potongan (dipilih yang paling jelas & natural)
      const j = await createVoiceJob({ kind: "tts", project_id: projectId, voice_id: voice.id, engine: "auto", lines, settings: bankSettings(t) });
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
    if (!voScenes.length) return setRun({ s: "error", msg: noScript(who) });
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

  /** pilih gaya bicara: preset = angkanya; Kustom = angka yang sedang dipakai (lalu bisa digeser) */
  const pickStyle = (id: VoicePreset) => {
    if (id === style.preset) return;
    const next: VoiceStyle = id === "kustom" ? { ...style, preset: "kustom" } : { preset: id, exaggeration: presetOf(id).exaggeration, cfg: presetOf(id).cfg, temperature: presetOf(id).temperature };
    setVoice(voicePatch(next));
  };
  /** slider Kustom dilepas → simpan (preset jadi Kustom) */
  const commitKnob = (patch: Partial<Pick<VoiceStyle, "exaggeration" | "cfg" | "temperature">>) => {
    const next: VoiceStyle = { preset: "kustom", exaggeration: exg, cfg, temperature: temp, ...patch };
    if (style.preset === "kustom" && next.exaggeration === style.exaggeration && next.cfg === style.cfg && next.temperature === style.temperature) return;
    setVoice(voicePatch(next));
  };

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
            <div data-vo-style>
              <div className="text-xs font-semibold text-zinc-300">🗣️ Gaya bicara</div>
              <div role="radiogroup" aria-label="Gaya bicara" className="mt-1.5 grid grid-cols-2 gap-1.5">
                {[...VOICE_PRESETS.map((p) => ({ id: p.id as VoicePreset, label: p.label })), { id: "kustom" as VoicePreset, label: "Kustom" }].map((o) => {
                  const on = style.preset === o.id;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      disabled={busy}
                      onClick={() => pickStyle(o.id)}
                      className={`min-h-[36px] rounded-lg border px-2 py-1.5 text-left text-[12px] font-semibold leading-tight transition ${on ? "border-orange-500 bg-orange-500/15 text-orange-300" : "border-zinc-700 text-zinc-400 hover:border-zinc-600"}`}
                      data-vo-style-opt={o.id}
                    >
                      {o.label}
                      {o.id === (teaser ? "promo" : "natural") && <span className="block text-[10px] font-normal text-zinc-500">saran{teaser ? " untuk teaser" : ""}</span>}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-[10.5px] leading-relaxed text-zinc-500" data-vo-style-hint>
                {style.preset === "kustom"
                  ? "Atur sendiri ekspresi, tempo & variasi di bawah."
                  : `${presetOf(style.preset).hint} Ekspresi ${fmt(style.exaggeration)} · tempo ${fmt(style.cfg)} · variasi ${fmt(style.temperature)}.`}
              </p>
            </div>
            {style.preset === "kustom" &&
              (
                [
                  ["Ekspresi", exg, setExg, "exaggeration", EXG_MIN, EXG_MAX, "Makin tinggi makin semangat (dan sedikit lebih cepat)."],
                  ["Tempo", cfg, setCfg, "cfg", CFG_MIN, CFG_MAX, "Makin tinggi bicara makin cepat & rapat; makin kecil makin santai."],
                  ["Variasi", temp, setTemp, "temperature", TEMP_MIN, TEMP_MAX, "Makin tinggi intonasi makin hidup; terlalu tinggi bisa ngaco."],
                ] as const
              ).map(([label, val, set, key, min, max, tip]) => (
                <div key={key} data-vo-knob={key}>
                  <div className="flex justify-between text-xs">
                    <span className="font-semibold text-zinc-300">{label}</span>
                    <span className="tabular-nums text-zinc-400">{fmt(val)}</span>
                  </div>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={0.05}
                    value={val}
                    disabled={busy}
                    aria-label={label}
                    className="w-full accent-orange-500"
                    onChange={(e) => set(Number(e.target.value))}
                    onPointerUp={(e) => commitKnob({ [key]: Number(e.currentTarget.value) })}
                    onKeyUp={(e) => commitKnob({ [key]: Number(e.currentTarget.value) })}
                    onBlur={(e) => commitKnob({ [key]: Number(e.currentTarget.value) })}
                  />
                  <p className="text-[10px] text-zinc-500">{tip}</p>
                </div>
              ))}
            <p className="text-[10.5px] leading-relaxed text-zinc-500" data-vo-ref-tip>
              💡 Masih kedengeran datar? Rekam ulang suara referensi 10–20 dtk dengan gaya yang sama dengan videonya — tips di tab <b>🎙️ Bank suara</b>.
            </p>
            <p className="text-[10.5px] leading-relaxed text-zinc-500" data-vo-takes-tip>
              ⏱️ Laptop membuat 3 versi tiap kalimat lalu memilih yang paling jelas &amp; natural — bisa ±1,5× lebih lama dari dulu.
            </p>
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

      {mode !== "none" && <LexiconEditor value={v.lexicon} disabled={busy} onChange={(lexicon) => setVoice({ lexicon: lexicon.length ? lexicon : undefined })} />}

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
          {fast.text && (
            <div className="mt-1.5 rounded-lg bg-sky-500/10 px-2.5 py-2 text-sky-300" data-vo-fast>
              ⏩ {fast.text}.{fast.maxed.length > 0 && ` ${names(fast.maxed)} sudah dipercepat maksimal ${MAX_SPEEDUP}% tapi masih agak panjang.`}
            </div>
          )}
          {tempos.length > 0 && (
            <div className="mt-1.5 text-zinc-400" data-vo-tempos>
              🎚️ Kecepatan diatur sendiri: {names(tempos)}
            </div>
          )}
          {clashNow.length > 0 && (
            <div className="mt-1.5 rounded-lg bg-red-500/10 px-2.5 py-2 text-red-300" data-vo-clash role="alert">
              ⛔ VO menabrak VO adegan berikutnya{clashNow.length > 1 ? ` (total ${fmt(Math.max(0.01, clashSec))} dtk)` : ""}: {names(clashNow)} — dua suara bunyi bersamaan (durasi adegan teaser dikunci di ketukan musik). {clashHint}
            </div>
          )}
          {cutNow.length > 0 && (
            <div className="mt-1.5 rounded-lg bg-red-500/10 px-2.5 py-2 text-red-300" data-vo-cut role="alert">
              ⛔ Ujung VO terpotong di akhir video: {names(cutNow)} — videonya habis sebelum kalimatnya selesai, jadi kata terakhir tidak terdengar. {cutHint}
            </div>
          )}
          {arranged && arranged.moved.length > 0 && !busy && (
            <button type="button" className="mt-1.5 block text-[12px] font-semibold text-orange-400 hover:text-orange-300" onClick={arrangeNow} data-vo-arrange>
              🪄 Susun otomatis (geser mulai VO supaya tidak numpuk)
            </button>
          )}
          {overNow && (
            <div className="mt-1.5 rounded-lg bg-amber-500/10 px-2.5 py-2 text-amber-300" data-vo-over>
              {overNow}
            </div>
          )}
          {oldSay.length > 0 && !busy && (
            <div className="mt-1.5 rounded-lg bg-amber-500/10 px-2.5 py-2 text-amber-300" data-vo-oldsay>
              📖 Naskah / ejaan {names(oldSay)} berubah sejak VO dibuat — suaranya masih versi lama. Klik &quot;Generate ulang VO&quot; supaya ikut berubah.
            </div>
          )}
          {tightNow.length > 0 && (
            <div className="mt-1.5 rounded-lg bg-zinc-800/60 px-2.5 py-2 text-zinc-300" data-vo-tight>
              VO mepet di ujung adegan: {names(tightNow)} — masih muat, tapi jeda sebelum pindah adegan kurang dari 0,25 dtk.
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
          {!voScenes.length && <p className="text-[11px] text-zinc-500">Belum ada naskah VO — minta {who} tuliskan dulu.</p>}
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

// ---------------------------------------------------------------------------------------------
// 📖 Kamus ejaan proyek (timeline.voice.lexicon)
// ---------------------------------------------------------------------------------------------
type LexRow = { id: number; from: string; to: string };
let lexSeq = 0;
const lexRows = (v: LexEntry[] | undefined): LexRow[] => (v ?? []).map((e) => ({ id: ++lexSeq, ...e }));
const lexKey = (s: string) => s.toLowerCase().replace(/[\s-]+/g, "");

/**
 * Kamus ejaan milik proyek: kata yang sering salah dibaca → cara bacanya. Baris diketik lokal, disimpan ke timeline saat keluar
 * kolom / Enter (baris yang belum lengkap tetap tampil tapi belum dipakai). Kamus bawaan bisa diganti dengan menulis kata yang sama.
 */
function LexiconEditor({ value, onChange, disabled }: { value: LexEntry[] | undefined; onChange: (v: LexEntry[]) => void; disabled?: boolean }) {
  const key = JSON.stringify(value ?? []);
  const [rows, setRows] = useState<LexRow[]>(() => lexRows(value));
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  // kamus dari luar berubah (undo, proyek lain, revisi) -> ikut; baris yang belum lengkap tetap dipertahankan
  useEffect(() => {
    setRows((r) => (JSON.stringify(normLexicon(r)) === key ? r : [...lexRows(JSON.parse(key) as LexEntry[]), ...r.filter((x) => !x.from.trim() || !x.to.trim())]));
  }, [key]);
  const commit = (next: LexRow[] = rowsRef.current) => {
    setRows(next);
    const clean = normLexicon(next);
    if (JSON.stringify(clean) !== key) onChange(clean);
  };
  const edit = (id: number, p: Partial<LexRow>) => setRows((r) => r.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const used = normLexicon(rows).length;
  const firstOf = new Map<string, number>();
  for (const r of rows) if (r.from.trim() && !firstOf.has(lexKey(r.from.trim()))) firstOf.set(lexKey(r.from.trim()), r.id);
  const inp = "input min-w-0 py-1.5 text-[12.5px]";
  return (
    <details className="group rounded-xl border border-zinc-800 px-3 py-2" data-lexicon>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        <span>
          📖 Kamus ejaan{used ? <span className="ml-1 text-xs font-normal text-zinc-500">({used} kata)</span> : null}
        </span>
        <span aria-hidden className="text-[11px] text-zinc-500 transition group-open:rotate-90">
          ▶
        </span>
      </summary>
      <div className="mt-2 space-y-2">
        <p className="text-[11px] leading-relaxed text-zinc-500">
          Kata yang sering salah dibaca mesin suara → tulis cara bacanya. Dipakai otomatis di semua adegan (subtitle tetap tulisan asli). Ejaan khusus di kartu adegan tetap
          menang. Habis diubah, klik &quot;Generate ulang VO&quot;.
        </p>
        {rows.map((r) => {
          const dup = !!r.from.trim() && firstOf.get(lexKey(r.from.trim())) !== r.id;
          return (
            <div key={r.id} className="space-y-0.5" data-lex-row>
              <div className="flex items-center gap-1.5">
                <input
                  className={`${inp} flex-[2]`}
                  value={r.from}
                  maxLength={LEX_FROM_MAX}
                  placeholder="mis. PPT"
                  aria-label="Kata yang ditulis"
                  disabled={disabled}
                  onChange={(e) => edit(r.id, { from: e.target.value })}
                  onBlur={() => commit()}
                  onKeyDown={(e) => e.key === "Enter" && commit()}
                />
                <span aria-hidden className="flex-none text-zinc-500">
                  →
                </span>
                <input
                  className={`${inp} flex-[3]`}
                  value={r.to}
                  maxLength={LEX_TO_MAX}
                  placeholder="mis. pepete"
                  aria-label={`Cara baca ${r.from || "kata"}`}
                  disabled={disabled}
                  onChange={(e) => edit(r.id, { to: e.target.value })}
                  onBlur={() => commit()}
                  onKeyDown={(e) => e.key === "Enter" && commit()}
                />
                <button
                  type="button"
                  className="h-8 w-8 flex-none rounded-lg text-[13px] text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
                  aria-label={`Hapus ${r.from || "baris"} dari kamus`}
                  disabled={disabled}
                  onClick={() => commit(rows.filter((x) => x.id !== r.id))}
                >
                  ✕
                </button>
              </div>
              {dup && <p className="text-[10.5px] text-amber-400">Kata ini sudah ada di atas — yang dipakai baris pertama.</p>}
            </div>
          );
        })}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            className="text-[12px] font-semibold text-orange-400 hover:text-orange-300 disabled:opacity-50"
            disabled={disabled || rows.length >= MAX_LEXICON}
            onClick={() => setRows((r) => [...r, { id: ++lexSeq, from: "", to: "" }])}
          >
            ＋ Tambah kata
          </button>
          <span className="text-[10.5px] text-zinc-500">Contoh: PPT → pepete · CS → si es · real-time → ril taim</span>
        </div>
        <details className="text-[11px] text-zinc-500">
          <summary className="cursor-pointer font-semibold hover:text-zinc-300">Ejaan bawaan ({DEFAULT_LEXICON.length})</summary>
          <p className="mt-1 leading-relaxed" data-lex-default>
            {DEFAULT_LEXICON.map((e) => `${e.from} → ${e.to}`).join(" · ")}
          </p>
          <p className="mt-1">Mau dibaca lain? Tulis kata yang sama di kamus di atas (mis. chat → chat supaya tidak jadi &quot;cet&quot;).</p>
        </details>
      </div>
    </details>
  );
}
