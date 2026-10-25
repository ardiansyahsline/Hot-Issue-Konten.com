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
 */
import "@fontsource-variable/inter";
import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource-variable/inter-tight";
import type { FC } from "react";
import { Composition, staticFile, type CalculateMetadataFunction } from "remotion";
import { StudioVideo, studioMeta, type StudioVideoProps } from "@/components/remotion/studio/StudioVideo";
import { SrcCtx } from "@/components/remotion/studio/theme";
import { defaultTimeline } from "@/lib/studio/timeline";
import { storagePathOf } from "@/lib/studio/urls";

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

/** alamat website → file di folder public Remotion */
export function laptopSrc(src: string): string {
  if (!src || /^(https?:|data:|blob:)/.test(src)) return src;
  const asset = src.match(/^\/api\/studio\/asset\/(sfx|music)\/([^?#]+)/);
  if (asset) return pub(`${asset[1]}/${asset[2]}`);
  const store = storagePathOf(src);
  if (store) return pub(`storage/${store}`);
  if (src.startsWith("/public/")) return pub(src.slice("/public/".length));
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

export function RemotionRoot() {
  const m = studioMeta(studioDefaults.timeline);
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
    </>
  );
}
