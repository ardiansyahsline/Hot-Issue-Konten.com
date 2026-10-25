"use client";

/**
 * Adegan 7 teaser — "Desain berita (TWS)" (7,2 dtk, frame global 990–1206).
 * VO: "Butuh konten berita? Sekali ketik… langsung jadi. Tinggal download."
 *
 * Semua slide = renderer TWS ASLI (lib/tws.ts twsSlideHtml, lewat tws-parts) dengan berita asli lib/studio/teaserNews.ts.
 * UI = AiChat composer (kolom ketik AI) + DesignCard Viewer (preview, ‹ Slide n/3 ›, "Feed 4:5 · 2160×2700",
 * thumbnail 6 kolom bercincin oranye, "✓ Dicek: …", tombol unduh ⬇ PNG / ⬇ SVG Figma / ⬇ HTML / ⬇ ZIP PNG / ⬇ ZIP SVG).
 *
 * Beat (detik adegan = titik pukulan SFX di lib/studio/teaser.ts):
 *  0,0–0,9  prompt diketik sekali di kolom AI, tombol kirim diketuk (0,87)
 *  1,2      bass-drop-cepat + impact-cut-sweep → kartu desain mendarat; lapisan "Angka 3D" ASLI slide 1 SLAM selebar ±78% layar
 *           (kilat singkat, getar kamera, bloom, kilau spekular di angka), lalu terbang ke slotnya di cover (1,5–2,0)
 *  3,0      kertas-balik-halaman → carousel geser ke cover Prabowo (Slide 2/3), kamera punch-in tepat di ketukan
 *  4,2      kertas-balik-halaman → slide kronologi (Slide 3/3), kamera punch-in tepat di ketukan
 *  5,0–5,65 kartu terbuka penuh, kamera turun ke baris unduh; "⬇ SVG Figma" terangkat, tombol lain redup (fokus)
 *  6,0      ui-pop → "⬇ SVG Figma" ditekan, toast "Tersimpan", panel Layers Figma
 */
import type { CSSProperties, ReactNode } from "react";
import { useId, useMemo } from "react";
import { AbsoluteFill, useRemotionEnvironment } from "remotion";
import { TEASER_TWS_DECK } from "@/lib/studio/teaserNews";
import { twsDesigns, type TwsSlide } from "@/lib/tws";
import { blurCss, Glow, TextShine, useSvgId } from "../../fx";
import HeroArt from "@/components/ai/HeroArt";
import { DISPLAY, FONT, HeroAvatar, ME, Z } from "../../screens/ui";
import { Cam, camAtTime, clamp01, EASE, Flash, prog, rgba, springAt, useShot, type CamKey } from "../kit";
import { bigNumberHtml, prepareSlide, SLIDE_W, TwsSlideView, TwsStyle, useTwsLogo, useTwsReady } from "./tws-parts";

// ---------------------------------------------------------------------------------------------
// Waktu (detik adegan) — sama dengan sfx adegan "tws" di lib/studio/teaser.ts
// ---------------------------------------------------------------------------------------------
const DROP = 1.2;
const FLIP1 = 3.0;
const FLIP2 = 4.2;
const POP = 6.0;
/** tombol kirim diketuk */
const SEND = 0.87;
/** kartu & angka mulai masuk (mendarat tepat di DROP) */
const NUM_IN = DROP - 0.17;
/** angka hero terbang ke slotnya di cover */
const FLY_A = 1.5;
const FLY_B = 2.0;
/** caption keluar, kartu terbuka penuh, kamera turun ke tombol unduh */
const CAP_OUT = 5.0;
const DL_IN = 5.65;

const PROMPT = "Bikin carousel TWS soal MSCI & IHSG";
const PLACEHOLDER = "Tanya apa aja… (Ctrl+V buat tempel screenshot)";

/** sumber (outlet dari TEASER_NEWS_SOURCES, bukan kutipan) — kecil di slide (note asli TWS) + terbaca di kanvas */
const SRC = ["Kontan, Databoks (Katadata)", "CNBC Indonesia, detikNews", "Kontan, Databoks (Katadata)"];
const SLIDES: TwsSlide[] = TEASER_TWS_DECK.slides.map((sl, i) => (SRC[i] && !sl.note ? { ...sl, note: `Sumber: ${SRC[i]}` } : sl));
/** nama slide persis seperti DesignCard (twsDesigns) */
const NAMES = twsDesigns(TEASER_TWS_DECK).map((d) => d.name);
const N = SLIDES.length;
/** nama file unduhan slide terakhir, rumus sama dengan DesignCard fileName() */
const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "konten";
const FILE_NAME = `tws-${slug(TEASER_TWS_DECK.title ?? "konten").slice(0, 24)}-${String(N).padStart(2, "0")}-${slug(NAMES[N - 1] ?? "").slice(0, 28)}-4x5`;

// ---------------------------------------------------------------------------------------------
// Tata letak kartu (px CSS website, lalu diskalakan U)
// ---------------------------------------------------------------------------------------------
const CW = 400; // lebar DesignCard Viewer (HP)
const PAD = 8; // p-2
const IN = CW - PAD * 2 - 2; // isi (dikurangi border)
const PW = IN; // preview
const PH = PW * 1.25; // 4:5
const PS = PW / SLIDE_W; // skala slide di preview
const PREV_Y = 1 + PAD; // atas preview di dalam kartu
const GAP_SLIDE = 60; // jarak antar-slide carousel (px slide)
const THUMB_CELL = (IN - 5 * 6) / 6; // grid-cols-6 gap-1.5
const THUMB_W = THUMB_CELL - 4; // p-0.5
// baris-baris kartu (px kartu)
const NAV_Y = PREV_Y + PH + 8; // ‹ Slide n/3 › (tinggi 28)
const FEED_Y = NAV_Y + 28 + 2; // "Feed 4:5 · 2160×2700" (16)
const THUMB_Y = FEED_Y + 16 + 8; // thumbnail
const CHECK_Y = THUMB_Y + THUMB_W * 1.25 + 4 + 6; // "✓ Dicek" (17)
const DL_Y = CHECK_Y + 17 + 8; // baris tombol unduh 1 (tinggi 28)
const DL_ROWS = 28 + 6 + 28; // 2 baris (ZIP SVG terbungkus ke baris 2)
const MSG_H = 4 + 34; // pesan font SVG (2 baris)
/** kartu dipotong (pudar) di bawah baris "Slide n/3" selama 1,2–5,0; dibuka penuh saat kamera turun ke tombol unduh */
const CROP_H = NAV_Y + 28 + 26;
const FULL_H = DL_Y + DL_ROWS + PAD + 1;
/** ekor pudar di bawah kartu terbuka (isi kartu asli berlanjut) */
const TAIL = 22;
// tombol unduh baris 1 (px kartu, diukur dari render): pusat "⬇ SVG Figma" & pusat baris
const HERO_X = 125;
const ROW_CX = 170;
const ROW_W = 322;
/** lebar glyph "-11,57%" di slide (px slide, 174px Inter Tight 900) & pusatnya (rotate(-3 540 258) di big3d) */
const NUM_GW = 650;
const NUM_CX = 540;
const NUM_CY = 258;
// panel Layers & toast (px CSS sebelum diskalakan)
const LP_W = 300;
const LP_H = 222;
const TOAST_H = 38;

const C = {
  orange: "#f97316",
  orangeGrad: "linear-gradient(180deg,#fb8a3c,#ea580c)",
  emerald: "#10b981",
  emerald4: "#34d399",
  sky4: "#38bdf8",
  sky: "#0ea5e9",
  red: "#ff3b3b",
  twsBlue: "#2f5ff0",
};

