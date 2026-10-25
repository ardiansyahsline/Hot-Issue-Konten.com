"use client";

/**
 * Bagian UI untuk adegan teaser "chat" & "musicReport" — dibuat ulang dari komponen website terbaru:
 * - components/chat/ChatPage.tsx (header room) · ChatThread.tsx (bubble, meta "Nama · HH.MM", "Kamu · … · Dilihat N", lampiran, composer)
 * - components/UserAvatar.tsx (1 huruf di zinc-800; milikku orange-500/15; titik online emerald)
 * - components/emoji/EmojiPicker.tsx (QuickBar) · Reactions.tsx (ReactionPills sm) · lib/reactions.ts (QUICK_EMOJI)
 * - components/MusicButton.tsx (popover 300px "🎵 Musik", ✨ Musik AI / ▶ YouTube, preset, ✍️ Setir sendiri, ⏸ Jeda / ⏹ Stop, 🔈)
 * - components/ai/MusicCmdCard.tsx (equalizer emerald) · components/Meteors.tsx (meteor saat musik nyala) · components/Nav.tsx (nav HP)
 * - components/ai/DeckCard.tsx + lib/deck.ts (kartu PPT navy, Mini slide hitam/hijau/oranye, "⬇ Unduh PowerPoint")
 * Semua gerak dihitung dari detik adegan `s` (deterministik).
 */
import type { CSSProperties, ReactNode } from "react";
import { interpolate } from "remotion";
import { Shine } from "../../fx";
import { DISPLAY, FONT, KLogo } from "../../screens/ui";
import { clamp01, EASE, rgba } from "../kit";
import { KONTEN_REPORT_LOGO } from "./team-logo";

// ---------------------------------------------------------------------------------------------
// token warna (tailwind zinc / emerald / orange, sama dengan website)
// ---------------------------------------------------------------------------------------------
export const ZN = { 950: "#09090b", 900: "#18181b", 800: "#27272a", 700: "#3f3f46", 600: "#52525b", 500: "#71717a", 400: "#a1a1aa", 300: "#d4d4d8", 200: "#e4e4e7", 100: "#f4f4f5" } as const;
export const EM = { 400: "#34d399", 500: "#10b981", 600: "#059669" } as const;
export const OR = { 400: "#fb923c", 500: "#f97316", 600: "#ea580c" } as const;
export const SKY400 = "#38bdf8";
export const BTN_GRAD = "linear-gradient(180deg, #fb8a3c 0%, #ea580c 100%)";
export const SHADOW_PRIMARY = "inset 0 1px 0 rgba(255,255,255,0.25), 0 8px 20px -8px rgba(234,88,12,0.7)";
export const SHADOW_POP = "inset 0 1px 0 rgba(255,255,255,0.05), 0 8px 24px -8px rgba(0,0,0,0.6)";
/** emoji berwarna: DejaVu Sans menang lebih dulu di stack global (🎵 jadi ♫ monokrom) — pakai span khusus, JANGAN di stack global (angka rusak) */
export const EMOJI_FONT = '"Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
export const Emo = ({ c, style }: { c: string; style?: CSSProperties }) => <span style={{ fontFamily: EMOJI_FONT, ...style }}>{c}</span>;

const CL = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
/** progres 0..1 detik a → b */
export const pr = (s: number, a: number, b: number, ease: (x: number) => number = EASE.inOut) => interpolate(s, [a, Math.max(a + 1e-3, b)], [0, 1], { ...CL, easing: ease });
/** pegas analitik (tanpa frame): 0 → 1 dengan overshoot kecil, mulai detik `at` */
export function sp(s: number, at: number, k = 1, zeta = 0.42, w = 22): number {
  const t = (s - at) * k;
  if (t <= 0) return 0;
  const wd = w * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * w * t) * (Math.cos(wd * t) + ((zeta * w) / wd) * Math.sin(wd * t));
}
/** pegas tanpa overshoot (kritis) */
export const spc = (s: number, at: number, w = 18) => {
  const t = s - at;
  if (t <= 0) return 0;
  return 1 - Math.exp(-w * t) * (1 + w * t);
};

/** komponen skala: isi berukuran CSS px asli website, diperbesar `scale` kali, pojok kiri-atas di (x,y) kanvas */
export function Scaled({ x, y, w, h, scale, children, style, origin = "0 0" }: { x: number; y: number; w: number; h?: number; scale: number; children: ReactNode; style?: CSSProperties; origin?: string }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h, transform: `scale(${scale})`, transformOrigin: origin, fontFamily: FONT, color: ZN[100], ...style }}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// UserAvatar (components/UserAvatar.tsx)
// ---------------------------------------------------------------------------------------------
export function UAvatar({ name, size = 28, me, online, ring = ZN[900], pulse = 0 }: { name: string; size?: number; me?: boolean; online?: boolean; ring?: string; pulse?: number }) {
  const dot = Math.max(8, Math.round(size * 0.32));
  return (
    <span style={{ position: "relative", display: "inline-flex", flex: "none", width: size, height: size }}>
      <span
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 999,
          fontWeight: 600,
          textTransform: "uppercase",
          fontSize: Math.max(10, size * 0.4),
          background: me ? rgba(OR[500], 0.15) : ZN[800],
          color: me ? OR[400] : ZN[200],
        }}
      >
        {name.trim().slice(0, 1)}
      </span>
      {online !== undefined && (
        <span style={{ position: "absolute", right: -2, bottom: -2, width: dot, height: dot, borderRadius: 999, background: online ? EM[500] : ZN[500], boxShadow: `0 0 0 2px ${ring}` }} />
      )}
      {/* aksen gerak "baru masuk" (real-time): cincin emerald membesar lalu pudar — bukan elemen UI permanen */}
      {pulse > 0 && pulse < 1 && (
        <span style={{ position: "absolute", inset: 0, borderRadius: 999, border: `2px solid ${rgba(EM[400], 0.95 * (1 - pulse))}`, boxShadow: `0 0 ${(12 * (1 - pulse)).toFixed(1)}px ${rgba(EM[400], 0.6 * (1 - pulse))}`, transform: `scale(${(1 + 1.2 * pulse).toFixed(3)})` }} />
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// CHAT TIM
// ---------------------------------------------------------------------------------------------
export type ChatMsg = { who: string; me?: boolean; time: string; text: string; at: number; img?: boolean; lines: number };
/** urutan bubble = detik SFX notif-chat (0,3 · 1,2 · 2,1 · 3,0) + ui-pop 4,8 (lampiran Natasha) */
export const CHAT: ChatMsg[] = [
  // riwayat pagi (sudah ada sebelum adegan mulai) — thread terasa hidup & bubble baru mendarat di atas composer
  { who: "Natasha", time: "09.20", text: "Pagi tim! Rekap hot issue semalam udah aku update ☀️", at: -1, lines: 2 },
  { who: "Irsyad", time: "09.24", text: "Siap, makasih Nat 🙏", at: -1, lines: 1 },
  { who: "Alif", me: true, time: "09.41", text: "Hot issue #1 naik 🔥 siapa pegang?", at: 0.3, lines: 1 },
  { who: "Derencalibur", time: "09.41", text: "@Alif aku ambil, sekalian cek video review 👀", at: 1.2, lines: 2 },
  { who: "Nengok", time: "09.42", text: "Laporan mingguan udah jadi ✅", at: 2.1, lines: 1 },
  { who: "Irsyad", time: "09.42", text: "3 banding udah Disetujui 👍", at: 3.0, lines: 1 },
  { who: "Natasha", time: "09.43", text: "SS chat clipper, identitasnya udah aku blur", at: 4.8, img: true, lines: 2 },
];
export const QUICK = ["👍", "❤️", "😂", "😮", "🙏", "🔥", "✅", "👀"] as const;
/** reaksi: QuickBar muncul (antisipasi), 🔥 diketuk, pill +1 pop di ui-accept-boing 3,9 */
export const REACT = { bar: 3.25, tap: 3.6, hit: 3.9, gap: 4.72 };
/** pegas relatif ke ketukan: mulai 1–2 frame sebelum titik pukulan supaya frame SFX sudah ≥85% dan puncak "pop" jatuh +1 frame */
const PRE = 1 / 30;
const PRE2 = 2 / 30;

/** isi pesan: @sebut disorot (ChatThread: bg-orange-500/10 text-orange-500; di bubble sendiri bg-white/25) */
function Body({ text, mine }: { text: string; mine: boolean }) {
  return (
    <>
      {text.split(/(@[\p{L}\d_]+)/u).map((x, i) =>
        x.startsWith("@") ? (
          <span key={i} style={{ borderRadius: 4, padding: "0 4px", fontWeight: 600, background: mine ? "rgba(255,255,255,0.25)" : rgba(OR[500], 0.1), color: mine ? "#fff" : OR[500] }}>
            {x}
          </span>
        ) : (
          <span key={i}>{x}</span>
        ),
      )}
    </>
  );
}

/** ReactionPills size "sm" (components/emoji/Reactions.tsx) */
export function Pill({ emoji, count, mine, scale = 1 }: { emoji: string; count: number; mine?: boolean; scale?: number }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        borderRadius: 999,
        padding: "0 6px",
        fontSize: 11.5,
        border: `1px solid ${mine ? rgba(OR[500], 0.6) : ZN[800]}`,
        background: mine ? rgba(OR[500], 0.1) : rgba(ZN[950], 0.6),
        color: mine ? OR[400] : ZN[300],
        transform: `scale(${scale.toFixed(3)})`,
        transformOrigin: "0 50%",
      }}
    >
      <span style={{ fontSize: 13, lineHeight: "20px" }}>{emoji}</span>
      <b style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{count}</b>
    </span>
  );
}

