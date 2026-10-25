/**
 * Helper BROWSER Studio Pro (dipakai komponen "use client"):
 * - status mesin di laptop (voice-worker) + mesin suara yang tersedia
 * - katalog SFX & musik (sekali per halaman, cache modul)
 * - bank suara (tabel studio_voices + realtime)
 * - upload ke bucket privat "studio"
 * - antrian suara / render (insert lewat RLS, pantau realtime, cadangan polling 5 dtk) + TTS cadangan
 * Semuanya tahan banting: tabel/route belum ada atau worker mati -> nilai kosong + pesan awam, tidak bikin crash.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { SFX_BUILTIN, type SfxMeta } from "./sfxMeta";
import type { EdgeVoice, Timeline, Word } from "./timeline";
import { sfxSrc, storageSrc, STUDIO_BUCKET } from "./urls";

// ---------------------------------------------------------------------------------------------
// Supabase (satu client untuk semua helper Studio)
// ---------------------------------------------------------------------------------------------
type Db = ReturnType<typeof createClient>;
let sbInst: Db | null = null;
export const studioDb = (): Db => (sbInst ??= createClient());

const chanName = (p: string) => `${p}-${Math.random().toString(36).slice(2, 9)}`;

/** id user yang sedang login (null kalau sesi habis) */
export async function studioUid(): Promise<string | null> {
  const sb = studioDb();
  const { data } = await sb.auth.getSession();
  if (data.session?.user.id) return data.session.user.id;
  const { data: u } = await sb.auth.getUser();
  return u.user?.id ?? null;
}

/** pesan error awam dari error Supabase / fetch / string */
export function friendlyStudioError(e: unknown): string {
  const o = (e && typeof e === "object" ? e : {}) as { message?: unknown; code?: unknown; error?: unknown; statusCode?: unknown };
  const msg = `${typeof e === "string" ? e : String(o.message ?? o.error ?? "")} ${String(o.code ?? "")} ${String(o.statusCode ?? "")}`;
  if (/42P01|PGRST20[45]|does not exist|could not find the table|schema cache/i.test(msg)) return "Fitur ini belum aktif — admin perlu menjalankan update database Studio (migration-20).";
  if (/bucket not found/i.test(msg)) return "Penyimpanan Studio belum aktif — admin perlu menjalankan update database Studio (migration-20).";
  if (/jwt|not authenticated|session/i.test(msg)) return "Sesi login habis. Muat ulang halaman lalu coba lagi.";
  if (/row-level|violates row|permission denied|42501|unauthorized|forbidden|\b40[13]\b/i.test(msg)) return "Kamu belum punya akses Studio untuk ini.";
  if (/too large|exceeded|maximum allowed size|\b413\b/i.test(msg)) return "File terlalu besar.";
  if (/mime|content.?type|\b415\b/i.test(msg)) return "Jenis file tidak didukung.";
  if (/failed to fetch|networkerror|network request|load failed|timeout|timed out/i.test(msg)) return "Koneksi putus. Cek internet lalu coba lagi.";
  return "Ada yang gagal. Coba lagi sebentar lagi.";
}

/** tabel belum ada (migration belum dijalankan)? */
export const isMissingTable = (e: unknown) => {
  const o = (e && typeof e === "object" ? e : {}) as { message?: unknown; code?: unknown };
  return /42P01|PGRST20[45]|does not exist|could not find the table|schema cache/i.test(`${String(o.message ?? "")} ${String(o.code ?? "")}`);
};

// ---------------------------------------------------------------------------------------------
// Status mesin (GET /api/studio/status tiap 20 dtk + realtime studio_workers). Satu loop untuk semua komponen.
// ---------------------------------------------------------------------------------------------
export type StudioStatus = {
  worker: { online: boolean; lastSeen: string | null; gpu: string | null; engine: string | null; queue: number };
  engines: { bank: boolean; edge: boolean; elevenlabs: boolean };
  freesound: boolean;
  renderWorker: boolean;
};

