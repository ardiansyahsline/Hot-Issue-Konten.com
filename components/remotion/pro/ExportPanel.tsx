"use client";

import { useEffect, useRef, useState } from "react";
import type { WebRendererAudioCodec, WebRendererContainer, WebRendererVideoCodec } from "@remotion/web-renderer";
import { StudioVideo, studioMeta, type StudioVideoProps } from "@/components/remotion/studio/StudioVideo";
import {
  canShareFile,
  cancelRenderJob,
  createRenderJob,
  downloadStudioUrl,
  fileExt,
  fileSlug,
  friendlyStudioError,
  recallJob,
  rememberJob,
  saveBlob,
  saveUrl,
  useStudioJob,
  useStudioStatus,
  type RenderJob,
} from "@/lib/studio/client";
import { storyboardHtml } from "@/lib/studio/exportDoc";
import type { SfxMeta } from "@/lib/studio/sfxMeta";
import { subtitleCues, toSrt, voClashes, voCutoffs, voGainOn, type Timeline } from "@/lib/studio/timeline";
import { storagePathOf, storageSrc } from "@/lib/studio/urls";

// Remotion gratis untuk perorangan / tim ≤ 3 orang. Perusahaan > 3 orang: isi key lisensi di env Vercel.
const LICENSE = process.env.NEXT_PUBLIC_REMOTION_LICENSE_KEY || "free-license";

type Kind = "mp4" | "mp3";
type Variant = "vo" | "novo";
type Render =
  | { s: "idle" }
  | { s: "run"; kind: Kind; p: number }
  | { s: "done"; kind: Kind; url: string; file: File; secs: number; note?: string }
  | { s: "error"; kind: Kind; msg: string; detail?: string };

const fmt = (n: number) => String(Number(n.toFixed(1))).replace(".", ",");

/** akhiran nama file kalau VO-nya masih "VO sementara" (cadangan Edge) — supaya tidak tertukar dengan versi final suara bank */
const TEMP_SUFFIX = "-vo-sementara";
/** akhiran tambahan kalau sebagian adegan yang punya teks VO belum bersuara (gagal / naskah berubah, belum di-generate ulang) */
const PART_SUFFIX = "-sebagian";

/**
 * Keadaan VO timeline untuk nama file & peringatan. Baris yang dihitung = yang benar-benar diputar planAudio (punya src & adegannya
 * masih punya teks VO). `has` false = video "Dengan VO" sebenarnya tanpa suara VO (belum dibuat / dimatikan / mode Tanpa VO).
 */
function voState(t: Timeline) {
  const on = t.voice.mode !== "none" && !t.muteVo;
  const want = t.scenes.filter((s) => s.vo?.text);
  const played = on && t.vo ? want.filter((s) => t.vo!.lines.some((l) => l.sceneId === s.id && !!l.src)) : [];
  const has = played.length > 0;
  return {
    on,
    has,
    temp: has && !!t.vo?.temp,
    /** jumlah adegan bersuara / adegan yang punya teks VO */
    done: played.length,
    want: want.length,
    partial: has && played.length < want.length,
    clash: has ? voClashes(t) : [],
    /** VO yang ujung ucapannya terpotong karena video sudah habis (mis. Outro teaser yang tetap kepanjangan) */
    cut: has ? voCutoffs(t) : [],
  };
}
type VoState = ReturnType<typeof voState>;
/**
 * akhiran nama file: MP4 tanpa VO (dipilih, atau VO belum ada / dimatikan) → "-tanpa-vo"; VO sementara → "-vo-sementara";
 * VO lengkap suara bank → tanpa akhiran (MP4) / "-vo" (.mp3); sebagian adegan belum bersuara → "...-sebagian" (mis. "-vo-sebagian")
 */