const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

// ---------------------------------------------------------------------------------------------
// Gerak
// ---------------------------------------------------------------------------------------------
/** posisi carousel (0 = slide 1): tiap geser mendarat TEPAT di detik kertas-balik, lalu sedikit lewat & kembali */
function carousel(s: number): number {
  const step = (t0: number) => {
    const len = 0.2;
    const a = t0 - len;
    if (s <= a) return 0;
    if (s < t0) {
      const p = (s - a) / len;
      return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    }
    const t = s - t0;
    return 1 + 0.035 * Math.exp(-t * 9) * Math.sin(t * 24);
  };
  return step(FLIP1) + step(FLIP2);
}

/** getar kamera setelah pukulan (px kanvas) */
function shake(s: number, at: number, amp: number): { x: number; y: number; r: number } {
  if (s < at) return { x: 0, y: 0, r: 0 };
  const t = s - at;
  const k = amp * Math.exp(-t * 9);
  if (k < 0.05) return { x: 0, y: 0, r: 0 };
  return { x: k * Math.sin(t * 71 + 0.6), y: k * Math.sin(t * 57 + 2.1) * 0.8, r: k * 0.03 * Math.sin(t * 43) };
}

// ---------------------------------------------------------------------------------------------
// Adegan
// ---------------------------------------------------------------------------------------------
export function TwsShot() {
  const { f, fps, s, t, box, W, H, display, brand } = useShot();
  const web = useRemotionEnvironment().isClientSideRendering;
  const logo = useTwsLogo();
  useTwsReady(logo);

  // id per salinan adegan: kelas animasi & id SVG tidak bentrok kalau ada 2 pemutar di satu halaman (mis. thumbnail Studio)
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  // slide asli (sekali): preview (kelas animasi tws{uid}p{i}) & thumbnail (statis)
  const prep = useMemo(() => SLIDES.map((sl, i) => prepareSlide(sl, i + 1, logo, `p${i}${uid}`)), [logo, uid]);
  const thumbs = useMemo(() => SLIDES.map((sl, i) => prepareSlide(sl, i + 1, logo, `t${i}${uid}`)), [logo, uid]);
  // lapisan "Angka 3D" asli slide 1 (salinan ber-id sendiri) untuk slam di level kanvas
  const heroNum = useMemo(() => (SLIDES[0] ? bigNumberHtml(prepareSlide(SLIDES[0], 1, logo, `h${uid}`).html) : ""), [logo, uid]);
  const baseCss = prep[0]?.css ?? "";
  // nama layer Figma = data-layer slide yang diunduh (lib/domToSvg: data-layer → grup bernama, nama kembar diberi nomor)
  const layers = useMemo(() => figmaLayers(prep[N - 1]?.html ?? ""), [prep]);

  // ---- tata letak kanvas (ikut box: menyusut kalau ada subtitle VO) ----
  const PCX = box.x + box.w / 2;
  const capFs = Math.round(box.w * 0.095);
  const capBottom = box.y + 2 * capFs * 1.12;
  const srcFs = Math.max(20, Math.round(box.w * 0.029));
  const srcY = capBottom + 6;
  const previewTop = srcY + srcFs * 1.35 + 76;
  // judul cover (slide y ≤ 1240 → 92%) + punch-in kamera 1,12× tetap di atas 12% bawah box
  const limit = box.y + box.h * 0.88;
  const PHc = Math.max(PH, Math.min(box.w * 0.78 * 1.25, (limit - previewTop) / 0.975));
  const U = PHc / PH; // skala UI kartu
  const PCY = previewTop + PHc / 2;
  /** titik px kartu → kanvas (kartu berpusat di pusat preview) */
  const toCanvas = (x: number, y: number): [number, number] => [PCX + (x - CW / 2) * U, PCY + (y - PREV_Y - PH / 2) * U];
  const UC = Math.min(U * 1.1, (box.w * 0.92) / (CW * 1.12)); // skala kolom ketik (muat di box saat kamera 1,12×)

  // angka: slot di cover (skala kartu) & posisi hero (±88% lebar box, di depan bagian gelap kartu)
  const kC = PS * U;
  const kH = (box.w * 0.88) / NUM_GW;
  const slotY = previewTop + NUM_CY * kC;
  const heroY = slotY + box.h * 0.1;

  // ---- kamera (fokus titik konten ke titik layar) ----
  const at = (tt: number, z: number, p: [number, number], sc: [number, number], r = 0, ease?: (x: number) => number): CamKey => ({
    t: tt,
    z,
    x: sc[0] - (W / 2 + (p[0] - W / 2) * z),
    y: sc[1] - (H / 2 + (p[1] - H / 2) * z),
    r,
    ease,
  });
  const PC: [number, number] = [PCX, PCY];
  // kolom ketik (antara gelembung pesan & composer)
  const CC: [number, number] = [PCX, PCY + 50 * UC];
  const ccScreen: [number, number] = [PCX, box.y + box.h * 0.56];
  // baris tombol unduh: seluruh baris 1 muat di box; "⬇ SVG Figma" terangkat sebagai hero
  const toastScale = U * 1.25;
  const toastBottom = box.y + 12 + TOAST_H * toastScale;
  // zoom: baris 1 muat di lebar box, dan toast + kartu (dari "Slide n/3") + panel Layers (skala ≥1,6) muat di tinggi box
  const fitH = (box.h - 12 - TOAST_H * toastScale - 28 - 34 - LP_H * 1.6) / (FULL_H + TAIL + MSG_H - NAV_Y);
  const Zdl = Math.max(1.3, Math.min(2, (box.w * 0.94) / (ROW_W * U), fitH / U));
  const DLP = toCanvas(ROW_CX, DL_Y + 14);
  // baris "Slide n/3" ≥ 28 px di bawah toast
  const dlScreenY = Math.max(box.y + box.h * 0.42, toastBottom + 28 + (DL_Y + 14 - NAV_Y) * U * Zdl);
  const dlScreen: [number, number] = [PCX, dlScreenY];
  // sebelum ketukan baris unduh sedikit lebih rendah; setelah ketukan kamera naik memberi ruang panel Layers
  const dlScreenA: [number, number] = [PCX, Math.max(dlScreenY + box.h * 0.1, box.y + box.h * 0.62)];
  const ease3 = (x: number) => x * x * x;
  const keys: CamKey[] = [
    at(0, 1.12, CC, ccScreen),
    at(SEND - 0.02, 1.06, CC, ccScreen, 0, EASE.soft),
    at(1.06, 0.98, CC, ccScreen, 0, EASE.inOut), // antisipasi: kamera mundur sebelum drop
    at(DROP, 1.07, PC, PC, 0, ease3), // punch-in, berhenti TEPAT di pukulan
    at(DROP + 0.3, 1.035, PC, PC, 0, EASE.out),
    at(FLY_B + 0.1, 1.0, PC, PC, 0, EASE.inOut),
    at(FLIP1 - 0.3, 1.025, PC, PC, 0, EASE.soft),
    at(FLIP1 - 0.12, 1.0, PC, PC, 0, EASE.inOut), // antisipasi
    at(FLIP1, 1.12, PC, PC, -0.5, ease3), // punch-in tepat di kertas-balik
    at(FLIP1 + 0.2, 1.1, PC, PC, 0, EASE.out),
    at(FLIP2 - 0.4, 1.04, PC, PC, 0, EASE.soft),
    at(FLIP2 - 0.12, 1.01, PC, PC, 0, EASE.inOut),
    at(FLIP2, 1.12, PC, PC, 0.5, ease3),
    at(FLIP2 + 0.2, 1.1, PC, PC, 0, EASE.out),
    at(CAP_OUT, 1.05, PC, PC, 0, EASE.soft),
    at(DL_IN, Zdl * 1.06, DLP, dlScreenA, 0, EASE.inOut), // turun & dorong ke baris unduh (rack focus)
    at(POP + 0.03, Zdl * 1.085, DLP, dlScreenA, 0, EASE.soft), // ketukan tajam (kamera hampir diam)
    at(POP + 0.75, Zdl, DLP, dlScreen, 0, EASE.inOut), // tarik mundur & naik pelan: toast + panel Layers masuk
    at(7.2, Zdl * 1.04, DLP, dlScreen, 0, EASE.soft),
  ];
  const sh1 = shake(s, DROP, 14);
  const sh2 = shake(s, POP, 3);
  const sh = { x: sh1.x + sh2.x, y: sh1.y + sh2.y, r: sh1.r + sh2.r };
  // motion blur kamera: min(kecepatan masuk, keluar) → tajam tepat di frame pukulan, buram saat gerak cepat berkelanjutan
  const camSpeed = (a: number, b: number) => {
    const ca = camAtTime(keys, a);
    const cb = camAtTime(keys, b);
    return Math.hypot(cb.x - ca.x, cb.y - ca.y) + Math.abs(cb.z - ca.z) * W * 0.5 + Math.abs(cb.r - ca.r) * 8;
  };
  const camV = Math.min(camSpeed(s - 1 / fps, s), camSpeed(s, s + 1 / fps));
  // setelah ketukan unduh blur dibatasi (tombol, cincin ketuk & panel tetap terbaca saat kamera naik)
  const camBlur = Math.min(s > POP ? 0.8 : 5, Math.max(0, camV - 7) * 0.12);
  // posisi layar (y) tepi bawah kartu: pada kamera akhir (ukuran panel Layers) & kamera sekarang (panel menempel di bawah kartu)
  const zEnd = Zdl * 1.04;
  const cardBottomY = toCanvas(0, FULL_H + TAIL + MSG_H)[1];
  const cardBottomEnd = dlScreenY + (cardBottomY - DLP[1]) * zEnd;
  const camNow = camAtTime(keys, s);
  const cardBottomNow = H / 2 + (cardBottomY - H / 2) * camNow.z + camNow.y;

  // ---- fase kolom ketik ----
  const typed = PROMPT.slice(0, Math.max(0, Math.floor(clamp01((s - 0.1) / 0.66) * PROMPT.length)));
  const sent = s >= SEND + 1 / fps;
  const composerOut = prog(f, fps, DROP - 0.2, DROP - 0.03, EASE.in);
  const showComposer = composerOut < 1;

  // ---- kartu ----
  const cardIn = prog(f, fps, NUM_IN, DROP, (x) => x * x);
  const cardOp = clamp01((s - NUM_IN) / 0.08);
  const cardBounce = s >= DROP ? -10 * Math.exp(-(s - DROP) * 10) * Math.sin((s - DROP) * 26) : 0;
  const cardScale = 0.62 + 0.38 * cardIn;
  const pos = carousel(s);
  const act = s >= FLIP2 ? 2 : s >= FLIP1 ? 1 : 0;
  // DOF saat angka slam: kartu di belakang buram & redup, fokus kembali saat angka terbang ke slotnya
  const slamDof = s < DROP ? 1 : 1 - prog(f, fps, FLY_A - 0.1, FLY_B - 0.1, EASE.inOut);
  // kartu terbuka penuh saat kamera turun
  const unfold = prog(f, fps, CAP_OUT - 0.05, 5.55, EASE.inOut);
  // fokus pindah ke tombol unduh: preview buram, redup, memudar ke atas
  const dof = prog(f, fps, CAP_OUT + 0.1, DL_IN, EASE.inOut);
  const dim = prog(f, fps, 5.25, 5.7, EASE.inOut);
  const lift = springAt(f, fps, 5.4, { damping: 14, stiffness: 150, mass: 0.8 });

  // ---- tombol unduh ----
  const popF = Math.round(POP * fps);
  const busy = f >= popF + 1 && f <= popF + 6;
  const msgOpen = prog(f, fps, POP + 7 / fps, POP + 7 / fps + 0.25, EASE.out);
  const press = f >= popF - 2 && f <= popF + 2 ? 1 - 0.1 * (1 - Math.abs(f - popF) / 3) : 1;
  const cardH = CROP_H + (FULL_H + TAIL - CROP_H) * unfold + MSG_H * msgOpen;
  // tepi bawah tetap pudar: kartu asli masih berlanjut (kontrol gambar, chip revisi, caption, sumber data)
  const fadeLen = 44 * (1 - unfold) + TAIL * unfold;

  // ---- CSS animasi ber-scope (hanya salinan preview: .tws{uid}p0/p1/p2) ----
  const anim = useMemo(() => slideAnim(f, fps, `tws${uid}p`), [f, fps, uid]);

  // ---- angka hero (level kanvas, di dalam kamera) ----
  const hn = heroNumAt(s, kH, kC, heroY, slotY);

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <TwsStyle css={baseCss} anim={anim} web={web} />

      {/* cahaya latar: biru TWS + rona merah saat angka jatuh */}
      <Glow x={PCX} y={PCY} r={box.w * 0.95} color={C.twsBlue} opacity={0.2 + 0.08 * Math.sin(f / 23)} />
      <Glow x={PCX} y={hn ? hn.y : slotY} r={box.w * 0.85} color={C.red} opacity={s >= DROP ? 0.5 * Math.exp(-(s - DROP) * 2.2) + 0.08 * (act === 0 ? 1 : 0) : 0} />
      <Glow x={PCX} y={PCY + PHc * 0.55} r={box.w * 0.7} color={brand.primary} opacity={0.12} />

      <Cam keys={keys} blur={false} style={{ filter: blurCss(camBlur) }}>
        <AbsoluteFill style={{ transform: `translate(${sh.x.toFixed(2)}px, ${sh.y.toFixed(2)}px) rotate(${sh.r.toFixed(3)}deg)` }}>
          {/* ---------- kolom ketik AI (AiChat composer) ---------- */}
          {showComposer && (
            <div
              style={{
                position: "absolute",
                left: PCX - (CW * UC) / 2,
                top: PCY - 124 * UC,
                width: CW,
                transform: `translateY(${(composerOut * 90 * UC).toFixed(1)}px) scale(${(UC * (1 - composerOut * 0.12)).toFixed(4)})`,
                transformOrigin: "0 0",
                opacity: 1 - composerOut,
                filter: blurCss(composerOut * 8),
              }}
            >
              <ChatBits f={f} fps={fps} />
              <Composer text={sent ? "" : typed} typing={s < 0.8 && s > 0.08} f={f} fps={fps} s={s} t={t} />
            </div>
          )}

          {/* ---------- DesignCard Viewer ---------- */}
          {cardOp > 0 && (
            <div
              style={{
                position: "absolute",
                // titik pusat skala = pusat preview → kartu berpusat di (PCX, PCY)
                left: PCX - CW / 2,
                top: PCY - (PREV_Y + PH / 2),
                width: CW,
                transform: `translateY(${((1 - cardIn) * 140 + cardBounce).toFixed(1)}px) scale(${(U * cardScale).toFixed(4)})`,
                transformOrigin: `${CW / 2}px ${PREV_Y + PH / 2}px`,
                opacity: cardOp,
                filter: blurCss((1 - cardIn) * 9),
                fontFamily: FONT,
              }}
            >
              <div
                style={{
                  position: "relative",
                  height: cardH,
                  overflow: "hidden",
                  borderRadius: 12,
                  border: `1px solid ${Z[800]}`,
                  background: "rgba(9,9,11,0.94)",
                  padding: PAD,
                  boxShadow: `0 40px 90px -30px rgba(0,0,0,0.9), 0 0 0 1px ${rgba("#ffffff", 0.03)}`,
                  // dipotong pudar (masih ada isi di bawahnya) selama fase carousel
                  maskImage: fadeLen > 0.5 ? `linear-gradient(180deg, #000 ${(((cardH - fadeLen) / cardH) * 100).toFixed(2)}%, rgba(0,0,0,0) 100%)` : undefined,
                  WebkitMaskImage: fadeLen > 0.5 ? `linear-gradient(180deg, #000 ${(((cardH - fadeLen) / cardH) * 100).toFixed(2)}%, rgba(0,0,0,0) 100%)` : undefined,
                }}
              >
                {/* preview besar (carousel) */}
                <div
                  style={{
                    position: "relative",
                    width: PW,
                    height: PH,
                    borderRadius: 8,
                    overflow: "hidden",
                    background: Z[950],
                    boxShadow: "0 1px 2px rgba(0,0,0,.4)",
                    maskImage: dof > 0.01 ? `linear-gradient(180deg, rgba(0,0,0,${(1 - dof).toFixed(3)}) 0%, rgba(0,0,0,${(1 - 0.7 * dof).toFixed(3)}) 70%, #000 100%)` : undefined,
                    WebkitMaskImage: dof > 0.01 ? `linear-gradient(180deg, rgba(0,0,0,${(1 - dof).toFixed(3)}) 0%, rgba(0,0,0,${(1 - 0.7 * dof).toFixed(3)}) 70%, #000 100%)` : undefined,
                  }}
                >
                  <div style={{ position: "absolute", inset: 0, filter: blurCss(swipeBlur(f, fps) / U + dof * 1.6 + slamDof * 3) }}>
                    {prep.map((p, i) => {
                      const d = i - pos;
                      if (Math.abs(d) > 1.05) return null;
                      const rot = Math.max(-28, Math.min(28, -d * 26));
                      return (
                        <div
                          key={i}
                          style={{
                            position: "absolute",
                            left: 0,
                            top: 0,
                            // perspektif di dalam transform (web-renderer hanya membaca matriks transform, bukan properti `perspective`)
                            transform: `perspective(900px) translateX(${(d * (SLIDE_W + GAP_SLIDE) * PS).toFixed(2)}px) rotateY(${rot.toFixed(2)}deg) scale(${(1 - Math.min(1, Math.abs(d)) * 0.08).toFixed(4)})`,
                            transformOrigin: d > 0 ? "0% 50%" : "100% 50%",
                          }}
                        >
                          <TwsSlideView html={p.html} scale={PS} cls={`tws${uid}p${i}`} />
                        </div>
                      );
                    })}
                  </div>
                  <PreviewSweeps f={f} fps={fps} />
                  {(dof > 0 || slamDof > 0) && <div style={{ position: "absolute", inset: 0, background: `rgba(0,0,0,${(dof * 0.35 + slamDof * 0.5).toFixed(3)})` }} />}
                </div>

                {/* ‹ Slide n/3 Nama › */}
                <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, padding: "0 2px", height: 28 }}>
                  <MiniBtn disabled={act === 0}>‹</MiniBtn>
                  <b style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: "18px", color: Z[100], whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    <span style={{ marginRight: 4, color: C.orange }}>
                      Slide {act + 1}/{N}
                    </span>
                    {NAMES[act]}
                  </b>
                  <MiniBtn disabled={act === N - 1}>›</MiniBtn>
                </div>
                <div style={{ marginTop: 2, padding: "0 2px", fontSize: 11, lineHeight: "16px", color: Z[500] }}>Feed 4:5 · 2160×2700</div>

                {/* thumbnail 6 kolom */}
                <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 6 }}>
                  {thumbs.map((p, i) => (
                    <div key={i} style={{ borderRadius: 6, padding: 2, boxShadow: i === act ? `0 0 0 2px ${C.orange}` : undefined, opacity: i === act ? 1 : 0.7 }}>
                      <div style={{ borderRadius: 8, overflow: "hidden", background: Z[950] }}>
                        <TwsSlideView html={p.html} scale={THUMB_W / SLIDE_W} />
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 6, padding: "0 2px", fontSize: 11.5, lineHeight: "17px", color: C.emerald }}>✓ Dicek: teks muat, kontras aman</div>

                {/* tombol unduh (Downloads): saat ⏳ semua tombol nonaktif (disabled:opacity-50) */}
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    <DlBtn dim={dim} busy={busy}>
                      ⬇ PNG
                    </DlBtn>
                    <DlBtn hero lift={lift} press={press} busy={busy}>
                      {busy ? "⏳" : "⬇"} SVG Figma
                      <Touch f={f} at={popF} x="95%" y="92%" from={[30, 42]} />
                    </DlBtn>
                    <DlBtn dim={dim} busy={busy}>
                      ⬇ HTML
                    </DlBtn>
                    <DlBtn dim={dim} busy={busy}>
                      ⬇ ZIP PNG
                    </DlBtn>
                    <DlBtn dim={dim} busy={busy}>
                      ⬇ ZIP SVG
                    </DlBtn>
                  </div>
                  {msgOpen > 0 && (
                    <div style={{ height: MSG_H * msgOpen, overflow: "hidden" }}>
                      <p style={{ margin: 0, paddingTop: 4, fontSize: 11.5, lineHeight: "17px", color: Z[500], opacity: msgOpen }}>
                        Font di SVG: Inter Tight — install dulu supaya di Figma tampilannya sama. <span style={{ color: C.orange }}>Unduh Inter Tight</span>
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ---------- angka "-11,57%" (lapisan Angka 3D asli) SLAM di level kanvas, lalu terbang ke slot cover ---------- */}
          {hn && <SlamBloom s={s} x={PCX} y={hn.y} w={box.w} />}
          {hn && heroNum && <HeroNumber html={heroNum} x={PCX} st={hn} f={f} fps={fps} />}
        </AbsoluteFill>
      </Cam>

      {/* kilat pukulan (bass-drop + impact): singkat, angka tetap kontras */}
      <Flash at={DROP} len={0.07} max={0.22} />

      {/* teks layar: "Sekali ketik," lalu "langsung jadi" mendarat di drop */}
      <CaptionTws box={box} fs={capFs} display={display} f={f} fps={fps} color={brand.text} accent={brand.primary} />
      <SourceLine f={f} fps={fps} s={s} x={PCX} y={srcY} w={box.w} fs={srcFs} />

      {/* toast setelah unduh (ruang kosong di atas kartu) */}
      <SavedToast f={f} fps={fps} x={PCX} y={box.y + 12} scale={toastScale} />

      {/* hasil di Figma: layer bernama (teks tetap teks) — jendela terpisah di bawah kartu */}
      <LayersPanel
        f={f}
        fps={fps}
        x={PCX + box.w * 0.05}
        y={Math.max(cardBottomEnd, cardBottomNow) + 34}
        scale={Math.min((box.w * 0.64) / LP_W, (box.y + box.h - (cardBottomEnd + 34) - 8) / LP_H)}
        layers={layers}
        file={FILE_NAME}
      />
    </AbsoluteFill>
  );
}

