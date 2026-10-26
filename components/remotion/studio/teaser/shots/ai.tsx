"use client";

/**
 * Adegan 6 teaser — "AI yang mikir dulu… bahkan nanya balik" (12,0 dtk, frame global 630–990).
 * Halaman ✨ AI asli (AiChat) dibuat ulang di panel melayang + kamera pelacak (dorong, rack focus, whip):
 *  0,0  ai-magic           panel AI menyala (cincin cahaya memuncak 0,12 + sapuan), sambutan hero Harley; caption mulai 0,35
 *  0,6  ui-arp-twinkle     composer berpendar, pertanyaan diketik; kamera dorong ke composer (kepala panel lewat di balik caption + scrim)
 *  1,8  (ketukan)          kirim: gelembung terbang dari composer ke atas, kamera ikut naik → sorot hero 1,96–2,6 (chip "Kamu dibantu oleh…")
 *  2,1                     ChoiceCard "Mau fokus ke mana?" + caption "Bahkan nanya balik"
 *  3,0  ui-accept-glassy   pilihan "Dua-duanya" DIKETUK (jari + cincin + kilat + sapuan) → AnsweredCard 3,3
 *  3,6                     caption "Bahkan nanya balik" keluar setelah AnsweredCard; 3,95 caption "AI yang mikir dulu" tampil lagi (sampai 6,6)
 *  4,8  ui-readout-panjang langkah berpikir ThinkingSteps bergulir (4,8 / 5,25 / 5,7 / 6,15 / 6,6), rack focus ke kotak proses
 *  7,2  ui-plucks-happy    AnalysisCard navy: pill BEARISH meletup + kartu berdenyut + kilau; metrik menyala di ketukan 7,8
 *  9,0  koin-flip          kartu chart IHSG dilempar seperti koin (rotateY 3D + busur) dan mendarat; candle terakhir + angka besar 9,6
 * 10,2  (ketukan)          chart kripto (tanpa angka) masuk dari kanan
 * 10,8  (ketukan)          AI selesai: "■ Stop" → tombol kirim (pegas), garis S/R berdenyut, sapuan; kamera mundur sampai 12,0
 * Angka pasar HANYA dari lib/studio/teaserNews.ts (IHSG -11,57% ke 5.185,10, 16 Okt 2026, terdalam sejak 1998; MSCI usul Standalone Market).
 */
import { useMemo, type CSSProperties, type ReactNode } from "react";
import { AbsoluteFill, Easing } from "remotion";
import { Shine, TextShine, blurCss } from "../../fx";
import { Caption, EASE, Flash, Sweep, camAtTime, clamp01, rgba, useShot, type CamKey, Cam } from "../kit";
import {
  AiHeader,
  AnalysisCard,
  AnsweredCard,
  AssistantRow,
  CandleArea,
  ChartFoot,
  ChartHead,
  ChoiceCard,
  Composer,
  HEAD_H,
  HelperLine,
  HERO as HERO_NAME,
  ORANGE,
  ProcessLine,
  SourceBadges,
  ThinkingLive,
  UserBubble,
  Welcome,
  makeCandles,
  type AskOpt,
  type ThinkStep,
} from "./ai-parts";

// ------------------------------------------------------------------ naskah & data ------------------------------------------------------------------
const QUESTION = "Kenapa IHSG anjlok? Efeknya ke kripto?";
const ASK_TITLE = "Biar jawabannya pas, aku tanya dulu ya ✨";
const ASK_Q = "Mau fokus ke mana?";
const OPTS: AskOpt[] = [
  { label: "Saham (IHSG)", desc: "Kenapa anjlok & efek usulan MSCI" },
  { label: "Kripto", desc: "Imbas sentimennya ke pasar kripto" },
  { label: "Dua-duanya", desc: "Bandingkan saham & kripto sekalian", rec: true },
];
const PICK = 2;

/** detik beat-sync (relatif awal adegan) — sama dengan sfx di lib/studio/teaser.ts */
const T = {
  ignite: 0,
  type: 0.6,
  send: 1.8,
  row1: 1.96,
  ask: 2.1,
  tap: 3.0,
  answered: 3.3,
  row2: 3.6,
  think: 3.95,
  readout: 4.8,
  answer: 7.2,
  coin: 9.0,
  slam: 9.6,
  chartB: 10.2,
  done: 10.8,
} as const;

const STEPS: ThinkStep[] = [
  { k: "understand", at: 4.8 },
  { k: "search", at: 5.25, q: "IHSG MSCI", n: 8 },
  { k: "price", at: 5.7, sym: "IHSG", src: "EODHD" },
  { k: "price", at: 6.15, sym: "BTC", src: "CoinGecko" },
  { k: "write", at: 6.6 },
];
const STEPS_DONE = 6.95;
/** jadwal caption (detik adegan) — lihat catatan di bawah komponen Caption */
const CAP_ASK_OUT = 3.6;
const CAP_THINK_AT = 3.95;
const CAP_THINK_OUT = 6.6;

// ------------------------------------------------------------------ ukuran panel (px CSS website) ------------------------------------------------------------------
const PW = 360;
const PAD = 14;
const CW = PW - PAD * 2;
const COLW = CW - 48;
const HEADER_H = 46;
const COMPOSER_H = 106;
const USER_H = 44;
const HELPER_H = 30;
const CHOICE_H = 290;
const ANSWERED_H = 90;
const THINK_BASE = 62;
const STEP_H = 25;
const PROC_H = 24;
const BADGE_H = 28;
const ANALYSIS_H = 326;
const CHART_H = 284;
const GAP = 16;

const outC = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
const outBack = (x: number) => {
  const c1 = 1.4;
  const c3 = c1 + 1;
  const v = clamp01(x) - 1;
  return 1 + c3 * v * v * v + c1 * v * v;
};
/** progres 0..1 (ease-out) dari detik a selama len */
const gr = (s: number, a: number, len: number) => outC((s - a) / len);

