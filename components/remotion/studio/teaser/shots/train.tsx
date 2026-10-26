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
import { AbsoluteFill, Easing, useRemotionEnvironment } from "remotion";
import { BRANDS } from "@/lib/studio/timeline";
import { Glow } from "../../fx";
import { AiScreen } from "../../screens/ai";
import { mkClock, ORANGE_GRAD, type Env } from "../../screens/ui";
import { Cam, camAtTime, Caption, clamp01, Depth, EASE, Flash, prog, rgba, sixWords, springAt, Sweep, useShot, type CamKey } from "../kit";
import { Confetti, OR, Page, QuizCard, ResultBody, RoleBody, StageSub, T_GROUP, T_QUIZ, T_STAGES, TapFx, TrainModal, type Cannon } from "./train-parts";

/** detik pukulan SFX (relatif awal adegan) */
const HIT = [0.6, 1.2, 1.8];
const RES = 2.4;
const CONF = 3.0;
const NEXT = 4.2;
const ROLE = 4.8;
/** caption masuk setelah transisi whip selesai (0,4 dtk): kata yang naik di bawah blur transisi terpotong jadi balok di render browser */
const CAP_AT = 0.4;
/** auto-lanjut kuis website (setTimeout 160 ms) */
const ADV = 0.16;

/** lebar modal (px CSS); pengali px CSS → px kanvas dihitung dari tinggi kotak aman (dengan/tanpa ruang subtitle) */
const MW = 380;
/** tinggi isi kuis 12/12 terpanjang (header 82 + pad 16 + dimensi 20 + soal 2 baris 55 + A–D 258 + petunjuk 29 + footer 62 + sisa) → pilihan D & petunjuk tidak terpotong */
const MH_NEED = 534;
const MH_MAX = 545;
/** posisi penting di modal (px CSS dari pojok kiri atas modal) */
const BODY = 82; // header + progres
const Y_TITLE = 12;
const Y_SUB = 34;
const Y_BARS = 76;
const HERO_TOP = BODY + 16; // TypeScene
const HERO_BOT = HERO_TOP + 248 + 12 + 43; // TypeScene (tinggi auto) + "Karakter kamu / ENFP · Si Penyemangat"
const TILES_Y = HERO_TOP + 16 + 128 + 4 + 18;

/** gerak "membanting" ke ketukan: makin cepat sampai berhenti tepat di frame pukulan (frame pukulan tajam, frame sebelumnya kena motion blur) */
const SLAM = (x: number) => x * x * x;
/** mendarat pelan (awal lembut, akhir sangat halus) */
const SETTLE = Easing.bezier(0.3, 0.1, 0.35, 1);

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

/**
 * pita caption padat sampai bawah caption lalu memudar — isi yang terdorong kamera ke atas tidak jadi "teks hantu" di belakang caption.
 * Div setinggi pita (bukan seluas kanvas) dengan color-stop PERSEN: @remotion/web-renderer tidak mengerti stop px (disebar merata → kanvas gelap).
 */
function TopScrim({ y, bg }: { y: number; bg: string }) {
  const h = Math.max(1, Math.round(y + 120));
  const P = (v: number) => `${((v / h) * 100).toFixed(2)}%`;
  return <div style={{ position: "absolute", left: 0, top: 0, right: 0, height: h, pointerEvents: "none", background: `linear-gradient(180deg, ${bg} 0%, ${bg} ${P(y)}, ${rgba(bg, 0.78)} ${P(y + 34)}, ${rgba(bg, 0)} 100%)` }} />;
}

/**
 * lebar perkiraan satu baris caption dalam em (font display 800, letter-spacing -0.035em, jarak kata 0.24em seperti Caption di kit).
 * Sengaja sedikit lebih lebar dari aslinya (Jakarta/Inter/Inter Tight) → kalau perkiraan bilang muat, baris asli pasti tidak terlipat.
 */
const chW = (c: string) => {
  if ("iljI.,:;'!|ı".includes(c)) return 0.32;
  if ("frtJ()-/".includes(c)) return 0.46;
  if ("mw".includes(c)) return 0.94;
  if ("MW".includes(c)) return 1.02;
  if (/[A-Z]/.test(c)) return 0.78;
  if (/[a-z]/.test(c)) return 0.62;
  if (/[0-9]/.test(c)) return 0.66;
  return (c.codePointAt(0) ?? 0) > 0x2000 ? 1.2 : 0.72;
};
const lineEm = (line: string) => {
  const ws = line.split(/\s+/).filter(Boolean);
  return ws.reduce((a, w) => a + Array.from(w).reduce((b, c) => b + chW(c) - 0.035, 0), 0) + Math.max(0, ws.length - 1) * 0.24;
};