/** blur gerak saat carousel geser (px kanvas, sebanding kecepatan) */
function swipeBlur(f: number, fps: number): number {
  const v = Math.abs(carousel((f + 1) / fps) - carousel(f / fps)) * PW * 1.6;
  return Math.min(7, Math.max(0, v - 10) * 0.06);
}

// ---------------------------------------------------------------------------------------------
// Angka hero "-11,57%"
// ---------------------------------------------------------------------------------------------
type HeroNumState = { y: number; k: number; rx: number; ty: number; blur: number; op: number };
/** keadaan angka hero di detik s (null = disembunyikan; angka di cover yang tampil) */
function heroNumAt(s: number, kH: number, kC: number, heroY: number, slotY: number): HeroNumState | null {
  if (s < NUM_IN || s >= FLY_B) return null;
  if (s < DROP) {
    // jatuh dari depan kamera: skala 3,5× + miring X + blur, makin cepat menjelang pukulan
    const p = clamp01((s - NUM_IN) / (DROP - NUM_IN));
    const e = p * p;
    return { y: heroY, k: kH * (1 + 2.5 * (1 - e)), rx: (1 - e) * 34, ty: -(1 - e) * 90, blur: (1 - e) * 9, op: clamp01(p * 3) };
  }
  const tt = s - DROP;
  const bounce = 1 - 0.09 * Math.exp(-tt * 9) * Math.cos(tt * 30);
  const q = EASE.inOut(clamp01((s - FLY_A) / (FLY_B - FLY_A)));
  // crossfade 2 frame terakhir dengan angka asli di cover (posisi & skala sudah sama)
  const op = 1 - clamp01((s - (FLY_B - 0.07)) / 0.07);
  return { y: lerp(heroY, slotY, q), k: lerp(kH * bounce, kC, q), rx: 0, ty: 0, blur: 0, op };
}

