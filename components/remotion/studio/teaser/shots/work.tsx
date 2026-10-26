"use client";

/**
 * Adegan 3 (Dashboard + Hot Issue) & adegan 4 (Video Review) teaser CS Tracker.
 * UI = halaman asli yang dibuat ulang (lihat work-parts.tsx), kamera virtual keyframe di ketukan, gerak pegas,
 * momen visual tepat di detik SFX lib/studio/teaser.ts:
 *  - Dashboard (5,4 dtk; 0–0,3 tertutup whip dari Reveal): swoosh-readout 0,3 (angka mulai berjalan) → semua angka mendarat di
 *    ketukan 0,6 · koin-ting 1,2 (laporan ke-3 → topik naik ke #1) · ui-scifi-ping 2,4 (badge 🔥 HOT menyala di #1 + light sweep,
 *    kamera dorong ke baris #1) · 2,95–5,8 kamera tetap hidup: dorong pelan + kick di tiap ketukan, lalu orbit/geser menyamping
 *    (4,45–5,05) dan naik searah transisi slide-up berikutnya
 *  - Data clipper (kontak, link) = placeholder tersamar + balok skeleton solid (lihat Redacted di work-parts.tsx).
 *  - Render browser: radius CSS blur di dalam World dikali skala dunia S (canvas blur tidak ikut transform; CLI sudah ikut).
 *  - Video Review: whoosh 0,6 (kartu kasus mendarat) · ui-accept 1,8 (status → Diproses) · whoosh 2,4 (kartu berikut)
 *    · ui-accept 3,6 (status → Disetujui, centang hijau + sweep)
 */
import { AbsoluteFill, random, useRemotionEnvironment } from "remotion";
import { TextShine } from "../../fx";
import { DISPLAY, Z, rgba, useSid } from "../../screens/ui";
import type { ReactNode } from "react";
import { Cam, EASE, Flash, Sweep, Trail, beatPulse, camAtTime, clamp01, prog, useShot, type CamKey } from "../kit";
import {
  C,
  CheckBurst,
  IssueRow,
  PageTitle,
  Pill,
  StatCard,
  StatusMenu,
  StatusPill,
  Tap,
  MENU_ROW,
  VR,
  VR_ORDER,
  VrCaseCard,
  VrSubNav,
  cardCss,
  springFrom,
  type RankIssue,
  type StatTone,
  type VrCase,
  type VrKey,
} from "./work-parts";

// =============================================================================================
// alat bantu bersama
// =============================================================================================
/** lebar isi halaman website versi HP (px CSS) */
const PAGE_W = 362;

type WKey = { t: number; wx: number; wy: number; z: number; tx?: number; ty?: number; r?: number; ease?: (x: number) => number };
/**
 * keyframe kamera dalam koordinat "dunia" (px CSS halaman): titik (wx, wy) diletakkan di titik kanvas (tx, ty) dengan zoom z.
 * Dunia digambar di kanvas mulai (ox, oy) dengan skala S. Hasilnya keyframe untuk <Cam> (pusat = tengah kanvas).
 */
function worldCam(keys: WKey[], o: { ox: number; oy: number; S: number; W: number; H: number; tx: number; ty: number }): CamKey[] {
  let tx = o.tx;
  let ty = o.ty;
  return keys.map((k) => {
    tx = k.tx ?? tx;
    ty = k.ty ?? ty;
    const px = o.ox + k.wx * o.S;
    const py = o.oy + k.wy * o.S;
    return { t: k.t, z: k.z, x: tx - o.W / 2 - (px - o.W / 2) * k.z, y: ty - o.H / 2 - (py - o.H / 2) * k.z, r: k.r ?? 0, ease: k.ease };
  });
}

/** titik fokus dunia kamera di detik s (untuk titik putar kemiringan 3D) */
function focusAt(keys: WKey[], s: number) {
  const v = camAtTime(keys.map((k) => ({ t: k.t, x: k.wx, y: k.wy, ease: k.ease })), s);
  return { fx: v.x, fy: v.y };
}
type TKey = { t: number; rx: number; ry: number; ease?: (x: number) => number };
/** kemiringan 3D dunia (derajat) di detik s */
function tiltAt(keys: TKey[], s: number) {
  const v = camAtTime(keys.map((k) => ({ t: k.t, x: k.rx, y: k.ry, ease: k.ease })), s);
  return { rx: v.x, ry: v.y };
}
/** dunia halaman website: digambar di (ox, oy) dengan skala S, dimiringkan 3D di sekitar titik fokus kamera */
function World({ ox, oy, S, h, rx, ry, fx, fy, children }: { ox: number; oy: number; S: number; h: number; rx: number; ry: number; fx: number; fy: number; children: ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        left: ox,
        top: oy,
        width: PAGE_W * S,
        height: h * S,
        transform: Math.abs(rx) + Math.abs(ry) > 0.02 ? `perspective(2600px) rotateX(${rx.toFixed(3)}deg) rotateY(${ry.toFixed(3)}deg)` : undefined,
        transformOrigin: `${(fx * S).toFixed(1)}px ${(fy * S).toFixed(1)}px`,
      }}
    >
      <div style={{ position: "absolute", left: 0, top: 0, width: PAGE_W, height: h, transform: `scale(${S.toFixed(4)})`, transformOrigin: "0 0" }}>{children}</div>
    </div>
  );
}

type Word = { w: string; at: number; em?: boolean };
/**
 * teks layar kinetik (≤ 6 kata) dengan waktu per kata — tiap kata jatuh tepat di ketukan/SFX.
 * Kata naik dari balik masker; masker (overflow) hanya aktif selama kata naik, lalu dilepas dan bayangan/cahaya
 * baru menyala → cahaya oranye tidak pernah terpotong jadi kotak.
 */