/** teks layar custom (scene.text, maks 2 baris × 6 kata): ukuran font menyesuaikan supaya tiap baris tetap satu baris; tinggi pita dipakai tata letak modal */
function captionFit(text: string[], boxW: number, portrait: boolean) {
  const lines = text.map(sixWords).filter(Boolean).slice(0, 2);
  if (!lines.length) return { lines, fs: 0, h: 0 };
  const base = portrait ? (lines.length > 1 ? 84 : 92) : 78;
  const room = boxW * 0.88; // sisa ±12% untuk font lebih lebar (Inter) & selisih perkiraan
  const fs = Math.round(Math.max(40, Math.min(base, ...lines.map((l) => room / lineEm(l)))));
  // kalimat yang tetap terlalu panjang di font minimum boleh terlipat → hitung barisnya supaya modal turun secukupnya
  const rows = lines.reduce((a, l) => a + Math.max(1, Math.ceil((lineEm(l) * fs) / boxW)), 0);
  return { lines, fs, h: rows * fs * 1.12 };
}

export function TrainAiShot() {
  const { f, fps, s, box, W, H, brand, text, portrait } = useShot();

  // ---------------- tata letak dunia (px kanvas) ----------------
  // pita caption mengikuti teks layar (bisa diubah user; kosong = tanpa teks → modal naik memakai ruangnya)
  const cap = captionFit(text, box.w, portrait);
  const capBottom = cap.lines.length ? box.y + cap.h + 7 : box.y - 12;
  const top0 = capBottom + 28;
  const avail = box.y + box.h - 6 - top0;
  const S = Math.min(2.1, Math.max(1.6, avail / MH_NEED));
  const MH = Math.min(MH_MAX, Math.round(avail / S));
  const mTop = top0 + Math.max(0, (avail - MH * S) * 0.5);
  const mw = MW * S;
  const cx = box.x + box.w / 2;
  const mLeft = cx - mw / 2;
  const wp = (x: number, y: number) => ({ x: mLeft + x * S, y: mTop + y * S });
  const tiles = wp(MW / 2, TILES_Y);
  const optsC = wp(MW / 2, BODY + 16 + 207);
  const cardW = (MW - 32 - 8) / 2;
  const veCard = wp(16 + cardW + 8 + cardW / 2, BODY + 16 + 33 + 107 + 67);
  const quizC = wp(MW / 2, (Y_TITLE + MH - 29) / 2);
  const heroC = wp(MW / 2, (HERO_TOP + HERO_BOT) / 2);
  const modalC = wp(MW / 2, MH / 2);

  // area layar yang dipakai: di bawah caption s/d bawah kotak aman (12% bawah kotak dihindari untuk teks penting)
  const uTop = Math.max(box.y, capBottom + 12);
  const uBot = box.y + box.h * 0.88;
  const boxBot = box.y + box.h - 4;
  const midU = (uTop + uBot) / 2;
  const midB = (uTop + boxBot) / 2;
  const zFull = Math.min(1.03, (boxBot - uTop) / (MH * S));
  // dorong ke hero sebesar mungkin tanpa teks (chip headline ±260 px CSS, blok hero) keluar kotak aman
  const zHmax = Math.min((uBot - uTop) / ((HERO_BOT - HERO_TOP) * S), (box.w * 0.9) / (262 * S), 1.42);

  // ---------------- kamera (keyframe di ketukan) ----------------
  // kuis: bawah modal dikunci di bawah kotak aman → saat kamera mendorong, footer tetap di kotak dan header yang "masuk" ke bawah caption (memudar)
  const aQ = (z: number) => aim(W, H, quizC.x, mTop + MH * S, z, cx, boxBot - 2);
  const aH = (z: number) => aim(W, H, heroC.x, heroC.y, z, cx, midU);
  const aR = (z: number) => aim(W, H, modalC.x, modalC.y, z, cx, midB);
  const aV = (z: number) => aim(W, H, veCard.x, veCard.y, z, cx, midU);
  // halaman peran utuh di kotak aman, sedikit condong ke kartu terpilih (semua teks tajam masih di dalam kotak saat dipilih)
  const aG = (z: number) => aim(W, H, mLeft + 205 * S, veCard.y, z, cx, midU);
  const q0 = aQ(zFull + 0.07);
  const keys: CamKey[] = [
    { t: 0, z: q0.z, x: q0.x + 70, y: q0.y + 30, r: 1.4 },
    { t: 0.45, ...aQ(zFull), r: 0, ease: EASE.out },
    // tiap ui-snap: kamera mendorong & berhenti TEPAT di ketukan, sudut bergantian (terasa seperti potongan)
    { t: 0.6, ...aQ(zFull + 0.05), r: -0.5, ease: SLAM },
    { t: 1.08, ...aQ(zFull + 0.057), r: -0.45, ease: EASE.soft },
    { t: 1.2, ...aQ(zFull + 0.1), r: 0.5, ease: SLAM },
    { t: 1.68, ...aQ(zFull + 0.107), r: 0.45, ease: EASE.soft },
    { t: 1.8, ...aQ(zFull + 0.145), r: -0.35, ease: SLAM },
    { t: 1.96, ...aQ(zFull + 0.15), r: -0.3, ease: EASE.soft },
    // antisipasi: mundur sedikit sambil membidik hero (energi berkumpul)
    { t: 2.27, ...aH(zFull * 0.96), r: 0, ease: EASE.inOut },
    // banting ke hero tepat di 2,4 (frame pukulan tajam), lalu dorong pelan sampai konfeti
    { t: RES, ...aH(zHmax - 0.12), ease: SLAM },
    { t: CONF, ...aH(zHmax - 0.04), ease: EASE.soft },
    { t: 3.4, ...aH(zHmax), ease: EASE.soft },
    // mundur ke kartu hasil utuh (deskripsi + footer), lalu ditahan tajam sampai "Lanjut →" ditekan
    { t: 3.72, ...aR(zFull), ease: EASE.inOut },
    { t: NEXT, ...aR(zFull + 0.012), ease: EASE.soft },
    // halaman peran: condong pelan ke kartu, tiba (diam, tajam) tepat di 4,8 → rack focus + dorong ke kartu sampai akhir
    { t: ROLE, ...aG(Math.min(1.06, zFull + 0.03)), ease: EASE.inOut },
    { t: 6.3, ...aV(1.38), ease: SETTLE },
  ];
  // denyut kamera di tiap ketukan + guncangan whoosh konfeti
  const kick = HIT.concat([ROLE]).reduce((a, h) => a + (s >= h ? 0.022 * Math.exp(-(s - h) * 10) : 0), 0) + (s >= RES ? 0.03 * Math.exp(-(s - RES) * 7) : 0);
  const sh = s >= CONF ? Math.exp(-(s - CONF) * 7) : 0;
  const shx = sh * 7 * Math.sin((s - CONF) * 70);
  const shy = sh * 5 * Math.cos((s - CONF) * 57);
  const bgKeys = keys.map((k) => ({ ...k, z: k.z === undefined ? undefined : 1 + (k.z - 1) * 0.35, x: k.x === undefined ? undefined : k.x * 0.3, y: k.y === undefined ? undefined : k.y * 0.3 }));

  // posisi layar titik dunia (abaikan putar kecil & denyut) → header memudar sebelum masuk pita caption
  const cam = camAtTime(keys, s);
  const sy = (py: number) => H / 2 + (py - H / 2) * cam.z + cam.y;
  const fadeAt = (cssY: number, range: number) => clamp01((sy(mTop + cssY * S) - (capBottom + 4)) / range);
  const headOp = fadeAt(Y_TITLE, 44);
  const subOp = fadeAt(Y_SUB, 40);
  const barsOp = fadeAt(Y_BARS, 34);
  const footOp = clamp01(1 - (sy(mTop + (MH - 13) * S) - (box.y + box.h)) / 40);
  // CSS blur di dalam modal (DOF, blur gerak halaman): render browser tidak menskalakan radius blur dengan transform induk → kalikan skala total di sana
  const bk = useRemotionEnvironment().isClientSideRendering ? S * cam.z : 1;

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
  // DOF saat dorong ke hero: footer & header ikut lembut (yang tajam hanya hero + nama tipe)
  const heroFocus = prog(f, fps, RES - 0.05, RES + 0.25, EASE.out) * (1 - prog(f, fps, 3.4, 3.7, EASE.inOut));

  // ---------------- masuk modal (3D, pegas) ----------------
  const ent = springAt(f, fps, 0, { damping: 15, stiffness: 120, mass: 0.9 });
  const tilt = (1 - ent) * 16;

  // ---------------- cahaya latar (oranye ↔ hijau kelompok, crossfade halus) ----------------
  const gR = prog(f, fps, resEnter, RES + 0.2, EASE.inOut) * (1 - prog(f, fps, NEXT - 0.1, NEXT + 0.3, EASE.inOut));
  const glowA = 0.32 + 0.22 * gR + (s >= RES ? 0.25 * Math.exp(-(s - RES) * 3) : 0);
  const glowY = optsC.y + (tiles.y - optsC.y) * gR;

  // ---------------- konfeti: dua meriam di sisi hero (ruang layar), huruf di tengah tetap bersih ----------------
  const camC = camAtTime(keys, CONF);
  const heroSY = H / 2 + (heroC.y - H / 2) * camC.z + camC.y;
  const canY = heroSY + (HERO_BOT - HERO_TOP) * 0.5 * S * camC.z * 0.95;
  const cannons: Cannon[] = [
    { x: cx - 480, y: canY, ang: -Math.PI / 2 + 0.3, spread: 0.5 },
    { x: cx + 480, y: canY, ang: -Math.PI / 2 - 0.3, spread: 0.5 },
  ];

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
          <Glow x={cx} y={glowY} r={720} color={OR} opacity={glowA * (1 - gR)} />
          <Glow x={cx} y={glowY} r={720} color={T_GROUP.color} opacity={glowA * gR} />
          <div
            style={{
              position: "absolute",
              left: mLeft,
              top: mTop,
              width: MW,
              height: MH,
              // ayunan masuk murni 2D (scaleX = cos sudut + sedikit skew): rotateY 3D di bawah blur transisi whip tidak tergambar di render browser
              transform: `translateX(${((1 - ent) * 120).toFixed(2)}px) scale(${S}) scaleX(${Math.cos((tilt * Math.PI) / 180).toFixed(4)}) skewY(${(-tilt * 0.1).toFixed(3)}deg)`,
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
              sheen={prog(f, fps, 0.2, 1.0, EASE.inOut)}
              headOp={headOp}
              subOp={subOp}
              barsOp={barsOp}
              footOp={footOp}
              dim={Math.max(focus, heroFocus)}
              bk={bk}
            >
              {T_QUIZ.map((q, i) => (
                <Page key={q.qi} f={f} fps={fps} bk={bk} enter={qEnter[i]} exit={i < 2 ? qEnter[i + 1] - 0.02 : resEnter - 0.02}>
                  <QuizCard f={f} fps={fps} qi={q.qi} pick={q.pick} hit={HIT[i]} enter={qEnter[i]} />
                </Page>
              ))}
              <Page f={f} fps={fps} bk={bk} enter={resEnter} exit={roleEnter - 0.02}>
                <ResultBody f={f} fps={fps} enter={resEnter} at={RES} hopAt={CONF} descAt={3.45} />
              </Page>
              <Page f={f} fps={fps} bk={bk} enter={roleEnter}>
                <RoleBody f={f} fps={fps} enter={roleEnter} hit={ROLE} focus={focus} bk={bk} />
              </Page>
            </TrainModal>
            {/* ketuk "Lanjut →" di luar modal (riak tidak terpotong), di sisi kanan tombol supaya label terbaca */}
            <TapFx f={f} fps={fps} hit={NEXT} x={MW - 21} y={MH - 25} from={[40, 70]} />
          </div>
        </AbsoluteFill>
      </Cam>

      <Sweep at={RES} len={0.7} alpha={0.16} />
      <Flash at={RES} len={0.2} color={T_GROUP.color} max={0.13} />
      <Flash at={CONF} len={0.16} max={0.06} />
      {cap.lines.length > 0 && <TopScrim y={capBottom} bg={brand.bg} />}
      <Confetti f={f} fps={fps} at={CONF - 1 / fps} cannons={cannons} W={W} H={H} />
      {cap.lines.length > 0 && <Caption lines={cap.lines} at={CAP_AT} size={cap.fs} emphasis={["versimu"]} />}
    </AbsoluteFill>
  );
}
