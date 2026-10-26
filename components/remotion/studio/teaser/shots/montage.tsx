"use client";

/**
 * Adegan 10 — Montage + Studio (5,4 dtk). VO (mulai 1,2 dtk): "Dan video ini… juga dibikin di sini." — "di sini" ±3,4–3,8 dtk.
 * 0,0 bass drop → potongan cepat di tiap ketukan (setengah ketukan untuk potongan 0,3 dtk) berisi momen terbaik adegan lain:
 * komponen adegan ASLI diputar ulang di frame yang dibekukan (SceneFreeze) + kamera close-up + transisi sesuai SFX
 * (snap + guncang, spin, glitch, whip). 3,0 snap-spin → Studio Pro (UI asli, timeline teaser ini, preview memutar ulang montage ini,
 * tombol Download MP4) dengan teks "Dibikin di sini": pesan meta — video ini dibuat di Studio. Bagian Studio 2,4 dtk:
 * 3,0 close-up preview → 3,6 bidikan lebar → 4,2 ketuk Download (ketukan) → progress + kilau 4,8 → dorongan kamera terus
 * berjalan sampai tertutup transisi mask Outro (5,4–5,8).
 */
import { useContext } from "react";
import { AbsoluteFill, random } from "remotion";
import { sceneStartSecs, type TeaserShot } from "@/lib/studio/timeline";
import { SceneBg } from "../../backgrounds";
import { blurCss } from "../../fx";
import { useScene, useStudio, type Box } from "../../theme";
import { BEAT, Cam, Caption, clamp01, EASE, Flash, rgba, springAt, Sweep, useShot, type CamKey } from "../kit";
import { GlitchBands, MontageDepth, SceneFreeze, StudioUi, UI, UI_W } from "./montage-parts";

type Enter = "drop" | "whip" | "shake" | "spin" | "glitch";
/**
 * potongan montage: `from` = detik mulai di adegan ini (titik pukulan SFX), `at` = detik momen terbaik di adegan sumber,
 * `drift` = gerak lambat (frame sumber per frame montage). Bidikan close-up (punch-in): elemen hero di (`hx`,`hy`) — px kanvas
 * adegan sumber dengan kotak aman tanpa subtitle (B0) — diperbesar `z` kali dan diletakkan di tengah kotak aman, tinggi `ty`
 * (0 = atas kotak, 1 = bawah). Zoom juga mendorong judul adegan sumber keluar bingkai (1 pesan per layar); judul yang masih
 * tersisa dipotong dengan jendela `win` = [atas, bawah] (pecahan kotak aman, koordinat layar), tepinya dilembutkan letterbox.
 */
type Cut = { shot: TeaserShot; from: number; at: number; enter: Enter; z: number; hx: number; hy: number; ty: number; drift: number; win?: [number, number] };

/** kotak aman 9:16 tanpa ruang subtitle (FORMATS["9:16"].safe) — acuan koordinat hero */
const B0 = { x: 64, y: 210, w: 866, h: 1310 };

