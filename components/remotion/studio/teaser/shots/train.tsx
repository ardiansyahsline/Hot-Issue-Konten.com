"use client";

/**
 * Adegan 8 "Train your AI" (6,0 dtk) teaser CS Tracker — "Latih AI versimu".
 * UI = CharacterWizard / TypeScene website asli (lihat train-parts.tsx), kamera virtual + beat sync ke SFX lib/studio/teaser.ts:
 *  ui-snap 0,6 / 1,2 / 1,8   → 3 jawaban kuis terakhir diketuk (10/12, 11/12, 12/12 "Lihat hasil →"), kartu berikut masuk
 *  ai-magic + sukses-happy 2,4 → hasil tipe ENFP terungkap (chibi pop, 4 huruf membalik, sinar + light sweep, dorong kamera)
 *  whoosh-confetti 3,0        → konfeti + gelombang kejut, chibi melompat, huruf berdenyut
 *  (ketukan 4,2 tanpa SFX)    → "Lanjut →" ditekan, halaman "Mau dilatih jadi apa AI-mu?" masuk
 *  ui-pop 4,8                 → kartu peran 🎬 Video Editor (✓ cocok dengan tipe ENFP) dipilih, rack focus ke kartu
 */
import type { ReactNode } from "react";
import { AbsoluteFill } from "remotion";
import { BRANDS } from "@/lib/studio/timeline";
import { Glow } from "../../fx";
import { AiScreen } from "../../screens/ai";
import { mkClock, ORANGE_GRAD, type Env } from "../../screens/ui";
import { Cam, Caption, Depth, EASE, Flash, prog, rgba, springAt, Sweep, useShot, type CamKey } from "../kit";
import { Confetti, OR, Page, QuizCard, ResultBody, RoleBody, StageSub, T_GROUP, T_QUIZ, T_STAGES, TapFx, TrainModal } from "./train-parts";

/** detik pukulan SFX (relatif awal adegan) */
const HIT = [0.6, 1.2, 1.8];
const RES = 2.4;
const CONF = 3.0;
const NEXT = 4.2;
const ROLE = 4.8;
/** auto-lanjut kuis website (setTimeout 160 ms) */
const ADV = 0.16;

/** lebar modal (px CSS); pengali px CSS → px kanvas dihitung dari tinggi kotak aman (dengan/tanpa ruang subtitle) */
const MW = 380;
/** tinggi modal minimum supaya pilihan D kuis tidak terpotong footer (px CSS) */
const MH_NEED = 494;
const MH_MAX = 540;

/** keyframe kamera yang membidik titik dunia (px, py) ke titik layar (sx, sy) pada zoom z (origin = tengah kanvas) */
const aim = (W: number, H: number, px: number, py: number, z: number, sx: number, sy: number) => ({ z, x: sx - (W / 2 + (px - W / 2) * z), y: sy - (H / 2 + (py - H / 2) * z) });

/** halaman ✨ AI asli (tab AI) sebagai latar di belakang jendela — dibekukan di akhir ceritanya */
function AiBackdrop({ W, H }: { W: number; H: number }) {
  const e: Env = {
    t: mkClock(239, 240, 30),
    wide: false,
    brand: BRANDS.konten,
    acc: "#f97316",
    acc2: "#fb923c",
    grad: ORANGE_GRAD,
    items: [],
    title: "",
    src: null,
    w: 390,
    h: 844,
    top: 0,
    bottom: 0,
  };
  const k = Math.max(W / 390, H / 844);
  return (
    <div style={{ position: "absolute", left: (W - 390 * k) / 2, top: (H - 844 * k) / 2, width: 390, height: 844, transform: `scale(${k})`, transformOrigin: "0 0", overflow: "hidden", background: "#09090b" }}>
      <AiScreen e={e} />
    </div>
  );
}

function TopScrim({ y, bg }: { y: number; bg: string }) {
  return <AbsoluteFill style={{ pointerEvents: "none", background: `linear-gradient(180deg, ${rgba(bg, 0.97)} 0px, ${rgba(bg, 0.95)} ${Math.round(y + 6)}px, ${rgba(bg, 0)} ${Math.round(y + 120)}px)` }} />;
}