function HeroNumber({ html, x, st, f, fps }: { html: string; x: number; st: HeroNumState; f: number; fps: number }) {
  return (
    <div style={{ position: "absolute", left: x, top: st.y, width: 0, height: 0, opacity: st.op, pointerEvents: "none" }}>
      <div
        className="twsx"
        style={{
          position: "absolute",
          left: -NUM_CX,
          top: -NUM_CY,
          background: "transparent",
          transformOrigin: `${NUM_CX}px ${NUM_CY}px`,
          transform: `perspective(1100px) translateY(${st.ty.toFixed(1)}px) rotateX(${st.rx.toFixed(2)}deg) scale(${st.k.toFixed(4)})`,
          filter: blurCss(st.blur),
        }}
      >
        <div dangerouslySetInnerHTML={{ __html: html }} />
        <NumSpecular f={f} fps={fps} />
      </div>
    </div>
  );
}

/** kilau spekular sempit yang menyapu glyph angka saja (clip = teks yang sama dengan lapisan Angka 3D) */
function NumSpecular({ f, fps }: { f: number; fps: number }) {
  const id = useSvgId("nspec");
  const p = prog(f, fps, DROP + 0.03, DROP + 0.38, EASE.inOut);
  if (p <= 0 || p >= 1) return null;
  const X = lerp(150, 950, p);
  const stops: [number, number][] = [
    [0, 0],
    [0.22, 0.08],
    [0.44, 0.14],
    [0.48, 0.65],
    [0.52, 0.65],
    [0.56, 0.14],
    [0.78, 0.08],
    [1, 0],
  ];
  const text = { textAnchor: "middle", fontFamily: "Inter Tight Variable, Inter Tight, sans-serif", fontWeight: 900, fontSize: 174, letterSpacing: -7, x: 540, y: 319 } as const;
  return (
    <svg width={1080} height={411} viewBox="0 0 1080 411" style={{ position: "absolute", left: 0, top: 0, zIndex: 4, overflow: "visible" }}>
      <defs>
        <clipPath id={`${id}c`}>
          <text {...text}>-11,57%</text>
        </clipPath>
        <linearGradient id={`${id}g`} gradientUnits="userSpaceOnUse" x1={X - 150} y1={150} x2={X + 150} y2={370}>
          {stops.map(([o, a]) => (
            <stop key={o} offset={o} stopColor="#ffffff" stopOpacity={a} />
          ))}
        </linearGradient>
      </defs>
      <g transform="rotate(-3 540 258)">
        <rect x={0} y={150} width={1080} height={220} fill={`url(#${id}g)`} clipPath={`url(#${id}c)`} />
      </g>
    </svg>
  );
}