type Lay = {
  userY: number;
  userH: number;
  row1Y: number;
  row1H: number;
  cardH: number;
  morph: number;
  row2Y: number;
  thinkY: number;
  thinkH: number;
  procP: number;
  badgeY: number;
  badgeH: number;
  anaY: number;
  anaH: number;
  chartAY: number;
  chartAH: number;
  chartBY: number;
  chartBH: number;
  total: number;
};

/** tata letak thread (y di ruang isi thread) di detik s — tinggi tiap blok tumbuh/menyusut halus */
function layout(s: number): Lay {
  let y = 10;
  const userY = y;
  const userH = USER_H * gr(s, T.send, 0.28);
  y += userH + GAP * gr(s, T.send, 0.28);
  const row1Y = y;
  const helper1 = HELPER_H * gr(s, T.row1, 0.22);
  const grow = gr(s, T.ask, 0.32);
  const morph = gr(s, T.answered, 0.32);
  const cardH = CHOICE_H * grow * (1 - morph) + ANSWERED_H * morph;
  const row1H = helper1 + cardH;
  y += row1H + (GAP + 4) * gr(s, T.row2, 0.22);
  const row2Y = y;
  let r = HELPER_H * gr(s, T.row2, 0.22);
  const badgeY = r;
  const badgeH = BADGE_H * gr(s, T.answer, 0.22);
  r += badgeH;
  const thinkY = r;
  const procP = gr(s, STEPS_DONE, 0.2);
  const live = (THINK_BASE + STEPS.reduce((a, st) => a + STEP_H * gr(s, st.at, 0.22), 0)) * gr(s, T.think, 0.3);
  const thinkH = live * (1 - procP) + PROC_H * procP;
  r += thinkH;
  const anaY = r;
  const anaH = (ANALYSIS_H + 10) * gr(s, T.answer - 0.14, 0.22);
  r += anaH;
  const chartAY = r;
  const chartAH = (CHART_H + 12) * EASE.inOut(clamp01((s - (T.coin - 0.42)) / 0.34));
  r += chartAH;
  const chartBY = r;
  const chartBH = (CHART_H + 12) * EASE.inOut(clamp01((s - (T.chartB - 0.3)) / 0.3));
  r += chartBH;
  y += r;
  return { userY, userH, row1Y, row1H, cardH, morph, row2Y, thinkY, thinkH, procP, badgeY, badgeH, anaY, anaH, chartAY, chartAH, chartBY, chartBH, total: y + 14 };
}

// ------------------------------------------------------------------ data chart ------------------------------------------------------------------
/** IHSG harian: menyamping lalu candle terakhir jatuh tepat -11,57% dari penutupan sebelumnya (satu-satunya angka yang ditampilkan) */
function ihsgCandles() {
  const base = makeCandles(31, 1.3, (i) => (i < 14 ? 0.18 : i < 24 ? -0.06 : -0.22), 0.7);
  const prev = base[base.length - 1].c;
  const c = prev * (1 - 0.1157);
  base.push({ o: prev, h: prev * 1.002, l: c * 0.994, c });
  return base;
}
/** kripto 4H (ilustrasi tanpa angka): bergerak di antara support & resistance */
function cryptoCandles() {
  return makeCandles(38, 4.1, (i) => Math.sin(i / 4.2) * 0.9 - (i > 26 && i < 31 ? 0.9 : 0) + (i >= 31 ? 0.55 : 0), 0.75);
}

/** emoji yang juga punya glyph teks di font cadangan (⚔ di DejaVu) → paksa font emoji berwarna seperti di browser HP */
const Emo = ({ children }: { children: ReactNode }) => <span style={{ fontFamily: '"Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif' }}>{children}</span>;