const CUTS: Cut[] = [
  // 0,0 bass-drop-jumpstart → kartu #1 🔥 HOT "Video ditolak padahal sesuai brief" (dashboard)
  { shot: "dashboard", from: 0, at: 3.5, enter: "drop", z: 1.3, hx: 436, hy: 1000, ty: 0.47, drift: 0.6, win: [0.13, 9] },
  // 0,3 (setengah ketukan) → pill "Disetujui" + centang hijau (video review), dropdown sudah tertutup
  { shot: "videoReview", from: BEAT * 0.5, at: 3.8, enter: "whip", z: 1.25, hx: 500, hy: 666, ty: 0.54, drift: 0.3, win: [-9, 1.03] },
  // 0,6 transisi-shaker-snap → lampiran screenshot clipper (identitas diburamkan) di chat tim
  { shot: "chat", from: BEAT, at: 5.5, enter: "shake", z: 1.2, hx: 465, hy: 850, ty: 0.52, drift: 0.4 },
  // 1,2 transisi-snap-spin → AI: chart BTC/USDT 4H dengan Resistance / Support
  { shot: "ai", from: BEAT * 2, at: 11.0, enter: "spin", z: 1.25, hx: 522, hy: 890, ty: 0.5, drift: 0.4 },
  // 1,8 transisi-shaker-snap → TWS: angka 3D "-11,57%"
  { shot: "tws", from: BEAT * 3, at: 1.7, enter: "shake", z: 1.4, hx: 470, hy: 770, ty: 0.47, drift: 0.4, win: [0.14, 9] },
  // 2,1 (setengah ketukan) → Train AI: huruf E N F P + "ENFP · Si Penyemangat" (sebelum rack focus)
  { shot: "trainAi", from: BEAT * 3.5, at: 3.0, enter: "whip", z: 1.3, hx: 500, hy: 930, ty: 0.5, drift: 0.3 },
  // 2,4 glitch-tinggi → Musik: baris "Fokus kerja ▶ diputar"
  { shot: "musicReport", from: BEAT * 4, at: 1.5, enter: "glitch", z: 1.45, hx: 522, hy: 930, ty: 0.49, drift: 0.3 },
];
/** 3,0 transisi-snap-spin → Studio */
const STUDIO_AT = BEAT * 5;
/** frame anticipation sebelum pukulan (keluar) & sesudah (masuk) per jenis transisi */
const PRE: Record<Enter, number> = { drop: 0, whip: 1, shake: 0, spin: 3, glitch: 1 };

type Fx = { x: number; y: number; s: number; r: number; blur: number; op: number };
const NONE: Fx = { x: 0, y: 0, s: 1, r: 0, blur: 0, op: 1 };
const add = (a: Fx, b: Partial<Fx>): Fx => ({ x: a.x + (b.x ?? 0), y: a.y + (b.y ?? 0), s: a.s * (b.s ?? 1), r: a.r + (b.r ?? 0), blur: a.blur + (b.blur ?? 0), op: a.op * (b.op ?? 1) });
const outC = EASE.out;

/** gerak masuk (lf = frame sejak pukulan) */
function enterFx(kind: Enter, lf: number, fps: number, W: number): Partial<Fx> {
  switch (kind) {
    case "drop": {
      const p = springAt(lf, fps, 0, { damping: 13, stiffness: 210, mass: 0.7 });
      return { s: 1 + 0.34 * (1 - p), blur: Math.max(0, 5 * (1 - lf / 4)) };
    }
    case "whip": {
      const q = outC(clamp01(lf / 4));
      return { x: W * 0.62 * (1 - q), blur: 16 * (1 - q) };
    }
    case "shake": {
      const q = outC(clamp01(lf / 6));
      const amp = 26 * Math.max(0, 1 - lf / 9);
      return { s: 1 + 0.16 * (1 - q), x: amp * (random(`sx${lf}`) * 2 - 1), y: amp * (random(`sy${lf}`) * 2 - 1), r: amp * 0.05 * (random(`sr${lf}`) * 2 - 1), blur: lf < 2 ? 3 - lf * 1.5 : 0 };
    }
    case "spin": {
      const p = springAt(lf, fps, 0, { damping: 15, stiffness: 190, mass: 0.7 });
      return { r: -22 * (1 - p), s: 1 + 0.26 * (1 - p), blur: 6 * (1 - outC(clamp01(lf / 4))) };
    }
    case "glitch": {
      const q = clamp01(lf / 7);
      return { s: 1 + 0.06 * (1 - q), x: lf < 4 ? (random(`gx${lf}`) * 2 - 1) * 30 : 0 };
    }
  }
}

/** gerak keluar sebelum pukulan berikutnya (left = sisa frame sampai pukulan, 1..PRE) */
function exitFx(next: Enter, left: number, W: number): Partial<Fx> {
  const n = PRE[next];
  if (left > n || left < 1) return {};
  const q = (n + 1 - left) / n;
  switch (next) {
    case "spin":
      return { r: 28 * q * q, s: 1 + 0.22 * q * q, blur: 14 * q * q };
    case "whip":
      return { x: -W * 0.12, blur: 8 };
    case "glitch":
      return { x: 18, blur: 1.5 };
    default:
      return {};
  }
}