/** bloom di BELAKANG angka saat pukulan (putih → merah), memudar cepat; sisa rona merah lembut */
function SlamBloom({ s, x, y, w }: { s: number; x: number; y: number; w: number }) {
  const id = useSvgId("bloom");
  if (s < DROP) return null;
  const t = s - DROP;
  const hit = Math.pow(1 - clamp01(t / 0.45), 2);
  const halo = 0.22 * Math.exp(-t * 1.6) * (1 - clamp01((s - FLY_A) / (FLY_B - FLY_A)));
  if (hit < 0.01 && halo < 0.01) return null;
  const rx = w * 0.55;
  const ry = w * 0.2;
  return (
    <svg width={rx * 2} height={ry * 2} style={{ position: "absolute", left: x - rx, top: y - ry, pointerEvents: "none" }}>
      <defs>
        <radialGradient id={`${id}b`}>
          <stop offset="0" stopColor="#ffffff" stopOpacity={0.55 * hit} />
          <stop offset="0.3" stopColor="#ff4d4d" stopOpacity={0.4 * hit + halo} />
          <stop offset="1" stopColor="#ff2d2d" stopOpacity={0} />
        </radialGradient>
      </defs>
      <ellipse cx={rx} cy={ry} rx={rx} ry={ry} fill={`url(#${id}b)`} />
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------
// Animasi lapisan slide asli (data-layer dari lib/tws.ts) — CSS per frame, hanya untuk salinan preview
// ---------------------------------------------------------------------------------------------
function slideAnim(f: number, fps: number, pre: string): string {
  const s = f / fps;
  const sp = (a: number, cfg: { damping?: number; stiffness?: number; mass?: number } = { damping: 15, stiffness: 190, mass: 0.7 }) => springAt(f, fps, a, cfg);
  const pr = (a: number, b: number, e: (x: number) => number = EASE.inOut) => prog(f, fps, a, b, e);
  const out: string[] = [];
  const titleRise = (cls: string, starts: number[]) => {
    starts.forEach((a, k) => {
      const p = sp(a);
      out.push(`.${cls} .judul span:nth-child(${k + 1}){transform:translateY(${((1 - p) * 80).toFixed(1)}px);opacity:${clamp01(p * 1.5).toFixed(3)}}`);
    });
  };
  // sorotan biru disapu dari kiri (clip-path inset: didukung web-renderer, tidak bergantung background-size/repeat)
  const highlight = (cls: string, a: number) => {
    const p = pr(a, a + 0.3, EASE.out);
    out.push(`.${cls} [data-layer="Sorotan"]{${p >= 1 ? "" : `clip-path:inset(0 ${((1 - p) * 100).toFixed(2)}% 0 0);`}box-shadow:0 10px 28px rgba(42,86,234,${(0.35 * p).toFixed(3)})}`);
  };
  const bgZoom = (cls: string, a: number, b: number, from: number) => {
    const z = from - (from - 1) * pr(a, b, EASE.out);
    out.push(`.${cls} [data-layer="Latar"]{transform:scale(${z.toFixed(4)});transform-origin:50% 45%}`);
  };
  const noteIn = (cls: string, a: number) => out.push(`.${cls} [data-layer="Catatan"]{opacity:${pr(a, a + 0.4).toFixed(3)}}`);

  // --- cover 1: angka asli di cover muncul saat angka hero menyatu (crossfade di FLY_B) ---
  out.push(`.${pre}0 [data-layer="Angka 3D"]{opacity:${clamp01((s - (FLY_B - 0.07)) / 0.07).toFixed(3)}}`);
  out.push(`.${pre}0 [data-layer="Cahaya Angka"]{opacity:${(s < DROP ? 0 : 1).toFixed(2)}}`);
  titleRise(`${pre}0`, [2.05, 2.12, 2.19]);
  highlight(`${pre}0`, 2.4);
  bgZoom(`${pre}0`, NUM_IN, DROP + 1.7, 1.16);
  noteIn(`${pre}0`, 2.3);

  // --- cover 2: Prabowo — baris 1 sudah penuh saat mendarat (FLIP1), baris 2-3 + sorotan menyusul ---
  titleRise(`${pre}1`, [FLIP1 - 0.32, FLIP1 - 0.04, FLIP1 + 0.06]);
  highlight(`${pre}1`, FLIP1 + 0.1);
  bgZoom(`${pre}1`, FLIP1 - 0.2, FLIP1 + 1.4, 1.12);
  noteIn(`${pre}1`, FLIP1 + 0.3);

  // --- slide 3: kronologi — kalimat sudah terbaca saat halaman bergerak, baris data masuk setelah ketukan ---
  const isi = pr(FLIP2 - 0.25, FLIP2 + 0.1, EASE.out);
  out.push(`.${pre}2 .isi{transform:translateY(${((1 - isi) * 24).toFixed(1)}px);opacity:${(0.85 + 0.15 * isi).toFixed(3)}}`);
  for (let k = 0; k < 3; k++) {
    const p = sp(FLIP2 + 0.04 + k * 0.08, { damping: 16, stiffness: 170, mass: 0.7 });
    out.push(`.${pre}2 [data-layer="Data"]>div:nth-child(${k + 1}){transform:translateX(${(-(1 - p) * 110).toFixed(1)}px);opacity:${clamp01(p * 1.4).toFixed(3)}}`);
  }
  bgZoom(`${pre}2`, FLIP2 - 0.2, FLIP2 + 1.6, 1.12);
  noteIn(`${pre}2`, FLIP2 + 0.4);
  return out.join("\n");
}

// ---------------------------------------------------------------------------------------------
// Efek di atas preview
// ---------------------------------------------------------------------------------------------
/** kilau spekular sempit (inti ±3%, sayap ±10%) di slide yang baru mendarat di tiap kertas-balik */
function PreviewSweeps({ f, fps }: { f: number; fps: number }) {
  const band = (a: number, len: number, core: number) => {
    const p = prog(f, fps, a, a + len, EASE.inOut);
    if (p <= 0 || p >= 1) return null;
    const x = -15 + p * 130;
    const w = (o: number) => `${(x + o).toFixed(2)}%`;
    return (
      <div
        key={a}
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background: `linear-gradient(112deg, rgba(255,255,255,0) ${w(-10)}, rgba(255,255,255,${(core * 0.18).toFixed(3)}) ${w(-3)}, rgba(255,255,255,${core}) ${w(0)}, rgba(255,255,255,${(core * 0.18).toFixed(3)}) ${w(3)}, rgba(255,255,255,0) ${w(10)})`,
        }}
      />
    );
  };
  return (
    <>
      {band(FLIP1 + 0.03, 0.35, 0.38)}
      {band(FLIP2 + 0.03, 0.35, 0.34)}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// UI website (dibuat ulang dari AiChat & DesignCard)
// ---------------------------------------------------------------------------------------------
/** tombol btn DesignCard: rounded-lg border-zinc-800 px-2.5 py-1 text-[12px] font-semibold (disabled:opacity-50 saat ⏳) */
function DlBtn({ children, hero, lift = 0, press = 1, dim = 0, busy }: { children: ReactNode; hero?: boolean; lift?: number; press?: number; dim?: number; busy?: boolean }) {
  const st: CSSProperties = {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    whiteSpace: "nowrap",
    borderRadius: 8,
    border: `1px solid ${hero && lift > 0.02 ? rgba(C.orange, 0.75 * clamp01(lift)) : Z[800]}`,
    padding: "4px 10px",
    fontSize: 12,
    lineHeight: "18px",
    fontWeight: 600,
    color: Z[100],
  };
  if (hero) {
    const l = Math.max(0, lift);
    st.zIndex = 2;
    st.background = l > 0.02 ? `rgba(39,39,42,${(0.95 * clamp01(l)).toFixed(3)})` : "transparent";
    st.transform = `translateY(${(-3 * l).toFixed(2)}px) scale(${((1 + 0.24 * l) * press).toFixed(4)})`;
    st.boxShadow = l > 0.02 ? `0 ${(10 * l).toFixed(1)}px ${(24 * l).toFixed(1)}px -6px rgba(0,0,0,.75), 0 0 0 ${(3 * l).toFixed(2)}px ${rgba(C.orange, 0.2)}, 0 0 ${(22 * l).toFixed(1)}px ${rgba(C.orange, 0.28)}` : undefined;
    st.opacity = busy ? 0.6 : 1;
  } else {
    // fokus ke tombol hero: tombol lain redup & sedikit buram (DOF); saat ⏳ tetap ≤ 0,5 seperti disabled
    st.opacity = Math.min(busy ? 0.5 : 1, 1 - 0.62 * dim);
    st.filter = blurCss(dim * 0.7);
  }
  return <span style={st}>{children}</span>;
}

function MiniBtn({ children, disabled }: { children: ReactNode; disabled?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 8, border: `1px solid ${Z[800]}`, padding: "4px 8px", fontSize: 12, lineHeight: "18px", fontWeight: 600, color: Z[100], opacity: disabled ? 0.5 : 1 }}>
      {children}
    </span>
  );
}

