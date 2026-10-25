"use client";

import { Player, type PlayerRef } from "@remotion/player";
import dynamic from "next/dynamic";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { StudioVideo, studioMeta } from "@/components/remotion/studio/StudioVideo";
import { useStudioCatalog } from "@/lib/studio/client";
import type { SfxMeta } from "@/lib/studio/sfxMeta";
import { FORMATS, defaultTimeline, sceneStartSecs, sceneStarts, totalSec, type Timeline } from "@/lib/studio/timeline";
import { createClient } from "@/lib/supabase/client";
import DirectorChat from "./DirectorChat";
import PlanCard from "./PlanCard";
import ProjectBar, { type ProjectRow, type SaveState } from "./ProjectBar";
import { Toggle } from "./fields";
import { dbErrorText, fmtSec, keepDataVo, sfxExtraOf, tidyTimeline, withoutDataVo } from "./planUtils";

// panel berat (timeline, suara, export) dimuat belakangan supaya chat cepat siap
const skeleton = (h: string) =>
  function Skeleton() {
    return <div className={`card ${h} animate-pulse`} />;
  };
const TimelineEditor = dynamic(() => import("./TimelineEditor"), { ssr: false, loading: skeleton("h-40") });
const VoPanel = dynamic(() => import("./VoPanel"), { ssr: false, loading: skeleton("h-32") });
const ExportPanel = dynamic(() => import("./ExportPanel"), { ssr: false, loading: skeleton("h-32") });

const LAST_KEY = "studio:lastProject";
const SAFE_KEY = "studio:safeZone";
const SAVE_DELAY = 1500;
/** judul bawaan proyek baru (sama dengan route chat) */
const NEW_TITLE = "Video baru";

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {}
  },
};

type Job = { id: string | null; tl: Timeline };

/**
 * Studio Pro: proyek + chat Harley + kartu rencana (kiri) dan preview, timeline, suara, export (kanan, sticky).
 * Timeline disimpan otomatis ke studio_projects.timeline (jeda 1,5 dtk) lewat Supabase client (RLS).
 */
/** file VO utuh (untuk unduh MP3) basi kalau posisi adegan yang bersuara bergeser -> dibuang, unduh VO lalu dirender ulang */
function dropStaleFullVo(prev: Timeline | null, next: Timeline): Timeline {
  const vo = next.vo;
  if (!vo?.full || !prev?.vo || prev.vo.full !== vo.full) return next; // file baru dari generate -> biarkan
  const at = (tl: Timeline) => {
    const st = sceneStartSecs(tl);
    return new Map(tl.scenes.map((s, i) => [s.id, st[i]]));
  };
  const a = at(prev);
  const b = at(next);
  const moved = vo.lines.length !== prev.vo.lines.length || vo.lines.some((l) => Math.abs((a.get(l.sceneId) ?? -1) - (b.get(l.sceneId) ?? -2)) > 1e-3);
  return moved ? { ...next, vo: { ...vo, full: null } } : next;
}