export const OFFLINE_STATUS: StudioStatus = {
  worker: { online: false, lastSeen: null, gpu: null, engine: null, queue: 0 },
  engines: { bank: false, edge: true, elevenlabs: false },
  freesound: false,
  renderWorker: false,
};

/** worker dianggap nyala kalau detak terakhir < 75 dtk (detak tiap ±20 dtk) */
const ONLINE_MS = 75_000;
const txt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : typeof v === "number" ? String(v) : null);

function parseStatus(raw: unknown): StudioStatus | null {
  const o = (raw && typeof raw === "object" ? raw : null) as Record<string, unknown> | null;
  if (!o || !o.worker || typeof o.worker !== "object") return null;
  const w = o.worker as Record<string, unknown>;
  const e = (o.engines && typeof o.engines === "object" ? o.engines : {}) as Record<string, unknown>;
  const online = w.online === true;
  return {
    worker: { online, lastSeen: txt(w.lastSeen), gpu: txt(w.gpu), engine: txt(w.engine), queue: Math.max(0, Number(w.queue) || 0) },
    engines: { bank: e.bank === undefined ? online : e.bank === true, edge: e.edge !== false, elevenlabs: e.elevenlabs === true },
    freesound: o.freesound === true,
    renderWorker: o.renderWorker === true,
  };
}

/** cadangan kalau route status belum ada: baca langsung tabel studio_workers (RLS) */
async function statusFromTable(): Promise<StudioStatus> {
  try {
    const { data, error } = await studioDb().from("studio_workers").select("id,last_seen,info").order("last_seen", { ascending: false }).limit(1);
    const row = !error && data?.[0] ? (data[0] as { last_seen: string; info: Record<string, unknown> | null }) : null;
    if (!row) return OFFLINE_STATUS;
    const info = row.info ?? {};
    const online = Date.now() - new Date(row.last_seen).getTime() < ONLINE_MS;
    return {
      ...OFFLINE_STATUS,
      worker: { online, lastSeen: row.last_seen, gpu: txt(info.gpu), engine: txt(info.engine), queue: Math.max(0, Number(info.antrian ?? info.queue) || 0) },
      // sama dengan route status: bank suara hanya kalau worker melaporkan mesin yang siap
      engines: { bank: online && !!txt(info.engine), edge: true, elevenlabs: false },
      renderWorker: online && info.render === true,
    };
  } catch {
    return OFFLINE_STATUS;
  }
}

let statusVal: StudioStatus | null = null;
let statusAt = 0;
let statusBusy: Promise<void> | null = null;
let statusTimer: ReturnType<typeof setInterval> | null = null;
let statusKick: ReturnType<typeof setTimeout> | null = null;
let statusChan: RealtimeChannel | null = null;
const statusSubs = new Set<(s: StudioStatus) => void>();

function loadStatus(): Promise<void> {
  if (statusBusy) return statusBusy;
  statusBusy = (async () => {
    let s: StudioStatus | null = null;
    try {
      const r = await fetch("/api/studio/status", { cache: "no-store" });
      if (r.ok) s = parseStatus(await r.json());
    } catch {
      /* route belum ada / offline -> pakai tabel */
    }
    if (!s) s = await statusFromTable();
    statusVal = s;
    statusAt = Date.now();
    statusSubs.forEach((f) => f(s));
  })().finally(() => {
    statusBusy = null;
  });
  return statusBusy;
}

const onVisible = () => {
  if (!document.hidden && Date.now() - statusAt > 10_000) void loadStatus();
};

function startStatus() {
  if (statusTimer) return;
  void loadStatus();
  statusTimer = setInterval(() => {
    if (!document.hidden) void loadStatus();
  }, 20_000);
  document.addEventListener("visibilitychange", onVisible);
  try {
    // detak worker masuk -> segarkan (paling cepat tiap 5 dtk)
    statusChan = studioDb()
      .channel(chanName("studio-workers"))
      .on("postgres_changes", { event: "*", schema: "public", table: "studio_workers" }, () => {
        if (statusKick) return;
        statusKick = setTimeout(() => {
          statusKick = null;
          void loadStatus();
        }, Math.max(500, 5_000 - (Date.now() - statusAt)));
      })
      .subscribe();
  } catch {
    statusChan = null;
  }
}