/** QuickBar + "↩︎ Balas" (ChatThread data-react-menu, mt-1.5, flex-wrap → di HP "Balas" turun ke baris 2) — melayang di atas zona reaksi */
function ReactMenu({ s }: { s: number }) {
  const open = sp(s, REACT.bar, 1, 0.5, 26);
  // seperti aslinya: memilih emoji langsung menutup menu (setPick(null)) — menu menyusut saat 🔥 lepas terbang
  const shut = pr(s, REACT.tap + 0.02, REACT.tap + 0.14, EASE.in);
  const vis = open * (1 - shut);
  // jari menekan 🔥 (antisipasi) → 🔥 "lepas" terbang ke pill
  const press = s >= REACT.tap - 0.12 ? pr(s, REACT.tap - 0.12, REACT.tap - 0.02) : 0;
  const gone = s >= REACT.tap ? 1 : 0;
  return (
    <div style={{ position: "absolute", left: 0, top: 6, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6, transformOrigin: "0 0", transform: `scale(${(0.6 + 0.4 * vis).toFixed(3)})`, opacity: clamp01(vis * 1.4), pointerEvents: "none" }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 2, borderRadius: 999, border: `1px solid ${ZN[800]}`, background: ZN[900], padding: 4, boxShadow: SHADOW_POP, whiteSpace: "nowrap" }}>
        {QUICK.map((e, i) => {
          // emoji muncul bergelombang dari kiri (follow-through)
          const k = sp(s, REACT.bar + 0.03 + i * 0.022, 1, 0.38, 30);
          const fire = e === "🔥";
          return (
            <span
              key={e}
              style={{
                position: "relative",
                display: "flex",
                width: 32,
                height: 32,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 999,
                fontSize: 18,
                background: fire && s > REACT.tap - 0.3 ? (press > 0 ? rgba(OR[500], 0.28 * press) : ZN[800]) : "transparent",
                transform: `scale(${(k * (fire ? 1 - 0.18 * press * (1 - gone) : 1)).toFixed(3)}) translateY(${((1 - k) * 8).toFixed(1)}px)`,
              }}
            >
              <span style={{ opacity: fire && gone ? 0.25 : 1 }}>{e}</span>
              {fire && press > 0 && <span style={{ position: "absolute", inset: -3 - 8 * press, borderRadius: 999, border: `2px solid ${rgba(OR[400], 0.85 * (1 - press * 0.5))}` }} />}
            </span>
          );
        })}
        <span style={{ display: "flex", width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 999, fontSize: 14, color: ZN[500] }}>⋯</span>
      </div>
      <span style={{ borderRadius: 999, border: `1px solid ${ZN[800]}`, background: ZN[900], padding: "6px 12px", fontSize: 12.5, fontWeight: 600, color: ZN[300], boxShadow: SHADOW_POP }}>↩︎ Balas</span>
    </div>
  );
}

/** tinggi menu reaksi (mt-1.5 + QuickBar 42 + gap 6 + Balas 29) — ruangnya dipertahankan sampai pesan Natasha masuk supaya thread tidak melompat saat payoff */
const MENU_H = 83;
const pillCount = (s: number) => (s < 4.22 ? 1 : s < 4.52 ? 2 : 3);
/** skala pill 🔥: naik 2 frame sebelum pukulan → 1,6 TEPAT di frame SFX → osilasi teredam ke 1 */
function pillScale(s: number) {
  const a = REACT.hit - PRE2;
  if (s < a) return 0;
  if (s < REACT.hit) return 1.6 * EASE.out(clamp01((s - a) / PRE2));
  const t = s - REACT.hit;
  return 1 + 0.6 * Math.exp(-t * 9) * Math.cos(t * 24);
}

/**
 * zona reaksi di bawah bubble Irsyad: QuickBar (3,3) → 🔥 diketuk & TERBANG melengkung (besar, jejak gerak) ke pill (3,66 → 3,9)
 * → pill "🔥 1" pop 1,6× + ledakan partikel tepat di ui-accept-boing 3,9 → angka naik real-time (teman ikut bereaksi).
 * Koordinat CSS px relatif ke tepi bawah bubble.
 */