/** jari (HP): muncul 10 frame sebelum ketukan, menekan tepat di `at`, cincin ketuk, lalu menghilang */
function Touch({ f, at, x, y, from = [40, 60] }: { f: number; at: number; x: string | number; y: string | number; from?: [number, number] }) {
  const a = at - 10;
  if (f < a || f > at + 16) return null;
  const op = clamp01((f - a) / 3) * (1 - clamp01((f - at - 9) / 7));
  const m = 1 - EASE.out(clamp01((f - a) / 9));
  const press = f >= at - 1 && f <= at + 2 ? 0.8 : 1;
  const ring = f >= at && f < at + 16 ? (f - at) / 16 : -1;
  return (
    <span style={{ position: "absolute", left: x, top: y, width: 0, height: 0, zIndex: 60, pointerEvents: "none", opacity: op }}>
      {ring >= 0 && (
        <span
          style={{
            position: "absolute",
            left: -16,
            top: -16,
            width: 32,
            height: 32,
            borderRadius: 999,
            border: `2.5px solid rgba(255,255,255,${(0.8 * (1 - ring)).toFixed(3)})`,
            transform: `scale(${(1 + ring * 1.5).toFixed(3)})`,
          }}
        />
      )}
      <span
        style={{
          position: "absolute",
          left: from[0] * m - 12,
          top: from[1] * m - 12,
          width: 24,
          height: 24,
          borderRadius: 999,
          background: "rgba(255,255,255,0.8)",
          border: "2px solid rgba(255,255,255,0.95)",
          boxShadow: "0 6px 18px rgba(0,0,0,0.45)",
          transform: `scale(${press})`,
        }}
      />
    </span>
  );
}