function voSuffix(st: VoState, kind: Kind, variant: Variant): string {
  if (kind === "mp4" && (variant === "novo" || !st.has)) return "-tanpa-vo";
  const base = st.temp ? TEMP_SUFFIX : kind === "mp3" ? "-vo" : "";
  return st.partial ? `${base || "-vo"}${PART_SUFFIX}` : base;
}
/** ingat per job render laptop: VO-nya sementara atau bukan saat diantrikan (RenderJob tidak membawa timeline) */
const tempKey = (id: string) => `studio-render-vo-temp:${id}`;
/** ingat per job render laptop: akhiran nama file saat diantrikan (VO sementara / sebagian) */
const suffixKey = (id: string) => `studio-render-vo-suffix:${id}`;
function markJobVo(id: string, temp: boolean, suffix: string) {
  try {
    localStorage.setItem(tempKey(id), temp ? "1" : "0");
    localStorage.setItem(suffixKey(id), suffix);
  } catch {
    /* mode privat: abaikan */
  }
}
function jobSuffix(id: string): string | null {
  try {
    return localStorage.getItem(suffixKey(id));
  } catch {
    return null;
  }
}
function jobWasTemp(id: string): boolean | null {
  try {
    const v = localStorage.getItem(tempKey(id));
    return v === null ? null : v === "1";
  } catch {
    return null;
  }
}

/** pesan awam untuk error render di browser */
function renderError(e: unknown): { msg: string; detail?: string } {
  const raw = e instanceof Error ? e.message : String(e);
  if (/codec|encod|webcodecs|VideoEncoder|AudioEncoder|not supported/i.test(raw)) return { msg: "Browser ini belum bisa bikin file video. Pakai Chrome / Edge terbaru di laptop.", detail: raw };
  if (/fetch|network|load|404|403|decode/i.test(raw)) return { msg: "Ada file suara / gambar yang gagal dimuat. Cek internet lalu coba lagi.", detail: raw };
  if (/memory|allocation|quota/i.test(raw)) return { msg: "Memori perangkat tidak cukup. Tutup tab lain atau pakai laptop.", detail: raw };
  return { msg: "Gagal bikin file. Coba lagi, atau pakai render di laptop.", detail: raw };
}

/**
 * Panel Export: MP4 di browser (dengan / tanpa VO), antrian render di laptop (gratis),
 * download VO .mp3, subtitle .srt, dan naskah + storyboard (.html / cetak PDF).
 */