function ReactionZone({ s }: { s: number }) {
  if (s < REACT.bar - 0.02) return null;
  const open = Math.min(1.04, sp(s, REACT.bar, 1, 0.6, 24));
  const menuSpace = open * (1 - pr(s, REACT.gap, REACT.gap + 0.2));
  const pillsOn = s >= REACT.hit - PRE2;
  const rowH = pillsOn ? 24 * spc(s, REACT.hit - PRE2, 30) : 0;
  const zoneH = Math.max(rowH, MENU_H * menuSpace);
  const from = { x: 191, y: 33 };
  const to = { x: 14, y: 14 };
  const ctl = { x: 120, y: -70 };
  const flyAt = (u: number) => {
    const v = 1 - u;
    return { x: v * v * from.x + 2 * v * u * ctl.x + u * u * to.x, y: v * v * from.y + 2 * v * u * ctl.y + u * u * to.y };
  };
  const span = REACT.hit - REACT.tap;
  const ttOf = (t: number) => clamp01((t - REACT.tap) / span);
  const uOf = (t: number) => EASE.inOut(ttOf(t));
  const flying = s >= REACT.tap && s < REACT.hit;
  // ukuran mengikuti WAKTU (bukan posisi): besar ±58 CSS px (≈130 px kanvas) di tengah penerbangan, kecil lagi saat masuk pill
  const sizeOf = (t: number) => 18 + 40 * Math.sin(Math.PI * ttOf(t)) - 4 * ttOf(t);
  const burst = s >= REACT.hit ? clamp01((s - REACT.hit) / 0.45) : 0;
  const ps = pillScale(s);
  const n = pillCount(s);
  const tick = n > 1 ? 1 + 0.18 * Math.max(0, 1 - (s - (n === 2 ? 4.22 : 4.52)) / 0.18) : 1;
  return (
    <div style={{ position: "relative", height: zoneH, width: "100%" }}>
      {s < REACT.tap + 0.16 && <ReactMenu s={s} />}
      {pillsOn && (
        <div style={{ position: "absolute", left: 0, top: 4, display: "flex", gap: 4, alignItems: "center" }}>
          <Pill emoji="🔥" count={n} mine scale={ps * tick} />
          {s >= 4.05 && <Pill emoji="👍" count={2} scale={clamp01(sp(s, 4.05, 1, 0.4, 30))} />}
        </div>
      )}
      {/* jejak gerak + emoji terbang */}
      {flying &&
        [0.16, 0.08, 0].map((d, i) => {
          const uu = uOf(s - d * span);
          const pt = flyAt(uu);
          const fs = sizeOf(s - d * span);
          return (
            <span key={i} style={{ position: "absolute", left: pt.x - fs / 2, top: pt.y - fs / 2, width: fs, height: fs, display: "flex", alignItems: "center", justifyContent: "center", fontSize: fs, lineHeight: 1, opacity: i === 2 ? 1 : 0.22 + i * 0.18, filter: i === 2 ? `drop-shadow(0 6px 10px rgba(0,0,0,0.55)) drop-shadow(0 0 8px ${rgba(OR[500], 0.7)})` : "blur(1.5px)", transform: `rotate(${(-18 + 18 * uu).toFixed(1)}deg)` }}>
              🔥
            </span>
          );
        })}
      {/* ledakan partikel deterministik di pill */}
      {burst > 0 && burst < 1 && (
        <>
          <span style={{ position: "absolute", left: to.x - 40, top: to.y - 40, width: 80, height: 80, borderRadius: 999, background: rgba(OR[500], 0.35 * (1 - burst)), filter: "blur(14px)" }} />
          <span style={{ position: "absolute", left: to.x - (6 + 26 * EASE.out(burst)), top: to.y - (6 + 26 * EASE.out(burst)), width: 2 * (6 + 26 * EASE.out(burst)), height: 2 * (6 + 26 * EASE.out(burst)), borderRadius: 999, border: `2px solid ${rgba(OR[400], 0.9 * (1 - burst))}` }} />
          {Array.from({ length: 10 }, (_, i) => {
            const ang = ((i * 36 + 12) * Math.PI) / 180;
            const dist = 12 + (i % 2 ? 32 : 46) * EASE.out(burst);
            const r = (i % 2 ? 3.2 : 4.4) * (1 - burst * 0.75);
            return <span key={i} style={{ position: "absolute", left: to.x + Math.cos(ang) * dist - r, top: to.y + Math.sin(ang) * dist - r, width: 2 * r, height: 2 * r, borderRadius: 999, background: i % 3 === 0 ? "#fde047" : i % 3 === 1 ? OR[400] : OR[500], opacity: 1 - burst }} />;
          })}
        </>
      )}
    </div>
  );
}

/** lampiran gambar di bubble (grid 240px, rounded-xl ring-zinc-800) — isinya screenshot chat clipper (identitas diburamkan) */
export const CLIP_AR = 0.86;
export function ClipperThumb({ w }: { w: number }) {
  return (
    <div style={{ width: w, height: w * CLIP_AR, borderRadius: 12, overflow: "hidden", boxShadow: `0 0 0 1px ${ZN[800]}` }}>
      <div style={{ width: 300, height: 300 * CLIP_AR, transform: `scale(${w / 300})`, transformOrigin: "0 0" }}>
        <ClipperChat w={300} h={300 * CLIP_AR} />
      </div>
    </div>
  );
}

/**
 * Screenshot chat dari CLIPPER (aplikasi chat umum, tema terang). Nama & foto profil clipper WAJIB tidak terbaca di skala berapa pun:
 * balok abu solid + teks buram di atasnya (tidak bergantung pada skala), foto = lingkaran abu + gradasi buram.
 */
export function ClipperChat({ w, h, tag = false }: { w: number; h: number; tag?: boolean }) {
  const inMsg = (t: string, time: string) => (
    <div style={{ alignSelf: "flex-start", maxWidth: "78%", borderRadius: "4px 12px 12px 12px", background: "#ffffff", padding: "6px 9px 4px", fontSize: 12.5, lineHeight: 1.35, color: "#111827", boxShadow: "0 1px 1px rgba(0,0,0,0.08)" }}>
      {t}
      <span style={{ marginLeft: 8, fontSize: 9.5, color: "#9ca3af", float: "right", marginTop: 5 }}>{time}</span>
    </div>
  );
  const outMsg = (t: string, time: string) => (
    <div style={{ alignSelf: "flex-end", maxWidth: "78%", borderRadius: "12px 4px 12px 12px", background: "#ffe8d6", padding: "6px 9px 4px", fontSize: 12.5, lineHeight: 1.35, color: "#111827", boxShadow: "0 1px 1px rgba(0,0,0,0.08)" }}>
      {t}
      <span style={{ marginLeft: 8, fontSize: 9.5, color: "#9a7b62", float: "right", marginTop: 5 }}>{time} ✓✓</span>
    </div>
  );
  return (
    <div style={{ position: "relative", width: w, height: h, overflow: "hidden", background: "#efeae2", fontFamily: FONT }}>
      {/* pola latar halus */}
      <div style={{ position: "absolute", inset: 0, opacity: 0.35, background: "repeating-linear-gradient(135deg, rgba(0,0,0,0.035) 0 2px, transparent 2px 14px)" }} />
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 9, height: 46, padding: "0 10px", background: "#f7f7f8", borderBottom: "1px solid #e5e7eb" }}>
        <span style={{ fontSize: 16, color: "#374151" }}>←</span>
        {/* foto profil clipper — lingkaran abu + warna buram (tak ada piksel asli) */}
        <span style={{ position: "relative", width: 30, height: 30, borderRadius: 999, overflow: "hidden", flex: "none", background: "#c9ccd2" }}>
          <span style={{ position: "absolute", inset: -4, filter: "blur(6px)", background: "linear-gradient(135deg, #e0a35a 0%, #b07a4a 55%, #8d6a55 100%)", opacity: 0.8 }} />
        </span>
        <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          {/* nama clipper — balok abu solid + teks buram */}
          <span style={{ position: "relative", display: "block", width: 112, height: 12, borderRadius: 4, background: "#cfd3d9", overflow: "hidden" }}>
            <span style={{ position: "absolute", left: 4, top: -2, filter: "blur(5px)", opacity: 0.45, fontSize: 13, fontWeight: 700, color: "#111827", whiteSpace: "nowrap" }}>Rizky Clipper Official</span>
          </span>
          <span style={{ fontSize: 10, color: "#16a34a" }}>online</span>
        </span>
        {tag && (
          <span style={{ marginLeft: "auto", borderRadius: 6, background: "rgba(0,0,0,0.72)", padding: "3px 7px", fontSize: 9.5, fontWeight: 700, color: "#fff", whiteSpace: "nowrap" }}>🔒 disamarkan</span>
        )}
      </div>
      <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 7, padding: "12px 10px" }}>
        <div style={{ alignSelf: "center", borderRadius: 6, background: "#ffffffcc", padding: "2px 8px", fontSize: 9.5, color: "#6b7280" }}>Hari ini</div>
        {inMsg("Kak, video aku kok ditolak ya? 🙏", "09.38")}
        {inMsg("Padahal udah sesuai brief 😭", "09.38")}
        {outMsg("Halo kak, kami cek ke tim review dulu ya", "09.40")}
      </div>
    </div>
  );
}