function Kinetic({ lines, pos, size, shine, bottomFrac = 0.88 }: { lines: Word[][]; pos: "top" | "bottom"; size: number; shine: number; bottomFrac?: number }) {
  const { f, fps, box, brand } = useShot();
  return (
    <div
      style={{
        position: "absolute",
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h * bottomFrac,
        display: "flex",
        flexDirection: "column",
        justifyContent: pos === "top" ? "flex-start" : "flex-end",
        alignItems: "center",
        pointerEvents: "none",
      }}
    >
      {lines.map((ln, li) => (
        <TextShine key={li} p={prog(f, fps, shine + li * 0.1, shine + 0.7 + li * 0.1)}>
          <div style={{ display: "flex", justifyContent: "center", columnGap: size * 0.24, fontFamily: DISPLAY, fontWeight: 800, fontSize: size, lineHeight: 1.04, letterSpacing: "-0.035em", color: brand.text, whiteSpace: "nowrap" }}>
            {ln.map((w, k) => {
              // kata mulai naik sedikit sebelum ketukan supaya sudah terbaca tepat di detik SFX
              const p = springFrom(f, fps, w.at - 0.12, { damping: 13, stiffness: 200, mass: 0.65 });
              if (f < (w.at - 0.13) * fps) return <span key={k} style={{ display: "inline-block", opacity: 0 }}>{w.w}</span>;
              const masked = f < (w.at + 0.1) * fps;
              const g = prog(f, fps, w.at + 0.1, w.at + 0.42, EASE.out);
              return (
                <span key={k} style={{ display: "inline-block", overflow: masked ? "hidden" : "visible", paddingBottom: size * 0.1, marginBottom: -size * 0.04 }}>
                  <span
                    style={{
                      display: "inline-block",
                      transform: `translateY(${((1 - p) * size * 1.05).toFixed(1)}px) rotate(${((1 - p) * 5).toFixed(2)}deg)`,
                      opacity: clamp01(p * 1.6),
                      color: w.em ? brand.primary : undefined,
                      textShadow:
                        g <= 0.001
                          ? undefined
                          : w.em
                            ? `0 6px 34px rgba(0,0,0,${(0.5 * g).toFixed(3)}), 0 0 40px ${rgba(brand.primary, 0.45 * g)}`
                            : `0 6px 34px rgba(0,0,0,${(0.55 * g).toFixed(3)})`,
                    }}
                  >
                    {w.w}
                  </span>
                </span>
              );
            })}
          </div>
        </TextShine>
      ))}
    </div>
  );
}

/** cahaya bulat lembut (SVG radialGradient — aman untuk render browser) */
function Glow({ x, y, r, color, opacity }: { x: number; y: number; r: number; color: string; opacity: number }) {
  const id = useSid("wg");
  if (opacity <= 0.005) return null;
  return (
    <svg width={r * 2} height={r * 2} viewBox={`0 0 ${r * 2} ${r * 2}`} style={{ position: "absolute", left: x - r, top: y - r, opacity, pointerEvents: "none", overflow: "visible" }} aria-hidden>
      <defs>
        <radialGradient id={id} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={color} stopOpacity="0.55" />
          <stop offset="55%" stopColor={color} stopOpacity="0.16" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={r} cy={r} r={r} fill={`url(#${id})`} />
    </svg>
  );
}

/** percikan bara yang naik dari badge HOT (n partikel, k = skala jarak) */
function Embers({ f, fps, at, x, y, n = 12, k: kd = 1, seed = "e" }: { f: number; fps: number; at: number; x: number; y: number; n?: number; k?: number; seed?: string }) {
  const k0 = (f - at * fps) / fps;
  if (k0 < 0 || k0 > 1.6) return null;
  return (
    <div style={{ position: "absolute", left: x, top: y, width: 0, height: 0, pointerEvents: "none" }}>
      {Array.from({ length: n }, (_, i) => {
        const d = random(`${seed}m${i}`) * 0.35;
        const k = (k0 - d) / 1.1;
        if (k < 0 || k > 1) return null;
        const ang = -Math.PI / 2 + (random(`${seed}a${i}`) - 0.5) * 2.2;
        const dist = (26 + random(`${seed}d${i}`) * 46) * kd;
        const px = Math.cos(ang) * dist * Math.pow(k, 0.6) + Math.sin(k * 6 + i) * 3;
        const py = Math.sin(ang) * dist * Math.pow(k, 0.6) - k * 18 * kd;
        const sz = 2 + random(`${seed}s${i}`) * 2.6;
        const col = i % 3 === 0 ? C.amber3 : i % 3 === 1 ? C.or4 : C.red4;
        return <span key={i} style={{ position: "absolute", left: px - sz / 2, top: py - sz / 2, width: sz, height: sz, borderRadius: 99, background: col, opacity: (1 - k) * 0.95, boxShadow: `0 0 6px ${col}` }} />;
      })}
    </div>
  );
}

/** blur gerak dari kecepatan layar (px/frame) — rumus sama dengan <Cam> */
const vblur = (v: number) => Math.min(7, Math.max(0, Math.abs(v) - 5) * 0.12);
const blurCss = (px: number) => (px > 0.05 ? `blur(${px.toFixed(2)}px)` : undefined);

// =============================================================================================
// ADEGAN 3 · DASHBOARD + HOT ISSUE
// =============================================================================================
/**
 * Kartu angka (StatCard) — dibuat konsisten dengan ranking: ranking asli menaruh issue HOT paling atas, jadi sebelum
 * laporan ke-3 masuk belum ada issue HOT (Hot aktif 0). Persentase = n / 35 issue aktif (Open 23 + In Progress 12).
 */
const STATS: { label: string; value: number; tone: StatTone; icon: string; footer: string }[] = [
  { label: "Hot aktif", value: 0, tone: "red", icon: "flame", footer: "0% dari issue aktif" },
  { label: "Urgent aktif", value: 5, tone: "orange", icon: "alert", footer: "14% dari issue aktif" },
  { label: "Open", value: 23, tone: "sky", icon: "inbox", footer: "66% dari issue aktif" },
  { label: "In Progress", value: 12, tone: "amber", icon: "clock", footer: "34% dari issue aktif" },
  { label: "Resolved total", value: 186, tone: "emerald", icon: "check", footer: "18 diselesaikan hari ini" },
];
/** jumlah issue di daftar ranking (header LoadMoreList: `${issues.length} issue · …`) */
const LIST_TOTAL = 35;