/** satu potongan montage dengan transformasinya: titik hero jadi pusat zoom (efek masuk/keluar ikut berpusat di hero) */
function CutLayer({ cut, lf, fx, box, W, H }: { cut: Cut; lf: number; fx: Fx; box: Box; W: number; H: number }) {
  const push = 1 + 0.035 * clamp01(lf / 18);
  const s = cut.z * push * fx.s;
  // hero dipetakan ke kotak aman sekarang (kotak lebih pendek kalau ada subtitle)
  const hx = box.x + (cut.hx - B0.x) * (box.w / B0.w);
  const hy = box.y + (cut.hy - B0.y) * (box.h / B0.h);
  const tx = box.x + box.w / 2;
  const ty = box.y + box.h * cut.ty;
  const layer = (
    <AbsoluteFill
      style={{
        transformOrigin: `${hx.toFixed(1)}px ${hy.toFixed(1)}px`,
        transform: `translate(${(tx - hx + fx.x).toFixed(1)}px, ${(ty - hy + fx.y).toFixed(1)}px) scale(${s.toFixed(4)}) rotate(${fx.r.toFixed(2)}deg)`,
        filter: blurCss(fx.blur),
        opacity: fx.op,
      }}
    >
      <SceneFreeze shot={cut.shot} at={cut.at} drift={lf * cut.drift} noText />
    </AbsoluteFill>
  );
  if (!cut.win) return layer;
  // jendela: hanya bagian layar [atas, bawah] yang tampil (overflow, aman untuk render browser)
  const top = Math.max(0, box.y + box.h * cut.win[0]);
  const bottom = Math.min(H, box.y + box.h * cut.win[1]);
  return (
    <div style={{ position: "absolute", left: 0, top, width: W, height: Math.max(0, bottom - top), overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: -top, width: W, height: H }}>{layer}</div>
    </div>
  );
}