function Bubble({ m, s, w, seen }: { m: ChatMsg; s: number; w: number; seen: number }) {
  const mine = !!m.me;
  // pegas mulai 2 frame sebelum SFX (w 34): frame pukulan ≈100%, puncak overshoot +1 frame
  const p = sp(s, m.at - PRE2, 1, 0.42, 34);
  const reacted = m.who === "Irsyad" && m.at > 0;
  const pulse = !mine && m.at > 0 && s >= m.at - PRE ? pr(s, m.at - PRE, m.at + 0.55, EASE.out) : 0;
  const s0 = m.img ? 0.72 : 0.82;
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        flexDirection: mine ? "row-reverse" : "row",
        marginTop: 12,
        opacity: clamp01(p * 3),
        transform: `translateY(${((1 - p) * 16).toFixed(1)}px) scale(${(s0 + (1 - s0) * p).toFixed(4)})`,
        transformOrigin: mine ? "100% 100%" : "0 100%",
      }}
    >
      <UAvatar name={m.who} me={mine} size={28} pulse={pulse} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start", maxWidth: w * 0.78 }}>
        <span style={{ marginBottom: 4, fontSize: 11, color: ZN[500], whiteSpace: "nowrap" }}>
          {mine ? "Kamu" : m.who} · {m.time}
          {mine && seen > 0 ? <span style={{ color: SKY400 }}> · Dilihat {seen}</span> : null}
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: mine ? "flex-end" : "flex-start" }}>
          {m.img && <ClipperThumb w={226} />}
          <div
            style={{
              position: "relative",
              overflow: "hidden",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              borderRadius: mine ? "16px 6px 16px 16px" : "6px 16px 16px 16px",
              fontSize: 13.5,
              lineHeight: 1.625,
              padding: "8px 14px",
              background: mine ? BTN_GRAD : rgba(ZN[800], 0.7),
              color: mine ? "#fff" : ZN[100],
              boxShadow: mine ? SHADOW_PRIMARY : undefined,
            }}
          >
            <Body text={m.text} mine={mine} />
            {mine && <Shine p={pr(s, m.at + 0.12, m.at + 0.75)} alpha={0.4} />}
          </div>
        </div>
        {reacted && <ReactionZone s={s} />}
      </div>
    </div>
  );
}

/** tinggi perkiraan tiap pesan (CSS px) untuk animasi ruang tumbuh (thread auto-gulir ke bawah seperti aslinya) */
function msgH(m: ChatMsg) {
  return 12 + 17 + 16 + m.lines * 22 + (m.img ? 226 * CLIP_AR + 6 : 0);
}

/** room "Tim CS": header (ChatPage), thread (ChatThread), composer — `w`×`h` CSS px */
export function ChatPanel({ s, w, h }: { s: number; w: number; h: number }) {
  const online = 3 + (s >= 1.2 - PRE ? 1 : 0) + (s >= 2.1 - PRE ? 1 : 0);
  const onlineFlash = Math.max(s >= 1.2 - PRE ? 1 - pr(s, 1.2 - PRE, 1.7) : 0, s >= 2.1 - PRE ? 1 - pr(s, 2.1 - PRE, 2.6) : 0);
  const onlineBump = 1 + 0.12 * Math.max(s >= 1.2 - PRE ? Math.max(0, 1 - (s - 1.2 + PRE) / 0.25) : 0, s >= 2.1 - PRE ? Math.max(0, 1 - (s - 2.1 + PRE) / 0.25) : 0);
  const onlineStyle: CSSProperties = { display: "inline-block", color: EM[500], transform: `scale(${onlineBump.toFixed(3)})`, transformOrigin: "0 60%", textShadow: onlineFlash > 0 ? `0 0 ${(14 * onlineFlash).toFixed(1)}px ${rgba(EM[400], 0.95)}` : undefined };
  // "Dilihat N" di pesan sendiri bertambah real-time
  const seen = s < 0.9 ? 0 : s < 1.2 ? 1 : s < 2.1 ? 2 : s < 3.0 ? 3 : 4;
  const tw = w - 24;
  return (
    <div style={{ position: "relative", width: w, height: h, display: "flex", flexDirection: "column", overflow: "hidden", borderRadius: 22, border: `1px solid ${rgba(ZN[800], 0.9)}`, background: ZN[900], boxShadow: `${SHADOW_POP}, 0 40px 90px -30px rgba(0,0,0,0.85)` }}>
      {/* header room */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 12px", borderBottom: `1px solid ${rgba(ZN[800], 0.8)}`, flex: "none" }}>
        <span style={{ color: ZN[400], fontSize: 16 }}>←</span>
        <span style={{ display: "flex", width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 999, background: rgba(OR[500], 0.1), fontSize: 14, fontWeight: 700, color: OR[400] }}>#</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Tim CS</div>
          <div style={{ fontSize: 12, color: ZN[500] }}>
            5 anggota · <span style={onlineStyle}>{online} online</span>
          </div>
        </div>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap", borderRadius: 999, border: `1px solid ${ZN[800]}`, padding: "4px 12px 4px 12px", fontSize: 12.5, fontWeight: 600 }}>
          <span>
            5 · <span style={onlineStyle}>{online} online</span> ▾
          </span>
        </span>
      </div>
      {/* thread: anchor bawah saat penuh (auto-gulir), ruang tiap pesan tumbuh dulu baru bubble pop */}
      <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "flex-end", overflow: "hidden" }}>
        <div style={{ minHeight: "100%", padding: "4px 12px 16px", flex: "none" }}>
          <div style={{ margin: "12px 0", display: "flex", alignItems: "center", gap: 12, fontSize: 11, fontWeight: 600, color: ZN[500] }}>
            <span style={{ height: 1, flex: 1, background: ZN[800] }} />
            Hari ini
            <span style={{ height: 1, flex: 1, background: ZN[800] }} />
          </div>
          {CHAT.map((m, i) => {
            // ruang pesan tumbuh BERSAMA pegas bubble (bukan lebih dulu) → tidak ada celah kosong; bubble naik dari balik composer
            const g = m.at < 0 ? 1 : m.img ? spc(s, m.at - PRE2, 34) : spc(s, m.at - 3 / 30, 30);
            if (g <= 0) return null;
            return (
              <div key={i} style={{ maxHeight: g > 0.999 ? undefined : (msgH(m) + 30) * g, overflow: "visible" }}>
                <Bubble m={m} s={s} w={tw} seen={seen} />
              </div>
            );
          })}
        </div>
      </div>
      {/* composer (HP): 📎 42px, "Tulis pesan…", tombol kirim pesawat kertas */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, padding: "12px 12px", borderTop: `1px solid ${rgba(ZN[800], 0.8)}`, flex: "none", background: ZN[900] }}>
        <span style={{ display: "flex", width: 42, height: 42, flex: "none", alignItems: "center", justifyContent: "center", borderRadius: 12, border: `1px solid ${rgba(ZN[700], 0.8)}`, color: ZN[400] }}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m21.4 11.6-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />
          </svg>
        </span>
        <span style={{ flex: 1, minWidth: 0, height: 42, boxSizing: "border-box", display: "flex", alignItems: "center", borderRadius: 12, border: `1px solid ${rgba(ZN[700], 0.8)}`, background: ZN[950], padding: "0 14px", fontSize: 14, color: ZN[500] }}>Tulis pesan…</span>
        <span style={{ display: "flex", height: 42, flex: "none", alignItems: "center", justifyContent: "center", borderRadius: 12, padding: "0 16px", backgroundImage: BTN_GRAD, boxShadow: SHADOW_PRIMARY, color: "#fff" }}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z" />
          </svg>
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// MUSIK
// ---------------------------------------------------------------------------------------------
export const PRESETS = [
  { icon: "🎹", name: "Piano klasik santai", desc: "Piano solo lembut, tenang" },
  { icon: "🎻", name: "String quartet", desc: "Biola & cello hangat" },
  { icon: "🧠", name: "Fokus kerja", desc: "Ambient klasik minim drum" },
  { icon: "🎸", name: "Gitar akustik", desc: "Petikan gitar akustik hangat" },
  { icon: "🪕", name: "Gitar klasik (nylon)", desc: "Gitar klasik lembut, ala Spanyol" },
  { icon: "☕", name: "Lo-fi klasik", desc: "Klasik + beat santai" },
] as const;
/** preset yang diputar ("🧠 Fokus kerja" — cocok buat kerja CS); di teaser batang EQ dikunci ke ketukan trailer 100 BPM */
export const PLAY_IDX = 2;
/** bpm preset "Fokus kerja" (MusicButton PRESETS focus.bpm) — slider Tempo menampilkan bpm preset aktif */
const PLAY_BPM = 72;

