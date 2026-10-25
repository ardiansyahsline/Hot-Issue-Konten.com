/**
 * Daftar komposisi untuk render di laptop (Remotion CLI):
 *   npx remotion render remotion/index.ts StudioVideo out.mp4 --props=props.json --config=remotion.config.mjs
 * props.json = { "timeline": <TIMELINE JSON>, "audio": "all" | "vo" | "novo" }.
 * Ukuran, fps & durasi dihitung dari timeline (calculateMetadata → studioMeta).
 *
 * Route website (/api/studio/…) tidak bisa diakses dari renderer laptop, jadi alamat media dipetakan ke folder public
 * Remotion (bawaan assets/audio, bisa diganti `--public-dir=<folder>`):
 *   /api/studio/asset/sfx/<file>   → <public>/sfx/<file>      (SFX bawaan repo)
 *   /api/studio/asset/music/<file> → <public>/music/<file>    (musik repo)
 *   /api/studio/file?p=<path>      → <public>/storage/<path>  (worker sendiri menulis ulang URL ini jadi /public/st/<hash>.<ext>)
 *   /public/<path>                 → <public>/<path>
 *   /konten-logo.png, /brand/tws-logo.svg (logo bawaan brand preset) → <public>/brand/<file> KALAU ada di folder public
 *     (worker menyalinnya dari public/ repo); kalau tidak ada (render CLI biasa dengan public bawaan assets/audio) → file repo
 *     public/konten-logo.png & public/brand/tws-logo.svg ikut di-bundle webpack, jadi render tidak gagal karena logo 404.
 *
 * Teaser CS Tracker premium (komposisi "TeaserCsTracker", props bawaan = teaserTimeline() dari lib/studio/teaser.ts):
 *   npx remotion render remotion/index.ts TeaserCsTracker teaser.mp4 --config=remotion.config.mjs --public-dir=<folder>
 *   npx remotion render remotion/index.ts TeaserCsTracker teaser-tanpa-vo.mp4 --props='{"audio":"novo"}' --config=… --public-dir=<folder>
 *   --public-dir harus berisi brand/konten-logo.png + brand/tws-logo.svg (salin dari public/konten-logo.png & public/brand/tws-logo.svg)
 *   plus sfx/ (salin assets/audio/sfx) dan music/ bila dipakai — sama dengan yang disiapkan worker. Tanpa --public-dir (bawaan
 *   assets/audio, tanpa brand/) render tetap jalan: logo diambil dari file repo yang di-bundle (lihat presetLogoSrc).
 *   Versi dengan suara VO: buka teaser di Studio Pro (🎞️ Buka Teaser CS Tracker) → Bikin suara VO → render dari sana / worker, karena file VO ada di storage Studio (props timeline.vo).
 *   Hasil MP4 taruh di assets/videos/ (BUKAN public/) — disajikan /api/studio/video/<nama> (wajib login + akses Studio).
 */
import "@fontsource-variable/inter";
import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource-variable/inter-tight";
import type { FC } from "react";
import { Composition, getStaticFiles, staticFile, type CalculateMetadataFunction } from "remotion";
import { StudioVideo, studioMeta, type StudioVideoProps } from "@/components/remotion/studio/StudioVideo";
import { SrcCtx } from "@/components/remotion/studio/theme";
import { teaserTimeline } from "@/lib/studio/teaser";
import { defaultTimeline, isPresetLogo, PRESET_LOGOS } from "@/lib/studio/timeline";
import { storagePathOf } from "@/lib/studio/urls";
// logo brand preset ikut di-bundle (asset webpack Remotion → URL) sebagai cadangan kalau <public>/brand/ tidak ada
import kontenLogoAsset from "../public/konten-logo.png";
import twsLogoAsset from "../public/brand/tws-logo.svg";

/** "a%20b/c.mp3" → staticFile("a b/c.mp3") (staticFile meng-encode sendiri) */
const pub = (p: string) => {
  let x = p;
  try {
    x = decodeURIComponent(p);
  } catch {
    // biarkan apa adanya
  }
  return staticFile(x.replace(/^\/+/, ""));
};

/** hasil import gambar: string (webpack Remotion) atau { src } (tipe Next) */
const assetUrl = (m: unknown): string => (typeof m === "string" ? m : m && typeof m === "object" && "src" in m && typeof (m as { src: unknown }).src === "string" ? (m as { src: string }).src : "");
const BUNDLED_LOGO: Record<string, string> = { [PRESET_LOGOS.konten]: assetUrl(kontenLogoAsset), [PRESET_LOGOS.tws]: assetUrl(twsLogoAsset) };

/** daftar file di folder public (render & Remotion Studio; kosong di tempat lain) */
function publicHas(rel: string): boolean {
  try {
    return getStaticFiles().some((f) => f.name === rel);
  } catch {
    return false;
  }
}

/** logo brand preset: <public>/brand/<file> kalau ada (worker), kalau tidak file repo yang di-bundle (CLI biasa) */
function presetLogoSrc(src: string): string {
  const rel = `brand/${src.split("/").pop()}`;
  if (publicHas(rel)) return pub(rel);
  return BUNDLED_LOGO[src] || pub(rel);
}

/** alamat website → file di folder public Remotion */
export function laptopSrc(src: string): string {
  if (!src || /^(https?:|data:|blob:)/.test(src)) return src;
  const asset = src.match(/^\/api\/studio\/asset\/(sfx|music)\/([^?#]+)/);
  if (asset) return pub(`${asset[1]}/${asset[2]}`);
  const store = storagePathOf(src);
  if (store) return pub(`storage/${store}`);
  if (src.startsWith("/public/")) return pub(src.slice("/public/".length));
  if (isPresetLogo(src)) return presetLogoSrc(src);
  return src;
}

/** StudioVideo dengan alamat media versi laptop */
const StudioVideoLaptop: FC<StudioVideoProps> = (p) => (
  <SrcCtx.Provider value={laptopSrc}>
    <StudioVideo {...p} />
  </SrcCtx.Provider>
);

const studioDefaults: StudioVideoProps = { timeline: defaultTimeline(), showSafeZone: false, audio: "all" };
const studioMetadata: CalculateMetadataFunction<StudioVideoProps> = ({ props }) => studioMeta(props.timeline);

/** Teaser CS Tracker premium: timeline bawaan lib/studio/teaser.ts (bisa ditimpa --props, mis. {"audio":"novo"}) */
const teaserDefaults: StudioVideoProps = { timeline: teaserTimeline(), showSafeZone: false, audio: "all" };

export function RemotionRoot() {
  const m = studioMeta(studioDefaults.timeline);
  const t = studioMeta(teaserDefaults.timeline);
  return (
    <>
      <Composition
        id="StudioVideo"
        component={StudioVideoLaptop}
        defaultProps={studioDefaults}
        calculateMetadata={studioMetadata}
        width={m.width}
        height={m.height}
        fps={m.fps}
        durationInFrames={m.durationInFrames}
      />
      <Composition
        id="TeaserCsTracker"
        component={StudioVideoLaptop}
        defaultProps={teaserDefaults}
        calculateMetadata={studioMetadata}
        width={t.width}
        height={t.height}
        fps={t.fps}
        durationInFrames={t.durationInFrames}
      />
    </>
  );
}
