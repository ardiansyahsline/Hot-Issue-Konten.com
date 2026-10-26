"use client";

/**
 * Adegan intro teaser CS Tracker:
 * 1. HookShot (3,0 dtk) — montase masalah SEBELUM CS Tracker: sheet "Video Review WA" berantakan, topik kembar (SimilarTopics "Mirip"),
 *    data kececer, notifikasi chat menumpuk. Potong di ketukan ui-snap 0,6 / 1,8 / 2,4, glitch di 0,0, braam gelap di 1,2.
 * 2. RevealShot (1,8 dtk) — riser memuncak + impact-chord di 0,0: logo Konten.com slam + gelombang kejut + sinar; braam-epik-1 di 0,3
 *    = ombak cahaya (halo, sinar, flare, kilau logo); "CS Tracker" di 0,6; "Konten.com" di 1,2; semua terbaca sebelum whip 0,3 dtk ke Dashboard.
 * 3. OutroShot (4,2 dtk) — whoosh-debris 0,0 → logo mendarat di 0,6 (boom + braam), tagline, tim, CTA; kartu akhir (2,4+) tetap memuat
 *    tagline kecil di bawah lockup, lalu potong bersih ke hitam di 4,2.
 * Kompatibel @remotion/web-renderer (jalur Download MP4): tanpa box-shadow spread/inset (border/outline), tanpa z-index (urutan DOM),
 * filter/opacity hanya di elemen berukuran.
 * Frame 0 adegan yang masuk dengan transisi zoom (Reveal) belum terlihat, dan frame 1 baru ±65% — jadi frame pukulan Reveal
 * (global 90–91) digambar di ekor Hook dengan panggung Reveal yang SAMA (RevealStage), supaya logo sudah tajam tepat di pukulan.
 */
import { useMemo, type ReactNode } from "react";
import { AbsoluteFill, random } from "remotion";
import { TextShine } from "../../fx";
import { FONT, Icon, Z } from "../../screens/ui";
import { clamp01, EASE, rgba } from "../../theme";
import { Cam, Flash, prog, springAt, Sweep, Trail, useShot, type CamKey } from "../kit";
import { HotChip, InitialAvatar, NOTIF_H, NotifCard, Sheet, SheetRow, SimilarItem, SimilarPanel, StatusChip, WaitTag } from "./intro-hook";
import { Bloom, Bokeh, Burst, Cover, Embers, Flare, KontenMark, MARK_AR, ORANGE, Rays, RED, shake, Shock, softBlur, Words } from "./intro-parts";

const LIN = (x: number) => x;
const decay = (s: number, at: number, k = 6) => (s < at ? 0 : Math.exp(-(s - at) * k));
/** heatLevel asli (lib/utils.ts) */
const heat = (n: number) => (n >= 9 ? 4 : n >= 5 ? 3 : n >= 3 ? 2 : n >= 2 ? 1 : 0);