/** equalizer emerald ala MusicCmdCard — tiap batang memantul di ketukan 0,6 dtk (100 BPM) */
export function EqBars({ s, on, h = 16, n = 4, bw = 3, gap = 2, color = EM[500] }: { s: number; on: number; h?: number; n?: number; bw?: number; gap?: number; color?: string }) {
  const base = [0.9, 0.55, 1, 0.7, 0.8, 0.6, 0.95];
  return (
    <span style={{ display: "flex", height: h, alignItems: "flex-end", gap }}>
      {Array.from({ length: n }, (_, i) => {
        const per = i % 2 ? 0.6 : 0.3; // ketukan & setengah ketukan
        const ph = (((s - i * 0.045) % per) + per) % per / per;
        const hit = Math.pow(1 - ph, 2.2); // puncak tepat di ketukan, turun cepat
        const k = 0.25 + 0.75 * (on * (0.35 + 0.65 * hit));
        return <span key={i} style={{ width: bw, height: `${(base[i % base.length] * 100).toFixed(0)}%`, borderRadius: 999, background: color, transform: `scaleY(${k.toFixed(3)})`, transformOrigin: "bottom" }} />;
      })}
    </span>
  );
}

/** header aplikasi versi HP (app/(app)/layout.tsx): baris 1 = logo + akun, baris 2 = Nav — lebar 390 CSS px */
export function PhoneHeader({ s, playing, press }: { s: number; playing: number; press: number }) {
  return (
    <div style={{ width: 390, boxSizing: "border-box", borderBottom: `1px solid ${rgba(ZN[800], 0.7)}`, background: rgba(ZN[950], 0.75), padding: "10px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <KLogo size={30} />
          <span style={{ lineHeight: 1.25 }}>
            <span style={{ display: "block", fontFamily: DISPLAY, fontSize: 15, fontWeight: 700 }}>CS Tracker</span>
            <span style={{ display: "block", fontSize: 11, fontWeight: 500, color: ZN[500] }}>Konten.com</span>
          </span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ display: "flex", borderRadius: 999, border: `1px solid ${rgba(ZN[800], 0.8)}`, background: ZN[900], padding: 4 }}>
            <UAvatar name="Alif" size={28} />
          </span>
          <span style={{ display: "flex", width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 999, border: `1px solid ${rgba(ZN[700], 0.8)}`, background: ZN[900], fontSize: 14 }}>🌙</span>
          <span style={{ borderRadius: 999, border: `1px solid ${rgba(ZN[700], 0.8)}`, background: ZN[900], padding: "6px 10px", fontSize: 12, fontWeight: 600, color: ZN[200] }}>Keluar</span>
        </span>
      </div>
      <MobileNav s={s} playing={playing} press={press} />
    </div>
  );
}

/** nav HP (components/Nav.tsx, sm:hidden): ikon + label kecil, tombol 🎵 paling kanan */
export function MobileNav({ s, playing, press }: { s: number; playing: number; press: number }) {
  const links: [string, string, boolean?][] = [
    ["🏠", "Home"],
    ["➕", "Issue"],
    ["🎬", "Video"],
    ["📝", "Saran"],
    ["💬", "Chat", true],
    ["✨", "AI"],
  ];
  // animate-pulse (opacity 1 ↔ 0,5) dikunci ke ketukan 100 BPM
  const pulse = playing > 0 ? 0.75 + 0.25 * Math.cos(((s % 0.6) / 0.6) * Math.PI * 2) : 1;
  return (
    <div style={{ display: "grid", gridAutoFlow: "column", gridAutoColumns: "1fr", gap: 2, width: "100%", borderRadius: 16, border: `1px solid ${rgba(ZN[800], 0.8)}`, background: ZN[900], padding: 4, boxShadow: "0 1px 2px rgba(0,0,0,0.4)" }}>
      {links.map(([ic, l, active]) => (
        <span key={l} style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, borderRadius: 12, padding: "4px 2px", background: active ? ZN[800] : "transparent", color: active ? "#fafafa" : ZN[400], boxShadow: active ? SHADOW_POP : undefined }}>
          <span style={{ fontSize: 16, lineHeight: 1 }}>{ic}</span>
          <span style={{ fontSize: 10, fontWeight: 600, lineHeight: 1.25 }}>{l}</span>
          {l === "Video" && <span style={{ position: "absolute", right: 2, top: 0, display: "flex", height: 16, minWidth: 16, alignItems: "center", justifyContent: "center", borderRadius: 999, padding: "0 4px", fontSize: 10, fontWeight: 700, color: "#fff", background: "#ef4444", boxShadow: `0 0 0 2px ${ZN[900]}` }}>3</span>}
        </span>
      ))}
      <span style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 999, padding: "6px 4px", fontSize: 16, color: playing > 0 ? EM[400] : ZN[400], transform: `scale(${(1 - 0.18 * press).toFixed(3)})`, background: press > 0 ? rgba(ZN[700], 0.6 * press) : "transparent" }}>
          {/* 🎵 Noto/Apple berwarna gelap → kilau emerald tipis (text-emerald-400 saat memutar) supaya terbaca di latar gelap */}
          <Emo c="🎵" style={{ opacity: playing > 0 ? pulse : 1, filter: `drop-shadow(0 0 ${playing > 0 ? 5 : 3}px ${playing > 0 ? rgba(EM[400], 0.9) : "rgba(255,255,255,0.55)"})` }} />
        </span>
      </span>
    </div>
  );
}

/** isi halaman Dashboard di balik popover (dibuat buram sebagai lapisan belakang / depth of field) */
export function PageGhost() {
  const card = (c: string, k: string, v: string) => (
    <div style={{ borderRadius: 16, border: `1px solid ${ZN[800]}`, background: ZN[900], padding: 12 }}>
      <div style={{ fontSize: 11, color: ZN[500] }}>{k}</div>
      <div style={{ marginTop: 4, fontSize: 22, fontWeight: 800, color: c }}>{v}</div>
    </div>
  );
  return (
    <div style={{ width: 390, padding: "18px 16px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontFamily: DISPLAY, fontSize: 22, fontWeight: 800 }}>Dashboard</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {card("#fca5a5", "Hot issue", "12")}
        {card("#fdba74", "Issue baru", "37")}
        {card("#7dd3fc", "Video review", "18")}
        {card("#6ee7b7", "Selesai", "128")}
      </div>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, borderRadius: 14, border: `1px solid ${ZN[800]}`, background: ZN[900], padding: 12 }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, background: i === 0 ? "#ef4444" : ZN[800] }} />
          <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ height: 8, width: `${70 - i * 8}%`, borderRadius: 4, background: ZN[600] }} />
            <span style={{ height: 6, width: `${45 + i * 5}%`, borderRadius: 4, background: ZN[700] }} />
          </span>
        </div>
      ))}
    </div>
  );
}