/** potongan-potongan cepat (dipakai juga di dalam preview Studio, kedalaman 1) */
function Cuts({ f, fps, W, H }: { f: number; fps: number; W: number; H: number }) {
  const { box } = useScene();
  const { brand } = useStudio();
  const S = CUTS.map((c) => Math.round(c.from * fps));
  const end = Math.round(STUDIO_AT * fps);
  let ci = -1;
  for (let i = 0; i < CUTS.length; i++) if (f >= S[i]) ci = i;
  if (ci < 0) return null;
  const cut = CUTS[ci];
  const E = ci + 1 < CUTS.length ? S[ci + 1] : end;
  const lf = f - S[ci];
  const nextEnter: Enter = ci + 1 < CUTS.length ? CUTS[ci + 1].enter : "spin";
  const fx = add(add(NONE, enterFx(cut.enter, lf, fps, W)), exitFx(nextEnter, E - f, W));
  // whip: potongan sebelumnya ikut tersapu keluar ke kiri selama potongan baru masuk
  const prev = ci > 0 && cut.enter === "whip" && lf < 4 ? CUTS[ci - 1] : null;
  const prevFx = prev ? add(NONE, { x: -W * 0.7 * EASE.in(clamp01((lf + 1) / 4)), blur: 16 }) : null;
  const glitch = cut.enter === "glitch" ? Math.max(0, 1 - lf / 7) : 0;
  return (
    <AbsoluteFill>
      {prev && prevFx && <CutLayer cut={prev} lf={S[ci] - S[ci - 1] + lf} fx={prevFx} box={box} W={W} H={H} />}
      <CutLayer cut={cut} lf={lf} fx={fx} box={box} W={W} H={H} />
      {glitch > 0 && <GlitchBands amt={glitch} seed={`g${lf}`} W={W} H={H} render={() => <CutLayer cut={cut} lf={lf} fx={fx} box={box} W={W} H={H} />} />}
      {/* letterbox gelap atas & bawah: sisa judul / UI adegan sumber di tepi bingkai tenggelam, mata ke hero di tengah */}
      <div style={{ position: "absolute", left: 0, top: 0, width: W, height: box.y + 300, background: `linear-gradient(180deg, ${rgba(brand.bg, 0.97)} 0%, ${rgba(brand.bg, 0.94)} ${(((box.y + 110) / (box.y + 300)) * 100).toFixed(1)}%, ${rgba(brand.bg, 0)} 100%)` }} />
      <div style={{ position: "absolute", left: 0, top: box.y + box.h * 0.86, width: W, height: H - (box.y + box.h * 0.86), background: `linear-gradient(0deg, ${rgba(brand.bg, 0.95)} 0%, ${rgba(brand.bg, 0.88)} 55%, ${rgba(brand.bg, 0)} 100%)` }} />
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------------------------------------
// Studio (3,0 – akhir)
// ---------------------------------------------------------------------------------------------
/** posisi (px kanvas, kamera diam) dari koordinat UI (px CSS) */
const camOn = (px: number, py: number, z: number, tx: number, ty: number, W: number, H: number) => ({ x: tx - W / 2 - (px - W / 2) * z, y: ty - H / 2 - (py - H / 2) * z, z });

function StudioPart({ f, fps, W, H }: { f: number; fps: number; W: number; H: number }) {
  const { box, brand, text } = useShot();
  const s = f / fps;
  const k = box.w / UI_W;
  const X0 = box.x;
  const Y0 = box.y + 190;
  const wx = (x: number) => X0 + x * k;
  const wy = (y: number) => Y0 + y * k;

  // preview memutar ulang montage ini mulai potongan chat (sampai ±5,3 dtk masih berputar); playhead di timeline terus berjalan
  // (preview sesudah potongan terakhir sudah redup / di luar bingkai, jadi bekunya tidak terlihat)
  const studioF = Math.round(STUDIO_AT * fps);
  const replayRaw = Math.round(BEAT * fps) + 4 + (f - studioF);
  const replayF = Math.min(studioF - 1, replayRaw);
  const head = useMontageStart() + replayRaw / fps;

  const pc = { x: wx(UI.player.x + UI.player.w / 2), y: wy(UI.player.y + UI.player.h / 2) };
  const btn = { x: wx(UI.button.x + UI.button.w / 2), y: wy(UI.button.y + UI.button.h / 2) };
  // titik ketuk: kanan teks tombol (teks "⬇️ Download MP4 (…)" tetap terbaca saat diketuk)
  const tap = { x: btn.x + UI.button.w * k * 0.37, y: btn.y };
  const A = STUDIO_AT;
  const close = camOn(pc.x, pc.y, 2.0, W / 2, 880, W, H);
  const settle = camOn(pc.x, pc.y, 1.86, W / 2, 900, W, H);
  // bidikan lebar: tab Studio sampai Preview, tepat di bawah teks
  const wide = camOn(W / 2, Y0, 0.88, W / 2, box.y + 236, W, H);
  // bidikan akhir (close-up): penggaris timeline + blok adegan "10. Montage + Studio" sampai tombol download, mengisi kotak aman
  // di bawah teks. Subtitle sudah dipotong dari kotak oleh StudioVideo (subs) → cukup sisakan 5% bawah. Sisi kiri/kanan boleh terpotong sedikit.
  const top = wy(UI.scenesRow - UI.rows.ruler - 4);
  const bot = wy(UI.y.end);
  const T0 = box.y + 232;
  const T1 = box.y + box.h * 0.95;
  // lebar UI × zoom akhir × dorongan ×1,12 tetap di dalam kotak aman (progress & tombol tidak masuk margin/rel kanan TikTok)
  const zFit = box.w / (UI_W * k * 1.12);
  const zEnd = Math.max(0.8, Math.min(1.32, zFit, (T1 - T0) / (bot - top)));
  const cxBox = box.x + box.w / 2;
  const midW = (top + bot) / 2;
  const midS = (T0 + T1) / 2;
  const fin = camOn(wx(UI_W / 2), midW, zEnd, cxBox, midS, W, H);
  // dorongan akhir kecil (×1,06) berpusat di tombol / progress: tombol diam di layar, sekitarnya membesar
  const btnS = { x: cxBox + (btn.x - wx(UI_W / 2)) * zEnd, y: midS + (btn.y - midW) * zEnd };
  // dorongan akhir pelan (×1,12) berpusat di tombol / progress — linear, tetap bergerak sampai tertutup mask Outro
  const push = camOn(btn.x, btn.y, zEnd * 1.12, btnS.x - 14, btnS.y - 8, W, H);
  const tapAt = A + BEAT * 2; // 4,2 dtk tepat di ketukan (frame 126 adegan)
  const keys: CamKey[] = [
    { t: A, ...close, r: -18 },
    { t: A + 0.2, ...settle, r: 0, ease: EASE.out },
    // 3,6 (ketukan): mundur ke bidikan lebar Studio, lalu tetap melayang pelan
    { t: A + 0.6, ...wide, ease: EASE.inOut },
    { t: A + 0.9, ...wide, z: wide.z * 1.018, y: wide.y - 10, ease: EASE.inOut },
    // pan ke timeline + download, mendarat tepat saat tombol diketuk
    { t: tapAt, ...fin, ease: EASE.inOut },
    { t: A + 2.4 + 0.5, ...push, ease: (x: number) => x },
  ];

  const press = 1 - 0.05 * Math.max(0, 1 - Math.abs(s - tapAt) / 0.1);
  const progress = s < tapAt + 0.13 ? 0 : clamp01((s - tapAt - 0.13) / 1.5) * 0.84 + 0.06;
  // kilau tombol saat masuk bingkai (sebelum diketuk) & kilau bar progress tepat di ketukan 4,8
  const sheen = clamp01((s - (A + 0.82)) / 0.36);
  const barSheen = clamp01((s - (A + BEAT * 3)) / 0.4);
  const ripple = clamp01((s - tapAt) / 0.32);
  // jari: turun ke tombol (0,25 dtk), tekan tepat di ketukan, lalu terangkat menjauh sebelum progress muncul (tidak menutupi teks)
  const finger = s >= tapAt - 0.25 && s < tapAt + 0.12;
  const fIn = clamp01((tapAt - s) / 0.25) + clamp01((s - tapAt - 0.06) / 0.14) * 0.8;
  return (
    <AbsoluteFill>
      <Cam keys={keys}>
        <div style={{ position: "absolute", left: X0, top: Y0, width: UI_W, height: UI.y.end, transform: `scale(${k.toFixed(4)})`, transformOrigin: "0 0" }}>
          <StudioUi head={head} press={press} progress={progress} sheen={sheen} barSheen={barSheen} dim={clamp01((s - A - 0.86) / 0.3)} player={<Replay frame={replayF} W={W} H={H} />} />
        </div>
        {/* jari mengetuk Download MP4 (kanan teks tombol) + riak di titik yang sama */}
        {ripple > 0 && ripple < 1 && (
          <div style={{ position: "absolute", left: tap.x - 50, top: tap.y - 50, width: 100, height: 100, borderRadius: 999, border: `4px solid ${rgba("#ffffff", 0.85 * (1 - ripple) * (1 - ripple))}`, transform: `scale(${(0.4 + ripple * 0.8).toFixed(3)})` }} />
        )}
        {finger && (
          <div style={{ position: "absolute", left: tap.x - 26 + 34 * fIn, top: tap.y - 26 + 52 * fIn, width: 52, height: 52, borderRadius: 999, background: "rgba(255,255,255,0.9)", boxShadow: "0 10px 30px rgba(0,0,0,0.45)", opacity: clamp01((s - (tapAt - 0.25)) / 0.1) * clamp01((tapAt + 0.12 - s) / 0.08), transform: `scale(${s > tapAt - 0.03 && s < tapAt + 0.1 ? 0.84 : 1})` }} />
        )}
      </Cam>
      {/* teks layar di atas (latar digelapkan supaya UI yang lewat di bawahnya tidak mengganggu) */}
      <div style={{ position: "absolute", left: 0, top: 0, width: W, height: box.y + 232, background: `linear-gradient(180deg, ${rgba(brand.bg, 0.97)} 0%, ${rgba(brand.bg, 0.95)} ${(((box.y + 186) / (box.y + 232)) * 100).toFixed(1)}%, ${rgba(brand.bg, 0)} 100%)`, opacity: clamp01((s - A - 0.06) / 0.2) }} />
      <Caption lines={[text[0] ?? "Dibikin di sini"]} at={A + 0.22} pos="top" size={112} emphasis={["sini"]} />
      <Sweep at={A + 0.5} len={0.7} alpha={0.16} />
    </AbsoluteFill>
  );
}

/** detik awal adegan montage di timeline (untuk playhead) */
function useMontageStart() {
  const { tl } = useStudio();
  const { i } = useScene();
  return sceneStartSecs(tl)[i] ?? 0;
}

/** pemutar preview Studio: montage ini diputar ulang (kedalaman 1, tanpa Studio di dalamnya) */
function Replay({ frame, W, H }: { frame: number; W: number; H: number }) {
  const { scene } = useScene();
  const { brand, fps } = useStudio();
  const sc = UI.player.w / W;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, transform: `scale(${sc.toFixed(5)})`, transformOrigin: "0 0", overflow: "hidden", background: brand.bg }}>
      <MontageDepth.Provider value={1}>
        <SceneBg bg={scene.bg} brand={brand} blur={0} />
        <Cuts f={frame} fps={fps} W={W} H={H} />
      </MontageDepth.Provider>
    </div>
  );
}

