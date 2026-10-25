"use client";

import { Player } from "@remotion/player";
import { useEffect, useRef, useState } from "react";
import { COMPOSITIONS, type Comp } from "./compositions";

type RenderState =
  | { s: "idle" }
  | { s: "rendering"; progress: number }
  | { s: "done"; url: string; file: File; secs: number }
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

/** HP (terutama iPhone) sering tidak bisa download langsung -> pakai menu Bagikan / Simpan Video */
const canShare = (f: File) => typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [f] });

// Remotion gratis untuk perorangan / perusahaan ≤ 3 orang. Kalau perlu lisensi perusahaan, isi key-nya di env Vercel.
const LICENSE = process.env.NEXT_PUBLIC_REMOTION_LICENSE_KEY || "free-license";

/** Menu Remotion (admin): pilih video, ubah teks, preview, lalu render jadi file MP4 langsung di browser */
export default function RemotionStudio() {
  const [comp, setComp] = useState<Comp>(COMPOSITIONS[0]);
  const [props, setProps] = useState<Record<string, unknown>>(comp.defaultProps);
  const [render, setRender] = useState<RenderState>({ s: "idle" });
  const abort = useRef<AbortController | null>(null);

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
    try {
      const { renderMediaOnWeb, getEncodableVideoCodecs } = await import("@remotion/web-renderer");
      // MP4 (H.264) kalau browser bisa — paling aman buat diupload ke TikTok/IG; selain itu WebM
      const mp4 = await getEncodableVideoCodecs("mp4");
      const container = mp4.includes("h264") ? "mp4" : "webm";
      const videoCodec = container === "mp4" ? "h264" : ((await getEncodableVideoCodecs("webm"))[0] ?? "vp8");
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
        muted: true,
        signal: ctrl.signal,
        licenseKey: LICENSE,
        onProgress: (p) => setRender({ s: "rendering", progress: p.progress }),
      });
      const blob = await res.getBlob();
      const file = new File([blob], `${comp.id}.${container}`, { type: blob.type || `video/${container}` });
      const url = URL.createObjectURL(file);
      setRender({ s: "done", url, file, secs: Math.round((performance.now() - t0) / 1000) });
      saveUrl(url, file.name); // langsung terdownload begitu jadi
    } catch (e) {
      if (ctrl.signal.aborted) setRender({ s: "idle" });
      else setRender({ s: "error", msg: e instanceof Error ? e.message : String(e) });
    } finally {
      abort.current = null;
    }
  };

  const busy = render.s === "rendering";
  const edited = JSON.stringify(props) !== JSON.stringify(comp.defaultProps);
  const secs = Math.round(comp.durationInFrames / comp.fps);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="card flex justify-center p-3 sm:p-5">
        <Player
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

        <div className="card space-y-3 p-4">
          <div className="label mb-0">Ubah teks</div>
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

        <div className="card space-y-3 p-4">
          <div className="label mb-0">Download video</div>
          {comp.file && !edited && (
            <>
              <a href={comp.file} download={`${comp.id}.mp4`} className="btn-primary w-full">
                ⬇️ Download MP4 sekarang
              </a>
              <p className="text-[11px] text-zinc-500">
                Video versi teks awal, langsung download tanpa nunggu.{" "}
                <a href={comp.file} target="_blank" rel="noreferrer" className="font-semibold text-orange-400 underline">
                  Buka di tab baru
                </a>{" "}
                kalau di HP nggak mau kedownload (tekan lama videonya → Simpan).
              </p>
            </>
          )}
          {comp.file && edited && render.s === "idle" && (
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
            <button type="button" className={comp.file && !edited ? "btn-ghost w-full" : "btn-primary w-full"} onClick={start}>
              🎬 {comp.file && !edited ? "Bikin ulang di browser" : `Bikin file video (${secs} detik)`}
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
            </>
          )}
          {render.s === "error" && <p className="text-xs text-red-400">Gagal bikin video: {render.msg}</p>}
          <p className="text-[11px] leading-relaxed text-zinc-500">
            Video dibikin langsung di browser (paling lancar di Chrome / Edge laptop). Belum ada suara — tambahin musik / voice over di CapCut biar makin UGC.
          </p>
        </div>
      </div>
    </div>
  );
}