export default function StudioPro({ active = true }: { active?: boolean }) {
  const sb = useMemo(() => createClient(), []);
  const catalog = useStudioCatalog();
  const catRef = useRef(catalog);
  catRef.current = catalog;
  const sfxExtra = useMemo(() => sfxExtraOf(catalog), [catalog]);

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [barErr, setBarErr] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>("idle");
  const [opening, setOpening] = useState(false);
  const [creating, setCreating] = useState(false);
  const playerRef = useRef<PlayerRef>(null);

  const idRef = useRef<string | null>(null);
  const tlRef = useRef<Timeline | null>(null);
  const listRef = useRef(projects);
  listRef.current = projects;
  const setPid = useCallback((id: string | null) => {
    idRef.current = id;
    setProjectId(id);
    store.set(LAST_KEY, id);
  }, []);
  /** proyek yang baru disimpan naik ke atas daftar */
  const bump = useCallback(
    (id: string, updated_at: string) =>
      setProjects((ps) => {
        const p = ps.find((x) => x.id === id);
        return p ? [{ ...p, updated_at }, ...ps.filter((x) => x.id !== id)] : ps;
      }),
    [],
  );

  // ---------- simpan otomatis (antri berurutan supaya urutan tulis tidak tertukar) ----------
  const queued = useRef<Job | null>(null);
  const failed = useRef<Job | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());

  const flush = useCallback((): Promise<void> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const job = queued.current;
    if (!job) return chain.current;
    queued.current = null;
    chain.current = chain.current.then(async () => {
      setSave("saving");
      try {
        if (!job.id) {
          // cadangan: belum ada proyek -> buat dulu
          const { data, error } = await sb.from("studio_projects").insert({ title: job.tl.title.slice(0, 120) || NEW_TITLE, timeline: job.tl }).select("id, title, updated_at").single();
          if (error || !data) throw error ?? new Error("insert");
          const row = data as ProjectRow;
          setProjects((ps) => [row, ...ps]);
          if (idRef.current === null) {
            setPid(row.id);
            setTitle(row.title);
          }
          // editan yang menyusul ikut masuk ke proyek yang baru dibuat
          if (queued.current && !queued.current.id) queued.current.id = row.id;
        } else {
          const { data, error } = await sb.from("studio_projects").update({ timeline: job.tl }).eq("id", job.id).select("updated_at").maybeSingle();
          if (error) throw error;
          if (data) bump(job.id, (data as { updated_at: string }).updated_at);
        }
        setSave(queued.current ? "dirty" : "saved");
      } catch (e) {
        // simpan lagi nanti kalau belum ada perubahan yang lebih baru
        if (!queued.current) failed.current = job;
        setSave("error");
        setBarErr(dbErrorText(e as { code?: string; message?: string }, "Gagal menyimpan otomatis. Cek internet lalu klik Coba lagi."));
      }
    });
    return chain.current;
  }, [sb, setPid, bump]);

  const queueSave = useCallback(
    (tl: Timeline) => {
      queued.current = { id: idRef.current, tl };
      failed.current = null;
      setSave("dirty");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DELAY);
    },
    [flush],
  );
  const retrySave = useCallback(() => {
    if (!queued.current && failed.current) queued.current = failed.current;
    failed.current = null;
    setBarErr(null);
    void flush();
  }, [flush]);

  // tab ditutup saat masih ada yang belum tersimpan -> simpan + minta konfirmasi
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (!queued.current && !timer.current) return;
      void flush();
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [flush]);
  useEffect(() => () => void flush(), [flush]);

  /** semua perubahan timeline dari editor (rencana, timeline, suara) */
  const change = useCallback(
    (next: Timeline) => {
      const tl = dropStaleFullVo(tlRef.current, next);
      tlRef.current = tl;
      setTimeline(tl);
      queueSave(tl);
    },
    [queueSave],
  );

  // ---------- proyek ----------
  const open = useCallback(
    async (id: string) => {
      void flush();
      setBarErr(null);
      setPid(id);
      setTitle(listRef.current.find((p) => p.id === id)?.title ?? "");
      tlRef.current = null;
      setTimeline(null);
      setSelected(null);
      setSave("idle");
      setOpening(true);
      const { data, error } = await sb.from("studio_projects").select("id, title, timeline").eq("id", id).maybeSingle();
      if (idRef.current !== id) return; // sudah pindah proyek lagi
      setOpening(false);
      if (error || !data) {
        setBarErr(error ? dbErrorText(error, "Gagal membuka proyek. Coba lagi.") : "Proyek tidak ditemukan (mungkin sudah dihapus).");
        return;
      }
      const row = data as { title: string | null; timeline: unknown };
      setTitle(row.title ?? "");
      const tl = row.timeline ? tidyTimeline(row.timeline, catRef.current) : null;
      tlRef.current = tl;
      setTimeline(tl);
    },
    [sb, flush, setPid],
  );

  // daftar proyek milik sendiri, lalu buka proyek terakhir
  useEffect(() => {
    let dead = false;
    (async () => {
      const { data: u } = await sb.auth.getUser();
      const me = u.user?.id;
      let q = sb.from("studio_projects").select("id, title, updated_at").order("updated_at", { ascending: false }).limit(60);
      if (me) q = q.eq("owner", me);
      const { data, error } = await q;
      if (dead) return;
      if (error) {
        setBarErr(dbErrorText(error, "Gagal memuat daftar proyek."));
        setLoading(false);
        return;
      }
      const list = (data ?? []) as ProjectRow[];
      setProjects(list);
      listRef.current = list;
      const last = store.get(LAST_KEY);
      const pick = list.find((p) => p.id === last)?.id ?? list[0]?.id;
      // open() langsung mengisi projectId sebelum menunggu DB -> chat tidak sempat tampil sebagai "proyek baru"
      if (pick) void open(pick);
      setLoading(false);
    })().catch(() => {
      if (!dead) {
        setBarErr("Gagal memuat proyek. Cek internet lalu muat ulang.");
        setLoading(false);
      }
    });
    return () => {
      dead = true;
    };
  }, [sb, open]);

  const fresh = useCallback(() => {
    void flush();
    setBarErr(null);
    setPid(null);
    setTitle("");
    tlRef.current = null;
    setTimeline(null);
    setSelected(null);
    setSave("idle");
    setOpening(false);
  }, [flush, setPid]);

  const example = useCallback(async () => {
    setCreating(true);
    const tl = tidyTimeline(defaultTimeline(), catRef.current);
    const { data, error } = await sb.from("studio_projects").insert({ title: "Contoh video", timeline: tl }).select("id, title, updated_at").single();
    setCreating(false);
    if (error || !data) return setBarErr(dbErrorText(error, "Gagal membuat proyek. Coba lagi."));
    const row = data as ProjectRow;
    void flush();
    setProjects((ps) => [row, ...ps]);
    setPid(row.id);
    setTitle(row.title);
    tlRef.current = tl;
    setTimeline(tl);
    setSelected(null);
    setSave("saved");
  }, [sb, flush, setPid]);

  const rename = useCallback(
    async (t: string) => {
      const id = idRef.current;
      if (!id) return;
      setTitle(t);
      setProjects((ps) => ps.map((p) => (p.id === id ? { ...p, title: t } : p)));
      const { error } = await sb.from("studio_projects").update({ title: t }).eq("id", id);
      if (error) setBarErr(dbErrorText(error, "Gagal ganti judul. Coba lagi."));
    },
    [sb],
  );

  const remove = useCallback(async () => {
    const id = idRef.current;
    if (!id) return;
    if (queued.current?.id === id) queued.current = null;
    if (failed.current?.id === id) failed.current = null;
    const { error } = await sb.from("studio_projects").delete().eq("id", id);
    if (error) return setBarErr(dbErrorText(error, "Gagal menghapus proyek. Coba lagi."));
    const rest = listRef.current.filter((p) => p.id !== id);
    setProjects(rest);
    listRef.current = rest;
    if (rest[0]) void open(rest[0].id);
    else fresh();
  }, [sb, open, fresh]);

  // ---------- dari chat Harley ----------
  const onProject = useCallback(
    (id: string, t: string) => {
      if (idRef.current === id) return;
      const name = t || NEW_TITLE;
      setPid(id);
      setTitle(name);
      setBarErr(null);
      setProjects((ps) => (ps.some((p) => p.id === id) ? ps : [{ id, title: name, updated_at: new Date().toISOString() }, ...ps]));
    },
    [setPid],
  );
  const onPlan = useCallback(
    (raw: unknown) => {
      const tl = keepDataVo(tlRef.current, tidyTimeline(raw, catRef.current));
      change(tl);
      setSelected(null);
      playerRef.current?.seekTo(0);
      // proyek masih berjudul bawaan -> ikut judul rencana (server melakukan hal yang sama)
      const id = idRef.current;
      if (id && tl.title && tl.title !== NEW_TITLE) {
        const name = tl.title.slice(0, 120);
        setTitle((cur) => (!cur || cur === NEW_TITLE ? name : cur));
        setProjects((ps) => ps.map((p) => (p.id === id && (!p.title || p.title === NEW_TITLE) ? { ...p, title: name } : p)));
      }
    },
    [change],
  );
  const getTimeline = useCallback(() => withoutDataVo(tlRef.current), []);

  /** pilih adegan dari kartu rencana -> preview lompat ke awal adegan */
  const selectScene = useCallback((sid: string) => {
    setSelected(sid);
    const tl = tlRef.current;
    const i = tl ? tl.scenes.findIndex((s) => s.id === sid) : -1;
    if (tl && i >= 0) {
      playerRef.current?.pause();
      playerRef.current?.seekTo(sceneStarts(tl)[i]);
    }
  }, []);

  // pindah tab -> preview berhenti
  useEffect(() => {
    if (!active) playerRef.current?.pause();
  }, [active]);

  return (
    <div className="space-y-4">
      <ProjectBar
        projects={projects}
        activeId={projectId}
        title={title}
        save={save}
        loading={loading || opening}
        error={barErr}
        onPick={(id) => void open(id)}
        onNew={fresh}
        onRename={(t) => void rename(t)}
        onDelete={() => void remove()}
        onRetrySave={retrySave}
      />

      {/* HP: chat → preview → rencana → suara & export. Layar lebar: kiri chat + rencana, kanan sticky */}
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-4">
          <div className="order-1 min-w-0">
            {loading ? (
              <div className="card h-[50vh] animate-pulse" />
            ) : (
              <DirectorChat
                projectId={projectId}
                getTimeline={getTimeline}
                hasPlan={!!timeline}
                onProject={onProject}
                onPlan={onPlan}
                onExample={timeline || opening ? undefined : example}
                exampleBusy={creating}
              />
            )}
          </div>
          <div className="order-3 min-w-0">
            {opening ? (
              <div className="card h-64 animate-pulse" />
            ) : timeline ? (
              <PlanCard timeline={timeline} onChange={change} catalog={catalog} selected={selected} onSelect={selectScene} />
            ) : (
              <div className="rounded-2xl border border-dashed border-zinc-800 p-5 text-center text-[13px] text-zinc-500">📋 Rencana video (naskah, adegan, musik & SFX) muncul di sini setelah ngobrol sama Harley.</div>
            )}
          </div>
        </div>

        <div className="contents lg:sticky lg:top-20 lg:flex lg:max-h-[calc(100dvh-6rem)] lg:min-w-0 lg:flex-col lg:gap-4 lg:overflow-y-auto lg:pb-1">
          <div className="order-2 min-w-0 space-y-4">
            <PreviewPane timeline={timeline} sfxExtra={sfxExtra} playerRef={playerRef} selected={selected} onSelect={setSelected} onChange={change} opening={opening} />
          </div>
          {timeline && (
            <div className="order-4 min-w-0 space-y-4">
              <VoPanel timeline={timeline} onChange={change} projectId={projectId} />
              <ExportPanel timeline={timeline} projectId={projectId} sfxExtra={sfxExtra} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** preview Player + zona aman + editor timeline (frame player dipegang di sini supaya bagian lain tidak ikut render ulang) */
const PreviewPane = memo(function PreviewPane({
  timeline,
  sfxExtra,
  playerRef,
  selected,
  onSelect,
  onChange,
  opening,
}: {
  timeline: Timeline | null;
  sfxExtra: SfxMeta[];
  playerRef: RefObject<PlayerRef | null>;
  selected: string | null;
  onSelect: (id: string) => void;
  onChange: (tl: Timeline) => void;
  opening: boolean;
}) {
  const [safe, setSafe] = useState(() => store.get(SAFE_KEY) === "1");
  const [frame, setFrame] = useState(0);
  const meta = useMemo(() => (timeline ? studioMeta(timeline) : null), [timeline]);
  const inputProps = useMemo(() => (timeline ? { timeline, showSafeZone: safe, sfxExtra } : null), [timeline, safe, sfxExtra]);
  const has = !!timeline;

  // posisi frame untuk editor timeline (dibatasi ±8x per detik supaya ringan saat diputar)
  useEffect(() => {
    if (!has) return;
    let off = () => {};
    let raf = 0;
    let tries = 0;
    const attach = () => {
      const p = playerRef.current;
      if (!p) {
        if (tries++ < 120) raf = requestAnimationFrame(attach);
        return;
      }
      let last = 0;
      let t: ReturnType<typeof setTimeout> | null = null;
      const on = (e: { detail: { frame: number } }) => {
        if (t) clearTimeout(t);
        const now = performance.now();
        if (now - last > 120) {
          last = now;
          setFrame(e.detail.frame);
        } else
          t = setTimeout(() => {
            last = performance.now();
            setFrame(p.getCurrentFrame());
          }, 130);
      };
      p.addEventListener("frameupdate", on);
      p.addEventListener("seeked", on);
      off = () => {
        p.removeEventListener("frameupdate", on);
        p.removeEventListener("seeked", on);
        if (t) clearTimeout(t);
      };
    };
    attach();
    return () => {
      cancelAnimationFrame(raf);
      off();
    };
  }, [has, playerRef]);

  const seek = useCallback((f: number) => playerRef.current?.seekTo(f), [playerRef]);
  const ratio = timeline ? FORMATS[timeline.ratio] : FORMATS["9:16"];

  return (
    <>
      <section aria-label="Preview video" className="card p-3 sm:p-4">
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-display text-[15px] font-bold">▶️ Preview</h2>
            {timeline && (
              <p className="text-[11.5px] text-zinc-500">
                {fmtSec(totalSec(timeline))} · {timeline.ratio} · {ratio.label}
              </p>
            )}
          </div>
          {timeline && (
            <Toggle
              on={safe}
              label="Tampilkan zona aman"
              onChange={(v) => {
                setSafe(v);
                store.set(SAFE_KEY, v ? "1" : "0");
              }}
            >
              Zona aman
            </Toggle>
          )}
        </div>
        <div className="flex justify-center">
          {timeline && meta && inputProps ? (
            <Player
              ref={playerRef}
              component={StudioVideo}
              inputProps={inputProps}
              durationInFrames={meta.durationInFrames}
              compositionWidth={meta.width}
              compositionHeight={meta.height}
              fps={meta.fps}
              controls
              loop
              clickToPlay
              doubleClickToFullscreen
              showVolumeControls
              acknowledgeRemotionLicense
              errorFallback={() => (
                <div className="flex h-full w-full items-center justify-center bg-zinc-950 p-4 text-center text-[13px] text-red-400">
                  Preview gagal tampil. Coba ubah adegan terakhir yang diedit, atau muat ulang halaman.
                </div>
              )}
              style={{ width: "100%", maxWidth: `calc(72vh * ${meta.width / meta.height})`, aspectRatio: `${meta.width} / ${meta.height}`, borderRadius: 14, overflow: "hidden" }}
            />
          ) : (
            <div
              className={`flex w-full items-center justify-center rounded-[14px] border border-dashed border-zinc-800 bg-zinc-950/50 p-4 text-center text-[13px] text-zinc-500 ${opening ? "animate-pulse" : ""}`}
              style={{ maxWidth: `calc(46vh * ${ratio.w / ratio.h})`, aspectRatio: `${ratio.w} / ${ratio.h}` }}
            >
              {opening ? "Membuka proyek…" : "🎬 Preview muncul di sini setelah rencana jadi."}
            </div>
          )}
        </div>
        {safe && timeline && <p className="mt-2 text-[11px] text-zinc-500">Kotak garis = area aman. Teks penting jangan keluar kotak (ketutup tombol & caption {timeline.ratio === "9:16" ? "TikTok/Reels" : "platform"}).</p>}
      </section>
      {timeline && <TimelineEditor timeline={timeline} onChange={onChange} selected={selected} onSelect={onSelect} frame={frame} onSeek={seek} />}
    </>
  );
});