export default function ExportPanel({ timeline: tl, projectId, sfxExtra }: { timeline: Timeline; projectId: string | null; sfxExtra?: SfxMeta[] }) {
  const status = useStudioStatus();
  const [variant, setVariant] = useState<Variant>("vo");
  const [render, setRender] = useState<Render>({ s: "idle" });
  const abort = useRef<AbortController | null>(null);
  const lastPct = useRef(-1);

  const meta = studioMeta(tl);
  const secs = meta.durationInFrames / meta.fps;
  const slug = fileSlug(tl.title);
  const vs = voState(tl);
  const voOn = vs.on;
  /** ada suara VO yang benar-benar ikut diputar (bukan cuma teks naskah) */
  const hasVo = vs.has;
  /** VO yang ada masih cadangan Edge ("VO sementara") */
  const voTemp = vs.temp;
  const hasVoText = tl.scenes.some((s) => s.vo?.text);
  const busy = render.s === "run";

  // VO baru jadi -> versi "Dengan VO"; VO dihapus / tanpa VO -> "Tanpa VO"
  useEffect(() => {
    setVariant(hasVo ? "vo" : "novo");
  }, [hasVo]);

  // bersihkan file lama dari memori browser
  useEffect(() => () => void (render.s === "done" && URL.revokeObjectURL(render.url)), [render]);
  useEffect(() => () => abort.current?.abort(), []);

  // ---------------- render di browser ----------------
  const renderWeb = async (kind: Kind) => {
    if (busy) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    lastPct.current = -1;
    setRender({ s: "run", kind, p: 0 });
    const t0 = performance.now();
    const snap = tl; // pakai timeline saat tombol diklik
    const st = voState(snap);
    // "Dengan VO" tanpa suara VO (belum dibuat / dimatikan) = versi tanpa VO, jangan sampai bernama versi VO
    const vari: Variant = st.has ? variant : "novo";
    let note: string | undefined;
    try {
      const [wr] = await Promise.all([import("@remotion/web-renderer"), import("@/components/remotion/studio/fonts").then((m) => m.registerStudioFonts())]);
      let container: WebRendererContainer;
      let videoCodec: WebRendererVideoCodec | null = null;
      let audioCodec: WebRendererAudioCodec | null;
      let muted = false;
      if (kind === "mp3") {
        container = "mp3";
        audioCodec = "mp3";
      } else {
        // MP4 (H.264 + AAC) paling aman untuk TikTok/IG; kalau browser tidak bisa -> WebM (+ Opus)
        const [v4, a4] = await Promise.all([wr.getEncodableVideoCodecs("mp4"), wr.getEncodableAudioCodecs("mp4")]);
        if (v4.includes("h264") && a4.includes("aac")) {
          container = "mp4";
          videoCodec = "h264";
          audioCodec = "aac";
        } else {
          const [vw, aw] = await Promise.all([wr.getEncodableVideoCodecs("webm"), wr.getEncodableAudioCodecs("webm")]);
          if (!vw.length) throw new Error("No video codec can be encoded (webcodecs not supported)");
          container = "webm";
          videoCodec = vw.includes("vp9") ? "vp9" : vw[0];
          audioCodec = aw.includes("opus") ? "opus" : (aw[0] ?? null);
          if (!audioCodec) {
            muted = true;
            note = "Browser ini tidak bisa bikin audio — video jadi tanpa suara. Pakai Chrome / Edge untuk versi bersuara.";
          } else note = "Browser ini belum bisa MP4 — file dibikin WebM (tetap bisa diupload ke kebanyakan platform).";
        }
      }
      const inputProps: StudioVideoProps = { timeline: snap, audio: kind === "mp3" ? "vo" : vari === "vo" ? "all" : "novo", sfxExtra: sfxExtra ?? [] };
      const res = await wr.renderMediaOnWeb({
        composition: { id: "studio-video", component: StudioVideo, ...studioMeta(snap), defaultProps: inputProps },
        inputProps,
        container,
        videoCodec,
        audioCodec,
        audioBitrate: "high",
        videoBitrate: "high",
        muted,
        signal: ctrl.signal,
        licenseKey: LICENSE,
        onProgress: (pr) => {
          const pct = Math.floor(pr.progress * 100);
          if (pct === lastPct.current) return;
          lastPct.current = pct;
          setRender({ s: "run", kind, p: pr.progress });
        },
      });
      const blob = await res.getBlob();
      // VO sementara (Edge) -> "-vo-sementara", sebagian adegan belum bersuara -> "...-sebagian", versi tanpa VO -> "-tanpa-vo"
      const name = `${slug}${voSuffix(st, kind, vari)}.${container}`;
      const file = new File([blob], name, { type: blob.type || (kind === "mp3" ? "audio/mpeg" : `video/${container}`) });
      const url = URL.createObjectURL(file);
      setRender({ s: "done", kind, url, file, secs: Math.round((performance.now() - t0) / 1000), note });
      saveUrl(url, file.name); // langsung terdownload begitu jadi
    } catch (e) {
      if (ctrl.signal.aborted) setRender({ s: "idle" });
      else setRender({ s: "error", kind, ...renderError(e) });
    } finally {
      if (abort.current === ctrl) abort.current = null;
    }
  };

  // ---------------- render di laptop (antrian) ----------------
  const jobKey = `studio-render-job:${projectId ?? "baru"}`;
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobErr, setJobErr] = useState<string | null>(null);
  const [queueing, setQueueing] = useState(false);
  const { job, missing } = useStudioJob<RenderJob>("studio_render_jobs", jobId);
  const renderOn = !!status?.renderWorker;

  useEffect(() => setJobId(recallJob(jobKey)), [jobKey]);
  useEffect(() => {
    if (missing || (job && (job.status === "batal" || job.status === "selesai" || job.status === "gagal"))) rememberJob(jobKey, null);
    if (missing || job?.status === "batal") setJobId(null);
  }, [job, missing, jobKey]);

  const queueLaptop = async () => {
    setJobErr(null);
    setQueueing(true);
    try {
      const vari: Variant = vs.has ? variant : "novo";
      const j = await createRenderJob({ project_id: projectId, timeline: tl, variant: vari === "vo" ? "vo" : "tanpa-vo" });
      markJobVo(j.id, vari === "vo" && voTemp, voSuffix(vs, "mp4", vari));
      rememberJob(jobKey, j.id);
      setJobId(j.id);
    } catch (e) {
      setJobErr(e instanceof Error ? e.message : friendlyStudioError(e));
    } finally {
      setQueueing(false);
    }
  };
  const cancelLaptop = async () => {
    if (!jobId) return;
    try {
      await cancelRenderJob(jobId);
    } catch (e) {
      setJobErr(friendlyStudioError(e));
    }
    rememberJob(jobKey, null);
    setJobId(null);
  };
  const laptopActive = !!jobId && !!job && (job.status === "antri" || job.status === "proses");

  // ---------------- file lain ----------------
  const cues = subtitleCues(tl);
  const downloadVo = () => {
    // VO lengkap dari laptop dipakai apa adanya, kecuali volume VO diatur di mixer (file itu belum memuatnya) → dirender dengan volume yang sama
    const full = voOn && !voGainOn(tl) ? tl.vo?.full : null;
    if (full) {
      const ext = fileExt(storagePathOf(full) ?? "") || "mp3";
      void downloadStudioUrl(full, `${slug}${voSuffix(vs, "mp3", "vo")}.${ext}`);
    } else void renderWeb("mp3");
  };
  const downloadSrt = () => saveBlob(new Blob([toSrt(cues)], { type: "application/x-subrip;charset=utf-8" }), `${slug}.srt`);
  const downloadDoc = () => saveBlob(new Blob([storyboardHtml(tl, sfxExtra ?? [])], { type: "text/html;charset=utf-8" }), `${slug}-naskah-storyboard.html`);
  const printDoc = () => {
    const html = storyboardHtml(tl, sfxExtra ?? []);
    const w = window.open("", "_blank");
    if (w) {
      w.document.open();
      w.document.write(html);
      w.document.close();
      w.focus();
      setTimeout(() => {
        try {
          w.print();
        } catch {
          /* user bisa tekan Ctrl+P sendiri */
        }
      }, 500);
      return;
    }
    // pop-up diblokir -> cetak lewat bingkai tersembunyi
    const f = document.createElement("iframe");
    f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    f.srcdoc = html;
    f.onload = () => {
      f.contentWindow?.focus();
      f.contentWindow?.print();
      setTimeout(() => f.remove(), 60_000);
    };
    document.body.appendChild(f);
  };

  const pct = render.s === "run" ? Math.round(render.p * 100) : 0;
  const jobPct = Math.round((job?.progress ?? 0) * 100);

  return (
    <div className="card min-w-0 space-y-4 p-4">
      <div className="label mb-0">Download</div>

      {/* versi */}
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            [
              "vo",
              "Dengan VO",
              hasVo
                ? `${voTemp ? "VO sementara" : "Suara"}${vs.partial ? ` (${vs.done}/${vs.want} adegan)` : ""} + musik + SFX`
                : voOn
                  ? "VO belum dibuat"
                  : "VO dimatikan",
            ],
            ["novo", "Tanpa VO", "Musik + SFX + teks"],
          ] as [Variant, string, string][]
        ).map(([id, title, sub]) => (
          <button
            key={id}
            type="button"
            disabled={busy || laptopActive || (id === "vo" && !hasVo)}
            title={id === "vo" && !hasVo ? (voOn ? "Bikin VO dulu di panel suara" : "VO dimatikan (Tanpa VO)") : undefined}
            onClick={() => setVariant(id)}
            className={`rounded-xl border px-3 py-2 text-left transition disabled:cursor-not-allowed ${variant === id && (id !== "vo" || hasVo) ? "border-orange-500 bg-orange-500/10" : "border-zinc-800 hover:border-zinc-700"} ${id === "vo" && !hasVo ? "opacity-60" : ""}`}
          >
            <div className="text-sm font-semibold">{title}</div>
            <div className="text-[11px] text-zinc-500">{sub}</div>
          </button>
        ))}
      </div>

      {/* (a) MP4 di browser */}
      <div className="space-y-2">
        {render.s === "run" ? (
          <>
            <div className="h-2.5 overflow-hidden rounded-full bg-zinc-800">
              <div className="h-full rounded-full bg-orange-500 transition-[width]" style={{ width: `${pct}%` }} />
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-zinc-400">
              <span>
                {render.kind === "mp3" ? "Bikin file VO" : "Bikin video"}… {pct}% — jangan tutup tab ini
              </span>
              <button type="button" className="flex-none font-semibold text-red-400 hover:text-red-300" onClick={() => abort.current?.abort()}>
                Batal
              </button>
            </div>
          </>
        ) : (
          <button type="button" className="btn-primary w-full" onClick={() => renderWeb("mp4")}>
            ⬇️ Download MP4 ({fmt(secs)} dtk)
          </button>
        )}
        {render.s === "done" && (
          <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/40 p-2.5">
            <div className="flex gap-2">
              <button type="button" className="btn-ghost flex-1 px-3 py-2 text-xs" onClick={() => saveUrl(render.url, render.file.name)}>
                ⬇️ {render.file.name.split(".").pop()?.toUpperCase()} lagi ({(render.file.size / 1e6).toFixed(1)} MB)
              </button>
              {canShareFile(render.file) && (
                <button type="button" className="btn-ghost flex-1 px-3 py-2 text-xs" onClick={() => navigator.share({ files: [render.file] }).catch(() => {})}>
                  📤 Bagikan / Simpan
                </button>
              )}
            </div>
            <p className="text-[11px] text-zinc-500">
              Jadi dalam {render.secs} detik.{" "}
              <a href={render.url} target="_blank" rel="noreferrer" className="font-semibold text-orange-400 underline">
                Buka di tab baru
              </a>{" "}
              kalau download tidak jalan.
            </p>
            {render.note && <p className="text-[11px] text-amber-400">{render.note}</p>}
          </div>
        )}
        {render.s === "error" && (
          <div className="rounded-lg bg-red-500/10 px-2.5 py-2 text-xs text-red-300">
            <p>{render.msg}</p>
            {render.detail && (
              <details className="mt-1 text-[10px] text-red-300/70">
                <summary className="cursor-pointer">Detail</summary>
                <p className="break-words">{render.detail.slice(0, 300)}</p>
              </details>
            )}
          </div>
        )}
        {variant === "vo" && hasVo && vs.clash.length > 0 && (
          <p className="rounded-lg bg-red-500/10 px-2.5 py-2 text-[11px] text-red-300" data-vo-clash role="alert">
            ⛔ VO menabrak VO adegan berikutnya:{" "}
            {vs.clash.map((c) => `${tl.scenes[c.scene]?.name} → ${tl.scenes[c.next]?.name} (${fmt(Math.max(0.1, c.sec))} dtk)`).join(", ")} — dua suara bunyi bersamaan di video. Pendekkan teks VO adegan itu, lalu generate ulang VO sebelum download.
          </p>
        )}
        {variant === "vo" && hasVo && vs.cut.length > 0 && (
          <p className="rounded-lg bg-red-500/10 px-2.5 py-2 text-[11px] text-red-300" data-vo-cut role="alert">
            ⛔ Ujung VO terpotong di akhir video: {vs.cut.map((c) => `${tl.scenes[c.scene]?.name} (${fmt(Math.max(0.1, c.sec))} dtk)`).join(", ")} — videonya habis sebelum
            kalimatnya selesai. Pendekkan teks VO adegan itu, lalu generate ulang VO sebelum download.
          </p>
        )}
        {variant === "vo" && vs.partial && (
          <p className="rounded-lg bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-300" data-vo-partial>
            ⚠️ Baru {vs.done} dari {vs.want} adegan yang bersuara — nama file diberi akhiran <b>{voSuffix(vs, "mp4", "vo")}</b>. Klik &quot;Generate ulang VO&quot; supaya semua adegan bersuara.
          </p>
        )}
        {variant === "vo" && voTemp && (
          <p className="rounded-lg bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-300" data-vo-temp>
            ⚠️ VO masih <b>VO sementara</b> (suara cadangan Edge) — nama file diberi akhiran <b>{voSuffix(vs, "mp4", "vo")}</b>. Versi final: nyalakan laptop, &quot;Generate ulang VO&quot; pakai bank suara, lalu download lagi.
          </p>
        )}
        <p className="text-[11px] text-zinc-500">Dibikin langsung di browser — paling lancar di Chrome / Edge laptop. Di HP bisa lama.</p>
      </div>

      {/* (b) render di laptop */}
      <div className="space-y-2 border-t border-zinc-800 pt-3">
        {laptopActive ? (
          <>
            <div className="h-2.5 overflow-hidden rounded-full bg-zinc-800">
              <div className={`h-full rounded-full bg-orange-500 transition-[width] ${jobPct ? "" : "w-1/12 animate-pulse"}`} style={jobPct ? { width: `${jobPct}%` } : undefined} />
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-zinc-400">
              <span className="min-w-0">{job?.status === "proses" ? `${job.message || "Laptop lagi render…"} ${jobPct ? `${jobPct}%` : ""}` : "Menunggu giliran di laptop…"}</span>
              <button type="button" className="flex-none font-semibold text-red-400 hover:text-red-300" onClick={cancelLaptop}>
                Batal
              </button>
            </div>
            {!renderOn && status !== null && <p className="text-[11px] text-amber-400">Laptop mati — antrian menunggu laptop nyala lagi.</p>}
          </>
        ) : (
          <button type="button" className="btn-ghost w-full" disabled={!renderOn || queueing || busy} onClick={queueLaptop}>
            🖥️ {queueing ? "Memasukkan antrian…" : "Render di laptop (gratis)"}
          </button>
        )}
        {job?.status === "selesai" && job.result_path && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
            <span>✅ Video dari laptop siap.</span>
            {(() => {
              // VO sementara saat job diantrikan (cadangan: VO timeline sekarang)
              const temp = job.variant !== "tanpa-vo" && (jobWasTemp(job.id) ?? voTemp);
              // akhiran saat diantrikan (VO sementara / sebagian); job lama tanpa catatan akhiran -> dari status sementara
              const suffix = job.variant === "tanpa-vo" ? "-tanpa-vo" : (jobSuffix(job.id) ?? (temp ? TEMP_SUFFIX : ""));
              return (
                <>
                  {temp && <span className="text-amber-300">(VO sementara)</span>}
                  <button type="button" className="font-semibold underline" onClick={() => downloadStudioUrl(storageSrc(job.result_path!), `${slug}${suffix}.${fileExt(job.result_path!) || "mp4"}`)}>
                    ⬇️ Download
                  </button>
                </>
              );
            })()}
            <button type="button" className="ml-auto text-emerald-400/70 hover:text-emerald-300" onClick={() => setJobId(null)}>
              Tutup
            </button>
          </div>
        )}
        {job?.status === "gagal" && (
          <div className="rounded-lg bg-red-500/10 px-2.5 py-2 text-xs text-red-300">
            Render di laptop gagal.{job.message ? <span className="block break-words text-[10px] text-red-300/70">Detail: {job.message.slice(0, 200)}</span> : null}
            <button type="button" className="mt-1 block font-semibold underline" onClick={() => setJobId(null)}>
              Tutup
            </button>
          </div>
        )}
        {jobErr && <p className="text-xs text-red-400">{jobErr}</p>}
        {!renderOn && !laptopActive && (
          <p className="text-[11px] text-zinc-500">{status === null ? "Cek laptop…" : "Mesin render di laptop belum nyala. Pakai Download MP4 di atas."}</p>
        )}
      </div>

      {/* (c) file lain */}
      <div className="space-y-2 border-t border-zinc-800 pt-3">
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn-ghost px-3 py-2 text-xs" disabled={busy || !hasVo} title={hasVo ? "" : "Bikin VO dulu"} onClick={downloadVo}>
            🎙️ VO (.mp3)
          </button>
          <button type="button" className="btn-ghost px-3 py-2 text-xs" disabled={!cues.length} title={cues.length ? "" : "Belum ada naskah VO"} onClick={downloadSrt}>
            💬 Subtitle (.srt)
          </button>
          <button type="button" className="btn-ghost px-3 py-2 text-xs" onClick={downloadDoc}>
            📄 Naskah + storyboard
          </button>
          <button type="button" className="btn-ghost px-3 py-2 text-xs" onClick={printDoc}>
            🖨️ Cetak / simpan PDF
          </button>
        </div>
        {!hasVo && hasVoText && voOn && <p className="text-[11px] text-zinc-500">VO .mp3 bisa diunduh setelah suara VO dibuat.</p>}
      </div>

      <p className="border-t border-zinc-800 pt-3 text-[10px] leading-relaxed text-zinc-500">
        Remotion gratis untuk tim ≤3 orang; perusahaan &gt;3 orang perlu lisensi (isi NEXT_PUBLIC_REMOTION_LICENSE_KEY).
      </p>
    </div>
  );
}