function stopStatus() {
  if (statusTimer) clearInterval(statusTimer);
  if (statusKick) clearTimeout(statusKick);
  statusTimer = statusKick = null;
  document.removeEventListener("visibilitychange", onVisible);
  if (statusChan) void studioDb().removeChannel(statusChan);
  statusChan = null;
}

/** status mesin suara/render. null = sedang dicek pertama kali */
export function useStudioStatus(): StudioStatus | null {
  const [s, setS] = useState<StudioStatus | null>(statusVal);
  useEffect(() => {
    statusSubs.add(setS);
    startStatus();
    if (statusVal) setS(statusVal);
    return () => {
      statusSubs.delete(setS);
      if (!statusSubs.size) stopStatus();
    };
  }, []);
  return s;
}

/** minta status segera (mis. setelah user menyalakan laptop) */
export const refreshStudioStatus = () => loadStatus();

// ---------------------------------------------------------------------------------------------
// Katalog SFX + musik (GET /api/studio/catalog sekali, cache modul). Gagal -> SFX bawaan saja (complete: false).
// ---------------------------------------------------------------------------------------------
export type Catalog = {
  sfx: (SfxMeta & { src: string })[];
  music: { name: string; src: string; lufs?: number | null }[];
  bed: boolean;
  /** false = daftar SFX tambahan gagal dimuat (belum pasti lengkap) -> cue SFX yang tidak dikenal jangan dibuang */
  complete: boolean;
};

const BUILTIN_IDS = new Set(SFX_BUILTIN.map((s) => s.id));
const builtinCatalog = (): Catalog => ({ sfx: SFX_BUILTIN.map((s) => ({ ...s, src: sfxSrc(s.file) })), music: [], bed: true, complete: false });

function parseCatalog(raw: unknown): Catalog {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const sfx = (Array.isArray(o.sfx) ? o.sfx : [])
    .filter((s): s is SfxMeta & { src: string } => !!s && typeof s === "object" && typeof (s as SfxMeta).id === "string" && typeof (s as { src?: unknown }).src === "string")
    .map((s) => ({ ...s, tags: Array.isArray(s.tags) ? s.tags : [], dur: Number(s.dur) || 1, lufs: Number(s.lufs) || -20, tp: Number(s.tp) || -3, hit: Number(s.hit) || 0, peak: Number(s.peak) || 0, use: s.use ?? "", cat: s.cat || "ui" }));
  const music = (Array.isArray(o.music) ? o.music : [])
    .filter((m): m is { name: string; src: string; lufs?: number | null } => !!m && typeof m === "object" && typeof (m as { src?: unknown }).src === "string")
    .map((m) => ({ name: String(m.name || m.src.split("/").pop() || "Musik"), src: m.src, lufs: typeof m.lufs === "number" ? m.lufs : null }));
  // bawaan selalu ada walau route lupa menyertakan
  const ids = new Set(sfx.map((s) => s.id));
  // partial = route gagal membaca tabel studio_sfx
  return { sfx: [...builtinCatalog().sfx.filter((s) => !ids.has(s.id)), ...sfx], music, bed: o.bed !== false, complete: o.partial !== true };
}

let catalogVal: Catalog | null = null;
let catalogP: Promise<Catalog> | null = null;
const catalogSubs = new Set<(c: Catalog) => void>();