/** urutan awal sesuai aturan ranking asli: HOT → jumlah laporan → prioritas → update terbaru */
const ROWS: RankIssue[] = [
  { title: "Saldo withdraw tertahan lebih dari 3 hari", status: "in_progress", priority: "urgent", category: "Withdraw / Payout", reports: 2, contact: ["WA", "0812-••••-••••", 1], pic: "Nengok", ago: "8 mnt lalu", by: "Alif" },
  { title: "Views tidak update sejak kemarin", status: "in_progress", priority: "high", category: "Views tidak update", reports: 2, contact: ["IG", "@••••••••", 1], pic: "Irsyad", ago: "12 mnt lalu", by: "Natasha" },
  { title: "Kode OTP verifikasi akun tidak masuk", status: "open", priority: "high", category: "Akun / Verifikasi / OTP", reports: 2, contact: ["Email", "•••••••@gmail.com", 1], pic: "Derencalibur", ago: "31 mnt lalu", by: "Irsyad" },
];
// PRIVASI: kontak clipper di atas sudah tersamar di sumbernya ('0812-••••-••••', '@••••') dan digambar sebagai balok skeleton.
/** topik yang naik: laporan ke-3 masuk → otomatis HOT (REPORT_HOT_THRESHOLD = 3) → ranking #1 */
const FEAT: RankIssue = { title: "Video ditolak padahal sesuai brief", status: "open", priority: "high", category: "Banding / Reject", reports: 2, contact: ["DC", "••••••••", 1], pic: "Natasha", ago: "1 jam lalu", by: "Derencalibur" };

// tata letak dunia (px CSS halaman)
const D = {
  gridY: 112,
  cardH: 154,
  gap: 12,
  get panelY() {
    return this.gridY + 3 * this.cardH + 2 * this.gap + 26;
  },
  headH: 41,
  rowH: 164,
};

// detik SFX (lib/studio/teaser.ts) + ketukan
const D_READ = 0.3; // swoosh-readout: angka mulai berjalan (whip masuk dari Reveal selesai di 0,3)
const D_SLAM = 0.6; // ketukan: semua angka mendarat
const D_TING = 1.2; // koin-ting: laporan ke-3 → naik ke #1
const D_PING = 2.4; // ui-scifi-ping: badge HOT menyala
/** jendela kamera mengikuti baris yang naik (blur gerak dihitung manual per baris) */
const FOLLOW: [number, number] = [1.12, 2.05];
/** ketukan sesudah ping: kick zoom + percikan bara (adegan 5,4 dtk → ketukan terakhir yang utuh 4,8) */
const AFTER_BEATS = [3.0, 3.6, 4.2, 4.8];