// =============================================================================================
// 1. HOOK
// =============================================================================================
export function HookShot() {
  const { f, fps, s, box, W, H, display } = useShot();
  const cx = box.x + box.w / 2;
  const cut = s < 0.6 ? 0 : s < 1.2 ? 1 : s < 1.8 ? 2 : s < 2.4 ? 3 : 4;
  // guncangan: braam (kuat) + tiap ui-snap (kecil) + glitch awal
  const a = shake(f, fps, 1.2, 34, 5.5, "hb");
  const b = [0.6, 1.8, 2.4].map((t) => shake(f, fps, t, 10, 16, `hs${t}`));
  const g = f < 7 ? { x: (random(`hg${f}`) - 0.5) * 60, y: 0, r: 0 } : { x: 0, y: 0, r: 0 };
  const sx = a.x + g.x + b.reduce((v, k) => v + k.x, 0);
  const sy = a.y + b.reduce((v, k) => v + k.y, 0);
  const sr = a.r + b.reduce((v, k) => v + k.r, 0);
  // kick zoom kecil tepat di tiap potongan
  const kick = 1 + 0.035 * (decay(s, 0.6, 14) + decay(s, 1.8, 14) + decay(s, 2.4, 14)) + 0.06 * decay(s, 1.2, 8);
  const shakeT = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) rotate(${sr.toFixed(3)}deg) scale(${kick.toFixed(4)})`;
  const capSpr = { damping: 16, stiffness: 320, mass: 0.55 };

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Cover color="#09090b" opacity={1} />
      <Bloom x={cx} y={H * 0.95} r={1100} sy={0.7} color={RED} opacity={0.16 + 0.06 * Math.sin(f / 3.3) + 0.25 * decay(s, 1.2, 3)} />
      <AbsoluteFill style={{ transform: shakeT }}>
        {cut === 0 && <CutSheet />}
        {cut === 1 && <CutSimilar />}
        {cut === 2 && <CutChaos layer="back" />}
        {cut === 3 && <CutChat phase={0} />}
        {cut === 4 && <CutChat phase={1} />}
      </AbsoluteFill>
      {/* braam: lapisan belakang diredam abu-abu (kesan desaturasi), serpihan depan tajam di atasnya */}
      <Cover color="#1f1f23" opacity={cut === 2 ? 0.5 : 0} />
      {cut === 2 && (
        <AbsoluteFill style={{ transform: shakeT }}>
          <CutChaos layer="front" />
        </AbsoluteFill>
      )}
      {/* hentakan gelap tepat di braam, pulih cepat */}
      <Cover color="#000000" opacity={cut === 2 ? 0.82 * decay(s, 1.2, 10) : 0} />
      {cut === 2 && (
        <AbsoluteFill style={{ transform: shakeT }}>
          <PileBadge />
        </AbsoluteFill>
      )}
      {[0.6, 1.8, 2.4].map((t) => (
        <Flash key={t} at={t} len={0.08} max={0.14} />
      ))}
      <Glitch f={f} W={W} H={H} />
      {/* kegelapan sebelum pukulan Reveal */}
      <Cover color="#000000" opacity={prog(f, fps, 2.7, 3.0, EASE.in) * 0.9} />
      <Converge f={f} fps={fps} x={cx} y={box.y + box.h * 0.4} W={W} H={H} />
      {/* teks layar — selalu di atas, scrim gelap supaya kontras */}
      <div style={{ position: "absolute", left: 0, top: 0, width: W, height: box.y + 520, background: `linear-gradient(180deg, ${rgba("#09090b", 0.92)} 0%, ${rgba("#09090b", 0.72)} 45%, ${rgba("#09090b", 0)} 100%)`, pointerEvents: "none" }} />
      <Words f={f} fps={fps} text="Hot issue numpuk?" at={0.08} out={1.5} cx={cx} top={box.y + 8} w={box.w} size={112} font={display} emph={["numpuk?"]} emphColor={RED} />
      <Words f={f} fps={fps} text="Chat tim berantakan?" at={1.75} out={2.8} cx={cx} top={box.y + 8} w={box.w} size={112} font={display} emph={["berantakan?"]} emphColor={RED} stagger={0.04} spr={capSpr} />
      {/* pukulan Reveal (global 90): panggung Reveal yang sama digambar di sini selama transisi zoom belum menutup */}
      {f >= 90 && <HookTail f={f} />}
    </AbsoluteFill>
  );
}

/** glitch-error di 0,0: pita horizontal merah/sian + kilat */
function Glitch({ f, W, H }: { f: number; W: number; H: number }) {
  if (f > 7) return null;
  const k = 1 - f / 8;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ position: "absolute", inset: 0, background: "#ffffff", opacity: f < 2 ? 0.35 : 0 }} />
      {Array.from({ length: 9 }, (_, i) => {
        const y = random(`gy${i}-${f}`) * H;
        const h = 6 + random(`gh${i}-${f}`) * 70;
        const x = (random(`gx${i}-${f}`) - 0.5) * 160;
        const c = i % 3 === 0 ? "#22d3ee" : i % 3 === 1 ? RED : "#ffffff";
        return <div key={i} style={{ position: "absolute", left: x, top: y, width: W, height: h, background: c, opacity: (0.18 + random(`go${i}-${f}`) * 0.3) * k }} />;
      })}
    </AbsoluteFill>
  );
}

/** garis cahaya tersedot ke tengah (2,72–3,0) + titik oranye kecil yang membesar → riser memuncak (layar tetap gelap) */
function Converge({ f, fps, x, y, W, H }: { f: number; fps: number; x: number; y: number; W: number; H: number }) {
  const p = prog(f, fps, 2.72, 3.0, EASE.in);
  if (p <= 0 || f >= 90) return null;
  return (
    <>
      <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}>
        {Array.from({ length: 30 }, (_, i) => {
          const a = random(`cv${i}`) * Math.PI * 2;
          const sp = 0.6 + random(`cs${i}`) * 0.4;
          const pp = clamp01(p * (0.8 + sp * 0.3));
          const d = 1300 * (1 - pp) + 30;
          const L = 60 + 260 * pp;
          return <line key={i} x1={x + Math.cos(a) * d} y1={y + Math.sin(a) * d} x2={x + Math.cos(a) * (d + L)} y2={y + Math.sin(a) * (d + L)} stroke={i % 3 ? "#fdba74" : "#ffffff"} strokeOpacity={0.15 + 0.6 * pp} strokeWidth={1.5 + 2 * pp} strokeLinecap="round" />;
        })}
      </svg>
      <Bloom x={x} y={y} r={50 + 230 * p} color={ORANGE} opacity={0.65 * p} />
      <Bloom x={x} y={y} r={8 + 46 * p} color="#fff4ea" opacity={0.9 * p} />
    </>
  );
}

/** frame pukulan Reveal (global 90–92): panggung Reveal + kilat sangat singkat (3 frame) */
function HookTail({ f }: { f: number }) {
  const rf = f - 90;
  const k = clamp01(1 - rf / 3);
  return (
    <AbsoluteFill>
      <RevealStage rf={rf} />
      <Cover color={ORANGE} opacity={0.16 * k} />
      <Cover color="#ffffff" opacity={0.08 * k * k} />
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------------------------------------
// Potongan A (0,0–0,6): sheet Video Review WA berantakan — rack focus ke dua baris kembar
// ---------------------------------------------------------------------------------------------
function CutSheet() {
  // kolom B–E (Penjelasan → Catatan) sudah di bingkai sejak frame 0; kamera push pelan + geser ≤ 30 px
  const keys: CamKey[] = [
    { t: 0, z: 0.97, x: -291, y: -96, r: -3 },
    { t: 0.62, z: 0.995, x: -298, y: -126, r: -2, ease: LIN },
  ];
  return (
    <Cam keys={keys}>
      <div style={{ position: "absolute", left: 0, top: 590 }}>
        <Sheet fs={28} focus={[0, 7]} blur={3.4} />
      </div>
    </Cam>
  );
}

// ---------------------------------------------------------------------------------------------
// Potongan B (0,6–1,2): topik kembar — panel "Mirip topik yang sudah ada"
// ---------------------------------------------------------------------------------------------
function CutSimilar() {
  const { f, fps, box } = useShot();
  const cx = box.x + box.w / 2;
  // item pertama mendarat tepat di potongan (0,6)
  const items = [0.6, 0.7, 0.8].map((t) => springAt(f, fps, t, { damping: 14, stiffness: 260, mass: 0.6 }));
  const keys: CamKey[] = [
    { t: 0.6, z: 1.02, x: 0, y: 24, r: 1.6 },
    { t: 1.2, z: 1.1, x: 10, y: -6, r: 0.4, ease: LIN },
  ];
  const w = Math.min(box.w, 880);
  return (
    <>
      <div style={{ position: "absolute", inset: 0, filter: softBlur(12), opacity: 0.45, transform: "scale(1.15) rotate(-4deg)" }}>
        <div style={{ position: "absolute", left: -380, top: 380 }}>
          <Sheet rows={14} />
        </div>
      </div>
      <Cam keys={keys}>
        <div style={{ position: "absolute", left: cx - w / 2, top: box.y + 330 }}>
          <SimilarPanel w={w} k={2.1} items={items} />
        </div>
      </Cam>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Potongan C (1,2–1,8): braam gelap — data kececer (lapisan belakang buram + 4 serpihan depan tajam)
// ---------------------------------------------------------------------------------------------
type Frag = { kind: number; x: number; y: number; d: number; r: number; dr: number; i: number };
const FRAGS: Frag[] = (() => {
  const out: Frag[] = [];
  let n = 0;
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 3; col++) {
      const i = n++;
      const jx = (random(`fx${i}`) - 0.5) * 260;
      const jy = (random(`fy${i}`) - 0.5) * 160;
      out.push({ kind: i % 5, x: (col - 1) * 470 + jx + (row % 2) * 140, y: (row - 3) * 280 + jy, d: 0.55 + random(`fd${i}`) * 0.4, r: (random(`fr${i}`) - 0.5) * 26, dr: (random(`fq${i}`) - 0.5) * 14, i });
    }
  }
  return out.sort((p, q) => p.d - q.d);
})();

/** serpihan depan: tajam & besar, di luar area teks layar (relatif ke pusat lencana) */
const HERO_FRAGS: { kind: number; i: number; x: number; y: number; r: number; sc: number; vx: number; vy: number }[] = [
  { kind: 0, i: 7, x: 30, y: -178, r: -4, sc: 0.66, vx: 40, vy: -24 },
  { kind: 1, i: 1, x: -70, y: 200, r: 5, sc: 0.96, vx: -36, vy: 16 },
  { kind: 2, i: 9, x: 150, y: 420, r: -5, sc: 0.8, vx: 60, vy: 36 },
  { kind: 3, i: 0, x: -100, y: 590, r: 4, sc: 1.05, vx: -24, vy: 40 },
];

function FragBody({ kind, i }: { kind: number; i: number }) {
  if (kind === 0) return <SheetRow ri={i} cols={[1, 3, 4]} num={false} outline={i % 7 === 0} fs={28} />;
  if (kind === 1) return <SimilarItem i={i} k={1.9} style={{ width: 640 }} />;
  if (kind === 2) return <NotifCard i={i} w={760} time={`${(i % 9) + 1} mnt`} />;
  if (kind === 3) return <WaitTag size={40} />;
  return <SheetRow ri={i + 3} cols={[0, 1, 4]} num />;
}

const CHAOS_KEYS: CamKey[] = [
  { t: 1.2, z: 1.14, r: 2.2 },
  { t: 1.8, z: 0.98, r: -1.2, ease: EASE.soft },
];

function CutChaos({ layer }: { layer: "back" | "front" }) {
  const { s, box } = useShot();
  const cx = box.x + box.w / 2;
  const t = Math.max(0, s - 1.2);
  if (layer === "front") {
    const cy = box.y + box.h * 0.44;
    return (
      <Cam keys={CHAOS_KEYS}>
        {HERO_FRAGS.map((h, k) => (
          <div key={k} style={{ position: "absolute", left: cx + h.x + h.vx * t, top: cy + h.y + h.vy * t, transform: `translate(-50%, -50%) scale(${h.sc}) rotate(${(h.r + (k % 2 ? 4 : -4) * t).toFixed(2)}deg)` }}>
            <FragBody kind={h.kind} i={h.i} />
          </div>
        ))}
      </Cam>
    );
  }
  const cy = box.y + box.h * 0.52;
  return (
    <Cam keys={CHAOS_KEYS}>
      {FRAGS.map((fr) => {
        const spread = 1 + t * 0.32 * fr.d;
        const x = cx + fr.x * spread * fr.d;
        const y = cy + fr.y * spread * fr.d;
        const sc = 0.82 * fr.d;
        const blur = 2.5 + (0.95 - fr.d) * 9;
        return (
          <div key={fr.i} style={{ position: "absolute", left: x, top: y, transform: `translate(-50%, -50%) scale(${sc.toFixed(3)}) rotate(${(fr.r + fr.dr * t).toFixed(2)}deg)`, filter: softBlur(blur), opacity: 0.75 }}>
            <FragBody kind={fr.kind} i={fr.i} />
          </div>
        );
      })}
    </Cam>
  );
}

/** meta laporan asli SimilarTopics (ikon api × heatLevel + "N laporan", red-400) dalam pil gelap — membanting di braam */
function PileBadge() {
  const { f, fps, box } = useShot();
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h * 0.44;
  // smash cut: lencana sudah besar di frame braam, lalu "menancap" (pegas meredam)
  const p = springAt(f, fps, 1.2, { damping: 8, stiffness: 260, mass: 0.6 });
  const n = Math.round(48 + 166 * prog(f, fps, 1.2, 1.75, EASE.out));
  const fl = Math.max(1, heat(n));
  return (
    <div style={{ position: "absolute", left: cx, top: cy, transform: `translate(-50%, -50%) scale(${(1.4 - 0.4 * p).toFixed(3)})` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "17px 37px 17px 27px", borderRadius: 999, background: "#150909", color: "#f87171", fontFamily: FONT, fontSize: 62, fontWeight: 800, border: `3px solid ${rgba(RED, 0.6)}`, outline: `12px solid ${rgba(RED, 0.12)}`, boxShadow: `0 0 90px ${rgba(RED, 0.55)}, 0 30px 80px -10px rgba(0,0,0,0.9)`, whiteSpace: "nowrap", letterSpacing: -1, textShadow: `0 0 30px ${rgba(RED, 0.6)}` }}>
        <span style={{ display: "inline-flex", gap: 2 }}>
          {Array.from({ length: fl }, (_, j) => (
            <Icon key={j} name="flame" size={58} color="#f87171" />
          ))}
        </span>
        {n} laporan
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Potongan D/E (1,8–3,0): notifikasi chat grup menumpuk, lalu semuanya tersedot ke tengah
// ---------------------------------------------------------------------------------------------
const NT = [1.5, 1.6, 1.8, 1.92, 2.04, 2.16, 2.4, 2.47, 2.54, 2.61, 2.68, 2.75];

function NotifStack({ chaos, top }: { chaos: number; top: number }) {
  const { f, fps, box } = useShot();
  const cx = box.x + box.w / 2;
  const w = Math.min(860, box.w);
  const ps = NT.map((t) => springAt(f, fps, t, { damping: 15, stiffness: 240, mass: 0.6 }));
  return (
    <>
      {NT.map((_, i) => {
        const p = ps[i];
        if (p <= 0.001) return null;
        let off = 0;
        for (let j = i + 1; j < NT.length; j++) off += ps[j];
        const y = top + off * (NOTIF_H + 20) - (1 - p) * 36;
        if (y > 1700) return null;
        const rot = chaos * (random(`nr${i}`) - 0.5) * 9;
        const dx = chaos * (random(`nx${i}`) - 0.5) * 90;
        const fade = clamp01((1560 - y) / 260);
        return (
          <div key={i} style={{ position: "absolute", left: cx - w / 2 + dx, top: y, transform: `scale(${(0.9 + 0.1 * p).toFixed(4)}) rotate(${rot.toFixed(2)}deg)`, opacity: clamp01(p * 2.5) * fade }}>
            <NotifCard i={i} w={w} time={i === NT.length - 1 || i === 6 ? "baru saja" : `${Math.max(1, 5 - (i % 5))} mnt`} />
          </div>
        );
      })}
    </>
  );
}

function CutChat({ phase }: { phase: 0 | 1 }) {
  const { f, fps, box } = useShot();
  const keysD: CamKey[] = [
    { t: 1.8, z: 1.0, x: 0, y: 0, r: 0 },
    { t: 2.4, z: 1.07, y: -10, r: -1, ease: EASE.out },
  ];
  // potongan lebih dekat & miring; tumpukan tetap utuh di kiri (crop hanya kanan/bawah)
  const keysE: CamKey[] = [
    { t: 2.4, z: 1.16, x: 46, y: 40, r: 2.5 },
    { t: 2.72, z: 1.2, x: 52, y: 50, r: 3, ease: LIN },
    { t: 3.0, z: 0.66, x: 0, y: 0, r: -3, ease: EASE.in },
    { t: 3.4, z: 0.5, r: -4 },
  ];
  const chaos = phase ? prog(f, fps, 2.4, 2.75, EASE.out) : 0;
  const badge = springAt(f, fps, 2.4, { damping: 9, stiffness: 260, mass: 0.6 });
  return (
    <Cam keys={phase ? keysE : keysD}>
      <NotifStack chaos={chaos} top={box.y + (phase ? 390 : 330)} />
      {phase === 1 && (
        <div style={{ position: "absolute", left: box.x + box.w - 250, top: box.y + 380, transform: `scale(${badge.toFixed(3)}) rotate(${(8 - 8 * badge).toFixed(2)}deg)` }}>
          <div style={{ width: 170, height: 170, borderRadius: 999, background: RED, color: "#fff", fontFamily: FONT, fontSize: 64, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", outline: `12px solid ${rgba(RED, 0.2)}`, boxShadow: `0 30px 70px -10px ${rgba(RED, 0.8)}`, letterSpacing: -2 }}>
            99+
          </div>
        </div>
      )}
    </Cam>
  );
}

// =============================================================================================
// 2. REVEAL
// =============================================================================================
const WORD = "CS Tracker";
const REVEAL_LW = 440;

/**
 * Panggung Reveal (latar gelap, cahaya, logo slam) pada frame relatif `rf` dari pukulan.
 * Dipakai RevealShot dan ekor Hook (frame pukulan) supaya keduanya identik. `counter` = skala penangkal zoom transisi untuk logo.
 */
function RevealStage({ rf, counter = 1, children }: { rf: number; counter?: number; children?: ReactNode }) {
  const { fps, box, W, H } = useShot();
  const s = rf / fps;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h * 0.4;
  const LW = REVEAL_LW;
  const LH = LW / MARK_AR;
  // slam pegas: 1,48× di frame pukulan → 1× di frame +2, mantul kecil lalu diam
  const scAt = (fr: number) => 1 + 0.48 * (1 - springAt(fr, fps, 0, { damping: 13, stiffness: 520, mass: 0.5 }));
  const sc = scAt(rf);
  const vel = Math.abs(scAt(rf + 1) - sc);
  const split = 0.5 * (1 - springAt(rf, fps, 0, { damping: 15, stiffness: 460, mass: 0.5 }));
  const hit = decay(s, 0, 4.2);
  const core = rf < 0 ? 0 : Math.exp(-rf / 2.4);
  const beatK = decay(s, 0.6, 7) + decay(s, 1.2, 7) + decay(s, 1.8, 7);
  // braam-epik-1 di 0,3: ombak cahaya (naik cepat, surut pelan), bukan pukulan kedua
  const wave = s < 0.3 ? 0 : (1 - Math.exp(-(s - 0.3) * 14)) * Math.exp(-(s - 0.3) * 2.4);
  const sh = shake(rf, fps, 0, 22, 9, "rv");
  const kick = 1 + 0.03 * beatK;
  return (
    <>
      <Cover color="#070708" opacity={1} />
      <AbsoluteFill style={{ transform: `translate(${sh.x.toFixed(1)}px, ${sh.y.toFixed(1)}px) rotate(${sh.r.toFixed(3)}deg) scale(${kick.toFixed(4)})` }}>
        {/* latar gelap dengan halo oranye di belakang logo (gelap → oranye) */}
        <Bloom x={cx} y={cy + 120} r={1250} color="#c2410c" opacity={0.34 + 0.22 * hit + 0.05 * beatK + 0.14 * wave} sy={1.1} />
        <Bloom x={cx} y={cy} r={760} color={ORANGE} opacity={0.3 + 0.32 * hit + 0.08 * beatK + 0.12 * wave} />
        <Bloom x={cx} y={cy} r={560} color="#fff1e4" opacity={0.85 * core} />
        <Rays x={cx} y={cy} n={14} len={1500} rot={s * 7} opacity={0.12 + 0.3 * hit + 0.04 * beatK + 0.12 * wave} />
        <Embers f={rf} fps={fps} W={W} H={H} n={34} seed="rvE" opacity={clamp01(s * 3)} />
        <Shock f={rf} fps={fps} at={0} x={cx} y={cy} r0={LW * 0.55} r1={1100} len={0.7} W={W} H={H} />
        <Shock f={rf} fps={fps} at={0.1} x={cx} y={cy} r0={LW * 0.5} r1={760} len={0.6} width={6} W={W} H={H} />
        <Burst f={rf} fps={fps} at={0} x={cx} y={cy} n={48} d0={LW * 0.45} d1={1000} len={0.9} seed="rvB" W={W} H={H} />
        <Flare x={cx} y={cy} k={0.85 * hit + 0.3 * wave + 0.14 * decay(s, 1.2, 5)} W={W} />
        {/* logo (dilindungi dari zoom transisi supaya sudah mendarat 1× di frame +2) */}
        <AbsoluteFill style={{ transform: counter !== 1 ? `scale(${counter.toFixed(4)})` : undefined }}>
          <div style={{ position: "absolute", left: cx - LW / 2, top: cy - LH / 2, width: LW, height: LH, transform: `scale(${sc.toFixed(4)})` }}>
            <KontenMark w={LW} split={split} shine={prog(rf, fps, 0.32, 0.82, EASE.inOut)} glow={0.7 + 0.5 * hit + 0.3 * wave} blur={vel > 0.01 ? Math.min(3, vel * 14) : 0} />
          </div>
        </AbsoluteFill>
        {children}
      </AbsoluteFill>
    </>
  );
}

export function RevealShot() {
  const { f, fps, box, W, H, display } = useShot();
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h * 0.4;
  const LH = REVEAL_LW / MARK_AR;
  // push-in pelan sepanjang 1,8 dtk, lanjut sedikit selama whip keluar (adegan ini masih tampil di bawah Dashboard 0,3 dtk)
  const keys: CamKey[] = [
    { t: 0, z: 1.0 },
    { t: 1.8, z: 1.1, ease: EASE.soft },
    { t: 2.1, z: 1.12, ease: LIN },
  ];
  // penangkal zoom transisi masuk (zoom: skala 1,3 − 0,3·EASE.out(f/12)), hanya untuk logo
  const counter = f < 12 ? 1 / (1.3 - 0.3 * EASE.out(clamp01(f / 12))) : 1;
  const fs = 136;
  const wordTop = cy + LH / 2 + 60;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Cam keys={keys} blur={false}>
        <RevealStage rf={f} counter={counter}>
          {/* wordmark */}
          <div style={{ position: "absolute", left: box.x, top: wordTop, width: box.w, display: "flex", justifyContent: "center" }}>
            <TextShine p={prog(f, fps, 0.95, 1.5)} glow="rgba(255,190,140,.9)">
              <div style={{ display: "flex", fontFamily: display, fontWeight: 800, fontSize: fs, lineHeight: 1.05, letterSpacing: "-0.04em", color: "#fafafa", whiteSpace: "pre" }}>
                {Array.from(WORD).map((ch, i) => {
                  const p = springAt(f, fps, 0.6 + i * 0.026, { damping: 13, stiffness: 200, mass: 0.6 });
                  if (ch === " ") return <span key={i} style={{ display: "inline-block", width: fs * 0.26 }} />;
                  return (
                    <span key={i} style={{ display: "inline-block", overflow: "hidden", paddingBottom: fs * 0.1 }}>
                      <span style={{ display: "inline-block", transform: `translateY(${((1 - p) * fs * 1.05).toFixed(1)}px)`, opacity: clamp01(p * 1.8), textShadow: `0 10px 50px ${rgba("#000000", 0.5)}, 0 0 60px ${rgba(ORANGE, 0.35)}` }}>{ch}</span>
                    </span>
                  );
                })}
              </div>
            </TextShine>
          </div>
          <KontenLine f={f} fps={fps} at={1.2} cx={cx} top={wordTop + fs * 1.15 + 14} size={42} />
          <Bokeh f={f} fps={fps} W={W} H={H} n={5} seed="rvK" opacity={0.1 + 0.08 * decay(f / fps, 0, 4.2)} />
        </RevealStage>
      </Cam>
      <Sweep at={0.3} len={0.6} alpha={0.16} />
    </AbsoluteFill>
  );
}

/** "Konten.com" kecil dengan garis tipis di kiri-kanan (nama di header app: CS Tracker / Konten.com) */
function KontenLine({ f, fps, at, cx, top, size = 40, out }: { f: number; fps: number; at: number; cx: number; top: number; size?: number; out?: number }) {
  const p = springAt(f, fps, at, { damping: 16, stiffness: 160 });
  const lw = 70 * prog(f, fps, at + 0.05, at + 0.5, EASE.out);
  const gone = out === undefined ? 0 : prog(f, fps, out, out + 0.18, EASE.out);
  if (gone >= 1) return null;
  return (
    <div style={{ position: "absolute", left: cx - 400, top, width: 800, display: "flex", alignItems: "center", justifyContent: "center", gap: 22, opacity: clamp01(p * 1.4) * (1 - gone), transform: `translateY(${((1 - p) * 26).toFixed(1)}px)` }}>
      <span style={{ width: lw, height: 2, background: `linear-gradient(90deg, ${rgba("#ffffff", 0)}, ${rgba("#ffffff", 0.45)})` }} />
      <span style={{ fontFamily: FONT, fontSize: size, fontWeight: 600, color: Z[400], letterSpacing: "0.01em" }}>Konten.com</span>
      <span style={{ width: lw, height: 2, background: `linear-gradient(90deg, ${rgba("#ffffff", 0.45)}, ${rgba("#ffffff", 0)})` }} />
    </div>
  );
}

// =============================================================================================
// 3. OUTRO
// =============================================================================================
const TEAM = ["Alif", "Derencalibur", "Nengok", "Irsyad", "Natasha"];
const HIT = 0.6;
const LIFT = 1.2;
const FIN = 2.4;
const END = 4.2;

type Deb = { a: number; r0: number; dir: number; kind: number; arrive: number; spin: number; pop: number; z: number };

/** jarak dari (x, y) searah sudut a sampai tepi area terlihat (supaya serpihan mulai di dalam bingkai) */
function rayMax(a: number, x: number, y: number, W: number, H: number) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  let t = 4000;
  if (c > 1e-3) t = Math.min(t, (W - 70 - x) / c);
  if (c < -1e-3) t = Math.min(t, (70 - x) / c);
  if (s > 1e-3) t = Math.min(t, (H - 300 - y) / s);
  if (s < -1e-3) t = Math.min(t, (140 - y) / s);
  return t;
}

function debPos(d: Deb, s: number, x: number, y: number) {
  const p = EASE.in(clamp01(s / d.arrive));
  const ang = d.a + p * 1.3 * d.dir;
  const r = d.r0 * (1 - p);
  return { x: x + Math.cos(ang) * r, y: y + Math.sin(ang) * r, p };
}

/** chip UI asli yang tersedot ke logo */
function DebBody({ kind, i }: { kind: number; i: number }) {
  switch (kind) {
    case 0:
      return <HotChip size={44} />;
    case 1:
      return <StatusChip label="Open" size={42} />;
    case 2:
      return <StatusChip label="In Progress" size={42} />;
    case 3:
      return (
        <div style={{ width: 760 * 0.66, height: NOTIF_H * 0.66 }}>
          <div style={{ transform: "scale(0.66)", transformOrigin: "0 0" }}>
            <NotifCard i={i} w={760} time="baru saja" />
          </div>
        </div>
      );
    case 4:
      return <InitialAvatar name={TEAM[i % TEAM.length]} size={108} me={i % TEAM.length === 0} />;
    case 5:
      return <SimilarItem i={i} k={1.55} style={{ width: 540 }} />;
    case 6:
      return <StatusChip label="Resolved" size={42} />;
    default:
      return <WaitTag size={36} />;
  }
}

export function OutroShot() {
  const { f, fps, s, box, W, H, display } = useShot();
  const cx = box.x + box.w / 2;
  const LY = box.y + box.h * 0.42; // titik mendarat logo = pusat pusaran serpihan
  const TOPY = box.y + 150; // posisi kunci (lockup) saat tagline tampil
  const FINY = box.y + 263; // posisi kartu akhir
  const LW = 300;
  const LH = LW / MARK_AR;
  const WM_TOP = LH / 2 + 34; // jarak pusat logo → atas wordmark (koordinat kunci)

  // diurutkan menurut kedalaman z (jauh → dekat): urutan DOM = urutan gambar di CLI maupun web-renderer (z-index diabaikan di web)
  const debris = useMemo<(Deb & { i: number })[]>(
    () =>
      Array.from({ length: 16 }, (_, i) => {
        const a = (i / 16) * Math.PI * 2 + (random(`da${i}`) - 0.5) * 0.3;
        const want = 560 + random(`dr${i}`) * 380;
        return {
          a,
          r0: Math.max(240, Math.min(want, rayMax(a, cx, LY, W, H))),
          dir: i % 2 ? 1 : -1,
          kind: i % 8,
          arrive: HIT - 0.03 - random(`dt${i}`) * 0.12,
          spin: (random(`ds${i}`) - 0.5) * 220,
          pop: random(`dp${i}`) * 0.08,
          z: 0.9 + random(`dz${i}`) * 0.6,
          i,
        };
      }).sort((p, q) => p.z - q.z),
    [cx, LY, W, H],
  );

  // logo terbang dari depan kamera, mendarat tepat di 0,6 (boom), lalu memantul pegas
  const fly = prog(f, fps, 0.34, HIT, EASE.in);
  const scAt = (fr: number) => {
    const ss = fr / fps;
    if (ss < HIT) return 2.2 - 1.2 * EASE.in(clamp01((ss - 0.34) / (HIT - 0.34)));
    return 1 - 0.09 * (1 - springAt(fr, fps, HIT, { damping: 9, stiffness: 220, mass: 0.6 }));
  };
  const sc = scAt(f);
  const vel = Math.abs(scAt(f + 1) - sc);
  const landed = s >= HIT;
  const hit = decay(s, HIT, 3.6);
  const core = landed ? Math.exp(-(f - HIT * fps) / 2.6) : 0;
  const sh = shake(f, fps, HIT, 26, 7, "ob");
  const keys: CamKey[] = [
    { t: 0, z: 1.22, r: -2 },
    { t: HIT, z: 1.0, r: 0, ease: EASE.in },
    { t: END, z: 1.05, ease: EASE.soft },
  ];
  // kunci logo + wordmark: tengah → naik kecil (tagline) → turun jadi kartu akhir
  const lift = springAt(f, fps, LIFT, { damping: 17, stiffness: 150, mass: 0.8 });
  const fin = springAt(f, fps, FIN, { damping: 17, stiffness: 150, mass: 0.8 });
  const gy = LY + (TOPY - LY) * lift + (FINY - TOPY) * fin;
  const gk = 1 - 0.4 * lift + 0.4 * fin;
  // kartu akhir: lockup → tagline kecil → tim → CTA
  const tagTop = box.y + 578;
  const teamY = box.y + 690 - 18 * fin;
  const ctaTop = box.y + 822;
  const cta = springAt(f, fps, FIN + 0.04, { damping: 12, stiffness: 190, mass: 0.7 });
  const press = s < 3.0 ? 1 : s < 3.07 ? 1 - 0.06 * ((s - 3.0) / 0.07) : 0.94 + 0.06 * springAt(f, fps, 3.07, { damping: 10, stiffness: 260 });
  const end = f >= END * fps ? 1 : prog(f, fps, END - 0.14, END, EASE.in);
  const glint = prog(f, fps, 3.6, 4.05, EASE.inOut);
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Cover color="#070708" opacity={1} />
      <Cam keys={keys} origin={`${cx.toFixed(0)}px ${(box.y + 470).toFixed(0)}px`}>
        <AbsoluteFill style={{ transform: `translate(${sh.x.toFixed(1)}px, ${sh.y.toFixed(1)}px) rotate(${sh.r.toFixed(3)}deg)` }}>
          <Bloom x={cx} y={H + 120} r={1250} sy={0.75} color="#c2410c" opacity={0.3 + 0.25 * hit * (landed ? 1 : 0) + 0.12 * fly} />
          <Bloom x={cx} y={gy} r={720} color={ORANGE} opacity={landed ? 0.28 + 0.4 * hit + 0.12 * decay(s, 3.6, 4) : 0.12 + 0.3 * fly} />
          {landed && <Rays x={cx} y={gy} n={12} len={1300} rot={s * 6} opacity={0.08 + 0.25 * hit} seed="orays" />}
          {landed && <Embers f={f} fps={fps} W={W} H={H} n={30} seed="oE" opacity={clamp01((s - HIT) * 3)} rise={0.8} />}
          {/* serpihan UI asli tersedot ke titik mendarat (whoosh-debris 0,0 → 0,6), jejak gerak + blur sebanding laju */}
          {!landed &&
            debris.map((d) => {
              const i = d.i;
              const a = debPos(d, s, cx, LY);
              const b = debPos(d, s - 1 / fps, cx, LY);
              if (a.p >= 0.97) return null;
              const vx = a.x - b.x;
              const vy = a.y - b.y;
              const v = Math.hypot(vx, vy);
              const pop = springAt(f, fps, d.pop, { damping: 12, stiffness: 260, mass: 0.5 });
              const bl = Math.min(6, Math.max(0, v - 8) * 0.07) + Math.max(0, d.z - 1.32) * 9;
              return (
                <div key={i} style={{ position: "absolute", left: a.x, top: a.y, opacity: clamp01(pop * 2) * (1 - a.p * 0.5), filter: bl > 0.4 ? softBlur(bl) : undefined }}>
                  <div style={{ transform: `translate(-50%, -50%) scale(${(d.z * (0.55 + 0.45 * pop) * (1 - a.p * 0.65)).toFixed(3)}) rotate(${(d.spin * a.p).toFixed(1)}deg)` }}>
                    <Trail dx={vx} dy={vy} n={3}>
                      <DebBody kind={d.kind} i={i} />
                    </Trail>
                  </div>
                </div>
              );
            })}
          <Shock f={f} fps={fps} at={HIT} x={cx} y={LY} r0={LW * 0.6} r1={1150} len={0.75} W={W} H={H} />
          <Shock f={f} fps={fps} at={HIT + 0.08} x={cx} y={LY} r0={LW * 0.5} r1={800} len={0.6} width={6} W={W} H={H} />
          <Burst f={f} fps={fps} at={HIT} x={cx} y={LY} n={50} d0={LW * 0.5} d1={1050} len={0.95} seed="oB" W={W} H={H} />
          <Flare x={cx} y={gy} k={landed ? 0.9 * hit + 0.25 * decay(s, 3.6, 5) : 0} W={W} />
          {landed && <Bloom x={cx} y={gy} r={330} color="#fff1e4" opacity={0.8 * core} />}
          {/* kunci: logo + wordmark seperti header app (CS Tracker / Konten.com) */}
          {/* wrapper 0×0 hanya membawa transform (opacity/filter dipasang di anak yang berukuran) */}
          <div style={{ position: "absolute", left: cx, top: gy, width: 0, height: 0, transform: `scale(${gk.toFixed(4)})` }}>
            {fly > 0 && (
              <div style={{ position: "absolute", left: -LW / 2, top: -LH / 2, width: LW, height: LH, transform: `scale(${sc.toFixed(4)})`, opacity: clamp01((s - 0.34) / 0.1) }}>
                <KontenMark w={LW} shine={glint} glow={0.8 + 0.6 * hit} blur={vel > 0.004 ? Math.min(9, vel * 45) : 0} />
              </div>
            )}
            <Words f={f} fps={fps} text="CS Tracker" at={HIT + 0.06} cx={0} top={WM_TOP} w={1000} size={112} font={display} stagger={0.05} tracking={-0.04} />
            <KontenLine f={f} fps={fps} at={HIT + 0.24} cx={0} top={WM_TOP + 128} size={38} out={LIFT} />
          </div>
          {/* tagline (hero) — keluar cepat saat kartu akhir masuk */}
          <Words f={f} fps={fps} text="Kerja lebih cepat" at={LIFT + 0.06} out={FIN} outLen={0.15} outY={0} cx={cx} top={box.y + 422} w={box.w} size={100} font={display} stagger={0.07} />
          <Words f={f} fps={fps} text="Bareng-bareng" at={1.8} out={FIN + 0.02} outLen={0.15} outY={0} cx={cx} top={box.y + 534} w={box.w} size={100} font={display} color={ORANGE} />
          {/* kartu akhir: tagline tetap ada (kecil, di bawah lockup) sampai potong hitam → cue "Logo + tagline + CTA" utuh */}
          <Words f={f} fps={fps} text="Kerja lebih cepat · Bareng-bareng" at={FIN + 0.16} cx={cx} top={tagTop} w={box.w} size={46} weight={700} tracking={-0.02} font={display} color={Z[200]} emph={["Bareng-bareng"]} emphColor={ORANGE} stagger={0.035} />
          <Team f={f} fps={fps} at={1.98} cx={cx} top={teamY} labelOut={FIN} />
          {/* CTA (.btn-primary) */}
          <div style={{ position: "absolute", left: cx - 400, top: ctaTop, width: 800, display: "flex", justifyContent: "center", opacity: clamp01(cta * 1.6), transform: `translateY(${((1 - cta) * 60).toFixed(1)}px) scale(${((0.7 + 0.3 * cta) * press).toFixed(4)})` }}>
            <div style={{ position: "relative", overflow: "hidden", display: "inline-flex", alignItems: "center", gap: 20, height: 118, padding: "0 60px", borderRadius: 32, background: "linear-gradient(180deg, #fb8a3c 0%, #ea580c 100%)", color: "#fff", fontFamily: display, fontSize: 52, fontWeight: 800, letterSpacing: "-0.02em", whiteSpace: "nowrap", boxShadow: `0 22px 50px -14px ${rgba("#ea580c", 0.85)}, 0 0 ${(40 + 60 * decay(s, 3.0, 3)).toFixed(0)}px ${rgba(ORANGE, 0.35 + 0.3 * decay(s, 3.0, 3))}` }}>
              {/* kilap tepi atas (pengganti box-shadow inset; dipotong radius oleh overflow hidden) */}
              <span style={{ position: "absolute", left: 0, top: 0, right: 0, height: 2, background: "rgba(255,255,255,0.28)", pointerEvents: "none" }} />
              Buka sekarang
              <svg width={46} height={46} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
              <Ripple f={f} fps={fps} at={3.0} />
              <BtnShine p={prog(f, fps, 3.05, 3.6, EASE.inOut)} />
            </div>
          </div>
        </AbsoluteFill>
      </Cam>
      <Flash at={HIT} len={0.1} color="#ffb27a" max={0.32} />
      {/* potong bersih ke hitam tepat di ketukan terakhir (59,4 dtk), ekor hening tetap hitam */}
      <Cover color="#000000" opacity={end} />
    </AbsoluteFill>
  );
}

/** grup avatar tim (UserAvatar: inisial di zinc-800, akun sendiri oranye) + titik online + teks siapa (lib/reactions.ts whoText) */
function Team({ f, fps, at, cx, top, labelOut }: { f: number; fps: number; at: number; cx: number; top: number; labelOut: number }) {
  const size = 96;
  const lab = springAt(f, fps, at + 0.16, { damping: 16, stiffness: 180 });
  const gone = prog(f, fps, labelOut, labelOut + 0.15, EASE.out);
  return (
    <div style={{ position: "absolute", left: cx - 430, top, width: 860, display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
      <div style={{ display: "flex", gap: 14 }}>
        {TEAM.map((n, i) => {
          const p = springAt(f, fps, at + i * 0.07, { damping: 10, stiffness: 240, mass: 0.6 });
          return (
            <span key={n} style={{ position: "relative", display: "inline-flex", transform: `scale(${p.toFixed(3)}) translateY(${((1 - p) * 30).toFixed(1)}px)`, opacity: clamp01(p * 2) }}>
              <InitialAvatar name={n} size={size} me={i === 0} />
              <span style={{ position: "absolute", right: 0, bottom: 0, width: 24, height: 24, borderRadius: 99, background: "#10b981", border: "5px solid #0b0b0d", boxSizing: "border-box", opacity: clamp01((p - 0.6) * 3) }} />
            </span>
          );
        })}
      </div>
      {gone < 1 && (
        <div style={{ fontFamily: FONT, fontSize: 32, fontWeight: 500, color: Z[400], opacity: clamp01(lab * 1.5) * (1 - gone), transform: `translateY(${((1 - lab) * 14).toFixed(1)}px)` }}>
          Alif, Natasha &amp; 3 lainnya
        </div>
      )}
    </div>
  );
}

function Ripple({ f, fps, at }: { f: number; fps: number; at: number }) {
  const p = prog(f, fps, at, at + 0.5, EASE.out);
  if (p <= 0 || p >= 1) return null;
  const r = 40 + 520 * p;
  return <span style={{ position: "absolute", left: "50%", top: "50%", width: r * 2, height: r * 2, marginLeft: -r, marginTop: -r, borderRadius: 999, background: "#ffffff", opacity: 0.35 * (1 - p), pointerEvents: "none" }} />;
}

function BtnShine({ p }: { p: number }) {
  if (p <= 0 || p >= 1) return null;
  const x = -30 + p * 160;
  return <span style={{ position: "absolute", inset: 0, background: `linear-gradient(105deg, rgba(255,255,255,0) ${x - 12}%, rgba(255,255,255,0.55) ${x}%, rgba(255,255,255,0) ${x + 12}%)`, pointerEvents: "none" }} />;
}
