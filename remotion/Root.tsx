/**
 * Daftar komposisi untuk render di laptop (Remotion CLI):
 *   npx remotion render remotion/index.ts StudioVideo out.mp4 --props=props.json --config=remotion.config.mjs
 * props.json = { "timeline": <TIMELINE JSON>, "audio": "all" | "vo" | "novo" }.
 * Ukuran, fps & durasi dihitung dari timeline (calculateMetadata → studioMeta).
 */
import "@fontsource-variable/inter";
import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource-variable/inter-tight";
import { Composition, type CalculateMetadataFunction } from "remotion";
import { StudioVideo, studioMeta, type StudioVideoProps } from "@/components/remotion/studio/StudioVideo";
import { FPS, H, W } from "@/components/remotion/ugc/kit";
import { UGC_DEFAULTS, UGC_DURATION, UgcFitur } from "@/components/remotion/ugc/UgcFitur";
import { defaultTimeline } from "@/lib/studio/timeline";

const studioDefaults: StudioVideoProps = { timeline: defaultTimeline(), showSafeZone: false, audio: "all" };
const studioMetadata: CalculateMetadataFunction<StudioVideoProps> = ({ props }) => studioMeta(props.timeline);

export function RemotionRoot() {
  const m = studioMeta(studioDefaults.timeline);
  return (
    <>
      <Composition
        id="StudioVideo"
        component={StudioVideo}
        defaultProps={studioDefaults}
        calculateMetadata={studioMetadata}
        width={m.width}
        height={m.height}
        fps={m.fps}
        durationInFrames={m.durationInFrames}
      />
      {/* komposisi lama "UGC — Fitur CS Tracker" (tetap bisa dirender di laptop) */}
      <Composition id="ugc-fitur-cs-tracker" component={UgcFitur} defaultProps={UGC_DEFAULTS} width={W} height={H} fps={FPS} durationInFrames={UGC_DURATION} />
    </>
  );
}