export function DashboardShot() {
  const { f, fps, s, box, W, H } = useShot();
  const S = box.w / PAGE_W;
  // render browser: ctx.filter blur dalam px kanvas (tidak ikut scale(S) World) → radius dikali S supaya DOF sama dengan CLI
  const bk = useRemotionEnvironment().isClientSideRendering ? S : 1;
  const bx = box.x + box.w / 2;
  const by = box.y + box.h / 2;
  const ox = bx - (PAGE_W / 2) * S;
  const oy = by - 300 * S;
  const panelY = D.panelY;
  const rowC = (slot: number) => panelY + D.headH + slot * D.rowH + D.rowH / 2;
  const row0 = rowC(0);
  const tyRow = box.y + box.h * 0.7; // #4 agak bawah: baris #1–#3 di atasnya terlihat (tujuan naiknya)
  const tyMid = box.y + box.h * 0.6;
  const tyHero = box.y + box.h * 0.585;

  // --- slot baris (pecahan) per frame: topik naik #4 → #1 di koin-ting, baris lain turun satu ---
  const featSlot = (fr: number) => 3 - 3 * springFrom(fr, fps, D_TING, { damping: 15, stiffness: 105, mass: 0.95 });
  const otherSlot = (fr: number, i: number) => i + springFrom(fr, fps, D_TING + 0.07 + i * 0.045, { damping: 15, stiffness: 150, mass: 0.8 });
  // kamera ikut baris yang naik, sedikit tertinggal (baris melesat duluan, kamera menyusul tanpa overshoot)
  const camSlot = (fr: number) => 3 - 3 * springFrom(fr, fps, D_TING + 0.03, { damping: 18, stiffness: 105, mass: 0.95 });

  const wkeys: WKey[] = [
    { t: 0, wx: 181, wy: 262, z: 0.84, r: -2.2, ty: by },
    { t: 0.42, wx: 181, wy: 300, z: 1.0, r: 0, ease: EASE.out },
    { t: D_SLAM, wx: 181, wy: 311, z: 1.045, ease: EASE.out }, // angka mendarat di ketukan → kamera "kick"
    { t: 0.85, wx: 181, wy: 316, z: 1.05, ease: EASE.soft },
    { t: FOLLOW[0], wx: 181, wy: rowC(3), z: 1.1, ty: tyRow, ease: EASE.whip }, // whip turun ke topik di #4
    { t: 1.2, wx: 181, wy: rowC(3), z: 1.1 },
    { t: 1.85, wx: 181, wy: row0, z: 1.1, ty: tyMid, ease: EASE.soft },
    { t: FOLLOW[1], wx: 181, wy: row0, z: 1.1 },
    { t: 2.28, wx: 178, wy: row0 + 2, z: 1.085, ty: tyHero, ease: EASE.soft }, // antisipasi: mundur sedikit
    { t: 2.47, wx: 168, wy: row0 - 4, z: 1.19, ease: EASE.out }, // dorong ke baris #1 tepat di ping
    { t: 2.95, wx: 166, wy: row0 - 6, z: 1.18, ease: EASE.soft },
    { t: 4.45, wx: 160, wy: row0 - 8, z: 1.26, ease: EASE.inOut }, // dorong pelan terus ke badge HOT (montage membekukan 3,5)
    { t: 5.05, wx: 184, wy: row0 - 1, z: 1.235, r: -1.1, ease: EASE.inOut }, // orbit: geser menyamping + miring, judul & PIC ikut terbaca
    { t: 5.8, wx: 186, wy: row0 + 118, z: 1.27, r: -0.4, ease: EASE.in }, // isi naik searah transisi slide-up berikutnya (5,4–5,8)
  ];
  const baseKeys = wkeys.map((k) => ({ t: k.t, x: k.wx, y: k.wy, z: k.z, r: k.r, ease: k.ease }));
  const tyKeys = wkeys.map((k) => ({ t: k.t, x: k.ty, ease: k.ease }));
  const camW = (fr: number) => {
    const t = fr / fps;
    const v = camAtTime(baseKeys, t);
    let wy = v.y;
    if (t > FOLLOW[0] && t < FOLLOW[1]) {
      const fy = rowC(camSlot(fr));
      wy = fy + (v.y - fy) * prog(fr, fps, 1.85, FOLLOW[1], (x) => x);
    }
    // "kick" zoom kecil di tiap ketukan musik sesudah ping (3,0 · 3,6 · 4,2 · 4,8) — seirama denyut badge HOT
    const kick = 0.01 * beatPulse(fr, fps) * prog(fr, fps, 2.85, 2.95) * (1 - prog(fr, fps, 5.0, 5.15));
    return { wx: v.x, wy, z: v.z + kick, r: v.r, ty: camAtTime(tyKeys, t).x };
  };
  const toCam = (fr: number): CamKey => {
    const c = camW(fr);
    const px = ox + c.wx * S;
    const py = oy + c.wy * S;
    return { t: fr / fps, z: c.z, x: bx - W / 2 - (px - W / 2) * c.z, y: c.ty - H / 2 - (py - H / 2) * c.z, r: c.r, ease: (x) => x };
  };
  const keys = [toCam(f), toCam(f + 1)];
  const c0 = camW(f);
  const c1 = camW(f - 1);
  const following = s > FOLLOW[0] + 0.01 && s < FOLLOW[1];
  const zS = S * c0.z;
  const camV = following ? (c0.wy - c1.wy) * zS : 0;
  const relV = (now: number, prev: number) => (following ? ((now - prev) * D.rowH - (c0.wy - c1.wy)) * zS : 0);

  const { rx, ry } = tiltAt(
    [
      { t: 0, rx: 18, ry: -14 },
      { t: 0.45, rx: 7, ry: -6, ease: EASE.out },
      { t: 0.85, rx: 6, ry: -5, ease: EASE.soft },
      { t: FOLLOW[0], rx: 9, ry: 5, ease: EASE.whip },
      { t: 1.9, rx: 4, ry: 2, ease: EASE.soft },
      { t: 2.4, rx: 0.5, ry: 0, ease: EASE.inOut },
      { t: 4.45, rx: -1.5, ry: -3, ease: EASE.soft },
      { t: 5.05, rx: 1.2, ry: 3.4, ease: EASE.inOut }, // orbit bersama geser menyamping
      { t: 5.8, rx: 3, ry: 2, ease: EASE.soft },
    ],
    s,
  );

  // --- angka berjalan: mulai di swoosh-readout, semua mendarat tepat di ketukan 0,6 ---
  const count = (v: number, i: number) => Math.round(v * prog(f, fps, D_READ + i * 0.03, D_SLAM, EASE.out));
  const slam = s >= D_SLAM ? Math.exp(-(s - D_SLAM) * 9) : 0;
  const cardGlow = 0.7 * prog(f, fps, D_SLAM - 0.12, D_SLAM, EASE.in) * (1 - prog(f, fps, D_SLAM + 0.05, D_SLAM + 0.55));
  const statsBlur = Math.max(3.2 * prog(f, fps, 0.92, 1.12), vblur(camV)) * bk;
  const statsFade = Math.max(0, 1 - 0.35 * prog(f, fps, 0.9, 1.2) - 0.65 * prog(f, fps, 1.9, 2.3));

  // --- topik naik ke #1 (koin-ting) ---
  const slotF = featSlot(f);
  const slotO = ROWS.map((_, i) => otherSlot(f, i));
  const reportsF = s >= D_TING ? 3 : 2;
  const plus = s >= D_TING ? clamp01(1 - (s - D_TING) / 0.75) : 0;
  const lift = prog(f, fps, 0.98, D_TING, EASE.out) * (1 - prog(f, fps, 1.75, 2.1));
  const antic = prog(f, fps, 0.98, D_TING, EASE.inOut) * (1 - prog(f, fps, D_TING, D_TING + 0.08)); // turun sedikit sebelum melompat
  const focus = prog(f, fps, 0.9, D_TING);

  // --- badge HOT menyala (ui-scifi-ping) + denyut di tiap ketukan sesudahnya ---
  const hot = s >= D_PING - 0.07 ? springFrom(f, fps, D_PING - 0.07, { damping: 13, stiffness: 230, mass: 0.6 }) : 0;
  const hotSlot = s >= D_PING - 0.2 ? springFrom(f, fps, D_PING - 0.2, { damping: 22, stiffness: 320, mass: 0.6 }) : 0;
  const hotGlow = s >= D_PING - 0.07 ? Math.max(0.4 + 0.45 * beatPulse(f, fps) * prog(f, fps, 2.85, 2.95), 1 - (s - D_PING) / 0.5) : 0;
  const sweep = prog(f, fps, D_PING, D_PING + 0.6, EASE.inOut);
  const restBlur = 1.8 * prog(f, fps, 2.2, 2.8);
  const scrim = prog(f, fps, 2.15, 2.45);

  const rows: { it: RankIssue; slot: number; v: number; feat: boolean }[] = [
    ...ROWS.map((it, i) => ({ it, slot: slotO[i], v: relV(slotO[i], otherSlot(f - 1, i)), feat: false })),
    { it: FEAT, slot: slotF, v: relV(slotF, featSlot(f - 1)), feat: true },
  ];

  return (
    <AbsoluteFill>
      <Cam keys={keys} blur={!following}>
        <World ox={ox} oy={oy} S={S} h={1400} rx={rx} ry={ry} fx={c0.wx} fy={c0.wy}>
          {/* cahaya panas di belakang baris #1 + sorotan yang ikut baris yang naik */}
          <Glow x={PAGE_W / 2} y={row0} r={260} color={C.red5} opacity={0.75 * clamp01(hotGlow)} />
          <Glow x={PAGE_W / 2} y={rowC(slotF)} r={170} color={C.or5} opacity={0.5 * focus} />

          {/* judul + kartu angka (StatCard) */}
          <div style={{ position: "absolute", left: 0, top: 0, width: PAGE_W, filter: blurCss(statsBlur), opacity: statsFade }}>
            <div style={{ opacity: clamp01(springFrom(f, fps, -0.05) * 1.3) }}>
              <PageTitle title="Dashboard Hot Issues" sub="Pantau issue clipper yang lagi ramai, siapa yang pegang, dan kontak yang dilaporkan berulang." />
            </div>
            {STATS.map((st, i) => {
              // masuk bertingkat saat whip dari Reveal mereda (0,1–0,3) → sudah diam & terbaca waktu angka mulai berjalan di 0,3
              const p = springFrom(f, fps, 0.06 + i * 0.045, { damping: 13, stiffness: 170, mass: 0.7 });
              const col = i % 2;
              const r = Math.floor(i / 2);
              const wide = i === 4;
              const w = wide ? PAGE_W : (PAGE_W - D.gap) / 2;
              const sc = (0.9 + 0.1 * p) * (1 + 0.035 * slam);
              return (
                <div
                  key={st.label}
                  style={{
                    position: "absolute",
                    left: wide ? 0 : col * (w + D.gap),
                    top: D.gridY + r * (D.cardH + D.gap),
                    width: w,
                    height: D.cardH,
                    opacity: clamp01(p * 1.5),
                    transform: `translateY(${((1 - p) * 46).toFixed(1)}px) scale(${sc.toFixed(4)})`,
                  }}
                >
                  <StatCard label={st.label} value={count(st.value, i)} tone={st.tone} icon={st.icon} footer={st.footer} glow={cardGlow} style={{ height: D.cardH }} />
                </div>
              );
            })}
          </div>

          {/* panel ranking "Dari agent" (LoadMoreList panel) */}
          <div
            style={{
              ...cardCss(),
              position: "absolute",
              left: 0,
              top: panelY,
              width: PAGE_W,
              height: D.headH + 4 * D.rowH,
              overflow: "hidden",
              opacity: clamp01(springFrom(f, fps, 0.35) * 1.3),
            }}
          >
            <div style={{ height: D.headH, boxSizing: "border-box", padding: "12px 20px", borderBottom: "1px solid rgba(39,39,42,0.8)", fontSize: 12, lineHeight: "16px", color: Z[500], whiteSpace: "nowrap", filter: blurCss(Math.max(restBlur * 0.5, vblur(camV)) * bk) }}>
              {LIST_TOTAL} issue · paling HOT & paling banyak laporan di atas
            </div>
            {rows
              .slice()
              .sort((a, b) => Number(a.feat) - Number(b.feat))
              .map((r) => {
                const rank = Math.min(4, Math.max(1, Math.round(r.slot) + 1));
                const y = D.headH + r.slot * D.rowH + (r.feat ? antic * 5 : 0);
                const sc = r.feat ? 1 + 0.025 * lift : 1;
                // baris utama tetap terbaca (blur gerak dibatasi), baris lain lewat dengan blur penuh
                const bl = (r.feat ? Math.min(1.2, vblur(r.v) * 0.4) : Math.max(restBlur, vblur(r.v))) * bk;
                return (
                  <div
                    key={r.it.title}
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: y,
                      height: D.rowH,
                      borderTop: r.slot > 0.5 ? "1px solid rgba(39,39,42,0.8)" : undefined,
                      zIndex: r.feat ? 3 : 1,
                      transform: `scale(${sc.toFixed(4)})`,
                      filter: blurCss(bl),
                      opacity: r.feat ? 1 : 1 - 0.35 * prog(f, fps, 2.2, 2.8),
                    }}
                  >
                    <IssueRow
                      it={r.it}
                      rank={rank}
                      reports={r.feat ? reportsF : r.it.reports}
                      plus={r.feat ? plus : 0}
                      hot={r.feat ? hot : 0}
                      hotGlow={r.feat ? hotGlow : 0}
                      lift={r.feat ? lift : 0}
                      focus={r.feat ? focus : 0}
                      sweep={r.feat ? sweep : -1}
                      twoLine={r.feat}
                      hotSlot={r.feat ? hotSlot : 0}
                      bk={bk}
                    />
                    {r.feat && (
                      <>
                        <Embers f={f} fps={fps} at={D_PING} x={84} y={28} />
                        {AFTER_BEATS.map((b) => (
                          <Embers key={b} f={f} fps={fps} at={b} x={84} y={28} n={5} k={0.7} seed={`b${b}`} />
                        ))}
                      </>
                    )}
                  </div>
                );
              })}
          </div>
        </World>
      </Cam>

      {/* layar gelap tipis di atas supaya teks layar kontras */}
      <AbsoluteFill style={{ pointerEvents: "none", opacity: scrim, background: `linear-gradient(180deg, rgba(9,9,11,0.94) 0%, rgba(9,9,11,0.8) ${(((box.y + 250) / H) * 100).toFixed(1)}%, rgba(9,9,11,0) ${(((box.y + 420) / H) * 100).toFixed(1)}%)` }} />
      <Sweep at={D_SLAM - 0.05} len={0.7} alpha={0.1} />
      <Flash at={D_PING} len={0.22} color="#ffb070" max={0.16} />
      <Kinetic
        pos="top"
        size={96}
        shine={3.3}
        lines={[
          [
            { w: "Paling", at: D_PING },
            { w: "panas,", at: D_PING + 0.08, em: true },
          ],
          [
            { w: "paling", at: 3.0 },
            { w: "atas", at: 3.08, em: true },
          ],
        ]}
      />
    </AbsoluteFill>
  );
}