/** layar kosong AiChat (HeroArt + sapaan) → crossfade ke gelembung pesan user + "⏳ Menyusun desain berita…" */
function ChatBits({ f, fps }: { f: number; fps: number }) {
  const sendF = SEND * fps;
  const g = clamp01((f - sendF) / 5);
  const hi = springAt(f, fps, 0.05, { damping: 16, stiffness: 150, mass: 0.8 });
  const b = springAt(f, fps, SEND + 0.03, { damping: 14, stiffness: 210, mass: 0.6 });
  const st = prog(f, fps, SEND + 0.1, SEND + 0.2, EASE.out);
  return (
    <div style={{ position: "relative", height: 150 }}>
      {g < 1 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            paddingBottom: 14,
            opacity: clamp01(hi * 1.4) * (1 - g),
            transform: `translateY(${((1 - hi) * 18 - g * 12).toFixed(1)}px)`,
            filter: blurCss(g * 4),
          }}
        >
          <HeroArt hero="Harley" size={76} still />
          <div style={{ marginTop: 6, fontFamily: DISPLAY, fontSize: 19, lineHeight: "24px", fontWeight: 700, color: Z[100] }}>Halo {ME}, mau ngobrol apa?</div>
        </div>
      )}
      {f >= sendF && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 8, paddingBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <div
              style={{
                maxWidth: "85%",
                borderRadius: 16,
                borderBottomRightRadius: 6,
                padding: "10px 16px",
                fontSize: 14,
                lineHeight: "21px",
                color: "#fff",
                backgroundImage: C.orangeGrad,
                transform: `translateY(${((1 - b) * 40).toFixed(1)}px) scale(${(0.9 + 0.1 * b).toFixed(3)})`,
                transformOrigin: "100% 100%",
                opacity: clamp01(b * 2),
              }}
            >
              {PROMPT}
            </div>
          </div>
          <div style={{ fontSize: 12.5, lineHeight: "18px", color: Z[500], opacity: st, paddingLeft: 4 }}>⏳ Menyusun desain berita…</div>
        </div>
      )}
    </div>
  );
}

/** kolom ketik AiChat: rounded-2xl border-zinc-800 bg-zinc-900 p-2.5 + baris tombol (versi HP) */
function Composer({ text, typing, f, fps, s, t }: { text: string; typing: boolean; f: number; fps: number; s: number; t: ReturnType<typeof useShot>["t"] }) {
  const sendF = Math.round(SEND * fps);
  const sendP = f >= sendF - 1 && f <= sendF + 1 ? 0.86 : 1;
  const ready = text.length > 0;
  const caretOn = typing || Math.floor(s * 2.4) % 2 === 0;
  return (
    <div style={{ position: "relative", borderRadius: 16, border: `1px solid ${ready ? rgba(C.orange, 0.45) : Z[800]}`, background: Z[900], padding: 10, boxShadow: `0 30px 70px -28px rgba(0,0,0,.9), 0 0 0 ${ready ? 4 : 0}px ${rgba(C.orange, 0.08)}` }}>
      <div style={{ padding: "6px 8px", fontSize: 14, lineHeight: "21px", minHeight: 33, color: text ? Z[100] : Z[500], whiteSpace: "nowrap", overflow: "hidden" }}>
        {text || PLACEHOLDER}
        {text && caretOn && <span style={{ display: "inline-block", width: 1.5, height: 17, marginLeft: 1, verticalAlign: "-3px", background: Z[100] }} />}
      </div>
      <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 32, height: 32, flex: "none", borderRadius: 999, border: `1px solid ${Z[800]}`, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>📎</span>
        <Pill c={C.emerald} fg={C.emerald4}>
          📊 Data
        </Pill>
        <Pill c={C.sky} fg={C.sky4}>
          🌐 Internet
        </Pill>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", borderRadius: 999, border: `1px solid ${Z[800]}`, padding: "2px 10px 2px 2px", fontSize: 12, fontWeight: 600, color: Z[300] }}>
          <HeroAvatar t={t} hero="Harley" size={22} />
          Harley ▾
        </span>
        <span
          style={{
            marginLeft: "auto",
            width: 36,
            height: 36,
            flex: "none",
            borderRadius: 12,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            backgroundImage: C.orangeGrad,
            opacity: ready ? 1 : 0.4,
            transform: `scale(${sendP})`,
            boxShadow: ready ? `0 8px 22px -6px ${rgba(C.orange, 0.7)}` : undefined,
          }}
        >
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </span>
      </div>
      <Touch f={f} at={sendF} x="91%" y="74%" from={[30, 50]} />
    </div>
  );
}

function Pill({ c, fg, children }: { c: string; fg: string; children: ReactNode }) {
  return (
    <span style={{ flex: "none", whiteSpace: "nowrap", borderRadius: 999, border: `1px solid ${rgba(c, 0.4)}`, background: rgba(c, 0.1), color: fg, padding: "4px 12px", fontSize: 12, lineHeight: "16px", fontWeight: 600 }}>{children}</span>
  );
}

/** sumber berita terbaca di kanvas (outlet dari TEASER_NEWS_SOURCES), berganti mengikuti slide */
function SourceLine({ f, fps, s, x, y, w, fs }: { f: number; fps: number; s: number; x: number; y: number; w: number; fs: number }) {
  const inP = prog(f, fps, 1.75, 2.1, EASE.out);
  const out = prog(f, fps, CAP_OUT, CAP_OUT + 0.25, EASE.in);
  if (inP <= 0 || out >= 1) return null;
  const sw = FLIP1 - 0.06;
  const idx = s >= FLIP2 - 0.06 ? 2 : s >= sw ? 1 : 0;
  const dip = clamp01(Math.abs(s - sw) / 0.09); // teks berganti di titik terendah
  return (
    <div
      style={{
        position: "absolute",
        left: x - w / 2,
        top: y,
        width: w,
        textAlign: "center",
        fontFamily: FONT,
        fontSize: fs,
        lineHeight: 1.35,
        fontWeight: 500,
        color: Z[300],
        whiteSpace: "nowrap",
        opacity: inP * (1 - out) * dip,
        transform: `translateY(${((1 - inP) * 10 - out * 20).toFixed(1)}px)`,
        textShadow: "0 2px 12px rgba(0,0,0,.6)",
      }}
    >
      <span style={{ color: Z[500] }}>Sumber: </span>
      {SRC[idx]}
    </div>
  );
}

/** toast "Tersimpan" setelah ⬇ SVG Figma (gaya Toast screens/ui, skala kanvas) */
function SavedToast({ f, fps, x, y, scale }: { f: number; fps: number; x: number; y: number; scale: number }) {
  const a = POP + 2 / fps;
  if (f / fps < a) return null;
  const p = springAt(f, fps, a, { damping: 13, stiffness: 220, mass: 0.6 });
  const st: CSSProperties = {
    position: "absolute",
    left: x,
    top: y,
    transform: `translateX(-50%) translateY(${((1 - p) * -50).toFixed(1)}px) scale(${(scale * (0.86 + 0.14 * p)).toFixed(4)})`,
    transformOrigin: "50% 0",
    opacity: clamp01(p * 1.6),
  };
  return (
    <div style={st}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          height: TOAST_H,
          boxSizing: "border-box",
          borderRadius: 14,
          padding: "0 14px",
          background: "rgba(24,24,27,0.97)",
          border: `1px solid ${rgba(C.emerald, 0.5)}`,
          boxShadow: `0 16px 40px -12px rgba(0,0,0,0.8), 0 0 0 4px ${rgba(C.emerald, 0.12)}`,
          fontFamily: FONT,
          fontSize: 13,
          fontWeight: 650,
          color: Z[100],
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ width: 18, height: 18, borderRadius: 999, background: C.emerald, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2.5 6.3l2.3 2.2 4.7-5" />
          </svg>
        </span>
        Tersimpan
        <span style={{ color: Z[400], fontWeight: 500 }}>· SVG siap Figma</span>
      </div>
    </div>
  );
}