function loadCatalog(): Promise<Catalog> {
  catalogP ??= fetch("/api/studio/catalog", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((j) => {
      const c = parseCatalog(j);
      if (!c.complete) catalogP = null; // SFX tambahan gagal dibaca -> coba lagi di pemakaian berikutnya
      catalogVal = c;
      catalogSubs.forEach((f) => f(c));
      return c;
    })
    .catch(() => {
      catalogP = null; // coba lagi di pemakaian berikutnya
      const c = catalogVal ?? builtinCatalog();
      catalogSubs.forEach((f) => f(c));
      return c;
    });
  return catalogP;
}

export function useStudioCatalog(): Catalog | null {
  const [c, setC] = useState<Catalog | null>(catalogVal);
  useEffect(() => {
    catalogSubs.add(setC);
    void loadCatalog().then(setC);
    return () => void catalogSubs.delete(setC);
  }, []);
  return c;
}

/** muat ulang katalog (mis. setelah tambah SFX Freesound / upload musik) */
export function reloadStudioCatalog(): Promise<Catalog> {
  catalogP = null;
  return loadCatalog();
}

/** SFX katalog yang BUKAN bawaan (diteruskan ke StudioVideo sebagai `sfxExtra`) */
export const extraSfxOf = (c: Catalog | null): SfxMeta[] => (c ? c.sfx.filter((s) => !BUILTIN_IDS.has(s.id)) : []);

// ---------------------------------------------------------------------------------------------
// Bank suara
// ---------------------------------------------------------------------------------------------
export type StudioVoice = {
  id: string;
  name: string;
  style: string | null;
  status: "baru" | "diproses" | "siap" | "gagal";
  quality: { noise?: string; snr_db?: number; lufs?: number; dur?: number; saran?: string } | null;
  clean_path: string | null;
  raw_path: string;
  seed_key: string | null;
  owner: string | null;
  created_at: string;
};

const VOICE_COLS = "id,name,style,status,quality,clean_path,raw_path,seed_key,owner,created_at";

/** daftar bank suara (bawaan Alif dulu, lalu urut waktu) + realtime. Tabel belum ada -> [] + `error` */
export function useVoices(): { voices: StudioVoice[]; reload: () => void; loaded: boolean; error: string | null } {
  const [voices, setVoices] = useState<StudioVoice[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const kick = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(() => {
    void (async () => {
      try {
        const { data, error: err } = await studioDb().from("studio_voices").select(VOICE_COLS).order("created_at", { ascending: true });
        if (!alive.current) return;
        if (err) {
          setVoices([]);
          setError(friendlyStudioError(err));
        } else {
          const list = ((data ?? []) as StudioVoice[]).slice().sort((a, b) => Number(!a.seed_key) - Number(!b.seed_key));
          setVoices(list);
          setError(null);
        }
      } catch (e) {
        if (alive.current) setError(friendlyStudioError(e));
      } finally {
        if (alive.current) setLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    alive.current = true;
    reload();
    let ch: RealtimeChannel | null = null;
    try {
      ch = studioDb()
        .channel(chanName("studio-voices"))
        .on("postgres_changes", { event: "*", schema: "public", table: "studio_voices" }, () => {
          if (kick.current) clearTimeout(kick.current);
          kick.current = setTimeout(reload, 300);
        })
        .subscribe();
    } catch {
      ch = null;
    }
    return () => {
      alive.current = false;
      if (kick.current) clearTimeout(kick.current);
      if (ch) void studioDb().removeChannel(ch);
    };
  }, [reload]);

  return { voices, reload, loaded, error };
}

// ---------------------------------------------------------------------------------------------
// Upload ke bucket "studio"
// ---------------------------------------------------------------------------------------------
/** tipe yang diterima bucket (sama dengan migration-20) */
const BUCKET_MIMES = new Set([
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave", "audio/webm", "audio/ogg", "audio/mp4", "audio/aac", "audio/x-m4a", "audio/flac",
  "video/mp4", "video/webm", "video/quicktime",
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml",
  "application/json", "text/plain", "application/x-subrip", "text/html",
]);
const EXT_MIME: Record<string, string> = {
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", oga: "audio/ogg", flac: "audio/flac", weba: "audio/webm",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml",
  json: "application/json", txt: "text/plain", srt: "application/x-subrip", html: "text/html",
};
const MIME_EXT: Record<string, string> = { "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac", "audio/ogg": "ogg", "audio/webm": "webm", "audio/flac": "flac", "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg" };
export const STUDIO_MAX_UPLOAD = 200 * 1024 * 1024;

export const fileExt = (name: string) => (/\.([a-z0-9]{1,5})$/i.exec(name)?.[1] ?? "").toLowerCase();

/**
 * Upload file user ke bucket "studio".
 * - "uploads" -> uploads/<uid>/<sub?>/<uuid>.<ext>   (lampiran chat, logo, musik, klip)
 * - "voices"  -> voices/<uuid>/raw.<ext>              (rekaman bank suara; uuid = id baris studio_voices)
 * Melempar Error berpesan awam kalau gagal.
 */
export async function uploadStudioFile(file: File, folder: "uploads" | "voices", sub?: string): Promise<{ path: string; src: string }> {
  if (file.size > STUDIO_MAX_UPLOAD) throw new Error("File terlalu besar (maks 200 MB).");
  const typed = (file.type || "").toLowerCase();
  let ext = fileExt(file.name) || MIME_EXT[typed] || "";
  const mime = BUCKET_MIMES.has(typed) ? typed : EXT_MIME[ext] ?? "";
  if (!mime) throw new Error("Jenis file tidak didukung.");
  if (!ext) ext = MIME_EXT[mime] ?? "bin";
  const id = crypto.randomUUID();
  let path: string;
  if (folder === "voices") path = `voices/${id}/raw.${ext}`;
  else {
    const uid = await studioUid();
    if (!uid) throw new Error("Sesi login habis. Muat ulang halaman lalu coba lagi.");
    const dir = (sub ?? "").replace(/[^\w/-]/g, "").replace(/\/{2,}/g, "/").replace(/^\/|\/$/g, "").slice(0, 60);
    path = `uploads/${uid}/${dir ? `${dir}/` : ""}${id}.${ext}`;
  }
  const { error } = await studioDb().storage.from(STUDIO_BUCKET).upload(path, file, { contentType: mime, upsert: false, cacheControl: "3600" });
  if (error) throw new Error(friendlyStudioError(error));
  return { path, src: storageSrc(path) };
}

// ---------------------------------------------------------------------------------------------
// Antrian suara & render (dikerjakan voice-worker di laptop)
// ---------------------------------------------------------------------------------------------
export type JobStatus = "antri" | "proses" | "selesai" | "gagal" | "batal";
export const JOB_DONE: JobStatus[] = ["selesai", "gagal", "batal"];
export type JobTable = "studio_voice_jobs" | "studio_render_jobs";

export type VoiceJobLine = { id: string; scene_id: string; text: string; spell: string | null; start: number };
/** `start` = detik baris ini ditaruh di VO lengkap (full.mp3) */
export type VoiceJobResultLine = { id: string; scene_id: string; path: string; dur: number; words?: Word[]; start?: number };
export type VoiceJobResult = {
  lines?: VoiceJobResultLine[];
  full_path?: string | null;
  srt_path?: string | null;
  bpm?: number;
  beats?: number[];
  lufs?: number;
  dur?: number;
};
export type VoiceJob = {
  id: string;
  kind: "tts" | "clean" | "beats";
  project_id: string | null;
  voice_id: string | null;
  /** naskah yang dikirim (tts) — untuk cek naskah adegan belum berubah saat hasilnya ditempel */
  lines?: VoiceJobLine[];
  status: JobStatus;
  progress: number;
  message: string | null;
  engine_used: string | null;
  result: VoiceJobResult | null;
  created_at: string;
};
export type RenderJob = {
  id: string;
  project_id: string | null;
  variant: "vo" | "tanpa-vo";
  status: JobStatus;
  progress: number;
  message: string | null;
  result_path: string | null;
  created_at: string;
};

const VOICE_JOB_COLS = "id,kind,project_id,voice_id,lines,status,progress,message,engine_used,result,created_at";
const RENDER_JOB_COLS = "id,project_id,variant,status,progress,message,result_path,created_at";
const colsOf = (t: JobTable) => (t === "studio_voice_jobs" ? VOICE_JOB_COLS : RENDER_JOB_COLS);

/** masukkan job suara ke antrian (status 'antri'). Melempar Error berpesan awam. */
export async function createVoiceJob(job: {
  kind: VoiceJob["kind"];
  project_id?: string | null;
  voice_id?: string | null;
  engine?: "auto" | "chatterbox" | "pocket";
  lines?: VoiceJobLine[];
  settings?: Record<string, unknown>;
}): Promise<VoiceJob> {
  const uid = await studioUid();
  if (!uid) throw new Error("Sesi login habis. Muat ulang halaman lalu coba lagi.");
  const { data, error } = await studioDb()
    .from("studio_voice_jobs")
    .insert({ kind: job.kind, project_id: job.project_id ?? null, voice_id: job.voice_id ?? null, engine: job.engine ?? "auto", lines: job.lines ?? [], settings: job.settings ?? {}, status: "antri", created_by: uid })
    .select(VOICE_JOB_COLS)
    .single();
  if (error || !data) throw Object.assign(new Error(friendlyStudioError(error)), { missing: isMissingTable(error) });
  return data as VoiceJob;
}

/** masukkan render MP4 ke antrian laptop */
export async function createRenderJob(job: { project_id?: string | null; timeline: Timeline; variant: RenderJob["variant"] }): Promise<RenderJob> {
  const uid = await studioUid();
  if (!uid) throw new Error("Sesi login habis. Muat ulang halaman lalu coba lagi.");
  const { data, error } = await studioDb()
    .from("studio_render_jobs")
    .insert({ project_id: job.project_id ?? null, timeline: job.timeline, variant: job.variant, status: "antri", created_by: uid })
    .select(RENDER_JOB_COLS)
    .single();
  if (error || !data) throw Object.assign(new Error(friendlyStudioError(error)), { missing: isMissingTable(error) });
  return data as RenderJob;
}

/** batalkan job (RLS hanya mengizinkan ubah status jadi 'batal') */
export async function cancelStudioJob(table: JobTable, id: string): Promise<void> {
  const { error } = await studioDb().from(table).update({ status: "batal" }).eq("id", id);
  if (error) throw new Error(friendlyStudioError(error));
}
export const cancelVoiceJob = (id: string) => cancelStudioJob("studio_voice_jobs", id);
export const cancelRenderJob = (id: string) => cancelStudioJob("studio_render_jobs", id);

/**
 * Pantau satu job: realtime UPDATE baris itu + polling (5 dtk kalau realtime belum tersambung, 15 dtk kalau sudah).
 * Berhenti sendiri setelah status selesai/gagal/batal. `missing` = baris tidak ditemukan (dihapus / bukan milik user).
 */
export function useStudioJob<T extends { id: string; status: JobStatus }>(table: JobTable, id: string | null): { job: T | null; missing: boolean } {
  const [job, setJob] = useState<T | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setJob(null);
    setMissing(false);
    if (!id) return;
    const sb = studioDb();
    let alive = true;
    let live = false;
    let done = false;
    let lastPoll = 0;
    const take = (row: T) => {
      if (!alive) return;
      // realtime bisa tidak mengirim kolom besar yang tidak berubah (mis. lines) -> sisanya diambil dari data sebelumnya
      setJob((prev) => (prev && prev.id === row.id ? { ...prev, ...row } : row));
      if (JOB_DONE.includes(row.status)) done = true;
    };
    const poll = async () => {
      lastPoll = Date.now();
      try {
        const { data, error } = await sb.from(table).select(colsOf(table)).eq("id", id).maybeSingle();
        if (!alive) return;
        if (data) take(data as unknown as T);
        else if (!error) {
          setMissing(true);
          done = true;
        }
      } catch {
        /* coba lagi di putaran berikutnya */
      }
    };
    void poll();
    let ch: RealtimeChannel | null = null;
    try {
      ch = sb
        .channel(chanName(`job-${id}`))
        .on("postgres_changes", { event: "UPDATE", schema: "public", table, filter: `id=eq.${id}` }, (payload) => {
          const row = payload.new as Partial<T> | null;
          if (row && row.id === id) take({ ...(row as T) });
        })
        .subscribe((s) => {
          live = s === "SUBSCRIBED";
        });
    } catch {
      ch = null;
    }
    const t = setInterval(() => {
      if (done || document.hidden) return;
      if (Date.now() - lastPoll >= (live ? 15_000 : 5_000) - 100) void poll();
    }, 5_000);
    return () => {
      alive = false;
      clearInterval(t);
      if (ch) void sb.removeChannel(ch);
    };
  }, [table, id]);

  return { job, missing };
}

/** ingat id job yang sedang jalan (per proyek) supaya tetap terpantau setelah halaman dimuat ulang */
export function rememberJob(key: string, id: string | null) {
  try {
    if (id) localStorage.setItem(key, id);
    else localStorage.removeItem(key);
  } catch {
    /* mode privat: abaikan */
  }
}
export function recallJob(key: string): string | null {
  try {
    const v = localStorage.getItem(key);
    return v && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// TTS langsung (Edge cadangan / ElevenLabs premium) lewat POST /api/studio/tts
// ---------------------------------------------------------------------------------------------
export type TtsResult = { src: string; dur: number; words: Word[]; engine: "edge" | "elevenlabs"; temp: boolean; label: string };
export const EDGE_LABEL = "VO sementara · cadangan (layanan tidak resmi)";

export async function requestTts(
  body: { text: string; spell?: string; voice?: EdgeVoice; engine?: "edge" | "elevenlabs"; rate?: string },
  signal?: AbortSignal,
): Promise<TtsResult> {
  let r: Response;
  try {
    r = await fetch("/api/studio/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error("Koneksi putus. Cek internet lalu coba lagi.");
  }
  const j = (await r.json().catch(() => null)) as Partial<TtsResult> & { error?: string } | null;
  if (!r.ok || !j || typeof j.src !== "string") {
    // pesan dari server (mis. "kunci premium belum diset") lebih jelas daripada pesan umum per status
    if (j?.error && j.error.length < 160) throw new Error(j.error);
    if (r.status === 404) throw new Error("Layanan suara belum terpasang di website.");
    if (r.status === 401 || r.status === 403) throw new Error("Kamu belum punya akses Studio untuk ini.");
    if (r.status === 503) throw new Error("Layanan suara sedang tidak bisa dihubungi. Coba lagi sebentar lagi.");
    throw new Error("Gagal bikin suara. Coba lagi.");
  }
  const engine = j.engine === "elevenlabs" ? "elevenlabs" : "edge";
  return {
    src: j.src,
    dur: Math.max(0.05, Number(j.dur) || 0.05),
    words: Array.isArray(j.words) ? j.words.filter((w) => w && typeof w.w === "string") : [],
    engine,
    temp: j.temp ?? engine === "edge",
    label: j.label || (engine === "edge" ? EDGE_LABEL : "Premium"),
  };
}

// ---------------------------------------------------------------------------------------------
// Simpan file ke perangkat
// ---------------------------------------------------------------------------------------------
/** download Blob (klik link otomatis) */
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  saveUrl(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function saveUrl(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** ambil file dari URL Studio (mis. /api/studio/file?p=…) lalu download; gagal -> buka di tab baru */
export async function downloadStudioUrl(src: string, name: string): Promise<void> {
  try {
    const r = await fetch(src);
    if (!r.ok) throw new Error(String(r.status));
    saveBlob(await r.blob(), name);
  } catch {
    window.open(src, "_blank", "noopener");
  }
}

/** HP (terutama iPhone) sering tidak bisa download langsung -> menu Bagikan / Simpan */
export const canShareFile = (f: File) => typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [f] });

/** nama file aman dari judul video */
export const fileSlug = (title: string) =>
  title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "video-studio";