// =============================================================================================
// ADEGAN 4 · VIDEO REVIEW
// =============================================================================================
const CASES: VrCase[] = [
  {
    no: 24,
    date: "25/10/26",
    explanation: "Video sudah 3 hari belum direview, minta dicek",
    category: "Review/rilis melewati estimasi waktu",
    links: [
      ["TikTok", "tiktok.com/@•••••/video/••••"],
      ["Email", "•••••••@gmail.com"],
    ],
    notes: "sudah upload sesuai jadwal",
  },
  {
    no: 23,
    date: "25/10/26",
    explanation: "Banding: video ditolak karena dianggap reupload",
    category: "Pengajuan banding",
    links: [
      ["TikTok", "tiktok.com/@•••••/video/••••"],
      ["Email", "••••••••••@gmail.com"],
    ],
    notes: "video hasil edit sendiri",
  },
];
/** daftar kasus di belakang (diburamkan, depth of field) */
const BACK: [number, string, VrKey, string][] = [
  [22, "Saldo dibekukan, minta dicek ulang", "disetujui", "Saldo dibekukan (cek/menanyakan)"],
  [21, "Minta review video campaign baru", "menunggu", "Permintaan review video"],
  [20, "Video tidak sesuai brief, minta penjelasan", "ditolak", "Kesesuaian video dengan brief"],
  [19, "Refresh views video top clipper", "selesai", "Refresh views top clipper"],
];