/** teks layar 2 baris (gaya Caption kit): baris 2 mendarat di drop, kata "jadi" warna brand */
function CaptionTws({ box, fs, display, f, fps, color, accent }: { box: { x: number; y: number; w: number; h: number }; fs: number; display: string; f: number; fps: number; color: string; accent: string }) {
  const lines: { words: string[]; at: number }[] = [
    { words: ["Sekali", "ketik,"], at: 0.3 },
    { words: ["langsung", "jadi"], at: DROP - 0.2 },
  ];
  const leave = prog(f, fps, CAP_OUT, CAP_OUT + 0.3, EASE.in);
  if (leave >= 1) return null;
  return (
    <div style={{ position: "absolute", left: box.x, top: box.y, width: box.w, display: "flex", flexDirection: "column", alignItems: "center", pointerEvents: "none", opacity: 1 - leave, transform: `translateY(${(-leave * 40).toFixed(1)}px)` }}>
      {lines.map((ln, li) => (
        <TextShine key={li} p={prog(f, fps, ln.at + 0.45, ln.at + 1.15)}>
          <div style={{ display: "flex", justifyContent: "center", columnGap: fs * 0.24, fontFamily: display, fontWeight: 800, fontSize: fs, lineHeight: 1.04, letterSpacing: "-0.035em", color }}>
            {ln.words.map((w, k) => {
              const p = springAt(f, fps, ln.at + k * 0.06, { damping: 13, stiffness: 170, mass: 0.7 });
              const em = w === "jadi";
              return (
                <span key={k} style={{ display: "inline-block", overflow: "hidden", paddingBottom: fs * 0.08 }}>
                  <span style={{ display: "inline-block", transform: `translateY(${((1 - p) * fs * 1.05).toFixed(1)}px) rotate(${((1 - p) * 4).toFixed(2)}deg)`, opacity: clamp01(p * 1.6), color: em ? accent : undefined, textShadow: `0 6px 34px ${rgba("#000000", 0.5)}` }}>{w}</span>
                </span>
              );
            })}
          </div>
        </TextShine>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Panel layer Figma (hasil "⬇ SVG Figma")
// ---------------------------------------------------------------------------------------------
type Layer = { name: string; kind: "text" | "image" | "group"; depth: number; caret?: "open" | "closed" };
const TEXT_LAYERS = /^(Teks|Nomor|Catatan|Pengantar|Judul|Sorotan|Kredit Foto|Tombol)/;
type LNode = { name: string; kids: LNode[] };
const VOID = /^(img|br|hr|input|meta|link|image|path|rect|circle|ellipse|line|polyline|polygon|stop|use)$/i;
/**
 * Pohon layer seperti hasil lib/domToSvg di Figma: elemen ber-data-layer = grup bernama (nama kembar diberi nomor),
 * anak di dalam induknya, urutan Figma = lapisan paling atas di baris pertama. Grup latar grafis dilipat.
 */
function figmaLayers(html: string): Layer[] {
  const root: LNode = { name: "", kids: [] };
  const stack: (LNode | null)[] = [];
  const parent = () => [...stack].reverse().find((x): x is LNode => !!x) ?? root;
  const seen = new Map<string, number>();
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(\/?)>/g)) {
    const [, close, tag, attrs, self] = m;
    if (close) {
      stack.pop();
      continue;
    }
    const lm = /data-layer="([^"]+)"/.exec(attrs);
    let node: LNode | null = null;
    if (lm) {
      const k = (seen.get(lm[1]) ?? 0) + 1;
      seen.set(lm[1], k);
      node = { name: k === 1 ? lm[1] : `${lm[1]} ${k}`, kids: [] };
      parent().kids.push(node);
    }
    if (!self && !VOID.test(tag)) stack.push(node);
  }
  const out: Layer[] = [];
  const walk = (n: LNode, depth: number) => {
    for (const c of [...n.kids].reverse()) {
      const fold = depth === 0 && c.name === "Latar";
      out.push({ name: c.name, depth, kind: c.name === "Logo" || c.name === "Foto Tokoh" ? "image" : TEXT_LAYERS.test(c.name) && !c.kids.length ? "text" : "group", caret: c.kids.length ? (fold ? "closed" : "open") : undefined });
      if (!fold) walk(c, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

function LayerIcon({ kind }: { kind: Layer["kind"] }) {
  const c = "#b3b3b3";
  if (kind === "text") return <span style={{ width: 14, textAlign: "center", fontSize: 11, fontWeight: 700, color: c }}>T</span>;
  if (kind === "image")
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={c} strokeWidth="1.2">
        <rect x="2" y="2.5" width="10" height="9" rx="1" />
        <path d="M3 10l3-3 2 2 1.5-1.5L11 10" />
      </svg>
    );
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={c} strokeWidth="1.2" strokeDasharray="2 1.6">
      <rect x="2.5" y="2.5" width="9" height="9" rx="1" />
    </svg>
  );
}

function LayersPanel({ f, fps, x, y, scale, layers, file }: { f: number; fps: number; x: number; y: number; scale: number; layers: Layer[]; file: string }) {
  const a = POP + 0.25;
  const s = f / fps;
  if (s < a || !layers.length) return null;
  const p = springAt(f, fps, a, { damping: 15, stiffness: 190, mass: 0.7 });
  const rows = layers.slice(0, 7);
  const sel = rows.findIndex((l) => l.name === "Teks");
  const selOn = prog(f, fps, a + 0.42, a + 0.52);
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: LP_W,
        height: LP_H,
        boxSizing: "border-box",
        transform: `translateX(-50%) translateY(${((1 - p) * 90).toFixed(1)}px) rotate(${(-1.6 + (1 - p) * -2).toFixed(2)}deg) scale(${(scale * (0.9 + 0.1 * p)).toFixed(4)})`,
        transformOrigin: "50% 0",
        opacity: clamp01(p * 1.5),
        fontFamily: FONT,
        borderRadius: 10,
        background: "#2c2c2c",
        border: "1px solid #444444",
        boxShadow: "0 30px 70px -16px rgba(0,0,0,.9), 0 0 0 1px rgba(0,0,0,.4)",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid #3d3d3d" }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "#ffffff" }}>Layers</span>
        <span style={{ marginLeft: "auto", fontSize: 10.5, color: "#9a9a9a" }}>Figma · SVG ditarik masuk</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", fontSize: 11, color: "#ffffff", fontWeight: 600 }}>
        <span style={{ width: 14, textAlign: "center", color: "#b3b3b3", fontWeight: 700 }}>#</span>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file}</span>
      </div>
      {rows.map((l, i) => {
        const q = prog(f, fps, a + 0.1 + i * 0.035, a + 0.22 + i * 0.035, EASE.out);
        const on = i === sel ? selOn : 0;
        return (
          <div
            key={l.name}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              height: 22,
              padding: `0 12px 0 ${14 + l.depth * 16}px`,
              fontSize: 11,
              color: "#e6e6e6",
              opacity: q,
              transform: `translateX(${((1 - q) * -16).toFixed(1)}px)`,
              background: on > 0 ? `rgba(13,153,255,${(0.32 * on).toFixed(3)})` : undefined,
            }}
          >
            <span style={{ width: 10, fontSize: 8, color: "#9a9a9a", textAlign: "center" }}>{l.caret === "open" ? "▼" : l.caret === "closed" ? "▶" : ""}</span>
            <LayerIcon kind={l.kind} />
            {l.name}
          </div>
        );
      })}
    </div>
  );
}