/** popover "🎵 Musik" (components/MusicButton.tsx, w-[300px]) dalam keadaan memutar */
export function MusicPopover({ s, playAt }: { s: number; playAt: number }) {
  const on = s >= playAt - PRE ? 1 : 0;
  const rowP = sp(s, playAt - PRE, 1, 0.45, 26);
  return (
    <div style={{ width: 300, borderRadius: 16, border: `1px solid ${ZN[800]}`, background: ZN[900], padding: 12, textAlign: "left", boxShadow: `${SHADOW_POP}, 0 20px 40px -16px rgba(0,0,0,0.6)` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <b style={{ fontSize: 14 }}>
          <Emo c="🎵" style={{ filter: "drop-shadow(0 0 2px rgba(255,255,255,0.6))" }} /> Musik
        </b>
        <div style={{ marginLeft: "auto", display: "flex", borderRadius: 999, background: ZN[800], padding: 2, fontSize: 12, fontWeight: 600 }}>
          <span style={{ borderRadius: 999, padding: "4px 10px", background: EM[600], color: "#fff" }}>✨ Musik AI</span>
          <span style={{ borderRadius: 999, padding: "4px 10px", color: ZN[400] }}>▶ YouTube</span>
        </div>
      </div>
      <p style={{ margin: "4px 0 0", fontSize: 11, color: ZN[500] }}>Instrumental dibuat AI langsung, tanpa jeda</p>
      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
        {PRESETS.map((p, i) => {
          const sel = i === PLAY_IDX;
          return (
            <div
              key={p.name}
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                gap: 10,
                borderRadius: 12,
                padding: "8px 10px",
                background: sel ? rgba(EM[500], 0.1 * (0.4 + 0.6 * on)) : "transparent",
                boxShadow: sel ? `0 0 0 1px ${rgba(EM[500], 0.4)}${on ? `, 0 0 ${(rowP * (12 + 14 * Math.pow(1 - ((((s - playAt) % 0.6) + 0.6) % 0.6) / 0.6, 2))).toFixed(1)}px -4px ${rgba(EM[500], 0.6)}` : ""}` : undefined,
              }}
            >
              <span style={{ fontSize: 18 }}>{p.icon}</span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: ZN[200] }}>{p.name}</span>
                <span style={{ display: "block", fontSize: 11, color: ZN[500] }}>{p.desc}</span>
              </span>
              {sel && on > 0 && (
                <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, transform: `scale(${(0.5 + 0.5 * rowP).toFixed(3)})`, transformOrigin: "100% 50%" }}>
                  <EqBars s={s - playAt} on={1} h={18} n={5} bw={3.5} gap={2.5} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: EM[400], whiteSpace: "nowrap" }}>▶ diputar</span>
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 10, borderRadius: 12, border: `1px solid ${ZN[800]}`, padding: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: ZN[500] }}>✍️ Setir sendiri</div>
        <div style={{ marginTop: 4, borderRadius: 12, border: `1px solid ${rgba(ZN[700], 0.8)}`, background: ZN[950], padding: "6px 12px", fontSize: 12.5, lineHeight: 1.4, color: ZN[500], height: 48, boxSizing: "border-box", overflow: "hidden" }}>mis. gitar akustik hujan sore, lembut · gamelan modern santai · epic orchestral</div>
        <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
          {/* textarea kosong → tombol nonaktif (opacity 50); saat musik jalan labelnya "Terapkan" */}
          <span style={{ borderRadius: 8, background: EM[600], padding: "4px 10px", fontSize: 12, fontWeight: 700, color: "#fff", opacity: 0.5 }}>{on ? "Terapkan" : "▶ Putar ini"}</span>
        </div>
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: ZN[500] }}>
          <span style={{ width: 66, flex: "none" }}>Tempo {PLAY_BPM}</span>
          <span style={{ position: "relative", flex: 1, height: 4, borderRadius: 4, background: ZN[700] }}>
            <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${PLAY_BPM - 60}%`, borderRadius: 4, background: EM[500] }} />
            <span style={{ position: "absolute", left: `${PLAY_BPM - 60}%`, top: -5, width: 14, height: 14, marginLeft: -7, borderRadius: 999, background: EM[500] }} />
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4, flex: "none" }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, border: `1px solid ${ZN[600]}` }} /> tanpa drum
          </span>
        </div>
        <p style={{ margin: "4px 0 0", fontSize: 10.5, lineHeight: 1.35, color: ZN[500] }}>Bahasa Indonesia boleh, bahasa Inggris biasanya lebih pas. Instrumental saja (tanpa vokal).</p>
      </div>
      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
        {on ? (
          <span style={{ borderRadius: 12, background: ZN[800], padding: "6px 12px", fontSize: 12.5, fontWeight: 700, color: ZN[100] }}><Emo c="⏸" /> Jeda</span>
        ) : (
          <span style={{ borderRadius: 12, background: EM[600], padding: "6px 12px", fontSize: 12.5, fontWeight: 700, color: "#fff" }}>▶ Putar</span>
        )}
        {on > 0 && <span style={{ borderRadius: 12, border: `1px solid ${ZN[800]}`, padding: "6px 12px", fontSize: 12.5, fontWeight: 700, color: ZN[300] }}><Emo c="⏹" /> Stop</span>}
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: ZN[500] }}>
          🔈
          <span style={{ position: "relative", width: 80, height: 4, borderRadius: 4, background: ZN[700] }}>
            <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "70%", borderRadius: 4, background: EM[500] }} />
            <span style={{ position: "absolute", left: "70%", top: -5, width: 14, height: 14, marginLeft: -7, borderRadius: 999, background: EM[500] }} />
          </span>
        </span>
      </div>
      <p style={{ margin: "8px 0 0", fontSize: 10.5, lineHeight: 1.35, color: ZN[500] }}>Instrumental dari Google Lyria (eksperimental). Musik tetap jalan saat pindah halaman.</p>
    </div>
  );
}

/** ☄️ meteor lewat saat musik menyala (components/Meteors.tsx + .meteor di globals.css), digerakkan per frame */
export function MeteorsFx({ s, from, W, H }: { s: number; from: number; W: number; H: number }) {
  const M = [
    { l: 0.72, t: -0.04, at: 0.05, len: 180 },
    { l: 1.04, t: 0.08, at: 0.35, len: 150 },
    { l: 0.9, t: 0.02, at: 0.75, len: 210 },
    { l: 1.1, t: 0.3, at: 1.05, len: 140 },
    { l: 0.62, t: -0.02, at: 1.5, len: 200 },
    { l: 1.0, t: 0.18, at: 2.0, len: 160 },
    { l: 0.85, t: 0.05, at: 2.6, len: 190 },
    { l: 1.08, t: 0.4, at: 3.1, len: 150 },
  ];
  const vmax = Math.max(W, H) / 100;
  const k = 2.2; // skala kanvas 1080p (meteor web 3px di layar HP)
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      {M.map((m, i) => {
        const p = (s - from - m.at) / 0.85;
        if (p <= 0 || p >= 1) return null;
        const op = p < 0.08 ? p / 0.08 : p > 0.8 ? (1 - p) / 0.2 : 1;
        const x = m.l * W - 70 * vmax * p * 0.75;
        const y = m.t * H + 45 * vmax * p * 0.75;
        return (
          <div key={i} style={{ position: "absolute", left: x, top: y, opacity: op }}>
            <span style={{ position: "absolute", left: 0, top: 0, width: 3 * k, height: 3 * k, borderRadius: 99, background: "#fff", boxShadow: `0 0 ${6 * k}px ${2 * k}px rgba(190,220,255,0.9), 0 0 ${14 * k}px ${4 * k}px rgba(120,200,255,0.35)` }} />
            <span style={{ position: "absolute", left: 1.5 * k, top: 1.5 * k - 1, width: m.len * k, height: 1.5 * k, transformOrigin: "0 50%", transform: "rotate(-33deg)", background: "linear-gradient(90deg, rgba(255,255,255,0.85), rgba(150,210,255,0.3) 40%, transparent)" }} />
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// LAPORAN / PPT (components/ai/DeckCard.tsx + lib/deck.ts)
// ---------------------------------------------------------------------------------------------
const DC = { bg: "#0A0A0A", panel: "#101010", panel2: "#141414", border: "#242424", soft: "#CFCFCF", muted: "#8A8A8A", muted2: "#6A6A6A", green: "#2FE34A", greenDark: "#1C5C28", orange: "#FF6A00", orange2: "#FF8A00" };
export const DECK = { title: "Laporan Mingguan CS", label: "Laporan CS", period: "13–19 Okt 2026", n: 6 };
type Kpi = { label: string; value: string; tone?: "green" | "orange" };
export type MiniKind = "cover" | "kpi" | "chart" | "table" | "bullets";

/** 1 slide pratinjau (Mini di DeckCard): lebar 220 CSS px, 16:9, font dasar 9px. `count` 0..1 = angka KPI berjalan */
export function MiniSlide({ kind, i, count = 1 }: { kind: MiniKind; i: number; count?: number }) {
  const n = (v: number, dec = 0) => (v * clamp01(count)).toFixed(dec).replace(".", ",");
  const kpis: Kpi[] = [
    { label: "Hot issue selesai", value: n(128), tone: "green" },
    { label: "Video direview", value: n(342), tone: "orange" },
  ];
  const bars = [42, 58, 51, 74, 66, 88, 80];
  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", width: 220, height: 123.75, boxSizing: "border-box", overflow: "hidden", borderRadius: 8, padding: 11, background: DC.bg, border: `1px solid ${DC.border}`, fontSize: 9, color: "#fff", fontFamily: FONT }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${DC.border}`, paddingBottom: 3 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={KONTEN_REPORT_LOGO} alt="" style={{ height: 9, width: "auto" }} />
        <span style={{ color: DC.soft, fontSize: 7, letterSpacing: 1 }}>{DECK.label.toUpperCase()}</span>
      </div>
      {kind === "cover" ? (
        <div style={{ display: "flex", flex: 1, flexDirection: "column", justifyContent: "center", borderLeft: `3px solid ${DC.green}`, paddingLeft: 8.8 }}>
          <b style={{ fontSize: 16, lineHeight: 1.1 }}>{DECK.title}</b>
          <span style={{ color: DC.soft, fontSize: 9 }}>Hot issue, video review & chat tim</span>
          <span style={{ color: DC.green, fontSize: 8 }}>{DECK.period}</span>
        </div>
      ) : (
        <div style={{ marginTop: 5, display: "flex", minHeight: 0, flex: 1, flexDirection: "column", gap: 5 }}>
          <b style={{ fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{kind === "kpi" ? "Ringkasan minggu ini" : kind === "chart" ? "Hot issue per hari" : kind === "table" ? "Top kategori issue" : "Catatan tim"}</b>
          <div style={{ display: "flex", minHeight: 0, flex: 1, gap: 6 }}>
            {(kind === "kpi" || kind === "chart") && (
              <div style={{ display: "grid", gap: 3, width: "30%", gridTemplateColumns: "1fr", alignContent: "start" }}>
                {kpis.map((k) => (
                  <div key={k.label} style={{ borderRadius: 4, padding: "2px 5px", background: k.tone === "orange" ? DC.orange : DC.panel, border: `1px solid ${k.tone === "green" ? DC.greenDark : k.tone === "orange" ? DC.orange : DC.border}` }}>
                    <div style={{ fontSize: 6, lineHeight: 1.15, color: k.tone === "orange" ? "#fff" : DC.muted, whiteSpace: "nowrap", overflow: "hidden" }}>{k.label}</div>
                    <div style={{ fontSize: 10.5, lineHeight: 1.15, fontWeight: 700, color: k.tone === "orange" ? "#fff" : k.tone === "green" ? DC.green : "#fff", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{k.value}</div>
                  </div>
                ))}
              </div>
            )}
            {(kind === "kpi" || kind === "chart") && (
              <div style={{ display: "flex", flex: 1, alignItems: "flex-end", gap: 3, borderRadius: 4, padding: 6, background: DC.panel, border: `1px solid ${DC.border}` }}>
                {bars.map((v, j) => (
                  <div key={j} style={{ display: "flex", height: "100%", flex: 1, alignItems: "flex-end" }}>
                    <div style={{ flex: 1, height: `${Math.max(2, (v / 88) * 100 * clamp01(count * 1.15 - j * 0.04))}%`, borderRadius: "1px 1px 0 0", background: DC.green }} />
                  </div>
                ))}
              </div>
            )}
            {kind === "table" && (
              <div style={{ flex: 1, overflow: "hidden", borderRadius: 4, border: `1px solid ${DC.border}`, fontSize: 6.5 }}>
                {[
                  ["Kategori", "Issue", "Selesai"],
                  ["Saldo / payout", "41", "39"],
                  ["Video ditolak", "33", "30"],
                  ["Banding", "22", "22"],
                  ["Akun", "17", "15"],
                ].map((r, ri) => (
                  <div key={ri} style={{ display: "flex", background: ri === 0 ? DC.panel2 : ri % 2 ? DC.bg : DC.panel, color: ri === 0 ? DC.muted : DC.soft }}>
                    {r.map((c, ci) => (
                      <span key={ci} style={{ flex: 1, padding: "1.5px 3px", whiteSpace: "nowrap", overflow: "hidden" }}>
                        {c}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            )}
            {kind === "bullets" && (
              <div style={{ flex: 1, color: DC.soft, fontSize: 7.5, display: "flex", flexDirection: "column", gap: 2 }}>
                {["Respon makin cepat (−2 mnt)", "Banding selesai 100%", "Fokus minggu depan: payout"].map((b) => (
                  <span key={b}>• {b}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 2.2, fontSize: 6, color: DC.muted2 }}>
        <span>{kind === "cover" ? DECK.period : "Sumber: CS Tracker · Laporan/minggu-42.xlsx"}</span>
        <span>
          {i + 1} / {DECK.n}
        </span>
      </div>
    </div>
  );
}

/**
 * halaman dibalik 3D (engsel kiri): halaman depan (`front`) terangkat dari tepi kanan & berputar, memperlihatkan `back`.
 * `p` 0..1 (0,5 = tegak lurus = puncak suara kertas). Tanpa preserve-3d / backface-visibility / properti CSS `perspective`
 * (web-renderer hanya membaca `transform`): perspective() ada DI DALAM string transform, sisi depan (0–90°) dan sisi
 * belakang kertas (90–180°, melayang di kiri engsel) digambar sebagai dua elemen terpisah.
 */
export function PageFlip({ p, w, h, front, back, radius = 8 }: { p: number; w: number; h: number; front: ReactNode; back: ReactNode; radius?: number }) {
  const th = 180 * clamp01(p);
  const lift = Math.sin(Math.PI * clamp01(p));
  const PERS = 1100;
  const turning = p > 0 && p < 1;
  // tepi bebas halaman (proyeksi kasar, fraksi lebar) → bayangan lengkung menyapu halaman berikut
  const edge = th < 90 ? Math.cos((th * Math.PI) / 180) : 0;
  const e = (edge * 100).toFixed(1);
  const shadeA = (0.6 * lift).toFixed(3);
  const dim = (0.35 * (1 - clamp01(p))).toFixed(3);
  return (
    <div style={{ position: "relative", width: w, height: h }}>
      {/* halaman berikut di bawah: redup + bayangan lengkung tepat di depan tepi halaman yang terangkat */}
      <div style={{ position: "absolute", inset: 0 }}>
        {back}
        {turning && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: radius,
              background:
                th < 90
                  ? `linear-gradient(90deg, rgba(0,0,0,${dim}) 0%, rgba(0,0,0,${dim}) ${e}%, rgba(0,0,0,${shadeA}) ${e}%, rgba(0,0,0,${(0.25 * lift).toFixed(3)}) ${Math.min(100, edge * 100 + 9).toFixed(1)}%, rgba(0,0,0,0) ${Math.min(100, edge * 100 + 34).toFixed(1)}%)`
                  : `linear-gradient(90deg, rgba(0,0,0,${shadeA}) 0%, rgba(0,0,0,${(0.22 * lift).toFixed(3)}) ${(14 * lift + 4).toFixed(1)}%, rgba(0,0,0,0) ${(48 * lift + 8).toFixed(1)}%)`,
            }}
          />
        )}
      </div>
      {/* sisi depan: 0 → 90°, tepi kanan terangkat ke arah penonton */}
      {th < 90 && (
        <div style={{ position: "absolute", inset: 0, transformOrigin: "0 50%", transform: `perspective(${PERS}px) rotateY(${(-th).toFixed(2)}deg) translateZ(${(lift * 18).toFixed(1)}px)`, boxShadow: turning ? `${(-24 * lift).toFixed(1)}px 18px 40px rgba(0,0,0,${(0.55 * lift).toFixed(3)})` : undefined, borderRadius: radius }}>
          {front}
          {turning && <div style={{ position: "absolute", inset: 0, borderRadius: radius, background: `linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,${(0.1 + 0.18 * lift).toFixed(3)}) 62%, rgba(255,255,255,${(0.04 * lift).toFixed(3)}) 80%, rgba(0,0,0,${(0.5 * lift).toFixed(3)}) 100%)` }} />}
        </div>
      )}
      {/* sisi belakang kertas: 90 → 180°, di kiri engsel, terlihat dari dalam (gelap, kilau dekat engsel) */}
      {th >= 90 && turning && (
        <div style={{ position: "absolute", top: 0, left: -w, width: w, height: h, transformOrigin: "100% 50%", transform: `perspective(${PERS}px) rotateY(${(180 - th).toFixed(2)}deg) translateZ(${(lift * 18).toFixed(1)}px)`, borderRadius: radius, overflow: "hidden", border: `1px solid ${DC.border}`, background: "linear-gradient(90deg, #070707 0%, #121212 70%, #1d1d1d 100%)", boxShadow: `${(24 * lift).toFixed(1)}px 18px 40px rgba(0,0,0,${(0.55 * lift).toFixed(3)})` }}>
          {/* tembus pandang halaman (cetakan terbalik samar) */}
          <div style={{ position: "absolute", inset: 0, transform: "scaleX(-1)", opacity: 0.07, filter: "blur(0.6px)" }}>{front}</div>
          <div style={{ position: "absolute", inset: 0, background: `linear-gradient(90deg, rgba(0,0,0,${(0.5 * lift).toFixed(3)}) 0%, rgba(255,255,255,0) 55%, rgba(255,255,255,${(0.14 * lift).toFixed(3)}) 100%)` }} />
        </div>
      )}
    </div>
  );
}

/** kartu PPT (.ai-card navy) — pratinjau slide besar (dibalik), deretan Mini 220px, tombol unduh / simpan */
export function DeckCardView({ s, flipAt, pressAt, shineAt }: { s: number; flipAt: number; pressAt: number; shineAt: number }) {
  // balik 0,65 dtk: makin cepat menuju ketukan (ease-in), tegak lurus ½ frame setelah flipAt (frame SFX = ±83°), lalu mendarat pelan (ease-out)
  const mid = flipAt + 1 / 60;
  const qa = pr(s, flipAt - 0.3, mid, (x) => x);
  const qb = pr(s, mid, flipAt + 0.35, (x) => x);
  // kuadrat masuk/keluar: kecepatan kontinu & maksimum tepat di ketukan
  const fp = s < mid ? 0.5 * qa * qa : 0.5 + 0.5 * (1 - (1 - qb) * (1 - qb));
  // angka KPI sudah berjalan (±30%) di frame SFX, bukan 0
  const count = pr(s, flipAt - 0.1, flipAt + 0.8, EASE.out);
  const press = s >= pressAt - 0.08 ? Math.max(0, 1 - Math.abs(s - pressAt) / 0.12) : 0;
  const bigW = 372;
  const bigS = bigW / 220;
  const big = (kind: MiniKind, i: number, c = 1) => (
    <div style={{ width: bigW, height: bigW * 0.5625, overflow: "hidden", borderRadius: 8 * bigS }}>
      <div style={{ transform: `scale(${bigS})`, transformOrigin: "0 0" }}>
        <MiniSlide kind={kind} i={i} count={c} />
      </div>
    </div>
  );
  const thumbs: MiniKind[] = ["cover", "kpi", "chart", "table", "bullets"];
  const active = s >= flipAt ? 1 : 0;
  return (
    <div style={{ width: 400, borderRadius: 18, border: "1px solid #1e293b", background: "#0b1220", color: "#e5e7eb", boxShadow: "0 18px 40px -26px rgba(15,23,42,0.9), 0 40px 90px -30px rgba(0,0,0,0.8)" }}>
      <div style={{ padding: "13px 14px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 13 }}>
          <b>📊 {DECK.title}</b>
          <span style={{ fontSize: 11.5, color: ZN[500] }}>
            {DECK.n} slide · gaya laporan Konten.com · {DECK.period}
          </span>
        </div>
        <div style={{ position: "relative", marginTop: 12 }}>
          <PageFlip p={fp} w={bigW} h={bigW * 0.5625} radius={8 * bigS} front={big("cover", 0)} back={big("kpi", 1, count)} />
          <Shine p={pr(s, flipAt + 0.08, flipAt + 0.62)} alpha={0.22} radius={8 * bigS} />
        </div>
        <div style={{ marginTop: 8, display: "flex", gap: 8, overflow: "hidden", paddingBottom: 4 }}>
          {thumbs.map((k, i) => (
            <div key={k} style={{ flex: "none", width: 110, height: 61.9, overflow: "hidden", borderRadius: 6, boxShadow: i === active ? `0 0 0 2px ${OR[500]}` : undefined }}>
              <div style={{ transform: "scale(0.5)", transformOrigin: "0 0" }}>
                <MiniSlide kind={k} i={i} />
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <span style={{ position: "relative", overflow: "hidden", borderRadius: 8, background: OR[500], padding: "6px 14px", fontSize: 12.5, fontWeight: 700, color: "#fff", boxShadow: `0 0 ${(24 * pr(s, shineAt, shineAt + 0.3) * (1 - pr(s, shineAt + 0.5, shineAt + 1))).toFixed(1)}px ${rgba(OR[500], 0.8)}` }}>
            ⬇ Unduh PowerPoint
            <Shine p={pr(s, shineAt, shineAt + 0.5)} alpha={0.55} />
          </span>
          <span style={{ borderRadius: 8, border: `1px solid ${press > 0 ? ZN[500] : ZN[700]}`, padding: "6px 12px", fontSize: 12.5, fontWeight: 700, color: ZN[300], transform: `scale(${(1 - 0.07 * press).toFixed(3)})`, background: press > 0 ? rgba(ZN[700], 0.4 * press) : "transparent" }}>{s >= pressAt && s < pressAt + 0.22 ? "Menyimpan…" : "💾 Simpan ke folder CS/Laporan"}</span>
          {s >= pressAt + 0.22 && (
            <span style={{ flexBasis: "100%", fontSize: 12, fontWeight: 600, color: EM[400], wordBreak: "break-word", opacity: pr(s, pressAt + 0.22, pressAt + 0.36), transform: `translateX(${((1 - spc(s, pressAt + 0.22, 20)) * -10).toFixed(1)}px)` }}>✓ Tersimpan di folder CS/Laporan/Laporan-Mingguan-CS.pptx</span>
          )}
        </div>
        <p style={{ margin: "6px 0 0", fontSize: 11, lineHeight: 1.4, color: ZN[500] }}>Angka diambil dari file di folder (lihat “Sumber” di tiap slide) — cek sekali lagi sebelum dikirim.</p>
      </div>
    </div>
  );
}
