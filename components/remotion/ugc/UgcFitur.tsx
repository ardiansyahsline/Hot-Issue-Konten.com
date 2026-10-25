"use client";

import { AbsoluteFill, Sequence } from "remotion";
import { AiScene, PROMPT } from "./AiScene";
import { Dashboard } from "./Dashboard";
import { HotIssue } from "./HotIssue";
import { Hook, Reveal } from "./Intro";
import { C, CaptionsOn, SceneFx } from "./kit";
import { Montage, Outro } from "./Outro";
import { ChatScene, ReportScene } from "./TeamScenes";

export type UgcFiturProps = {
  hook: string;
  prompt: string;
  cta: string;
  captions: boolean;
};

export const UGC_DEFAULTS: UgcFiturProps = {
  hook: "Tim CS masih nyatet hot issue di sheet? 🫠",
  prompt: PROMPT,
  cta: "Cobain sekarang 👉 CS Tracker",
  captions: true,
};

// urutan scene + durasinya (frame, 30 fps). Scene berikutnya mulai 6 frame sebelum yang lama selesai (transisi nyambung).
const OVERLAP = 6;
const SCENES = [
  { key: "hook", dur: 96 },
  { key: "reveal", dur: 66 },
  { key: "dashboard", dur: 165 },
  { key: "hot", dur: 195 },
  { key: "ai", dur: 390 },
  { key: "chat", dur: 150 },
  { key: "report", dur: 150 },
  { key: "montage", dur: 90 },
  { key: "outro", dur: 120 },
] as const;

export const UGC_DURATION = SCENES.reduce((n, s) => n + s.dur, 0) - OVERLAP * (SCENES.length - 1);

/** Video UGC fitur CS Tracker — 1080x1920 (9:16) buat TikTok / Reels / Shorts */
export function UgcFitur(props: UgcFiturProps) {
  const p = { ...UGC_DEFAULTS, ...props };
  let from = 0;
  return (
    <CaptionsOn.Provider value={p.captions}>
      <AbsoluteFill style={{ background: C.bg }}>
        {SCENES.map((s) => {
          const start = from;
          from += s.dur - OVERLAP;
          return (
            <Sequence key={s.key} from={start} durationInFrames={s.dur} name={s.key}>
              <SceneFx dur={s.dur}>{scene(s.key, s.dur, p)}</SceneFx>
            </Sequence>
          );
        })}
      </AbsoluteFill>
    </CaptionsOn.Provider>
  );
}

function scene(key: (typeof SCENES)[number]["key"], dur: number, p: UgcFiturProps) {
  switch (key) {
    case "hook":
      return <Hook text={p.hook} dur={dur} />;
    case "reveal":
      return <Reveal dur={dur} />;
    case "dashboard":
      return <Dashboard dur={dur} />;
    case "hot":
      return <HotIssue dur={dur} />;
    case "ai":
      return <AiScene dur={dur} prompt={p.prompt || PROMPT} />;
    case "chat":
      return <ChatScene dur={dur} />;
    case "report":
      return <ReportScene dur={dur} />;
    case "montage":
      return <Montage dur={dur} />;
    case "outro":
      return <Outro cta={p.cta} dur={dur} />;
  }
}