// detik SFX (lib/studio/teaser.ts)
const V_IN1 = 0.6;
const V_OK1 = 1.8;
const V_IN2 = 2.4;
const V_OK2 = 3.6;

const V = { navY: 92, stageY: 160 };
const SWIPE = 470;
/** posisi pil status & item menu di dalam kartu (px lokal) */
const PILL = { x: 296, y: 26 };
const itemY = (i: number) => 40 + 5 + MENU_ROW * i + MENU_ROW / 2;

function BackList() {
  return (
    <div style={{ ...cardCss(), width: PAGE_W, overflow: "hidden" }}>
      {BACK.map(([no, ex, st, cat], i) => (
        <div key={no} style={{ padding: 16, borderTop: i ? "1px solid rgba(39,39,42,0.7)" : undefined, fontSize: 13, lineHeight: "19px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: Z[500] }}>
            <span>#{no}</span>
            <span>24/10/26</span>
            <span style={{ marginLeft: "auto" }}>
              <Pill t={VR[st]}>{VR[st].label}</Pill>
            </span>
          </div>
          <div style={{ marginTop: 8, fontWeight: 600, color: Z[100] }}>{ex}</div>
          <div style={{ marginTop: 4, fontSize: 12, color: Z[400] }}>{cat}</div>
        </div>
      ))}
    </div>
  );
}

const easeOutP = (u: number, k = 3.5) => 1 - Math.pow(1 - clamp01(u), k);

/** cincin cahaya yang melebar dari titik (x, y) mulai detik `at` */
function Ring({ f, fps, at, x, y, color, r = 30 }: { f: number; fps: number; at: number; x: number; y: number; color: string; r?: number }) {
  const k = (f - at * fps) / (0.5 * fps);
  if (k < 0 || k > 1) return null;
  const e = easeOutP(k, 3);
  return <span style={{ position: "absolute", left: x - r, top: y - r, width: r * 2, height: r * 2, borderRadius: 999, border: `2px solid ${rgba(color, 0.6 * (1 - k))}`, boxShadow: `0 0 14px ${rgba(color, 0.4 * (1 - k))}`, transform: `scale(${(0.4 + e * 1.0).toFixed(3)})`, pointerEvents: "none", zIndex: 12 }} />;
}

/** satu kartu kasus aktif: masuk (berhenti tepat di `land`), pilih status (tap → menu → pilih di `ok`), keluar (opsional) */
function ActiveCase({ c, land, tapAt, ok, from, to, hoverAt, outAt, resolution, glowColor, approve }: { c: VrCase; land: number; tapAt: number; ok: number; from: VrKey; to: VrKey; hoverAt: number; outAt?: number; resolution: string; glowColor: string; approve?: boolean }) {
  const { f, fps } = useShot();
  // masuk dari kanan, melambat & berhenti tepat di detik whoosh; keluar ke kiri makin cepat
  const xAt = (fr: number) => {
    let x = SWIPE * (1 - easeOutP((fr / fps - (land - 0.3)) / 0.3));
    if (outAt !== undefined) x -= SWIPE * 1.2 * Math.pow(clamp01((fr / fps - (outAt - 0.26)) / 0.26), 2.4);
    return x;
  };
  const x = xAt(f);
  const dx = x - xAt(f - 1);
  if (f < (land - 0.32) * fps || x < -SWIPE * 1.15) return null;
  const thump = f >= land * fps ? Math.sin(((f / fps - land) / 0.3) * Math.PI) * Math.exp(-(f / fps - land) * 7) : 0;
  const open = springFrom(f, fps, tapAt + 0.03, { damping: 16, stiffness: 260, mass: 0.6 }) * (1 - prog(f, fps, ok + 0.03, ok + 0.16));
  const iFrom = VR_ORDER.indexOf(from);
  const iTo = VR_ORDER.indexOf(to);
  const hl = iFrom + (iTo - iFrom) * prog(f, fps, hoverAt - 0.1, hoverAt + 0.12, EASE.inOut);
  const pop = f >= ok * fps ? Math.exp(-(f / fps - ok) * 6) * Math.min(1, (f / fps - ok) / 0.05 + 0.3) : 0;
  const flip = prog(f, fps, ok - 0.1, ok, (v) => v);
  const press = Math.max(clamp01(1 - Math.abs(f - tapAt * fps) / 3), clamp01(1 - Math.abs(f - ok * fps) / 3));
  const glowK = f >= (ok - 0.03) * fps ? Math.max(0.3, 1 - (f / fps - ok) / 0.6) : 0;
  const resP = springFrom(f, fps, ok + 0.12, { damping: 16 });
  const check = approve && f >= (ok - 0.04) * fps ? springFrom(f, fps, ok - 0.04, { damping: 10, stiffness: 210, mass: 0.6 }) : 0;
  const sweep = approve ? prog(f, fps, ok, ok + 0.55, EASE.inOut) : 0;
  const ryDeg = (x / SWIPE) * -34;
  const vb = Math.abs(dx) > 5 ? Math.min(6, Math.abs(dx) * 0.05) : 0;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        transform: `perspective(1500px) translateX(${x.toFixed(2)}px) rotateY(${ryDeg.toFixed(2)}deg) rotate(${(dx * 0.03).toFixed(3)}deg) scale(${(1 + 0.022 * thump).toFixed(4)})`,
        transformOrigin: "50% 50%",
        filter: vb > 0 ? `blur(${vb.toFixed(2)}px)` : undefined,
        opacity: clamp01(1.4 - Math.abs(x) / SWIPE),
      }}
    >
      <Trail dx={dx} dy={0} n={3}>
        <VrCaseCard c={c} status={<StatusPill from={from} to={to} p={flip} press={press} pop={pop} />} resolution={resolution} resP={f >= (ok + 0.12) * fps ? resP : 0} glow={glowColor} glowK={glowK}>
          {/* menu pilihan status (isi <select>) */}
          <div style={{ position: "absolute", right: 16, top: 40, zIndex: 10 }}>
            <StatusMenu open={open} cur={from} hl={hl} chosen={f >= ok * fps ? 1 : 0} />
          </div>
          <Tap f={f} fps={fps} at={tapAt} x={PILL.x} y={PILL.y} />
          {/* riak pilih item: pendek, hilang bersama menu (tidak mengambang di atas isi kartu) */}
          <Tap f={f} fps={fps} at={ok} x={250} y={itemY(iTo)} len={0.16} />
          <Ring f={f} fps={fps} at={ok + 0.02} x={PILL.x} y={PILL.y} color={glowColor} />
          {sweep > 0 && sweep < 1 && (
            <div style={{ position: "absolute", inset: 0, borderRadius: 16, overflow: "hidden", pointerEvents: "none" }}>
              <span style={{ position: "absolute", top: -40, bottom: -40, left: `${(-40 + sweep * 160).toFixed(2)}%`, width: "28%", transform: "skewX(-20deg)", background: "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(167,243,208,0.14) 45%, rgba(255,255,255,0.3) 50%, rgba(167,243,208,0.14) 55%, rgba(255,255,255,0) 100%)" }} />
            </div>
          )}
          {check > 0.001 && (
            <div style={{ position: "absolute", right: 4, bottom: -22, transform: `scale(${(0.4 + 0.6 * check).toFixed(3)}) rotate(${((1 - check) * -25).toFixed(2)}deg)`, transformOrigin: "50% 50%" }}>
              <span style={{ position: "absolute", left: 14, top: 22, width: 64, height: 64, borderRadius: 999, background: rgba(C.em5, 0.55), filter: "blur(14px)" }} />
              <CheckBurst p={prog(f, fps, ok - 0.04, ok + 0.45, EASE.out)} size={92} />
            </div>
          )}
        </VrCaseCard>
      </Trail>
    </div>
  );
}

