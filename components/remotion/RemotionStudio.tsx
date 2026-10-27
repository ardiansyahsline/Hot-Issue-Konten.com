"use client";

import { Player, type PlayerRef } from "@remotion/player";
import type { WebRendererAudioCodec, WebRendererContainer, WebRendererVideoCodec } from "@remotion/web-renderer";
import { useEffect, useRef, useState } from "react";
import { COMPOSITIONS, filesOf, type Comp } from "./compositions";

type RenderState =
  | { s: "idle" }
  | { s: "rendering"; progress: number }
  | { s: "done"; url: string; file: File; secs: number; note?: string }
  | { s: "error"; msg: string };

/** simpan file ke perangkat (klik link download secara otomatis) */
function saveUrl(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** nama file download dari alamat (…/teaser-cs-tracker.mp4 → teaser-cs-tracker.mp4) */
const nameOf = (url: string, fallback: string) => decodeURIComponent(url.split(/[?#]/)[0].split("/").pop() || "") || fallback;

/**
 * Cek file jadi benar-benar ada (HEAD) sebelum tombol download ditampilkan — file teaser disajikan route terlindungi
 * dan bisa saja belum diunggah (404). Hasil per alamat: true ada, false tidak ada, undefined masih dicek.
 */
function useFilesExist(urls: string[]): Record<string, boolean | undefined> {
  const [known, setKnown] = useState<Record<string, boolean>>({});
  const key = urls.join("\n");
  useEffect(() => {
    const todo = key ? key.split("\n").filter((u) => !(u in known)) : [];
    if (!todo.length) return;
    let live = true;
    for (const url of todo)
      // redirect manual: sesi habis -> middleware 307 ke /login (200 HTML) tidak boleh dianggap "file ada"
      fetch(url, { method: "HEAD", cache: "no-store", redirect: "manual" })
        .then((r) => live && setKnown((k) => ({ ...k, [url]: r.status === 200 && (r.headers.get("content-type") ?? "").startsWith("video/") })))
        .catch(() => live && setKnown((k) => ({ ...k, [url]: false })));
    return () => {
      live = false;
    };
  }, [key, known]);
  return known;
}

/** HP (terutama iPhone) sering tidak bisa download langsung -> pakai menu Bagikan / Simpan Video */
const canShare = (f: File) => typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [f] });

// Remotion gratis untuk perorangan / perusahaan ≤ 3 orang. Kalau perlu lisensi perusahaan, isi key-nya di env Vercel.
const LICENSE = process.env.NEXT_PUBLIC_REMOTION_LICENSE_KEY || "free-license";

/** Menu Remotion (admin): pilih video, ubah teks, preview, lalu render jadi file MP4 langsung di browser */
export default function RemotionStudio({ active = true }: { active?: boolean }) {
  const [comp, setComp] = useState<Comp>(COMPOSITIONS[0]);
  const [props, setProps] = useState<Record<string, unknown>>(comp.defaultProps);
  const [render, setRender] = useState<RenderState>({ s: "idle" });
  const abort = useRef<AbortController | null>(null);
  const player = useRef<PlayerRef>(null);

  // tab ditinggal -> pemutar berhenti (editan & render yang sedang jalan tetap aman)
  useEffect(() => {
    if (!active) player.current?.pause();
  }, [active]);

  // bersihkan file video lama dari memori browser
  useEffect(() => () => void (render.s === "done" && URL.revokeObjectURL(render.url)), [render]);

  const pick = (c: Comp) => {
    if (render.s === "rendering") return;
    setComp(c);
    setProps(c.defaultProps);
    setRender({ s: "idle" });
  };

  const start = async () => {
    const ctrl = new AbortController();
    abort.current = ctrl;
    setRender({ s: "rendering", progress: 0 });
    const t0 = performance.now();
    let note: string | undefined;
    try {
      // template Studio (teaser): font Studio didaftarkan dulu supaya teks di <svg> (angka 3D, label chart) ikut font asli
      const [wr] = await Promise.all([
        import("@remotion/web-renderer"),
        comp.studio ? import("@/components/remotion/studio/fonts").then((m) => m.registerStudioFonts()) : null,
      ]);
      const { renderMediaOnWeb, getEncodableVideoCodecs, getEncodableAudioCodecs } = wr;
      let container: WebRendererContainer;
      let videoCodec: WebRendererVideoCodec;
      let audioCodec: WebRendererAudioCodec | null = null;
      let muted = true;
      if (comp.studio) {
        // bersuara (musik + SFX) seperti ExportPanel: MP4 (H.264 + AAC), kalau tidak bisa WebM (+ Opus)
        const [v4, a4] = await Promise.all([getEncodableVideoCodecs("mp4"), getEncodableAudioCodecs("mp4")]);
        if (v4.includes("h264") && a4.includes("aac")) {
          container = "mp4";
          videoCodec = "h264";
          audioCodec = "aac";
        } else {
          const [vw, aw] = await Promise.all([getEncodableVideoCodecs("webm"), getEncodableAudioCodecs("webm")]);
          container = "webm";
          videoCodec = vw.includes("vp9") ? "vp9" : (vw[0] ?? "vp8");
          audioCodec = aw.includes("opus") ? "opus" : (aw[0] ?? null);
          note = audioCodec
            ? "Browser ini belum bisa MP4 — file dibikin WebM (tetap bisa diupload ke kebanyakan platform)."
            : "Browser ini tidak bisa bikin audio — video jadi tanpa suara. Pakai Chrome / Edge untuk versi bersuara.";
        }
        muted = !audioCodec;
      } else {
        // MP4 (H.264) kalau browser bisa — paling aman buat diupload ke TikTok/IG; selain itu WebM
        const mp4 = await getEncodableVideoCodecs("mp4");
        container = mp4.includes("h264") ? "mp4" : "webm";
        videoCodec = container === "mp4" ? "h264" : ((await getEncodableVideoCodecs("webm"))[0] ?? "vp8");
      }
      const res = await renderMediaOnWeb({
        composition: {
          id: comp.id,
          component: comp.component,
          width: comp.width,
          height: comp.height,
          fps: comp.fps,
          durationInFrames: comp.durationInFrames,
          defaultProps: comp.defaultProps,
        },
        inputProps: props,
        container,
        videoCodec,
        videoBitrate: "high",
        ...(muted ? { muted: true } : { muted: false, audioCodec, audioBitrate: "high" as const }),
        signal: ctrl.signal,
        licenseKey: LICENSE,
        onProgress: (p) => setRender({ s: "rendering", progress: p.progress }),
      });
      const blob = await res.getBlob();
      const file = new File([blob], `${comp.renderName ?? comp.id}.${container}`, { type: blob.type || `video/${container}` });
      const url = URL.createObjectURL(file);
      setRender({ s: "done", url, file, secs: Math.round((performance.now() - t0) / 1000), note });
      saveUrl(url, file.name); // langsung terdownload begitu jadi
    } catch (e) {
      if (ctrl.signal.aborted) setRender({ s: "idle" });
      else setRender({ s: "error", msg: e instanceof Error ? e.message : String(e) });
    } finally {
      abort.current = null;
    }
  };

  const busy = render.s === "rendering";
  // pilihan versi (mis. Pakai VO) bukan editan teks: file jadi versi itu tetap bisa langsung didownload
  const textOnly = (p: Record<string, unknown>) => Object.fromEntries(Object.entries(p).filter(([k]) => !comp.fields.some((f) => f.key === k && f.variant)));
  const edited = JSON.stringify(textOnly(props)) !== JSON.stringify(textOnly(comp.defaultProps));
  const files = filesOf(comp, props);
  const known = useFilesExist(files.map((f) => f.url));
  const okFiles = files.filter((f) => known[f.url] === true);
  const missing = files.filter((f) => known[f.url] === false);
  const checking = files.some((f) => known[f.url] === undefined);
  const ready = okFiles.length > 0;
  const secs = Math.round(comp.durationInFrames / comp.fps);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="card flex justify-center p-3 sm:p-5">
        <Player
          ref={player}
          component={comp.component}
          inputProps={props}
          durationInFrames={comp.durationInFrames}
          compositionWidth={comp.width}
          compositionHeight={comp.height}
          fps={comp.fps}
          controls
          loop
          clickToPlay
          doubleClickToFullscreen
          acknowledgeRemotionLicense
          style={{ width: "100%", maxWidth: `calc(72vh * ${comp.width / comp.height})`, aspectRatio: `${comp.width} / ${comp.height}`, borderRadius: 16, overflow: "hidden" }}
        />
      </div>

      <div className="space-y-4">
        <div className="card p-4">
          <div className="label">Pilih video</div>
          <div className="space-y-2">
            {COMPOSITIONS.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => pick(c)}
                className={`w-full rounded-xl border px-3.5 py-3 text-left transition ${c.id === comp.id ? "border-orange-500 bg-orange-500/10" : "border-zinc-800 hover:border-zinc-700"}`}
              >
                <div className="text-sm font-semibold">{c.title}</div>
                <div className="mt-0.5 text-xs text-zinc-500">{c.desc}</div>
                <div className="mt-1.5 text-[11px] font-semibold text-zinc-400">
                  {c.width}×{c.height} · {Math.round(c.durationInFrames / c.fps)} detik · {c.fps} fps
                </div>
              </button>
            ))}
          </div>
        </div>

        {comp.fields.length > 0 ? (
          <div className="card space-y-3 p-4">
            <div className="label mb-0">{comp.fields.some((f) => f.type === "text") ? "Ubah teks" : "Pilihan"}</div>
            {comp.fields.map((f) =>
              f.type === "toggle" ? (
                <label key={f.key} className="flex cursor-pointer items-start gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-orange-500"
                    checked={Boolean(props[f.key])}
                    disabled={busy}
                    onChange={(e) => setProps((p) => ({ ...p, [f.key]: e.target.checked }))}
                  />
                  <span>
                    {f.label}
                    {f.hint && <span className="block text-xs text-zinc-500">{f.hint}</span>}
                  </span>
                </label>
              ) : (
                <div key={f.key}>
                  <label className="mb-1 block text-xs font-semibold text-zinc-400">{f.label}</label>
                  <input
                    className="input py-2 text-[13px]"
                    value={String(props[f.key] ?? "")}
                    disabled={busy}
                    maxLength={90}
                    onChange={(e) => setProps((p) => ({ ...p, [f.key]: e.target.value }))}
                  />
                  {f.hint && <p className="mt-1 text-[11px] text-zinc-500">{f.hint}</p>}
                </div>
              ),
            )}
            <button type="button" className="text-xs font-semibold text-zinc-500 hover:text-zinc-300" disabled={busy} onClick={() => setProps(comp.defaultProps)}>
              ↺ Balikin ke teks awal
            </button>
          </div>
        ) : comp.guide ? (
          <div className="card space-y-1.5 p-4" data-template-guide>
            <div className="label mb-0">{comp.guide.title}</div>
            <p className="text-xs leading-relaxed text-zinc-400">{comp.guide.text}</p>
          </div>
        ) : null}

        <div className="card space-y-3 p-4">
          <div className="label mb-0">Download video</div>
          {!edited && okFiles.length > 0 && (
            <>
              {okFiles.map((f, i) => (
                <a key={f.url} href={f.url} download={nameOf(f.url, `${comp.id}.mp4`)} className={i === 0 ? "btn-primary w-full" : "btn-ghost w-full"}>
                  ⬇️ Download MP4 {f.label ? `— ${f.label}` : "sekarang"}
                </a>
              ))}
              <p className="text-[11px] text-zinc-500">
                {files.some((f) => f.label) ? "File jadi" : "Video versi teks awal"}, langsung download tanpa nunggu.{" "}
                <a href={okFiles[0].url} target="_blank" rel="noreferrer" className="font-semibold text-orange-400 underline">
                  Buka di tab baru
                </a>{" "}
                kalau di HP nggak mau kedownload (tekan lama videonya → Simpan).
              </p>
            </>
          )}
          {files.length > 0 && !edited && checking && !ready && <p className="text-[11px] text-zinc-500">Cek file jadi…</p>}
          {files.length > 0 && !edited && !checking && !ready && <p className="text-[11px] text-zinc-500">File jadi belum tersedia — bikin langsung di browser lewat tombol di bawah.</p>}
          {!edited && ready && missing.some((f) => f.label) && (
            <p className="text-[11px] text-zinc-500">Belum tersedia: {missing.map((f) => f.label).filter(Boolean).join(", ")}.</p>
          )}
          {ready && edited && render.s === "idle" && (
            <p className="text-[11px] text-amber-400">Teks sudah diubah — klik tombol di bawah buat bikin video versi baru.</p>
          )}
          {render.s === "rendering" ? (
            <>
              <div className="h-2.5 overflow-hidden rounded-full bg-zinc-800">
                <div className="h-full rounded-full bg-orange-500 transition-[width]" style={{ width: `${Math.round(render.progress * 100)}%` }} />
              </div>
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Lagi dibikin… {Math.round(render.progress * 100)}% — jangan tutup tab ini</span>
                <button type="button" className="font-semibold text-red-400 hover:text-red-300" onClick={() => abort.current?.abort()}>
                  Batal
                </button>
              </div>
            </>
          ) : (
            <button type="button" className={ready && !edited ? "btn-ghost w-full" : "btn-primary w-full"} onClick={start}>
              🎬 {ready && !edited ? "Bikin ulang di browser" : `Bikin file video (${secs} detik)`}{comp.studio ? " — tanpa VO" : ""}
            </button>
          )}
          {render.s === "done" && (
            <>
              <button type="button" className="btn-primary w-full" onClick={() => saveUrl(render.url, render.file.name)}>
                ⬇️ Download {render.file.name.split(".").pop()?.toUpperCase()} ({(render.file.size / 1e6).toFixed(1)} MB)
              </button>
              {canShare(render.file) && (
                <button type="button" className="btn-ghost w-full" onClick={() => navigator.share({ files: [render.file] }).catch(() => {})}>
                  📤 Simpan ke HP / Bagikan
                </button>
              )}
              <p className="text-[11px] text-zinc-500">
                Jadi dalam {render.secs} detik.{" "}
                <a href={render.url} target="_blank" rel="noreferrer" className="font-semibold text-orange-400 underline">
                  Buka di tab baru
                </a>{" "}
                kalau download nggak jalan.
              </p>
              {render.note && <p className="text-[11px] text-amber-400">{render.note}</p>}
            </>
          )}
          {render.s === "error" && <p className="text-xs text-red-400">Gagal bikin video: {render.msg}</p>}
          <p className="text-[11px] leading-relaxed text-zinc-500">
            Video dibikin langsung di browser (paling lancar di Chrome / Edge laptop), {comp.studio ? "dengan SFX (tanpa musik latar)" : "tanpa suara"}. {comp.note}
          </p>
        </div>
      </div>
    </div>
  );
}