export function MontageShot() {
  const depth = useContext(MontageDepth);
  const { f, fps, W, H } = useShot();
  const studioF = Math.round(STUDIO_AT * fps);
  const showCuts = depth > 0 || f < studioF;
  return (
    <AbsoluteFill>
      {showCuts && <Cuts f={depth > 0 ? Math.min(f, studioF - 1) : f} fps={fps} W={W} H={H} />}
      {depth === 0 && f >= studioF && <StudioPart f={f} fps={fps} W={W} H={H} />}
      {depth === 0 && (
        <>
          <Flash at={0} len={0.24} max={0.7} />
          <Flash at={BEAT} len={0.12} max={0.3} />
          <Flash at={BEAT * 3} len={0.12} max={0.3} />
          <Flash at={STUDIO_AT} len={0.14} max={0.22} color="#fdba74" />
          <Sweep at={0.05} len={0.45} alpha={0.22} />
          <Sweep at={BEAT * 2 + 0.05} len={0.4} alpha={0.18} />
          <BeatEdge f={f} fps={fps} W={W} H={H} />
        </>
      )}
    </AbsoluteFill>
  );
}

/** bingkai oranye tipis berdenyut di tiap pukulan potongan (energi montage) */
function BeatEdge({ f, fps, W, H }: { f: number; fps: number; W: number; H: number }) {
  const hits = [0, ...CUTS.slice(1).map((c) => c.from), STUDIO_AT];
  let a = 0;
  for (const h of hits) {
    const d = (f - h * fps) / fps;
    if (d >= 0 && d < 0.25) a = Math.max(a, 1 - d / 0.25);
  }
  if (a <= 0.01) return null;
  const c = rgba("#f97316", 0.5 * a);
  const d = Math.round(150 * a);
  const g = (dir: string) => `linear-gradient(${dir}, ${c} 0%, ${rgba("#f97316", 0)} 100%)`;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: W, height: d, background: g("180deg") }} />
      <div style={{ position: "absolute", left: 0, top: H - d, width: W, height: d, background: g("0deg") }} />
      <div style={{ position: "absolute", left: 0, top: 0, width: d, height: H, background: g("90deg") }} />
      <div style={{ position: "absolute", left: W - d, top: 0, width: d, height: H, background: g("270deg") }} />
    </AbsoluteFill>
  );
}