// ------------------------------------------------------------------ adegan ------------------------------------------------------------------
export function AiShot() {
  const { f, fps, s, t, box, W, H } = useShot();

  // panel: lebar mengikuti zona aman, mulai di bawah caption
  const S = Math.min((box.w * 0.96) / PW, 2.3);
  const panelW = PW * S;
  const capH = Math.min(200, box.h * 0.145);
  const bcx = box.x + box.w / 2;
  const panelX = bcx - panelW / 2;
  const panelY = box.y + capH;
  // panel sedikit lebih tinggi dari zona aman (composer di bawah); bidikan lebar memakai zoom < 1 supaya tetap di dalam box
  const panelHc = box.y + box.h * 1.1 - panelY;
  const PH = panelHc / S;
  const VH = PH - HEADER_H - COMPOSER_H - 6;
  const threadTop = HEADER_H + 6;

  const L = layout(s);
  const scrollOf = (sec: number) => {
    const l = layout(sec);
    return Math.max(0, l.total - VH);
  };
  const scroll = scrollOf(s);

  // ---------------- kamera pelacak: titik fokus (kanvas) per babak, dibaurkan halus; keyframe rapat per frame ----------------
  const keys = useMemo<CamKey[]>(() => {
    const cx = W / 2;
    const cy = H / 2;
    // bidikan dekat (z 1,2): titik pusat 181 px CSS dari kiri panel → avatar utuh di kiri, teks kolom tetap di dalam box
    const zx = panelX + 181 * S;
    const midX = panelX + (PW / 2) * S;
    const toCanvasY = (sec: number, ty: number) => panelY + (threadTop + ty - scrollOf(sec)) * S;
    type Tgt = (sec: number) => { px: number; py: number; z: number; qy: number };
    const mid = box.y + box.h * 0.5;
    const lowMid = panelY + (box.y + box.h - panelY) * 0.5;
    const wide: Tgt = (sec) => {
      const z = 0.84 + 0.07 * outC(sec / 0.75);
      return { px: midX, py: panelY + panelHc / 2, z, qy: box.y + capH - 10 + (panelHc / 2) * z };
    };
    // dorong ke composer: teks ketikan di ±72% tinggi box (di atas zona subtitle); kepala panel naik ke balik caption (scrim gelap)
    const composer: Tgt = () => ({ px: midX, py: panelY + (PH - 83) * S, z: 1.16, qy: box.y + box.h * 0.72 });
    // sorot hero: avatar + "Kamu dibantu oleh Harley · ENFP …"
    const hero: Tgt = (sec) => {
      const l = layout(sec);
      return { px: zx, py: toCanvasY(sec, l.row1Y + 15), z: 1.22, qy: box.y + box.h * 0.44 };
    };
    const ask: Tgt = (sec) => {
      const l = layout(sec);
      return { px: midX, py: toCanvasY(sec, l.row1Y + HELPER_H + l.cardH / 2), z: 1.11, qy: lowMid + 10 };
    };
    const bridge: Tgt = (sec) => {
      const l = layout(sec);
      return { px: midX, py: toCanvasY(sec, (l.row1Y + HELPER_H + l.row2Y + l.thinkY + 60) / 2), z: 1.08, qy: lowMid };
    };
    const think: Tgt = (sec) => {
      const l = layout(sec);
      return { px: zx, py: toCanvasY(sec, l.row2Y + l.thinkY + l.thinkH / 2), z: 1.2, qy: mid };
    };
    // blok baru selalu muncul di dasar thread (thread di-scroll ke bawah). Titik bidik dibatasi ke posisi akhirnya di viewport,
    // jadi kamera tidak pernah membidik ruang kosong di bawah panel selagi kartu masih tumbuh.
    const endY = (h: number, gap: number) => panelY + (threadTop + VH - 14 - gap - h / 2) * S;
    // (titik tetap: saat kartu berikutnya tumbuh, isi thread yang bergulir ke atas — kamera tidak ikut naik ke kartu lama)
    const ana: Tgt = () => ({ px: zx, py: endY(ANALYSIS_H, 10) - 8 * S, z: 1.2, qy: mid });
    const chartA: Tgt = () => ({ px: zx, py: endY(CHART_H, 12), z: 1.22, qy: mid + 10 });
    const chartB: Tgt = () => ({ px: zx, py: endY(CHART_H, 12), z: 1.2, qy: mid });
    const outro: Tgt = () => ({ px: zx, py: endY(CHART_H, 12) - CHART_H * 0.14 * S, z: 1.06, qy: mid - 30 });
    // [mulai pindah, lama pindah, target, easing]
    const SHOTS: [number, number, Tgt, (x: number) => number][] = [
      [0, 0.01, wide, EASE.inOut],
      [0.7, 0.7, composer, Easing.bezier(0.45, 0, 0.2, 1)],
      [1.82, 0.32, hero, Easing.bezier(0.6, 0, 0.15, 1)],
      [2.3, 0.5, ask, Easing.bezier(0.45, 0, 0.2, 1)],
      [3.32, 0.6, bridge, Easing.bezier(0.45, 0, 0.2, 1)],
      [4.3, 0.5, think, Easing.bezier(0.45, 0, 0.2, 1)],
      [6.75, 0.42, ana, Easing.bezier(0.5, 0, 0.15, 1)],
      [8.72, 0.28, chartA, Easing.bezier(0.6, 0, 0.18, 1.04)],
      [9.9, 0.3, chartB, Easing.bezier(0.6, 0, 0.18, 1.04)],
      [T.done, 1.2, outro, Easing.bezier(0.4, 0, 0.3, 1)],
    ];
    const at = (sec: number) => {
      let i = 0;
      while (i + 1 < SHOTS.length && sec >= SHOTS[i + 1][0]) i++;
      const [t0, len, tgt, ease] = SHOTS[i];
      const cur = tgt(sec);
      const prev = i > 0 ? SHOTS[i - 1][2](sec) : cur;
      const k = ease(clamp01((sec - t0) / len));
      const settle = Math.max(0, sec - (t0 + len));
      const z = (prev.z + (cur.z - prev.z) * k) * (1 + Math.min(settle, 1.6) * 0.012);
      const px = prev.px + (cur.px - prev.px) * k;
      const py = prev.py + (cur.py - prev.py) * k;
      let qy = prev.qy + (cur.qy - prev.qy) * k;
      // bidikan lebar & kartu tanya: atas panel tidak boleh naik menabrak caption.
      // Saat dorong ke composer (0,7–1,8) penjaga dilepas — kepala panel boleh lewat di balik caption (ditutup scrim gelap).
      const guard = Math.max(clamp01((0.95 - sec) / 0.25), clamp01(Math.min((sec - 1.95) / 0.25, (4.5 - sec) / 0.3)));
      const top = qy + z * (panelY - py);
      const capBottom = box.y + capH - 14;
      if (guard > 0 && top < capBottom) qy += (capBottom - top) * guard;
      return { z, x: bcx - cx - z * (px - cx), y: qy - cy - z * (py - cy) };
    };
    const n = Math.round(12.6 * fps);
    const out: CamKey[] = [];
    for (let i = 0; i <= n; i++) {
      const sec = i / fps;
      const v = at(sec);
      // denyut kamera kecil di pukulan (ketuk 3,0 & koin 9,0) + putar halus di awal
      const punch = (a: number, amp: number) => {
        const d = sec - a;
        return d < 0 ? 0 : amp * Math.exp(-d * 7) * Math.sin(d * 18 + 0.2);
      };
      const zMul = 1 + punch(T.tap, 0.03) + punch(T.coin, 0.035) + punch(T.answer, 0.015);
      const r = -1.2 * (1 - outC(sec / 0.9)) + punch(T.coin, 0.6) * 10;
      out.push({ t: sec, z: v.z * zMul, x: v.x, y: v.y, r, ease: (x) => x });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [W, H, S, panelX, panelY, panelHc, PH, VH, fps, box.y, box.h, capH, bcx]);

  const cam = camAtTime(keys, s);
  const cam2 = camAtTime(keys, s + 1 / fps);
  const camV = Math.hypot(cam2.x - cam.x, cam2.y - cam.y) + Math.abs(cam2.z - cam.z) * W * 0.5 + Math.abs(cam2.r - cam.r) * 8;
  // motion blur kamera hanya saat whip, dan dibatasi supaya selalu ada elemen yang terbaca
  const camBlur = Math.min(1.3, Math.max(0, camV - 18) * 0.03);

  // seberapa jauh atas panel naik melewati batas caption (untuk scrim)
  const capBottomPx = box.y + capH - 14;
  const panelTopPx = H / 2 + cam.y + cam.z * (panelY - H / 2);
  const cap1Vis = clamp01(Math.min((s - 0.3) / 0.2, (1.85 - s) / 0.3));
  const scrimOp = cap1Vis * clamp01((capBottomPx + 30 - panelTopPx) / 90);

  // ---------------- fokus (DOF): blok selain fokus diburamkan (px CSS, ikut dibesarkan panel) ----------------
  const rack = gr(s, 4.5, 0.35) * (1 - gr(s, 7.05, 0.3));
  const fA = gr(s, 8.8, 0.3);
  const fB = gr(s, 10.1, 0.3);
  const settleEnd = gr(s, 11.1, 0.7);
  const blurOld = rack * 2.2 + gr(s, 7.2, 0.4) * 1.4;
  const blurChrome = rack * 2.2 + fA * 1.2;
  const blurAna = rack * 0 + fA * 1.5;
  const blurChartA = fB * 1.6 * (1 - settleEnd * 0.5);

  // ---------------- panel menyala ----------------
  const intro = outBack((s - 0.02) / 0.5);
  const introOp = clamp01(s / 0.22);
  // cincin cahaya memuncak di 0,12 dtk (panel sudah tampil) lalu meredup
  const ring = (s < 0.12 ? s / 0.12 : Math.max(0, 1 - (s - 0.12) / 0.85)) * 0.9 + 0.12 * Math.exp(-Math.max(0, s - T.tap) * 5) * (s >= T.tap ? 1 : 0);
  const k = 0.9 + 0.1 * intro;

  // ---------------- composer ----------------
  const typed = clamp01((s - T.type) / 0.95);
  const draft =
    s < T.send + 0.03
      ? Array.from(QUESTION)
          .slice(0, Math.floor(typed * QUESTION.length + 0.0001))
          .join("")
      : "";
  const focusComposer = s >= 0.45 && s < T.send + 0.05;
  const press = s >= T.send - 0.07 && s < T.send + 0.1 ? 0.86 : 1;
  const busy = (s >= T.send + 0.06 && s < T.ask + 0.25) || (s >= T.tap + 0.1 && s < T.done);
  // ketukan 10,8: AI selesai → "■ Stop" kembali jadi tombol kirim (pegas)
  const sendBack = s >= T.done ? 0.6 + 0.4 * outBack((s - T.done) / 0.3) : 1;
  const twinkle = Math.max(0, 1 - Math.abs(s - T.type) / 0.35);

  // ---------------- pesan ----------------
  const userP = outBack((s - T.send) / 0.4);
  // kirim 1,8: gelembung terbang dari composer ke tempatnya di atas thread (kamera ikut naik ke hero)
  const flyAt = (sec: number) => outC(clamp01((sec - T.send) / 0.34));
  const flyD = PH - 83 - (threadTop + L.userY + 22);
  const flyY = (1 - flyAt(s)) * flyD;
  const flyBlur = Math.min(3, (flyAt(s + 1 / fps) - flyAt(s)) * flyD * 0.06);
  const r1P = outBack((s - T.row1) / 0.35);
  const r1Glow = s >= T.row1 ? Math.max(0, 1 - (s - T.row1) / 1.0) : 0;
  // sorot hero 2,0: chip menyala + kilau huruf, avatar melompat kecil
  const heroD = s - T.row1;
  const chipPop = heroD < 0 ? 0 : heroD < 0.12 ? outC(heroD / 0.12) : Math.exp(-(heroD - 0.12) * 3.2);
  const chipShine = clamp01((s - (T.row1 + 0.1)) / 0.6);
  const heroBounce = heroD > 0 ? Math.abs(Math.sin(heroD * 9)) * Math.exp(-heroD * 3.5) : 0;
  const r2P = outBack((s - T.row2) / 0.35);
  const r2Glow = s >= T.row2 ? Math.max(0, 1 - (s - T.row2) / 1.0) : 0;
  const talk = s >= T.think && s < 10.4 ? 1 : 0;
  const welcomeOut = gr(s, T.send - 0.12, 0.3);
  const welcomeDof = gr(s, 0.8, 0.45);

  // kartu tanya: denyut pilih di 3,0
  const tapF = Math.round(T.tap * fps);
  const askPunch = s >= T.tap ? Math.exp(-(s - T.tap) * 9) * Math.sin((s - T.tap) * 30) : 0;

  // chart IHSG: dilempar seperti koin (rotateY 3D + busur naik-turun) → mendarat 9,0 ; candle tampil ; candle terakhir jatuh 9,28–9,6
  const COIN_LEN = 0.58;
  const coinAt = (sec: number) => clamp01((sec - (T.coin - COIN_LEN)) / COIN_LEN);
  const coinK = coinAt(s);
  const coinOp = clamp01((s - (T.coin - COIN_LEN)) / 0.08);
  const angOf = (sec: number) => Math.pow(1 - coinAt(sec), 1.5) * 540;
  const coinDeg = s < T.coin ? angOf(s) : 0;
  const coinSpin = Math.abs(angOf(s + 1 / fps) - angOf(s)); // derajat per frame
  const coinBack = Math.cos((coinDeg * Math.PI) / 180) < 0;
  const coinY = s < T.coin ? (1 - coinK) * 170 - Math.sin(coinK * Math.PI) * 100 : -Math.exp(-(s - T.coin) * 9) * Math.abs(Math.sin((s - T.coin) * 22)) * 10;
  const coinSc = s < T.coin ? 0.72 + 0.28 * outC(coinK) : 1;
  const coinBlur = Math.min(2.4, coinSpin * 0.05);
  const revealA = gr(s, T.coin - 0.16, 0.5);
  const slam = Easing.bezier(0.55, 0, 0.9, 0.6)(clamp01((s - (T.slam - 0.32)) / 0.32));
  const slamHit = s >= T.slam ? Math.exp(-(s - T.slam) * 4) : 0;
  const tagP = outBack((s - (T.slam - 0.03)) / 0.26);
  // ketukan 10,8: garis S/R berdenyut
  const srPulse = s >= T.done ? Math.exp(-(s - T.done) * 4.5) : 0;

  // chart kripto: masuk dari kanan, mendarat di ketukan 10,2
  const bK = clamp01((s - (T.chartB - 0.3)) / 0.3);
  const bX = s < T.chartB ? (1 - outC(bK)) * 260 : -Math.exp(-(s - T.chartB) * 8) * Math.sin((s - T.chartB) * 20) * 8;
  const bV = s < T.chartB ? (outC(clamp01((s + 1 / fps - (T.chartB - 0.3)) / 0.3)) - outC(bK)) * 260 : 0;
  const revealB = gr(s, T.chartB - 0.1, 0.55);

  const ihsg = useMemo(ihsgCandles, []);
  const crypto = useMemo(cryptoCandles, []);
  const chartW = COLW - 2;
  const areaH = CHART_H - HEAD_H - 27 - 27 - 2;

  const block = (key: string, y: number, h: number, blur: number, node: ReactNode, x = 0, w = CW, clip = true) => (
    <div key={key} style={{ position: "absolute", left: PAD + x, top: y, width: w, height: h, overflow: clip ? "hidden" : "visible", filter: blurCss(blur), opacity: 1 - Math.min(0.55, blur * 0.2) }}>
      {node}
    </div>
  );
  const colX = 48;

  // kartu chart IHSG (muka chart / punggung koin oranye saat berputar)
  const coinCard = (
    <div style={{ position: "relative", height: CHART_H }}>
      {/* perspektif DI DALAM transform (bukan properti CSS perspective di induk) → web-renderer juga menggambar flip 3D */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: coinOp,
          transform: `perspective(900px) translateY(${coinY.toFixed(1)}px) scale(${coinSc.toFixed(4)}) rotateY(${coinDeg.toFixed(2)}deg)`,
          transformOrigin: "50% 50%",
          filter: blurCss(coinBlur),
        }}
      >
        {coinBack ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 12,
              backgroundImage: "linear-gradient(135deg,#fb8a3c,#c2410c)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 20px 40px -18px rgba(0,0,0,0.9)",
              transform: "scaleX(-1)",
            }}
          >
            {/* cincin dalam = div ber-border (box-shadow inset tidak tergambar di web-renderer) */}
            <div style={{ position: "absolute", inset: 0, borderRadius: 12, border: "3px solid rgba(255,255,255,0.25)", boxSizing: "border-box", pointerEvents: "none" }} />
            <svg width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 3v18h18" />
              <path d="M7 15l4-4 3 3 5-6" />
            </svg>
          </div>
        ) : (
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 12,
              border: "1px solid #27272a",
              background: "#111113",
              overflow: "hidden",
              boxShadow: s < T.coin ? "0 20px 40px -18px rgba(0,0,0,0.9)" : undefined,
            }}
          >
            <ChartHead
              title="IHSG · 1D"
              tf="1D"
              stock
              right={
                <span style={{ color: "#71717a", whiteSpace: "nowrap" }}>
                  Rencana dari <Emo>⚔️</Emo> {HERO_NAME} · ilustrasi
                </span>
              }
            />
            <div style={{ position: "relative", height: areaH }}>
              <CandleArea w={chartW} h={areaH} data={ihsg} reveal={revealA} slam={slam}>
                {(y, x) => {
                  const last = ihsg[ihsg.length - 1];
                  const yc = y(last.o + (last.c - last.o) * slam);
                  return (
                    <g opacity={slam}>
                      <line x1={0} x2={chartW} y1={yc} y2={yc} stroke="#ef4444" strokeWidth={1} strokeDasharray="4 3" />
                      <circle cx={x(ihsg.length - 1)} cy={yc} r={3 + slamHit * 10} fill="none" stroke="#ef4444" strokeWidth={2} opacity={slamHit} />
                    </g>
                  );
                }}
              </CandleArea>
              <span style={{ position: "absolute", right: 8, top: 6, fontSize: 10.5, color: "#71717a" }}>16 Okt 2026</span>
              {tagP > 0.01 && (
                <div
                  style={{
                    position: "absolute",
                    left: 14,
                    top: areaH * 0.36,
                    transform: `translateY(${((1 - Math.min(1, tagP)) * -14).toFixed(1)}px) scale(${(0.6 + 0.4 * tagP).toFixed(4)})`,
                    transformOrigin: "0% 50%",
                    opacity: clamp01(tagP * 2.5),
                  }}
                >
                  <TextShine p={clamp01((s - (T.slam + 0.05)) / 0.5)} glow="rgba(248,113,113,.9)">
                    <div
                      style={{
                        fontFamily: "inherit",
                        fontSize: 30,
                        fontWeight: 800,
                        lineHeight: 1,
                        letterSpacing: "-0.02em",
                        color: "#f87171",
                        fontVariantNumeric: "tabular-nums",
                        textShadow: `0 0 ${(6 + slamHit * 22).toFixed(1)}px rgba(239,68,68,${(0.35 + 0.55 * slamHit).toFixed(2)})`,
                      }}
                    >
                      -11,57%
                    </div>
                  </TextShine>
                  <div style={{ marginTop: 5, fontSize: 12.5, fontWeight: 700, color: "#f4f4f5", whiteSpace: "nowrap" }}>
                    ke 5.185,10 <span style={{ fontWeight: 500, color: "#a1a1aa" }}>· terdalam sejak 1998</span>
                  </div>
                </div>
              )}
            </div>
            <ChartFoot />
            <Shine p={clamp01((s - T.coin) / 0.6)} alpha={0.22} radius={12} />
            <Shine p={clamp01((s - T.slam) / 0.5)} alpha={0.16} radius={12} />
          </div>
        )}
      </div>
    </div>
  );

  // scroll cepat (kartu baru mendorong thread ke atas) = whip di dalam panel → blur gerak sebanding kecepatan
  const scrollV = Math.abs(scrollOf(s + 1 / fps) - scroll);
  // hanya untuk dorongan kartu chart (8,6 & 9,9) — jawaban 7,2 harus tajam tepat di pukulan SFX
  const scrollWin = (s > 8.5 && s < 9.0) || (s > 9.85 && s < 10.3) ? 1 : 0;
  const scrollBlur = scrollWin * Math.min(2, Math.max(0, scrollV - 5) * 0.09);
  const thread = (
    <div style={{ position: "absolute", left: 0, right: 0, top: 0, transform: `translateY(${(-scroll).toFixed(2)}px)`, filter: blurCss(scrollBlur) }}>
      {L.userH > 0.5 &&
        block(
          "u",
          L.userY,
          L.userH + 30,
          blurOld,
          <div style={{ transform: `translateY(${flyY.toFixed(1)}px)`, filter: blurCss(flyBlur) }}>
            <UserBubble text={QUESTION} p={userP} />
          </div>,
          0,
          CW,
          false,
        )}
      {s >= T.row1 &&
        block(
          "r1",
          L.row1Y - 10,
          L.row1H + 14,
          blurOld,
          // paddingTop: ruang untuk lompatan avatar & glow chip (blok ini memotong isi untuk animasi tinggi kartu)
          <div style={{ paddingTop: 10 }}>
            <AssistantRow f={f} talk={0} p={r1P} bounce={heroBounce}>
              <HelperLine max={COLW} p={r1P} glow={r1Glow} pop={chipPop} shine={chipShine} />
              <div style={{ position: "relative", height: L.cardH, transform: `scale(${(1 + askPunch * 0.025).toFixed(4)})`, transformOrigin: "50% 80%" }}>
                {L.morph < 1 && (
                  <div style={{ position: "absolute", left: 0, top: 0, width: COLW, height: CHOICE_H, opacity: 1 - L.morph }}>
                    <ChoiceCard t={t} title={ASK_TITLE} q={ASK_Q} opts={OPTS} pick={PICK} tapAt={tapF} inAt={Math.round(T.ask * fps)} tapF={tapF} />
                  </div>
                )}
                {L.morph > 0 && (
                  <div style={{ position: "absolute", left: 0, top: 0, width: COLW, opacity: L.morph }}>
                    <AnsweredCard title={ASK_TITLE} pairs={[[ASK_Q.replace(/\?$/, ""), OPTS[PICK].label]]} />
                  </div>
                )}
                {s >= T.tap - 0.05 && s < T.tap + 0.7 && (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      borderRadius: 16,
                      pointerEvents: "none",
                      boxShadow: `0 0 0 ${(3 * Math.exp(-(s - T.tap) * 4)).toFixed(2)}px ${rgba(ORANGE, 0.6 * Math.exp(-(s - T.tap) * 4))}`,
                    }}
                  />
                )}
              </div>
            </AssistantRow>
          </div>,
        )}
      {s >= T.row2 && (
        <>
          {block(
            "r2h",
            L.row2Y - 8,
            HELPER_H + L.badgeH + 8,
            blurOld * 0.6 + fA * 1.2,
            <div style={{ paddingTop: 8 }}>
              <AssistantRow f={f} talk={talk} p={r2P}>
                <HelperLine max={COLW} p={r2P} glow={r2Glow} />
                {L.badgeH > 0.5 && <SourceBadges p={gr(s, T.answer, 0.3)} />}
              </AssistantRow>
            </div>,
          )}
          {L.thinkH > 0.5 &&
            block(
              "th",
              L.row2Y + L.thinkY,
              L.thinkH + 24,
              (1 - rack) * 0.6 * (s > T.answer ? 1 : 0) + fA * 1.2,
              <div style={{ position: "relative", height: L.thinkH + 24 }}>
                {L.procP < 1 && (
                  <div style={{ opacity: clamp01(1 - L.procP * 1.8) }}>
                    <ThinkingLive f={f} fps={fps} steps={STEPS} doneAt={STEPS_DONE} hot={rack} />
                  </div>
                )}
                {L.procP > 0.5 && (
                  <div style={{ position: "absolute", left: 0, top: 2, opacity: clamp01(L.procP * 2 - 1) }}>
                    <ProcessLine n={STEPS.length} secs={3} />
                  </div>
                )}
              </div>,
              colX,
              COLW,
            )}
          {L.anaH > 0.5 &&
            block(
              "an",
              L.row2Y + L.anaY,
              L.anaH,
              blurAna,
              <div
                style={{
                  position: "relative",
                  transform: `translateY(${((1 - gr(s, T.answer - 0.14, 0.3)) * 26).toFixed(1)}px) scale(${(0.95 + 0.05 * outBack((s - (T.answer - 0.14)) / 0.32) + 0.028 * Math.exp(-Math.pow((s - (T.answer + 0.02)) / 0.09, 2))).toFixed(4)})`,
                  transformOrigin: "50% 30%",
                }}
              >
                <AnalysisCard
                  f={f}
                  fps={fps}
                  inAt={T.answer - 0.14}
                  sym="IHSG · 1D"
                  bias="bearish"
                  lead="Anjlok usai MSCI usul status pasar RI turun ke Standalone Market."
                  tiles={[
                    { k: "Penutupan", v: "5.185,10", n: "16 Okt 2026", tone: "down" },
                    { k: "Harian", v: "-11,57%", n: "terdalam sejak 1998", tone: "down" },
                  ]}
                  sigs={[
                    { text: "MSCI usul turun ke Standalone Market", tone: "bad" },
                    { text: "Kripto: pantau efek sentimennya", tone: "warn" },
                  ]}
                  flash={s >= 7.8 ? Math.exp(-(s - 7.8) * 3) : 0}
                />
                <Shine p={clamp01((s - (T.answer - 0.04)) / 0.55)} alpha={0.24} radius={18} />
              </div>,
              colX,
              COLW,
            )}
          {L.chartAH > 0.5 && block("ca", L.row2Y + L.chartAY, L.chartAH, blurChartA, s >= T.coin ? coinCard : null, colX, COLW, false)}
          {L.chartBH > 0.5 &&
            block(
              "cb",
              L.row2Y + L.chartBY,
              L.chartBH,
              0,
              <div style={{ position: "relative", height: CHART_H, transform: `translateX(${bX.toFixed(1)}px)`, filter: blurCss(Math.min(3, Math.abs(bV) * 0.12)) }}>
                <div style={{ position: "absolute", inset: 0, borderRadius: 12, border: "1px solid #27272a", background: "#111113", overflow: "hidden" }}>
                  <ChartHead
                    title="BTC/USDT · 4H"
                    tf="4H"
                    right={
                      <span style={{ color: "#71717a", whiteSpace: "nowrap" }}>
                        Rencana dari <Emo>⚔️</Emo> {HERO_NAME} · ilustrasi
                      </span>
                    }
                  />
                  <div style={{ position: "relative", height: areaH }}>
                    <CandleArea w={chartW} h={areaH} data={crypto} reveal={revealB}>
                      {(y) => {
                        const hi = Math.max(...crypto.map((d) => d.h));
                        const lo = Math.min(...crypto.map((d) => d.l));
                        const res = y(hi - (hi - lo) * 0.12);
                        const sup = y(lo + (hi - lo) * 0.14);
                        const a = gr(s, T.chartB + 0.2, 0.4);
                        const sw = 1.2 + srPulse * 1.6;
                        return (
                          <g opacity={a}>
                            <line x1={0} x2={chartW * a} y1={res} y2={res} stroke="#9333ea" strokeWidth={sw} strokeDasharray="2 3" />
                            <line x1={0} x2={chartW * a} y1={sup} y2={sup} stroke="#0d9488" strokeWidth={sw} strokeDasharray="2 3" />
                          </g>
                        );
                      }}
                    </CandleArea>
                    {(() => {
                      const a = gr(s, T.chartB + 0.3, 0.3);
                      const sc = 1 + srPulse * 0.22;
                      const lab = (bg: string): CSSProperties => ({
                        position: "absolute",
                        left: 6,
                        borderRadius: 5,
                        background: bg,
                        padding: "2px 6px",
                        fontSize: 10.5,
                        fontWeight: 700,
                        color: "#fff",
                        opacity: a,
                        transform: `scale(${sc.toFixed(3)})`,
                        transformOrigin: "0% 50%",
                        boxShadow: srPulse > 0.01 ? `0 0 ${(srPulse * 16).toFixed(1)}px ${bg}` : undefined,
                      });
                      return (
                        <>
                          <span style={{ ...lab("#9333ea"), top: 10 }}>Resistance</span>
                          <span style={{ ...lab("#0d9488"), bottom: 12 }}>Support</span>
                        </>
                      );
                    })()}
                  </div>
                  <ChartFoot />
                  <Shine p={clamp01((s - T.chartB) / 0.6)} alpha={0.18} radius={12} />
                  <Shine p={clamp01((s - T.done) / 0.55)} alpha={0.14} radius={12} />
                </div>
              </div>,
              colX,
              COLW,
            )}
        </>
      )}
    </div>
  );

  // ---------------- latar (parallax lebih lambat dari kamera) ----------------
  const bgZ = 1 + (cam.z - 1) * 0.35;
  const glowPulse = 0.55 + 0.45 * Math.max(0, 1 - s / 1.2) + 0.12 * Math.exp(-Math.max(0, s - T.tap) * 4) * (s >= T.tap ? 1 : 0) + 0.15 * (s >= T.coin ? Math.exp(-(s - T.coin) * 3) : 0);
  const bokeh = useMemo(
    () =>
      Array.from({ length: 9 }, (_, i) => ({
        x: ((i * 397) % 1000) / 1000,
        y: ((i * 613 + 211) % 1000) / 1000,
        r: 10 + ((i * 37) % 26),
        d: 0.4 + ((i * 53) % 60) / 100,
        c: i % 3 === 0 ? "#ffffff" : ORANGE,
      })),
    [],
  );

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {/* latar: cahaya oranye + siluet candle buram, bergerak lambat */}
      <AbsoluteFill style={{ transform: `translate(${(cam.x * 0.3).toFixed(1)}px, ${(cam.y * 0.3).toFixed(1)}px) scale(${bgZ.toFixed(4)})`, transformOrigin: "50% 50%" }}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", inset: 0 }} aria-hidden>
          <defs>
            <radialGradient id="aiGlowA" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={ORANGE} stopOpacity={0.55} />
              <stop offset="45%" stopColor={ORANGE} stopOpacity={0.16} />
              <stop offset="100%" stopColor={ORANGE} stopOpacity={0} />
            </radialGradient>
            <radialGradient id="aiGlowB" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
            </radialGradient>
          </defs>
          <ellipse cx={bcx} cy={panelY + panelHc * 0.42} rx={W * 0.75} ry={H * 0.42} fill="url(#aiGlowA)" opacity={glowPulse * introOp} />
          <ellipse cx={W * 0.85} cy={box.y + 80} rx={W * 0.5} ry={H * 0.18} fill="url(#aiGlowB)" opacity={0.6 * introOp} />
        </svg>
        <div style={{ position: "absolute", left: 0, right: 0, top: box.y - 40, height: 360, filter: "blur(6px)", opacity: 0.22 * introOp }}>
          <CandleArea w={W} h={360} data={ihsg} reveal={1} grid={false} />
        </div>
      </AbsoluteFill>

      {/* panel AI + kamera */}
      <Cam keys={keys} blur={false}>
        <AbsoluteFill style={{ filter: blurCss(camBlur) }}>
          <div
            style={{
              position: "absolute",
              left: panelX,
              top: panelY,
              width: PW,
              height: PH,
              transform: `translate(${((1 - k) * panelW * 0.5).toFixed(2)}px, ${((1 - k) * panelHc * 0.5 + (1 - intro) * 70).toFixed(2)}px) scale(${(S * k).toFixed(4)})`,
              transformOrigin: "0 0",
              opacity: introOp,
              borderRadius: 26,
              overflow: "hidden",
              background: "#0c0c0f",
              border: `1px solid ${rgba(ring > 0.05 ? ORANGE : "#27272a", ring > 0.05 ? 0.3 + ring * 0.6 : 1)}`,
              boxShadow: `0 40px 110px -30px rgba(0,0,0,0.95), 0 0 ${(70 * ring).toFixed(1)}px ${rgba(ORANGE, 0.5 * ring)}`,
            }}
          >
            <div style={{ filter: blurCss(blurChrome) }}>
              <AiHeader f={f} />
            </div>
            <div style={{ position: "absolute", left: 20, right: 20, top: 0, height: 1, background: "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.22), rgba(255,255,255,0))" }} />
            <div style={{ position: "absolute", left: 0, right: 0, top: threadTop, height: VH, overflow: "hidden" }}>
              {welcomeOut < 1 && (
                <div
                  style={{
                    position: "absolute",
                    left: PAD,
                    right: PAD,
                    top: 0,
                    bottom: 0,
                    display: "flex",
                    alignItems: "center",
                    opacity: (1 - welcomeOut) * (1 - welcomeDof * 0.4),
                    transform: `translateY(${(-welcomeOut * 40).toFixed(1)}px) scale(${(1 - welcomeOut * 0.05).toFixed(4)})`,
                    filter: blurCss(welcomeOut * 3 + welcomeDof * 1.3),
                  }}
                >
                  <div style={{ width: "100%" }}>
                    <Welcome f={f} fps={fps} inAt={0.12} />
                  </div>
                </div>
              )}
              {thread}
              <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 18, background: "linear-gradient(180deg, #0c0c0f 10%, rgba(12,12,15,0))" }} />
              <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 14, background: "linear-gradient(0deg, #0c0c0f, rgba(12,12,15,0))" }} />
            </div>
            {s < T.coin && coinOp > 0 && <div style={{ position: "absolute", left: PAD + colX, top: threadTop + L.row2Y + L.chartAY - scroll, width: COLW, height: CHART_H }}>{coinCard}</div>}
            <div style={{ position: "absolute", left: PAD, right: PAD, bottom: 12, filter: blurCss(blurChrome), opacity: 1 - Math.min(0.5, blurChrome * 0.24) }}>
              <Composer f={f} draft={draft} focus={focusComposer} press={press} busy={busy} glow={twinkle} fit={0.84} back={sendBack} />
            </div>
          </div>
        </AbsoluteFill>
      </Cam>

      {/* bokeh depan (parallax lebih cepat) */}
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        {bokeh.map((b, i) => {
          const px = b.x * W + cam.x * (1.3 + b.d) + Math.sin(f / 40 + i) * 12;
          const py = (((b.y * H + cam.y * (1.3 + b.d) - f * (0.6 + b.d)) % H) + H) % H;
          return (
            <div key={i} style={{ position: "absolute", left: px, top: py, width: b.r * 2, height: b.r * 2, borderRadius: 999, background: b.c, opacity: 0.1 + 0.06 * b.d, filter: "blur(8px)" }} />
          );
        })}
      </AbsoluteFill>

      {/* scrim atas: saat kamera dorong ke composer, kepala panel lewat di balik caption → digelapkan supaya caption tetap bersih */}
      {scrimOp > 0.01 && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            height: box.y + capH + 150,
            pointerEvents: "none",
            opacity: scrimOp,
            background: "linear-gradient(180deg, rgba(9,9,11,0.96) 0%, rgba(9,9,11,0.9) 52%, rgba(9,9,11,0.55) 76%, rgba(9,9,11,0) 100%)",
          }}
        />
      )}

      <Sweep at={0.08} len={0.8} alpha={0.22} />
      <Sweep at={T.tap} len={0.6} alpha={0.16} />
      <Sweep at={T.answer - 0.04} len={0.6} alpha={0.1} />
      <Sweep at={T.coin} len={0.7} alpha={0.12} />
      <Sweep at={T.done} len={0.7} alpha={0.1} />
      <Flash at={T.tap} len={0.2} max={0.1} />
      <Flash at={T.answer} len={0.18} max={0.06} color="#ffd8b5" />
      <Flash at={T.coin} len={0.22} max={0.14} color="#ffd8b5" />
      <Flash at={T.slam} len={0.2} max={0.08} color="#fecaca" />

      {/* caption mengikuti visual, dijaga tidak bertabrakan makna dengan VO #6 (mulai 0,2: "Tanya AI soal hot issue, saham, sampai kripto.
          Dia mikir dulu… bahkan nanya balik, biar jawabannya pas." — perkiraan "mikir dulu" ±3,4–4,9, "nanya balik" ±5,0–6,3):
          "Bahkan nanya balik" bertahan sampai pertanyaan AI dijawab (AnsweredCard 3,3 → keluar 3,6),
          "AI yang mikir dulu" tampil lagi saat kotak berpikir muncul (3,95) dan bertahan selama langkah berpikir (4,8–6,6). */}
      <Caption lines={["AI yang mikir dulu"]} at={0.35} out={1.5} emphasis={["mikir"]} size={86} />
      <Caption lines={["Bahkan nanya balik"]} at={2.05} out={CAP_ASK_OUT} emphasis={["nanya", "balik"]} size={86} />
      <Caption lines={["AI yang mikir dulu"]} at={CAP_THINK_AT} out={CAP_THINK_OUT} emphasis={["mikir"]} size={86} />
    </AbsoluteFill>
  );
}