export function VideoReviewShot() {
  const { f, fps, s, box, W, H } = useShot();
  const S = box.w / PAGE_W;
  // render browser: blur canvas tidak ikut scale(S) World → radius dikali S (blur di dalam kartu 3D sudah ikut skala, tidak dikali)
  const bk = useRemotionEnvironment().isClientSideRendering ? S : 1;
  const bx = box.x + box.w / 2;
  const capTop = box.y + box.h * 0.88 - 196;
  const zoneCy = (box.y + capTop) / 2;
  const ox = bx - (PAGE_W / 2) * S;
  const oy = zoneCy - 220 * S;
  const cardMid = V.stageY + 128;

  // titik menu status di dunia (px halaman): pil di kanan atas kartu, item "Diproses" / "Disetujui"
  const menuX = 268;
  const itemW = (i: number) => V.stageY + itemY(i);
  const wkeys: WKey[] = [
    { t: 0, wx: 181, wy: 108, z: 1.04, r: 0 },
    { t: 0.42, wx: 181, wy: 150, z: 1.0, ease: EASE.soft },
    { t: 0.8, wx: 181, wy: cardMid - 22, z: 0.985, ease: EASE.out },
    { t: 1.02, wx: 183, wy: cardMid - 18, z: 1.0, ease: EASE.soft },
    // push ke pil/menu: tap 1,25 → sorot 1,52 → pilih Diproses 1,8
    { t: 1.62, wx: menuX - 2, wy: itemW(1) - 14, z: 1.3, r: -1.4, ease: EASE.inOut },
    { t: V_OK1, wx: menuX, wy: itemW(1) - 8, z: 1.33, r: -1.5, ease: EASE.soft },
    { t: V_OK1 + 0.12, wx: menuX, wy: itemW(1) - 6, z: 1.37, r: -1.7, ease: EASE.out }, // kick di ui-accept
    { t: 2.0, wx: menuX - 2, wy: itemW(1) - 6, z: 1.36, ease: EASE.soft },
    // whip balik lebar untuk ganti kartu (mendarat sebelum whoosh 2,4)
    { t: 2.32, wx: 181, wy: cardMid - 20, z: 0.985, r: 0, ease: EASE.whip },
    { t: 2.85, wx: 183, wy: cardMid - 16, z: 1.0, ease: EASE.soft },
    // push lagi: tap 3,05 → sorot 3,32 → pilih Disetujui 3,6 (dibingkai sedikit lebih tinggi supaya centang di sudut kartu tidak menabrak teks bawah)
    { t: 3.42, wx: menuX - 2, wy: itemW(2) + 8, z: 1.3, r: 1.4, ease: EASE.inOut },
    { t: V_OK2, wx: menuX, wy: itemW(2) + 14, z: 1.33, r: 1.5, ease: EASE.soft },
    { t: V_OK2 + 0.12, wx: menuX, wy: itemW(2) + 16, z: 1.37, r: 1.7, ease: EASE.out }, // kick di ui-accept
    { t: 3.95, wx: menuX - 4, wy: itemW(2) + 18, z: 1.35, r: 1.4, ease: EASE.soft }, // tahan: centang mendarat
    // rack keluar ke kartu utuh + centang hijau, lalu dorong pelan
    { t: 4.55, wx: 186, wy: cardMid + 26, z: 1.04, r: 0, ease: EASE.inOut },
    { t: 5.3, wx: 188, wy: cardMid + 30, z: 1.06, ease: EASE.soft },
  ];
  const keys = worldCam(wkeys, { ox, oy, S, W, H, tx: bx, ty: zoneCy });
  const { fx, fy } = focusAt(wkeys, s);
  const { rx, ry } = tiltAt(
    [
      { t: 0, rx: 12, ry: 9 },
      { t: 0.8, rx: 4, ry: -3, ease: EASE.out },
      { t: 1.62, rx: 2, ry: -7, ease: EASE.inOut },
      { t: 2.32, rx: 5, ry: 4, ease: EASE.whip },
      { t: 3.42, rx: 2, ry: 6, ease: EASE.inOut },
      { t: 3.95, rx: 1.5, ry: 5, ease: EASE.soft },
      { t: 4.55, rx: 0, ry: 0, ease: EASE.inOut },
      { t: 5.3, rx: 2, ry: -2, ease: EASE.soft },
    ],
    s,
  );

  const headP = springFrom(f, fps, -0.05, { damping: 16 });
  const navP = springFrom(f, fps, 0.08, { damping: 15 });
  const backP = springFrom(f, fps, 0.15, { damping: 18 });
  // depth of field: kepala halaman buram saat kamera mendorong ke kartu
  const zNow = Math.max(prog(f, fps, 0.55, 0.85) * 0.6, prog(f, fps, 1.05, 1.5) * (1 - prog(f, fps, 2.0, 2.3)), prog(f, fps, 2.85, 3.3));
  const headBlur = 2.4 * zNow * bk;

  return (
    <AbsoluteFill>
      <Cam keys={keys}>
        <World ox={ox} oy={oy} S={S} h={900} rx={rx} ry={ry} fx={fx} fy={fy}>
          <Glow x={PAGE_W / 2} y={cardMid} r={250} color={C.or5} opacity={0.35} />
          <Glow x={PAGE_W / 2} y={cardMid} r={230} color={C.amber5} opacity={f >= V_OK1 * fps ? 0.6 * clamp01(1 - (f / fps - V_OK1) / 0.7) : 0} />
          <Glow x={PAGE_W / 2} y={cardMid} r={270} color={C.em5} opacity={f >= V_OK2 * fps ? Math.max(0.4, 0.85 * (1 - (f / fps - V_OK2) / 0.6)) : 0} />

          <div style={{ filter: headBlur > 0.05 ? `blur(${headBlur.toFixed(2)}px)` : undefined, opacity: 1 - 0.65 * zNow }}>
            <div style={{ opacity: clamp01(headP * 1.3), transform: `translateY(${((1 - headP) * 14).toFixed(1)}px)` }}>
              <PageTitle title="Video Review" sub="Log kasus review video dari WA / Discord — format sama dengan sheet “Video Review WA”." />
            </div>
            <div style={{ position: "absolute", left: 0, top: V.navY, width: PAGE_W, opacity: clamp01(navP * 1.3), transform: `translateY(${((1 - navP) * 16).toFixed(1)}px)` }}>
              <VrSubNav total={24} />
            </div>
          </div>

          {/* daftar kasus di belakang kartu aktif (buram) */}
          <div style={{ position: "absolute", left: 0, top: V.stageY + 26, width: PAGE_W, transform: `scale(0.93)`, transformOrigin: "50% 0%", filter: `blur(${(2.6 * bk).toFixed(2)}px)`, opacity: 0.5 * clamp01(backP * 1.2) }}>
            <BackList />
          </div>

          {/* kartu kasus aktif */}
          <div style={{ position: "absolute", left: 0, top: V.stageY, width: PAGE_W }}>
            <ActiveCase c={CASES[0]} land={V_IN1} tapAt={1.25} hoverAt={1.52} ok={V_OK1} from="menunggu" to="diproses" outAt={V_IN2 - 0.04} resolution="Dicek ulang ke tim review (Alif)" glowColor={C.amber5} />
            <ActiveCase c={CASES[1]} land={V_IN2} tapAt={3.05} hoverAt={3.32} ok={V_OK2} from="diproses" to="disetujui" resolution="Disetujui (Alif)" glowColor={C.em5} approve />
          </div>
        </World>
      </Cam>

      {/* layar gelap lembut di belakang teks layar bawah */}
      <AbsoluteFill style={{ pointerEvents: "none", opacity: prog(f, fps, 0.4, 0.7), background: `linear-gradient(180deg, rgba(9,9,11,0) ${(((capTop - 90) / H) * 100).toFixed(1)}%, rgba(9,9,11,0.72) ${(((capTop + 40) / H) * 100).toFixed(1)}%, rgba(9,9,11,0.72) ${(((capTop + 200) / H) * 100).toFixed(1)}%, rgba(9,9,11,0) ${(((capTop + 330) / H) * 100).toFixed(1)}%)` }} />
      <Sweep at={V_OK2} len={0.6} alpha={0.12} />
      <Flash at={V_OK2} len={0.2} color="#a7f3d0" max={0.12} />
      <Kinetic
        pos="bottom"
        size={90}
        shine={3.75}
        lines={[
          [
            { w: "Cek,", at: V_IN1 },
            { w: "kasih", at: V_OK1 },
            { w: "status,", at: V_OK1 + 0.08 },
          ],
          [{ w: "beres.", at: V_OK2, em: true }],
        ]}
      />
    </AbsoluteFill>
  );
}
