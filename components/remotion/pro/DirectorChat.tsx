"use client";

import { memo, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import AnsweredCard, { parseCardAnswer } from "@/components/ai/AnsweredCard";
import ChoiceCard from "@/components/ai/ChoiceCard";
import HelperLine from "@/components/ai/HelperLine";
import HeroArt from "@/components/ai/HeroArt";
import Markdown from "@/components/ai/Markdown";
import { personaOf } from "@/lib/aiPersona";
import { splitChoice, type Choice } from "@/lib/choiceCard";
import { reloadStudioCatalog, uploadStudioFile } from "@/lib/studio/client";
import { DIRECTOR_IDEAS } from "@/lib/studio/directorIdeas";
import type { Director, Timeline } from "@/lib/studio/timeline";
import { storageSrc } from "@/lib/studio/urls";
import { createClient } from "@/lib/supabase/client";
import DirectorPicker, { DEFAULT_DIRECTOR, DirectorQuickPick, activeDirector, charUnavailable, useMyChars } from "./DirectorPicker";
import { MAX_UPLOAD } from "./fields";
import { dbErrorText } from "./planUtils";

const HERO = DEFAULT_DIRECTOR;

export type AttKind = "image" | "video" | "audio" | "logo";
export type Att = { path: string; kind: AttKind; name: string };
/** langkah kerja dari server; riset web membawa subjek (q), jumlah sumber (n), dan off / fail (lanjut tanpa riset) */
type Step = { k: string; s: "run" | "done"; q?: string; n?: number; off?: boolean; fail?: boolean };
type Msg = {
  id: string | number;
  role: "user" | "assistant";
  content: string;
  attachments: Att[];
  persona?: string | null;
  model?: string | null;
  error?: boolean;
  steps?: Step[];
  startedAt?: number;
  doneAt?: number;
  /** kartu tanya balik dari bingkai {t:"ask"} */
  choice?: Choice | null;
  /** jawaban ini membuat / memperbarui rencana */
  planned?: boolean;
};
type Row = { id: number; role: "user" | "assistant"; content: string | null; attachments: unknown; persona: string | null; model: string | null; error: boolean | null };
type Pending = { key: string; name: string; kind: AttKind; status: "up" | "ok" | "err"; path?: string; preview?: string; err?: string };
type Mode = "media" | "logo" | "music";

const IDEAS = DIRECTOR_IDEAS;

/** langkah kerja sutradara (bingkai {t:"step"}) dengan gaya Harley */
const STEP_TEXT: Record<string, string> = {
  understand: "Pahami idemu dulu ✨",
  plan: "Rancang alur, hook & tempo 🎬",
  write: "Tulis naskah VO, teks layar & SFX ✍️",
  check: "Cek durasi, kata per layar & zona aman ✅",
};
/** teks langkah: riset web dirangkai dari subjek & jumlah sumbernya, langkah lain dari STEP_TEXT */
function stepText(s: Step): string {
  if (s.k !== "research") return STEP_TEXT[s.k] ?? s.k;
  const q = s.q ? `: ${s.q}` : "";
  if (s.s === "run") return `🔎 Riset${q}…`;
  if (s.off) return "🔎 Riset internet belum aktif — lanjut tanpa riset";
  if (s.fail) return `🔎 Riset${q} gagal — lanjut tanpa riset`;
  return s.n ? `🔎 Riset${q} · 📚 ${s.n} sumber dibaca` : `🔎 Riset${q} — belum ketemu info, lanjut tanpa riset`;
}
const KIND_ICON: Record<AttKind, string> = { image: "🖼️", video: "🎞️", audio: "🎵", logo: "🏷️" };
const ATT_KINDS: AttKind[] = ["image", "video", "audio", "logo"];

/** sembunyikan blok ```studio (rencana JSON) dari tampilan, termasuk yang belum selesai saat streaming */
const hideStudio = (t: string) =>
  t
    .replace(/```studio\b[\s\S]*?```/gi, "")
    .replace(/```studio\b[\s\S]*$/i, "")
    .trim();
const hasStudio = (t: string) => /```studio\b/i.test(t);

/** rapikan Choice dari bingkai {t:"ask"} pakai parser yang sama dengan blok ```ask */
const cleanChoice = (c: unknown): Choice | null => {
  try {
    return splitChoice("```ask\n" + JSON.stringify(c) + "\n```").choice;
  } catch {
    return null;
  }
};

/** lampiran dari DB (jsonb) -> daftar yang aman */
const cleanAtts = (v: unknown): Att[] =>
  (Array.isArray(v) ? v : [])
    .map((a) => (a && typeof a === "object" ? (a as Record<string, unknown>) : {}))
    .filter((a) => typeof a.path === "string" && a.path)
    .map((a) => ({ path: String(a.path), kind: ATT_KINDS.includes(a.kind as AttKind) ? (a.kind as AttKind) : "image", name: String(a.name ?? "lampiran").slice(0, 80) }));

const failText = (status: number, name: string) =>
  status === 401 ? "Sesi login habis. Muat ulang halaman lalu masuk lagi." : status === 403 ? "Kamu belum punya akses Studio." : status >= 500 ? `${name} lagi gangguan. Coba lagi sebentar.` : `Gagal (${status}). Coba lagi.`;

type Props = {
  projectId: string | null;
  /** timeline TERBARU (sudah termasuk editan user) — dikirim tiap pesan supaya revisi berbasis editan */
  getTimeline: () => Timeline | null;
  hasPlan: boolean;
  onProject: (id: string, title: string) => void;
  /** rencana dari server; `title` = judul proyek baru kalau server ikut menggantinya (rencana baru untuk subjek lain) */
  onPlan: (raw: unknown, title?: string) => void;
  onExample?: () => void;
  exampleBusy?: boolean;
  /** sutradara pilihan proyek ini (kosong = Harley) — dikirim tiap pesan, server memeriksanya */
  director?: Director | null;
  onDirector?: (d: Director | null) => void;
  /** buka panel 🧠 Skill (tab catatan gaya / simpan / impor / library) */
  onSkill?: (tab?: "notes") => void;
};

/** Chat dengan sutradara (bawaan Harley; bisa hero lain / karakter buatan user): ide -> tanya balik -> rencana video (timeline) -> revisi */
function DirectorChat({ projectId, getTimeline, hasPlan, onProject, onPlan, onExample, exampleBusy, director = null, onDirector, onSkill }: Props) {
  const sb = useMemo(() => createClient(), []);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const pid = useRef(projectId);
  pid.current = projectId;
  /** proyek yang baru dibuat oleh chat ini sendiri -> jangan muat ulang riwayat (pesan sedang mengalir) */
  const own = useRef<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const modeRef = useRef<Mode>("media");
  const { chars, loaded: charsLoaded } = useMyChars();
  const act = activeDirector(director, chars, charsLoaded);
  const name = act.name;
  /** catatan dari server untuk sutradara pilihan ini (mis. karakter tidak bisa dibaca → Harley) */
  const [dirNote, setDirNote] = useState<{ hero: string; note: string } | null>(null);
  const cb = useRef({ onProject, onPlan, getTimeline, director, name });
  cb.current = { onProject, onPlan, getTimeline, director, name };

  // ganti proyek -> hentikan jawaban yang berjalan & muat riwayat dari studio_messages
  useEffect(() => {
    if (projectId && projectId === own.current) return;
    abort.current?.abort();
    own.current = null;
    setMsgs([]);
    setLoadErr(null);
    setDirNote(null);
    stick.current = true;
    if (!projectId) return setLoading(false);
    let dead = false;
    setLoading(true);
    sb.from("studio_messages")
      .select("id, role, content, attachments, persona, model, error")
      .eq("project_id", projectId)
      .order("id", { ascending: false })
      .limit(400)
      .then(({ data, error }) => {
        if (dead) return;
        setLoading(false);
        if (error) return setLoadErr(dbErrorText(error, "Gagal memuat obrolan. Coba buka ulang proyeknya."));
        // diambil 400 pesan TERBARU (urut turun), lalu dibalik supaya tampil dari yang lama ke yang baru
        setMsgs(
          ((data ?? []) as Row[]).reverse().map((r) => ({
            id: r.id,
            role: r.role,
            content: r.content ?? "",
            attachments: cleanAtts(r.attachments),
            persona: r.persona,
            model: r.model,
            error: !!r.error,
            planned: r.role === "assistant" && hasStudio(r.content ?? ""),
          })),
        );
      });
    return () => {
      dead = true;
    };
  }, [projectId, sb]);

  // berhenti kalau komponen ditutup
  useEffect(() => () => abort.current?.abort(), []);

  // gulir otomatis ke bawah selama user belum menggulir ke atas (chat kosong: dari atas — sapaan & pilih sutradara terlihat utuh)
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = msgs.length ? el.scrollHeight : 0;
  }, [msgs]);
  const onScroll = () => {
    const el = scroller.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // pratinjau gambar lampiran dibersihkan dari memori
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(() => () => pendingRef.current.forEach((p) => p.preview && URL.revokeObjectURL(p.preview)), []);

  const run = async (content: string, atts: Att[]) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    stick.current = true;
    const now = Date.now();
    const tempId = `a${now}`;
    setMsgs((m) => [
      ...m,
      { id: `u${now}`, role: "user", content, attachments: atts },
      { id: tempId, role: "assistant", content: "", attachments: [], persona: cb.current.name, steps: [], startedAt: now },
    ]);
    const patch = (f: (x: Msg) => Msg) => setMsgs((m) => m.map((x) => (x.id === tempId ? f(x) : x)));
    const ac = new AbortController();
    abort.current = ac;
    let text = "";
    let failMsg = "";
    let got = false; // ada rencana / kartu tanya balik
    try {
      const res = await fetch("/api/studio/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: pid.current, content, attachments: atts, timeline: cb.current.getTimeline(), director: cb.current.director ?? null }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || failText(res.status, cb.current.name));
      }
      const onFrame = (f: Record<string, unknown>) => {
        if (f.t === "project") {
          const id = typeof f.id === "string" ? f.id : "";
          if (id) {
            own.current = id;
            pid.current = id;
            cb.current.onProject(id, typeof f.title === "string" ? f.title : "");
          }
        } else if (f.t === "step") {
          const k = String(f.k ?? "");
          const s: Step["s"] = f.s === "done" ? "done" : "run";
          const step: Step = {
            k,
            s,
            ...(typeof f.q === "string" && f.q ? { q: f.q.slice(0, 60) } : {}),
            ...(typeof f.n === "number" && f.n >= 0 ? { n: Math.min(9, Math.round(f.n)) } : {}),
            ...(f.off === true ? { off: true } : {}),
            ...(f.fail === true ? { fail: true } : {}),
          };
          if (k)
            patch((x) => {
              const steps = [...(x.steps ?? [])];
              const i = steps.findIndex((y) => y.k === k);
              if (i >= 0) steps[i] = { ...steps[i], ...step };
              else steps.push(step);
              return { ...x, steps };
            });
        } else if (f.t === "director") {
          // sutradara yang benar-benar dipakai server (pilihan tidak bisa dipakai -> Harley + catatan)
          const nm = typeof f.name === "string" && f.name ? f.name.slice(0, 40) : "";
          if (nm) patch((x) => ({ ...x, persona: nm }));
          const want = cb.current.director?.hero ?? HERO;
          const note = typeof f.note === "string" && f.note ? f.note.slice(0, 160) : "";
          setDirNote(note ? { hero: want, note } : null);
          // server memakai Harley karena karakter pilihan tidak bisa dibaca → semua tampilan ikut Harley, daftar disegarkan
          if (note) charUnavailable(want);
        } else if (f.t === "meta") {
          patch((x) => ({ ...x, persona: typeof f.persona === "string" && f.persona ? f.persona : x.persona, model: typeof f.model === "string" ? f.model : x.model }));
        } else if (f.t === "ask") {
          const c = cleanChoice(f.choice);
          if (c) {
            got = true;
            patch((x) => ({ ...x, choice: c }));
          }
        } else if (f.t === "plan") {
          got = true;
          cb.current.onPlan(f.timeline, typeof f.title === "string" && f.title.trim() ? f.title.trim().slice(0, 120) : undefined);
          patch((x) => ({ ...x, planned: true }));
        } else if (f.t === "error") failMsg = typeof f.message === "string" && f.message ? f.message : `${cb.current.name} lagi error. Coba lagi.`;
      };
      // aliran = teks biasa + bingkai kontrol "\u001e{json}\n"
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        for (;;) {
          const i = buf.indexOf("\u001e");
          if (i < 0) {
            text += buf;
            buf = "";
            break;
          }
          text += buf.slice(0, i);
          const nl = buf.indexOf("\n", i);
          if (nl < 0) {
            buf = buf.slice(i);
            break;
          }
          try {
            onFrame(JSON.parse(buf.slice(i + 1, nl)));
          } catch {}
          buf = buf.slice(nl + 1);
        }
        const t = text;
        patch((x) => ({ ...x, content: t }));
      }
      const end = (x: Msg): Msg => ({ ...x, doneAt: Date.now(), steps: x.steps?.map((s) => ({ ...s, s: "done" as const })) });
      if (failMsg) patch((x) => (text.trim() || got ? { ...end(x), content: `${text.trim()}\n\n⚠️ ${failMsg}`.trim() } : { ...end(x), content: `⚠️ ${failMsg}`, error: true }));
      else if (!text.trim() && !got) patch((x) => ({ ...end(x), content: `⚠️ ${cb.current.name} belum ngasih jawaban. Coba kirim ulang.`, error: true }));
      else patch(end);
    } catch (e) {
      if ((e as Error).name === "AbortError") patch((x) => ({ ...x, doneAt: Date.now(), content: `${text.trim()}\n\n_⏹ Dihentikan._`.trim() }));
      else {
        const msg = e instanceof Error && e.message && !/fetch|network|load failed/i.test(e.message) ? e.message : `${cb.current.name} nggak bisa dihubungi. Cek internet lalu coba lagi.`;
        patch((x) => ({ ...x, doneAt: Date.now(), content: `⚠️ ${msg}`, error: true }));
      }
    } finally {
      if (abort.current === ac) abort.current = null;
      busyRef.current = false;
      setBusy(false);
    }
  };

  const uploading = pending.some((p) => p.status === "up");
  const ready = pending.filter((p) => p.status === "ok" && p.path);

  const send = () => {
    const t = input.trim();
    if ((!t && !ready.length) || busy || uploading) return;
    const atts = ready.map((p) => ({ path: p.path!, kind: p.kind, name: p.name }));
    pending.forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
    setPending([]);
    setInput("");
    if (ta.current) ta.current.style.height = "";
    void run(t || "Ini lampiranku, pakai di videonya ya.", atts);
  };

  const addFiles = (files: File[], mode: Mode) => {
    for (const f of files.slice(0, 6)) {
      const kind: AttKind = mode === "logo" ? "logo" : mode === "music" ? "audio" : f.type.startsWith("video") ? "video" : "image";
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      if (f.size > MAX_UPLOAD) {
        setPending((p) => [...p, { key, name: f.name, kind, status: "err", err: "kebesaran (maks 200 MB)" }]);
        continue;
      }
      const preview = kind === "image" || kind === "logo" ? URL.createObjectURL(f) : undefined;
      setPending((p) => [...p, { key, name: f.name, kind, status: "up", preview }]);
      uploadStudioFile(f, "uploads", mode).then(
        (r) => {
          setPending((p) => p.map((x) => (x.key === key ? { ...x, status: "ok", path: r.path } : x)));
          // musik upload masuk daftar musik di kartu rencana
          if (mode === "music") void reloadStudioCatalog();
        },
        (e) => setPending((p) => p.map((x) => (x.key === key ? { ...x, status: "err", err: e instanceof Error && e.message.length < 80 ? e.message : "gagal upload" } : x))),
      );
    }
  };
  const pick = (mode: Mode, accept: string) => {
    modeRef.current = mode;
    if (!fileRef.current) return;
    fileRef.current.accept = accept;
    fileRef.current.click();
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const files = Array.from(e.dataTransfer.files);
    const audio = files.filter((f) => f.type.startsWith("audio"));
    const media = files.filter((f) => f.type.startsWith("image") || f.type.startsWith("video"));
    if (audio.length) addFiles(audio, "music");
    if (media.length) addFiles(media, "media");
  };
  const unpick = (key: string) => {
    const p = pending.find((x) => x.key === key);
    if (p?.preview) URL.revokeObjectURL(p.preview);
    setPending((ps) => ps.filter((x) => x.key !== key));
  };

  /** kirim ulang pesan user terakhir (setelah error) */
  const retry = (i: number) => {
    const u = [...msgs.slice(0, i)].reverse().find((x) => x.role === "user");
    if (!u || busy) return;
    setMsgs((m) => m.filter((x) => x.id !== u.id && x.id !== msgs[i].id));
    void run(u.content, u.attachments);
  };

  const choiceOf = (m: Msg) => m.choice ?? splitChoice(hideStudio(m.content)).choice;
  const answerAfter = (i: number) => {
    const nx = msgs[i + 1];
    return nx?.role === "user" ? parseCardAnswer(nx.content) : null;
  };
  // pesan "📌 Jawaban …" yang menjawab kartu tidak perlu jadi gelembung lagi (sudah tampil di kartu)
  const answersCard = (i: number) => {
    const m = msgs[i];
    if (m.role !== "user" || !m.content.startsWith("📌") || !parseCardAnswer(m.content)) return false;
    const prev = msgs[i - 1];
    return !!prev && prev.role === "assistant" && !!choiceOf(prev);
  };
  const firstPlan = msgs.findIndex((m) => m.planned);

  return (
    <section aria-label={`Chat dengan ${name} si Sutradara`} className="card flex flex-col p-3 sm:p-4 lg:h-[min(74vh,780px)]">
      <div className="mb-2 flex items-center gap-1.5">
        {onDirector ? (
          <DirectorPicker
            value={director}
            onChange={onDirector}
            chars={chars}
            loaded={charsLoaded}
            busy={busy}
            note={dirNote && dirNote.hero === (director?.hero ?? HERO) ? dirNote.note : null}
            onNotes={onSkill ? () => onSkill("notes") : undefined}
          />
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-end justify-center overflow-hidden rounded-full bg-orange-500/10">
              <HeroArt hero={name} size={38} still={!busy} talk={busy} />
            </span>
            <div className="min-w-0 leading-tight">
              <div className="text-[14px] font-bold">{name} · Sutradara</div>
              <div className="truncate text-[11.5px] text-zinc-500">Ketik ide → cek rencana → preview → download</div>
            </div>
          </div>
        )}
        {onSkill && (
          <button type="button" className="btn-ghost shrink-0 px-2.5 py-1.5 text-[12px]" title="Skill Studio: catatan gaya, simpan / impor setelan, Library tim" onClick={() => onSkill()}>
            🧠 Skill
          </button>
        )}
      </div>

      <div
        ref={scroller}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-busy={busy}
        className="-mx-1 max-h-[58vh] min-h-[220px] flex-1 space-y-5 overflow-y-auto px-1 py-2 lg:max-h-none"
      >
        {loading ? (
          <p className="py-10 text-center text-[13px] text-zinc-500">Memuat obrolan…</p>
        ) : loadErr ? (
          <p className="py-10 text-center text-[13px] text-red-400">{loadErr}</p>
        ) : !msgs.length ? (
          <div className="flex flex-col items-center px-2 py-4 text-center">
            {/* di HP + ada pilihan sutradara: avatar besar disembunyikan (sudah ada di header) & sapaan diringkas, supaya baris
                "Pilih sutradara" masuk layar pertama */}
            <span className={onDirector ? "hidden sm:block" : undefined}>
              <HeroArt hero={name} size={onDirector ? 76 : 110} />
            </span>
            <p className={`max-w-[420px] text-[13.5px] leading-relaxed text-zinc-300 ${onDirector ? "sm:mt-2" : "mt-2"}`}>
              Halo! Aku <b className="text-zinc-100">{name}</b>, sutradara videomu 🎬{" "}
              {onDirector ? (
                <>
                  <span className="sm:hidden">Ceritain idenya: tentang apa, buat siapa, berapa detik. Aku riset dulu kalau perlu, lalu bikinin rencana lengkap.</span>
                  <span className="hidden sm:inline">
                    Ceritain idenya — videonya tentang apa, buat siapa, tayang di mana, berapa detik. Aku riset dulu kalau perlu, lalu bikinin rencana lengkap: naskah VO, adegan, musik & SFX.
                  </span>
                </>
              ) : (
                "Ceritain idenya — videonya tentang apa, buat siapa, tayang di mana, berapa detik. Aku riset dulu kalau perlu, lalu bikinin rencana lengkap: naskah VO, adegan, musik & SFX."
              )}
            </p>
            <div className="mt-3 flex max-w-[640px] flex-wrap justify-center gap-1.5">
              {IDEAS.map((t) => (
                <button
                  key={t}
                  type="button"
                  disabled={busy}
                  onClick={() => void run(t, [])}
                  className="rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-[12.5px] text-zinc-300 transition hover:border-orange-500/60 hover:text-zinc-100"
                >
                  💡 {t}
                </button>
              ))}
            </div>
            {onDirector && <DirectorQuickPick value={director} onChange={onDirector} chars={chars} loaded={charsLoaded} disabled={busy} />}
            {onExample && (
              <button type="button" disabled={exampleBusy || busy} onClick={onExample} className="mt-3 text-[12px] font-semibold text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline">
                {exampleBusy ? "Menyiapkan…" : "atau mulai dari contoh rencana"}
              </button>
            )}
          </div>
        ) : (
          msgs.map((m, i) => {
            if (answersCard(i)) return null;
            if (m.role === "user") return <UserMsg key={m.id} m={m} />;
            const live = busy && i === msgs.length - 1;
            const shown = hideStudio(m.content);
            const ch = splitChoice(shown);
            const choice = m.choice ?? ch.choice;
            const ans = choice ? answerAfter(i) : null;
            return (
              <div key={m.id} className="flex gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-end justify-center overflow-hidden rounded-full bg-orange-500/10">
                  <HeroArt hero={m.persona || HERO} size={42} talk={live} still={!live} />
                </span>
                <div className="min-w-0 flex-1 text-[14px] leading-relaxed text-zinc-200">
                  {!m.error && <HelperLine hero={m.persona || HERO} />}
                  {!!m.steps?.length || (live && !ch.text) ? <DirectorSteps hero={m.persona || name} steps={m.steps ?? []} live={live && !ch.text} startedAt={m.startedAt} doneAt={m.doneAt} /> : null}
                  {m.error ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-400">
                      <span className="min-w-0 flex-1">{m.content}</span>
                      {i === msgs.length - 1 && !busy && (
                        <button type="button" className="shrink-0 font-semibold underline" onClick={() => retry(i)}>
                          Kirim ulang
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      {ch.text && <Markdown text={ch.text} />}
                      {ch.partial && live && <p className="mt-1 text-[12.5px] text-zinc-500">⏳ Menyiapkan pilihan…</p>}
                      {live && hasStudio(m.content) && !m.planned && <p className="mt-1 text-[12.5px] text-zinc-500">⏳ Menyusun rencana adegan…</p>}
                      {m.planned && (
                        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[12.5px] text-emerald-400">
                          <span className="min-w-0 flex-1">📋 Rencana {i === firstPlan ? "dibuat" : "diperbarui"} — cek & ubah di kartu rencana.</span>
                          {hasPlan && (
                            <button
                              type="button"
                              className="shrink-0 font-semibold underline"
                              onClick={() => document.getElementById("studio-plan")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                            >
                              Lihat rencana
                            </button>
                          )}
                        </div>
                      )}
                      {choice && !live && (ans ? <AnsweredCard title={choice.title} answer={ans} /> : <ChoiceCard choice={choice} disabled={busy || i !== msgs.length - 1} onSubmit={(t) => void run(t, [])} />)}
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* kolom ketik */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={`mt-2 rounded-2xl border bg-zinc-900 p-2 transition ${drag ? "border-orange-500" : "border-zinc-800"}`}
        style={{ boxShadow: "var(--shadow-sm)" }}
      >
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          tabIndex={-1}
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []), modeRef.current);
            e.target.value = "";
          }}
        />
        {pending.length > 0 && (
          <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Lampiran">
            {pending.map((p) => (
              <li
                key={p.key}
                className={`flex max-w-full items-center gap-1.5 rounded-lg border px-1.5 py-1 text-[11.5px] ${p.status === "err" ? "border-red-500/40 text-red-400" : "border-zinc-800 text-zinc-300"}`}
              >
                {p.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.preview} alt="" className="h-6 w-6 shrink-0 rounded object-cover" />
                ) : (
                  <span aria-hidden>{KIND_ICON[p.kind]}</span>
                )}
                <span className="max-w-[150px] truncate">{p.name}</span>
                {p.status === "up" && <span className="text-zinc-500">⏳</span>}
                {p.status === "err" && <span>· {p.err}</span>}
                <button type="button" aria-label={`Hapus lampiran ${p.name}`} className="px-0.5 text-zinc-500 hover:text-red-400" onClick={() => unpick(p.key)}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={ta}
          rows={2}
          value={input}
          aria-label="Tulis ide atau revisi video"
          placeholder={hasPlan ? "Revisi? mis. “adegan 3 lebih cepat”, “hook lebih nendang”…" : "Ceritain ide videomu… mis. promo Konten.com buat clipper, 30 detik"}
          onChange={(e) => {
            setInput(e.target.value);
            const el = e.target;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
          }}
          onKeyDown={(e) => {
            // laptop: Enter = kirim, Shift+Enter = baris baru. HP: Enter = baris baru (pakai tombol Kirim)
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !window.matchMedia("(pointer: coarse)").matches) {
              e.preventDefault();
              send();
            }
          }}
          className="block max-h-48 w-full resize-none bg-transparent px-1.5 py-1 text-[14px] leading-relaxed text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
        />
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <AttachBtn label="🎞️ Klip/gambar" title="Lampirkan klip atau gambar" onClick={() => pick("media", "image/*,video/*")} />
          <AttachBtn label="🏷️ Logo" title="Lampirkan logo" onClick={() => pick("logo", "image/*")} />
          <AttachBtn label="🎵 Musik" title="Lampirkan musik" onClick={() => pick("music", "audio/*")} />
          <span className="flex-1" />
          {busy ? (
            <button type="button" className="btn-ghost px-3 py-1.5 text-[12.5px]" onClick={() => abort.current?.abort()}>
              ⏹ Berhenti
            </button>
          ) : (
            <button type="button" className="btn-primary px-3.5 py-1.5 text-[13px]" disabled={(!input.trim() && !ready.length) || uploading} onClick={send}>
              {uploading ? "Mengunggah…" : "Kirim ➤"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function AttachBtn({ label, title, onClick }: { label: string; title: string; onClick: () => void }) {
  return (
    <button type="button" title={title} onClick={onClick} className="rounded-lg px-2 py-1.5 text-[12px] font-semibold text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100">
      {label}
    </button>
  );
}

/** gelembung pesan user + lampirannya */
function UserMsg({ m }: { m: Msg }) {
  return (
    <div className="flex flex-col items-end gap-1.5">
      {m.attachments.length > 0 && (
        <div className="flex max-w-[90%] flex-wrap justify-end gap-1.5">
          {m.attachments.map((a) =>
            a.kind === "image" || a.kind === "logo" ? (
              <a key={a.path} href={storageSrc(a.path)} target="_blank" rel="noreferrer" className="overflow-hidden rounded-xl ring-1 ring-zinc-800" title={a.name}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={storageSrc(a.path)} alt={a.name} className="h-20 w-auto max-w-[160px] object-cover" loading="lazy" />
              </a>
            ) : (
              <span key={a.path} className="flex max-w-[220px] items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-[12px] text-zinc-300">
                <span aria-hidden>{KIND_ICON[a.kind]}</span>
                <span className="truncate">{a.name}</span>
              </span>
            ),
          )}
        </div>
      )}
      {m.content && (
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md px-3.5 py-2 text-[14px] text-white" style={{ backgroundImage: "linear-gradient(180deg,#fb8a3c,#ea580c)" }}>
          {m.content}
        </div>
      )}
    </div>
  );
}

/** langkah berpikir singkat gaya sutradara (pahami → rancang → tulis → cek), dilipat setelah jawaban keluar */
function DirectorSteps({ hero, steps, live, startedAt, doneAt }: { hero: string; steps: Step[]; live: boolean; startedAt?: number; doneAt?: number }) {
  const [open, setOpen] = useState(false);
  const secs = startedAt && doneAt ? Math.max(1, Math.round((doneAt - startedAt) / 1000)) : null;
  const list = (
    <ul className="mt-1 space-y-1">
      {steps.map((s) => (
        <li key={s.k} className="flex items-start gap-2 text-[12.5px] text-zinc-300">
          <span className="mt-[1px] w-4 shrink-0 text-center">{s.s === "done" ? <span className="font-bold text-emerald-400">✓</span> : <span className="inline-block animate-spin">⏳</span>}</span>
          <span className="min-w-0 flex-1 break-words">{stepText(s)}</span>
        </li>
      ))}
      {live && !steps.length && <li className="text-[12.5px] text-zinc-500">⏳ …</li>}
    </ul>
  );
  if (live)
    return (
      <div className="mb-1.5 rounded-xl border border-zinc-800 px-3 py-2">
        <div className="text-[12.5px] font-bold text-orange-400">
          {hero} ({personaOf(hero).type}): “Oke, aku racik dulu ya~ 🎬”
        </div>
        {list}
      </div>
    );
  if (!steps.length) return null;
  return (
    <div className="mb-1.5">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="text-[11.5px] font-semibold text-zinc-500 hover:text-zinc-300">
        ⚙️ {open ? "Sembunyikan proses ▾" : "Lihat proses ▸"}{" "}
        <span className="font-normal">
          ({steps.length} langkah{secs ? ` · ${secs} detik` : ""})
        </span>
      </button>
      {open && <div className="mt-1 rounded-xl border border-zinc-800 px-3 py-2">{list}</div>}
    </div>
  );
}

export default memo(DirectorChat);