export function TrainAiShot() {
  const { f, fps, s, box, W, H, brand, text } = useShot();

  // ---------------- tata letak dunia (px kanvas) ----------------
  const capBottom = box.y + 110;
  const top0 = box.y + 138;
  const avail = box.y + box.h - 6 - top0;
  const S = Math.min(2.1, Math.max(1.6, avail / MH_NEED));
  const MH = Math.min(MH_MAX, Math.round(avail / S));
  const mTop = top0 + Math.max(0, (avail - MH * S) * 0.5);
  const mw = MW * S;
  const cx = box.x + box.w / 2;
  const mLeft = cx - mw / 2;
  const wp = (x: number, y: number) => ({ x: mLeft + x * S, y: mTop + y * S });
  const BODY = 79; // tinggi header + progres (px CSS)
  const tiles = wp(MW / 2, BODY + 16 + 16 + 128 + 4 + 18);
  const optsC = wp(MW / 2, BODY + 16 + 200);
  const cardW = (MW - 32 - 8) / 2;
  const veCard = wp(16 + cardW + 8 + cardW / 2, BODY + 223);

  // ---------------- kamera (keyframe di ketukan) ----------------
  const id = { z: 1, x: 0, y: 0 };
  const aO = (z: number) => aim(W, H, optsC.x, optsC.y, z, optsC.x, optsC.y);
  const aT = (z: number, k: number) => aim(W, H, tiles.x, tiles.y, z, cx, box.y + box.h * k);
  const aV = (z: number) => aim(W, H, veCard.x, veCard.y, z, veCard.x - 24, veCard.y - 10);
  const keys: CamKey[] = [
    { t: 0, z: 1.07, x: 70, y: 30, r: 1.4 },
    { t: 0.5, ...aO(1.0), r: 0, ease: EASE.out },
    // dorong bertahap di tiap ketukan jawaban (kamera ikut "masuk" ke kuis)
    { t: 0.6, ...aO(1.0) },
    { t: 0.86, ...aO(1.035), ease: EASE.out },
    { t: 1.2, ...aO(1.042), ease: EASE.soft },
    { t: 1.46, ...aO(1.075), ease: EASE.out },
    { t: 1.8, ...aO(1.082), ease: EASE.soft },
    { t: 2.04, ...aO(1.1), ease: EASE.out },
    // antisipasi: mundur sedikit sebelum hasil terungkap
    { t: 2.33, z: 0.975, x: 0, y: 16, ease: EASE.inOut },
    // pukulan ke huruf tipe tepat di 2,4
    { t: 2.58, ...aT(1.13, 0.5), ease: EASE.out },
    { t: 3.55, ...aT(1.1, 0.49), ease: EASE.soft },
    { t: 4.12, ...id, ease: EASE.inOut },
    { t: 4.62, ...aV(1.025), ease: EASE.soft },
    // dorong ke kartu peran terpilih di 4,8
    { t: 4.98, ...aV(1.085), ease: EASE.out },
    { t: 6.3, ...aV(1.19), ease: EASE.soft },
  ];
  // denyut kamera kecil di tiap ketukan jawaban + guncangan whoosh konfeti
  const kick = HIT.concat([ROLE]).reduce((a, h) => a + (s >= h ? 0.016 * Math.exp(-(s - h) * 11) : 0), 0) + (s >= RES ? 0.03 * Math.exp(-(s - RES) * 7) : 0);
  const sh = s >= CONF ? Math.exp(-(s - CONF) * 7) : 0;
  const shx = sh * 7 * Math.sin((s - CONF) * 70);
  const shy = sh * 5 * Math.cos((s - CONF) * 57);
  const bgKeys = keys.map((k) => ({ ...k, z: k.z === undefined ? undefined : 1 + (k.z - 1) * 0.35, x: k.x === undefined ? undefined : k.x * 0.3, y: k.y === undefined ? undefined : k.y * 0.3 }));

  // ---------------- status wizard ----------------
  const qEnter = [0, HIT[0] + ADV, HIT[1] + ADV];
  const resEnter = HIT[2] + ADV;
  const roleEnter = NEXT + 0.03;
  const onRole = s >= roleEnter;
  const onRes = s >= resEnter && !onRole;
  const qi = s < qEnter[1] ? 0 : s < qEnter[2] ? 1 : 2;
  const quizN = 10 + qi;
  // progres tahap 2 (Kenali kepribadianmu): (i+1)/(12+1) → 100% di hasil; tahap 3 (Latih perannya): 1/(10+1)
  const ease = (a: number, b: number, from: number, to: number) => from + (to - from) * prog(f, fps, a, a + b, EASE.out);
  const b1 = s < qEnter[1] ? 10 / 13 : s < qEnter[2] ? ease(qEnter[1], 0.25, 10 / 13, 11 / 13) : s < resEnter ? ease(qEnter[2], 0.25, 11 / 13, 12 / 13) : ease(resEnter, 0.3, 12 / 13, 1);
  const b2 = onRole ? ease(roleEnter, 0.3, 0, 1 / 11) : 0;
  const bars = [1, b1, b2, 0];
  const answered = !onRes && !onRole && s >= HIT[qi];
  const nextLabel = !onRes && !onRole && qi === 2 ? "Lihat hasil →" : "Lanjut →";
  const nextOn = onRes || onRole || answered;
  const nf = Math.round(NEXT * fps);
  const nextPress = f >= nf - 2 && f <= nf + 1 ? 0.92 : f > nf + 1 && f < nf + 8 ? 1 + 0.03 * Math.sin(((f - nf - 1) / 7) * Math.PI) : 1;
  const sub: ReactNode = onRole ? (
    <StageSub f={f} fps={fps} label={T_STAGES[2]} />
  ) : onRes ? (
    <StageSub f={f} fps={fps} label={T_STAGES[1]} />
  ) : (
    <StageSub f={f} fps={fps} label={T_STAGES[1]} n={quizN} changeAt={qi > 0 ? qEnter[qi] : undefined} />
  );
  const focus = prog(f, fps, ROLE + 0.05, ROLE + 0.45, EASE.out);

  // ---------------- masuk modal (3D, pegas) ----------------
  const ent = springAt(f, fps, 0, { damping: 15, stiffness: 120, mass: 0.9 });
  const tilt = (1 - ent) * 16;

  // ---------------- cahaya latar ----------------
  const gR = prog(f, fps, resEnter, RES + 0.2, EASE.inOut) * (1 - prog(f, fps, NEXT - 0.1, NEXT + 0.3, EASE.inOut));
  const glowC = gR > 0.5 ? T_GROUP.color : OR;
  const glowA = 0.32 + 0.22 * gR + (s >= RES ? 0.25 * Math.exp(-(s - RES) * 3) : 0);

  return (
    <AbsoluteFill>
      {/* latar: halaman AI asli, buram (DOF) + gelap bg-black/60 */}
      <Cam keys={bgKeys} blur={false}>
        <Depth blur={16}>
          <AiBackdrop W={W} H={H} />
        </Depth>
      </Cam>
      <AbsoluteFill style={{ background: "rgba(0,0,0,0.66)" }} />

      <Cam keys={keys}>
        <AbsoluteFill style={{ transform: `translate(${shx.toFixed(2)}px, ${shy.toFixed(2)}px) scale(${(1 + kick).toFixed(4)})`, transformOrigin: `${cx}px ${tiles.y}px` }}>
          <Glow x={cx} y={gR > 0.5 ? tiles.y : optsC.y} r={720} color={glowC} opacity={glowA} />
          <div
            style={{
              position: "absolute",
              left: mLeft,
              top: mTop,
              width: MW,
              height: MH,
              transform: `perspective(2600px) translateX(${((1 - ent) * 120).toFixed(2)}px) rotateY(${(-tilt).toFixed(3)}deg) scale(${S})`,
              transformOrigin: "0 0",
              opacity: Math.min(1, ent * 1.8),
            }}
          >
            <TrainModal
              w={MW}
              h={MH}
              sub={sub}
              bars={bars}
              next={nextLabel}
              nextOn={nextOn}
              nextPress={nextPress}
              footerFx={<TapFx f={f} fps={fps} hit={NEXT} x="62%" y="55%" from={[-30, -60]} />}
              sheen={prog(f, fps, 0.2, 1.0, EASE.inOut)}
            >
              {T_QUIZ.map((q, i) => (
                <Page key={q.qi} f={f} fps={fps} enter={qEnter[i]} exit={i < 2 ? qEnter[i + 1] - 0.02 : resEnter - 0.02}>
                  <QuizCard f={f} fps={fps} qi={q.qi} pick={q.pick} hit={HIT[i]} enter={qEnter[i]} />
                </Page>
              ))}
              <Page f={f} fps={fps} enter={resEnter} exit={roleEnter - 0.02}>
                <ResultBody f={f} fps={fps} enter={resEnter} at={RES} hopAt={CONF} />
              </Page>
              <Page f={f} fps={fps} enter={roleEnter}>
                <RoleBody f={f} fps={fps} enter={roleEnter} hit={ROLE} focus={focus} />
              </Page>
            </TrainModal>
          </div>
          <Confetti f={f} fps={fps} at={CONF - 1 / fps} ox={tiles.x} oy={tiles.y} />
        </AbsoluteFill>
      </Cam>

      <Sweep at={RES} len={0.7} alpha={0.16} />
      <Flash at={RES} len={0.25} color={T_GROUP.color} max={0.22} />
      <Flash at={CONF} len={0.18} max={0.12} />
      <TopScrim y={capBottom} bg={brand.bg} />
      <Caption lines={text} at={0.12} emphasis={["versimu"]} />
    </AbsoluteFill>
  );
}
