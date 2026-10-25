"use client";

/** Layar hasil karya: desain berita gaya TWS, laporan/PPT yang dibalik, landing page brand, dan foto/klip user. */
import { Video } from "@remotion/media";
import type { CSSProperties, ReactNode } from "react";
import { Easing, Img } from "remotion";
import { storagePathOf } from "@/lib/studio/urls";
import {
  Btn,
  Caret,
  DISPLAY,
  HeroAvatar,
  HelperChip,
  KLogo,
  LineChart,
  Rich,
  Shell,
  TIGHT,
  TapAt,
  TwsLogo,
  Z,
  bt,
  card,
  clamp01,
  en,
  fill,
  fmtNum,
  fontOf,
  lumOf,
  mixHex,
  parseFigure,
  plain,
  pop,
  ramp,
  rgba,
  splitStat,
  useSid,
  type Clock,
  type Env,
} from "./ui";

const HERO = "Harley";
/** jam yang sudah lewat semua animasi (untuk gambar mini / thumbnail) */
const settled = (t: Clock): Clock => ({ ...t, f: 99999 });

/** baris obrolan AI: chibi + "Kamu dibantu oleh …" + teks yang diketik */
function AiLine({ e, at, text, max }: { e: Env; at: number; text: string; max: number }) {
  const { t } = e;
  if (t.f < at) return null;
  const p = pop(t, at, { damping: 14 });
  const n = ((t.f - at - 6) / t.fps) * 44;
  const typing = n > 0 && n < Array.from(plain(text)).length;
  return (
    <div style={{ display: "flex", gap: 10, opacity: clamp01(p * 1.4), transform: `translateY(${(1 - p) * 10}px)` }}>
      <HeroAvatar t={t} hero={HERO} size={32} acc={e.acc} talk={typing} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <HelperChip hero={HERO} max={max - 42} p={p} acc={e.acc} />
        <div style={{ fontSize: 13.5, lineHeight: 1.5, color: Z[200], minHeight: 20 }}>
          <Rich text={text} n={Math.max(0, n)} bold={{ color: "#fdba74" }} />
          {typing && <Caret t={t} typing color={e.acc} h={14} />}
        </div>
      </div>
    </div>
  );
}

/** gelembung pesan user (oranye) */
function UserBubble({ e, at, text, size = 13.5 }: { e: Env; at: number; text: string; size?: number }) {
  const p = pop(e.t, at, { damping: 14 });
  if (e.t.f < at) return null;
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", opacity: clamp01(p * 1.4), transform: `translateY(${(1 - p) * 10}px)` }}>
      <div style={{ maxWidth: "85%", borderRadius: "16px 16px 6px 16px", padding: "8px 14px", fontSize: size, lineHeight: 1.45, color: "#fff", background: e.grad, boxShadow: `0 10px 22px -12px ${rgba(e.acc, 0.8)}` }}>{text}</div>
    </div>
  );
}

/** titik penanda halaman carousel */
function Dots({ n, on, acc }: { n: number; on: number; acc: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", gap: 6 }}>
      {Array.from({ length: n }, (_, i) => {
        const a = clamp01(1 - Math.abs(on - i));
        return <span key={i} style={{ width: 7 + a * 14, height: 7, borderRadius: 99, background: a > 0.5 ? acc : Z[700] }} />;
      })}
    </div>
  );
}

// ================================================================== DESAIN GAYA TWS ==================================================================
const TW = 1080;
const TH = 1350;
type Tone = "gold" | "red" | "green" | "blue";
/** warna angka 3D (sama dengan lib/tws.ts): permukaan logam berlapis, sisi, cahaya */
const TONE3D: Record<Tone, { face: [number, string][]; side: string; glow: string; edge: string }> = {
  gold: { face: [[0, "#fff4c8"], [0.2, "#f2cf6c"], [0.42, "#b98425"], [0.56, "#ffe7a0"], [0.78, "#a46d18"], [1, "#5e3c0b"]], side: "#5a3a0a", glow: "#ffba46", edge: "#fff1c2" },
  red: { face: [[0, "#ffd0cc"], [0.2, "#ff5b52"], [0.42, "#b3141b"], [0.56, "#ff7d72"], [0.78, "#8e0c12"], [1, "#4a0508"]], side: "#4a0609", glow: "#ff2e2e", edge: "#ffc2bc" },
  green: { face: [[0, "#dcffe7"], [0.2, "#5cf08c"], [0.42, "#119a3f"], [0.56, "#8ef9b0"], [0.78, "#0a7029"], [1, "#043a16"]], side: "#053a17", glow: "#2eff78", edge: "#d2ffe0" },
  blue: { face: [[0, "#e4ecff"], [0.2, "#80a6ff"], [0.42, "#2b57e0"], [0.56, "#a9c1ff"], [0.78, "#1c3da4"], [1, "#0b1a4d"]], side: "#0d1d52", glow: "#467dff", edge: "#dce6ff" },
};
const toneOf = (big: string): Tone => (/^\s*[-−▼]/.test(big) ? "red" : /^\s*[+▲]/.test(big) ? "green" : "gold");
const BLUE_EM = "linear-gradient(180deg, #4a7dff 0%, #2a56ea 100%)";
const TWS_TEXT_BLUE = "#3a6bff";

/** angka 3D vektor: lapisan sisi bertumpuk + permukaan gradasi logam + cahaya di belakang */
function Big3D({ text, tone }: { text: string; tone: Tone }) {
  const id = useSid("b3");
  const T = TONE3D[tone];
  const size = Math.round(Math.min(330, 980 / (Math.max(3, Array.from(text).length) * 0.58)));
  const base = 250 + size * 0.36;
  const depth = 16;
  const attrs = { x: TW / 2, textAnchor: "middle" as const, fontFamily: TIGHT, fontWeight: 900, fontSize: size, letterSpacing: -size * 0.04 };
  return (
    <svg width={TW} height={520} viewBox={`0 0 ${TW} 520`} style={{ display: "block", overflow: "visible" }} aria-hidden>
      <defs>
        <linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
          {T.face.map(([o, c]) => (
            <stop key={o} offset={o} stopColor={c} />
          ))}
        </linearGradient>
        <radialGradient id={`${id}g`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={T.glow} stopOpacity="0.55" />
          <stop offset="100%" stopColor={T.glow} stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx={TW / 2} cy={base - size * 0.32} rx={460} ry={size * 0.62} fill={`url(#${id}g)`} />
      <text {...attrs} y={base + depth * 2.2 + 18} fill="#000" opacity="0.55">
        {text}
      </text>
      {Array.from({ length: depth }, (_, i) => depth - i).map((i) => (
        <text key={i} {...attrs} x={TW / 2 + i * 1.1} y={base + i * 2.2} fill={mixHex(T.side, "#000000", (i / depth) * 0.5)}>
          {text}
        </text>
      ))}
      <text {...attrs} y={base} fill={`url(#${id}f)`} stroke={T.edge} strokeOpacity="0.55" strokeWidth="2">
        {text}
      </text>
    </svg>
  );
}

/** latar grafis TWS (cadangan foto): grid, candle naik, garis tren bercahaya yang tergambar */
function TwsGraphic({ t, at, accent = "#2ee86a", h = TH }: { t: Clock; at: number; accent?: string; h?: number }) {
  const id = useSid("tg");
  const p = ramp(t, at, at + 40, 0, 1, Easing.inOut(Easing.cubic));
  const candles = Array.from({ length: 16 }, (_, i) => {
    const x = 70 + i * 62;
    const mid = h * 0.62 - i * (h * 0.018) + Math.sin(i * 1.9) * 40;
    const up = Math.sin(i * 2.3) > -0.45;
    const body = 40 + Math.abs(Math.cos(i * 1.3)) * 70;
    return { x, mid, up, body };
  });
  const line = candles.map((c, i) => `${i ? "L" : "M"}${c.x} ${(c.mid - c.body * 0.3).toFixed(1)}`).join(" ");
  return (
    <svg width={TW} height={h} viewBox={`0 0 ${TW} ${h}`} style={{ position: "absolute", inset: 0 }} aria-hidden>
      <defs>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#030712" />
          <stop offset="55%" stopColor="#0a1a3f" />
          <stop offset="100%" stopColor="#020409" />
        </linearGradient>
      </defs>
      <rect width={TW} height={h} fill={`url(#${id}b)`} />
      {Array.from({ length: 12 }, (_, i) => (
        <line key={`h${i}`} x1="0" x2={TW} y1={i * (h / 11)} y2={i * (h / 11)} stroke="#3d6ef7" strokeOpacity="0.12" />
      ))}
      {Array.from({ length: 10 }, (_, i) => (
        <line key={`v${i}`} y1="0" y2={h} x1={i * 120} x2={i * 120} stroke="#3d6ef7" strokeOpacity="0.09" />
      ))}
      {candles.map((c, i) => (
        <g key={i} opacity={0.55 * clamp01(p * 16 - i)}>
          <line x1={c.x} x2={c.x} y1={c.mid - c.body} y2={c.mid + c.body * 0.6} stroke={c.up ? "#22c55e" : "#ef4444"} strokeWidth="3" />
          <rect x={c.x - 14} y={c.mid - c.body * 0.7} width="28" height={c.body} rx="3" fill={c.up ? "#22c55e" : "#ef4444"} />
        </g>
      ))}
      <path d={line} fill="none" stroke={accent} strokeOpacity="0.25" strokeWidth="22" strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - p} />
      <path d={line} fill="none" stroke={accent} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - p} />
    </svg>
  );
}

/** baris judul TWS: kapital tebal, satu baris disorot kotak biru yang menyapu dari kiri */
function TwsTitle({ t, at, lines, hl, size, style, center }: { t: Clock; at: number; lines: string[]; hl: number; size: number; style?: CSSProperties; center?: boolean }) {
  return (
    <div style={{ position: "absolute", margin: 0, fontWeight: 800, fontSize: size, lineHeight: 1.12, letterSpacing: "-0.02em", textTransform: "uppercase", textShadow: "0 2px 18px rgba(0,0,0,0.45)", textAlign: center ? "center" : "left", ...style }}>
      {lines.map((l, i) => {
        const p = pop(t, at + i * 5, { damping: 16, stiffness: 150 });
        const em = i === hl - 1;
        const w = ramp(t, at + 10 + i * 5, at + 20 + i * 5, 0, 1, Easing.out(Easing.cubic));
        return (
          <span key={i} style={{ display: "block", whiteSpace: "nowrap", opacity: clamp01(p * 1.6), transform: `translateY(${(1 - p) * 48}px)` }}>
            {em ? (
              <span style={{ position: "relative", display: "inline-block", padding: "3px 16px 1px", margin: center ? "3px 0" : "3px 0 3px -16px", textShadow: "none" }}>
                <span style={{ position: "absolute", inset: 0, borderRadius: 5, background: BLUE_EM, boxShadow: "0 10px 28px rgba(42,86,234,0.35)", transform: `scaleX(${w})`, transformOrigin: "0 50%" }} />
                <span style={{ position: "relative" }}>{l}</span>
              </span>
            ) : (
              l
            )}
          </span>
        );
      })}
    </div>
  );
}

const Num = ({ n }: { n: string }) => <div style={{ position: "absolute", right: 64, top: 62, fontSize: 26, fontWeight: 500, color: "#e4e4e7", zIndex: 20 }}>{n}</div>;
const Note = ({ text }: { text: string }) => <div style={{ position: "absolute", left: 56, right: 56, bottom: 36, zIndex: 10, fontSize: 19, color: "#9a9a9a", textAlign: "center" }}>{text}</div>;
const Art = ({ children, bg = "#000" }: { children: ReactNode; bg?: string }) => (
  <div style={{ position: "absolute", left: 0, top: 0, width: TW, height: TH, overflow: "hidden", background: bg, color: "#fff", fontFamily: TIGHT }}>{children}</div>
);

/** pecah judul jadi 2–3 baris (maks ±18 huruf per baris) */
function wrapTitle(s: string, max = 18, rows = 3) {
  const out: string[] = [];
  for (const w of s.trim().split(/\s+/)) {
    const last = out[out.length - 1];
    if (last !== undefined && (last + " " + w).length <= max) out[out.length - 1] = `${last} ${w}`;
    else out.push(w);
  }
  if (out.length <= rows) return out;
  return [...out.slice(0, rows - 1), out.slice(rows - 1).join(" ")];
}

type Tws = { big: string; lines: string[]; kicker: string; text: string; rows: [string, string][]; note: string };

function TwsCover({ t, at, d, src }: { t: Clock; at: number; d: Tws; src: string | null }) {
  const tone = toneOf(d.big);
  const p = pop(t, at + 4, { damping: 12, stiffness: 110 });
  const zoom = 1.1 - 0.1 * ramp(t, at, at + t.fps * 6, 0, 1, Easing.out(Easing.quad));
  const size = Math.max(52, Math.min(80, Math.round(950 / (Math.max(8, ...d.lines.map((l) => l.length)) * 0.6))));
  return (
    <Art>
      <div style={{ position: "absolute", inset: 0, transform: `scale(${zoom})` }}>
        {src ? (
          <>
            <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 28%" }} />
            <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.42)" }} />
          </>
        ) : (
          <TwsGraphic t={t} at={at} accent={tone === "red" ? "#ff2d2d" : "#2ee86a"} />
        )}
      </div>
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0) 24%, rgba(0,0,0,0) 76%, rgba(0,0,0,0.5) 100%)" }} />
      {d.big && (
        <div style={{ position: "absolute", left: 0, top: 60, width: TW, opacity: clamp01(p * 2), transform: `scale(${1.55 - 0.55 * p})`, transformOrigin: "50% 45%", filter: p < 0.98 ? `blur(${(1 - clamp01(p)) * 12}px)` : undefined }}>
          <Big3D text={d.big} tone={tone} />
        </div>
      )}
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0) 15%, rgba(0,0,0,0) 46%, rgba(0,0,0,0.7) 62%, rgba(0,0,0,0.95) 76%, #000 88%)" }} />
      <div style={{ position: "absolute", left: 64, top: 56, zIndex: 20 }}>
        <TwsLogo h={44} />
      </div>
      <Num n="1/4" />
      <TwsTitle t={t} at={at + 14} lines={d.lines} hl={d.lines.length} size={size} style={{ left: 68, right: 52, bottom: 110 }} />
      {d.note && <Note text={d.note} />}
    </Art>
  );
}

function TwsText({ t, at, d }: { t: Clock; at: number; d: Tws }) {
  const n = plain(d.text).length;
  const fs = n <= 40 ? 104 : n <= 60 ? 92 : n <= 90 ? 80 : n <= 130 ? 68 : 58;
  const words = d.text.split(/(\*\*[^*]+\*\*|\s+)/).filter((x) => x && !/^\s+$/.test(x));
  return (
    <Art>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 620, WebkitMaskImage: "linear-gradient(180deg, transparent 0%, #000 38%)", maskImage: "linear-gradient(180deg, transparent 0%, #000 38%)" }}>
        <TwsGraphic t={t} at={at} accent="#3d6ef7" h={620} />
      </div>
      <div style={{ position: "absolute", left: 64, top: 56, zIndex: 20 }}>
        <TwsLogo h={44} />
      </div>
      <Num n="2/4" />
      <div style={{ position: "absolute", left: 64, right: 64, top: 170, zIndex: 5, textAlign: "center" }}>
        <div style={{ fontSize: 28, fontWeight: 400, color: "#e4e4e7", lineHeight: 1.3, opacity: ramp(t, at, at + 10) }}>{d.kicker}</div>
        <div style={{ marginTop: 20, fontSize: fs, fontWeight: 400, lineHeight: 1.1, letterSpacing: "-0.03em" }}>
          {words.map((w, i) => {
            const k = w.startsWith("**");
            const p = pop(t, at + 6 + i * 2.2, { damping: 18 });
            return (
              <span key={i} style={{ display: "inline-block", marginRight: "0.24em", opacity: clamp01(p * 1.5), transform: `translateY(${(1 - p) * 30}px)`, color: k ? TWS_TEXT_BLUE : "#fff", fontWeight: k ? 700 : 400 }}>
                {k ? w.slice(2, -2) : w}
              </span>
            );
          })}
        </div>
        <div style={{ marginTop: 40, textAlign: "left" }}>
          {d.rows.map(([l, v], i) => {
            const p = pop(t, at + 22 + i * 5, { damping: 18 });
            const f = parseFigure(v);
            const dir = /^\s*[-−▼]/.test(v) ? -1 : /^\s*[+▲]/.test(v) ? 1 : 0;
            const shown = f ? `${f.pre}${fmtNum(f.n * ramp(t, at + 22 + i * 5, at + 46 + i * 5, 0, 1, Easing.out(Easing.cubic)), f.dec)}${f.suf}` : v;
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 20, padding: "22px 0", borderTop: "1px solid rgba(255,255,255,0.16)", opacity: clamp01(p * 1.4), transform: `translateX(${(1 - p) * 40}px)` }}>
                <div style={{ flex: 1, fontSize: 34, fontWeight: 600, letterSpacing: "-0.01em" }}>{l}</div>
                <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-0.02em", color: dir < 0 ? "#ff3b3b" : dir > 0 ? "#3ee66b" : "#fff", fontVariantNumeric: "tabular-nums" }}>{shown}</div>
              </div>
            );
          })}
        </div>
      </div>
      {d.note && <Note text={d.note} />}
    </Art>
  );
}

const BARS: [string, string, string][] = [
  ["Indonesia", "5,75%", "+0,25%"],
  ["Filipina", "5,50%", "-0,50%"],
  ["Malaysia", "3,00%", "0,00%"],
  ["Thailand", "1,75%", "-0,25%"],
];
function TwsBars({ t, at }: { t: Clock; at: number }) {
  const id = useSid("tb");
  const nums = BARS.map((b) => Math.abs(parseFloat(b[2].replace(/[^\d,.-]/g, "").replace(",", ".")) || 0));
  const max = Math.max(0.01, ...nums);
  return (
    <Art>
      <svg width={TW} height={TH} style={{ position: "absolute", inset: 0 }} aria-hidden>
        <defs>
          <radialGradient id={id} cx="50%" cy="0%" r="75%">
            <stop offset="0%" stopColor="#0b1a33" />
            <stop offset="100%" stopColor="#000" />
          </radialGradient>
        </defs>
        <rect width={TW} height={TH} fill={`url(#${id})`} />
      </svg>
      <div style={{ position: "absolute", left: 0, right: 0, top: 56, display: "flex", justifyContent: "center", zIndex: 20 }}>
        <TwsLogo h={44} />
      </div>
      <Num n="3/4" />
      <TwsTitle t={t} at={at + 2} lines={["SUKU BUNGA", "NEGARA TETANGGA"]} hl={2} size={66} center style={{ left: 60, right: 60, top: 130 }} />
      <div style={{ position: "absolute", top: 300, left: 0, right: 0, textAlign: "center", fontSize: 26, color: "#d4d4d8", opacity: ramp(t, at + 10, at + 20) }}>Perubahan 2026</div>
      <div style={{ position: "absolute", left: 60, right: 60, top: 380 }}>
        {BARS.map(([l, v, pct], i) => {
          const dir = pct.startsWith("-") ? -1 : pct.startsWith("+") ? 1 : 0;
          const col = dir < 0 ? "#ef4444" : dir > 0 ? "#22c55e" : "#a1a1aa";
          const g = ramp(t, at + 14 + i * 4, at + 34 + i * 4, 0, 1, Easing.out(Easing.back(1.4)));
          const w = Math.max(6, (nums[i] / max) * 360) * g;
          const p = pop(t, at + 10 + i * 4, { damping: 18 });
          return (
            <div key={l} style={{ display: "flex", alignItems: "center", height: 118, borderTop: "1px solid rgba(255,255,255,0.12)", background: i === 0 ? "rgba(61,110,247,0.10)" : undefined, opacity: clamp01(p * 1.4) }}>
              <div style={{ width: 250, paddingLeft: 16 }}>
                <div style={{ fontSize: 34, fontWeight: 800 }}>{l}</div>
                <div style={{ fontSize: 20, color: "#a1a1aa" }}>{v}</div>
              </div>
              <div style={{ flex: 1, position: "relative", height: 44 }}>
                <div style={{ position: "absolute", left: "50%", top: -14, bottom: -14, width: 2, background: "rgba(255,255,255,0.25)" }} />
                <div style={{ position: "absolute", top: 0, height: 44, borderRadius: 8, background: col, boxShadow: `0 0 24px ${rgba(col, 0.4)}`, ...(dir < 0 ? { right: "50%", width: w / 2 } : { left: "50%", width: w / 2 }) }} />
              </div>
              <div style={{ width: 170, textAlign: "right", paddingRight: 16, fontSize: 36, fontWeight: 800, color: dir < 0 ? "#ff3b3b" : dir > 0 ? "#3ee66b" : "#fff" }}>{pct}</div>
            </div>
          );
        })}
      </div>
      <Note text="*Sumber: bank sentral masing-masing" />
    </Art>
  );
}

function TwsCta({ t, at }: { t: Clock; at: number }) {
  const lines = ["IKUTI TERUS", "UPDATE MARKETNYA"];
  const p = pop(t, at + 12, { damping: 12 });
  return (
    <Art bg="linear-gradient(180deg, #000 0%, #000 45%, #0b1a4a 100%)">
      <div style={{ position: "absolute", left: 0, right: 0, top: 56, display: "flex", justifyContent: "center" }}>
        <TwsLogo h={44} />
      </div>
      <div style={{ position: "absolute", left: 60, right: 60, top: 150, textAlign: "center", fontSize: 84, lineHeight: 1.04, fontWeight: 600, letterSpacing: "-0.025em" }}>
        {lines.map((l, i) => (
          <span key={l} style={{ display: "block", whiteSpace: "nowrap", color: i === lines.length - 1 ? TWS_TEXT_BLUE : "#fff", fontWeight: i === lines.length - 1 ? 800 : 600 }}>
            {l}
          </span>
        ))}
      </div>
      <div style={{ position: "absolute", left: 130, right: 130, top: 430, height: 540, borderRadius: 30, overflow: "hidden", border: "2px solid rgba(255,255,255,0.2)", background: "#0b0f1a" }}>
        <div style={{ position: "absolute", left: -130, top: -430 }}>
          <TwsGraphic t={t} at={at} accent="#3d6ef7" />
        </div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 140, textAlign: "center" }}>
        <span style={{ display: "inline-block", whiteSpace: "nowrap", background: BLUE_EM, borderRadius: 6, padding: "10px 28px", fontSize: 44, fontWeight: 800, transform: `scale(${0.8 + 0.2 * p})` }}>FOLLOW BIAR NGGAK KETINGGALAN!</span>
      </div>
    </Art>
  );
}

/** satu slide TWS (kanvas asli 1080×1350) diskalakan ke lebar w */
function TwsSlide({ i, w, t, at, d, src }: { i: number; w: number; t: Clock; at: number; d: Tws; src: string | null }) {
  const s = w / TW;
  return (
    <div style={{ position: "relative", width: w, height: TH * s, flex: "none", overflow: "hidden", borderRadius: 10, background: "#000" }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: TW, height: TH, transform: `scale(${s})`, transformOrigin: "0 0" }}>
        {i === 0 ? <TwsCover t={t} at={at} d={d} src={src} /> : i === 1 ? <TwsText t={t} at={at} d={d} /> : i === 2 ? <TwsBars t={t} at={at} /> : <TwsCta t={t} at={at} />}
      </div>
    </div>
  );
}

/** carousel geser: slide aktif & tetangganya saja yang digambar */
function Carousel({ e, w, at, cuts, d }: { e: Env; w: number; at: number[]; cuts: number[]; d: Tws }) {
  const { t } = e;
  const pos = cuts.reduce((a, c) => a + pop(t, c, { damping: 20, stiffness: 120 }), 0);
  const h = (TH / TW) * w;
  return (
    <div style={{ position: "relative", width: w, height: h, overflow: "hidden", borderRadius: 10 }}>
      {[0, 1, 2, 3].map((i) => {
        const off = i - pos;
        if (Math.abs(off) >= 1) return null;
        return (
          <div key={i} style={{ position: "absolute", left: off * (w + 12), top: 0 }}>
            <TwsSlide i={i} w={w} t={t} at={at[i] ?? 0} d={d} src={e.src} />
          </div>
        );
      })}
    </div>
  );
}

const DESIGN_DEF: Tws = {
  big: "5,75%",
  lines: ["BREAKING! BI TAHAN", "SUKU BUNGA 5,75%,", "DI LUAR EKSPEKTASI"],
  kicker: "Keputusan RDG 20–21 Oktober 2026",
  text: "BI Rate ditahan di **5,75%** untuk keempat kalinya",
  rows: [
    ["Deposit Facility", "5,00%"],
    ["Lending Facility", "6,50%"],
  ],
  note: "*Data per 21 Oktober 2026",
};

/**
 * Desain berita gaya TWS di kartu desain AI: cover hitam, angka 3D, judul kapital + sorotan biru,
 * lalu carousel bergeser ke slide isi & perbandingan. title = judul cover, items = [angka besar, kalimat isi (**kata** = biru), pengantar].
 */
export function DesignScreen({ e }: { e: Env }) {
  const { t, wide } = e;
  const big = e.items[0] && e.items[0].length <= 8 ? e.items[0] : DESIGN_DEF.big;
  const d: Tws = {
    ...DESIGN_DEF,
    big,
    lines: e.title ? wrapTitle(e.title.toUpperCase()) : DESIGN_DEF.lines,
    text: e.items[1] || DESIGN_DEF.text,
    kicker: e.items[2] || DESIGN_DEF.kicker,
  };
  const askAt = en(t, 2);
  const aiAt = wide ? bt(t, 0.08) : en(t, 4);
  const cardAt = wide ? bt(t, 0.12) : en(t, 10);
  const cuts = [bt(t, 0.52), bt(t, 0.78)];
  const at = [cardAt + 6, cuts[0] + 4, cuts[1] + 4];
  const idx = cuts.filter((c) => t.f >= c).length;
  const pos = cuts.reduce((a, c) => a + pop(t, c, { damping: 20, stiffness: 120 }), 0);
  const cp = pop(t, cardAt, { damping: 16 });
  const sw = wide ? 416 : 320;
  const designCard = (
    <div style={{ ...card(e.acc), overflow: "hidden", opacity: clamp01(cp * 1.4), transform: `translateY(${(1 - cp) * 30}px) scale(${0.96 + 0.04 * cp})` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "9px 12px", borderBottom: "1px solid rgba(39,39,42,0.8)" }}>
        <b style={{ fontSize: 13, color: Z[100] }}>🎨 Carousel · 4 slide</b>
        <span style={{ fontSize: 11.5, color: Z[500], fontVariantNumeric: "tabular-nums" }}>{idx + 1} / 4</span>
      </div>
      <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 8px", background: "#050506" }}>
        <Carousel e={e} w={sw} at={at} cuts={cuts} d={d} />
      </div>
      <div style={{ padding: "6px 12px 10px" }}>
        <Dots n={4} on={pos} acc={e.acc} />
        <div style={{ marginTop: 8, display: "flex", gap: 6, justifyContent: "center" }}>
          <Btn grad={e.grad} size={12}>
            ⬇️ PNG
          </Btn>
          <Btn ghost size={12}>
            📦 ZIP
          </Btn>
          <Btn ghost size={12}>
            ✏️ Revisi
          </Btn>
        </div>
      </div>
    </div>
  );
  const answer = "Ini carousel-nya ✨ angka & judul dari **berita terbaru**.";
  if (!wide)
    return (
      <Shell e={e} nav="ai">
        <AiLine e={e} at={aiAt} text={answer} max={e.w - 28} />
        <div style={{ marginTop: 10 }}>{designCard}</div>
      </Shell>
    );
  const thumbs = (
    <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
      {[0, 1, 2, 3].map((i) => {
        const p = pop(t, cardAt + 10 + i * 4, { damping: 16 });
        return (
          <div key={i} style={{ borderRadius: 12, padding: 3, border: `2px solid ${i === Math.round(pos) ? e.acc : "transparent"}`, opacity: clamp01(p * 1.4), transform: `translateY(${(1 - p) * 16}px)` }}>
            <TwsSlide i={i} w={140} t={settled(t)} at={0} d={d} src={e.src} />
          </div>
        );
      })}
    </div>
  );
  return (
    <Shell e={e} nav="ai" fill>
      <div style={{ position: "absolute", inset: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) 470px", gap: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <UserBubble e={e} at={askAt} text={`Bikin carousel TWS: ${d.lines.join(" ").toLowerCase()} 🙏`} />
          <AiLine e={e} at={aiAt} text={answer} max={700} />
          <div style={{ paddingLeft: 42, opacity: ramp(t, cardAt + 4, cardAt + 14) }}>
            <div style={{ fontSize: 11.5, fontWeight: 650, color: Z[500] }}>
              ⚙️ Lihat proses ▸ <span style={{ fontWeight: 400 }}>(cari berita · tulis · desain · 6 detik)</span>
            </div>
            {thumbs}
          </div>
        </div>
        <div>{designCard}</div>
      </div>
    </Shell>
  );
}

// ================================================================== LAPORAN / PPT ==================================================================
const D = { bg: "#0A0A0A", panel: "#101010", panel2: "#141414", border: "#242424", soft: "#CFCFCF", muted: "#8A8A8A", green: "#2FE34A", orange: "#FF6A00", orange2: "#FF8A00", red: "#FF3B30" };
const SW = 1280;
const SH = 720;
type Kpi = { label: string; n: number; suf: string; delta: string; c: string };
const KPIS: Kpi[] = [
  { label: "Issue selesai", n: 186, suf: "", delta: "▲ 12%", c: D.green },
  { label: "Beres < 24 jam", n: 94, suf: "%", delta: "▲ 6%", c: D.green },
  { label: "Hot issue aktif", n: 12, suf: "", delta: "▼ 3", c: D.orange2 },
];
const R_BARS = [18, 26, 22, 31, 28, 35, 26];
const R_DAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
const R_POINTS = ["Payout jadi keluhan nomor 1 — cek batch tiap Senin", "Video ditolak turun 18% setelah brief diperjelas", "Respon tim makin cepat: rata-rata 2 jam"];

/** wordmark Konten untuk kepala slide (SVG, tidak perlu memuat gambar) */
const DeckLogo = () => (
  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
    <KLogo size={40} shadow={false} />
    <span style={{ fontFamily: DISPLAY, fontSize: 30, fontWeight: 800, letterSpacing: -0.6, color: "#fff" }}>konten</span>
  </div>
);

function DeckSlide({ i, t, at, title, kpis, points }: { i: number; t: Clock; at: number; title: string; kpis: Kpi[]; points: string[] }) {
  const head = (
    <div style={{ position: "absolute", left: 64, right: 64, top: 36, height: 60, display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${D.border}` }}>
      <DeckLogo />
      <span style={{ fontSize: 18, letterSpacing: 4, color: D.soft }}>LAPORAN MINGGUAN</span>
    </div>
  );
  const foot = <div style={{ position: "absolute", right: 64, bottom: 30, fontSize: 18, color: D.muted }}>{i + 1} / 4</div>;
  const h1 = (s: string) => {
    const p = pop(t, at, { damping: 18 });
    return <div style={{ position: "absolute", left: 64, top: 128, fontSize: 46, fontWeight: 800, letterSpacing: -1, color: "#fff", opacity: clamp01(p * 1.4), transform: `translateX(${(1 - p) * -30}px)` }}>{s}</div>;
  };
  let body: ReactNode;
  if (i === 0) {
    const p = pop(t, at, { damping: 16 });
    const bar = ramp(t, at, at + 16, 0, 1, Easing.out(Easing.cubic));
    body = (
      <div style={{ position: "absolute", left: 64, top: 230, paddingLeft: 40 }}>
        <span style={{ position: "absolute", left: 0, top: 0, width: 8, height: 250 * bar, borderRadius: 4, background: D.green }} />
        <div style={{ fontSize: 84, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2, color: "#fff", maxWidth: 1050, opacity: clamp01(p * 1.4), transform: `translateY(${(1 - p) * 30}px)` }}>{title}</div>
        <div style={{ marginTop: 18, fontSize: 34, color: D.soft, opacity: ramp(t, at + 8, at + 18) }}>Hot Issue & Video Review</div>
        <div style={{ marginTop: 12, fontSize: 28, fontWeight: 700, color: D.green, opacity: ramp(t, at + 12, at + 22) }}>20–26 Oktober 2026</div>
      </div>
    );
  } else if (i === 1) {
    body = (
      <>
        {h1("Ringkasan minggu ini")}
        <div style={{ position: "absolute", left: 64, right: 64, top: 236, display: "flex", gap: 32 }}>
          {kpis.map((k, j) => {
            const p = pop(t, at + 6 + j * 5, { damping: 15 });
            const v = k.n * ramp(t, at + 6 + j * 5, at + 36 + j * 5, 0, 1, Easing.out(Easing.cubic));
            return (
              <div key={j} style={{ flex: 1, height: 260, boxSizing: "border-box", borderRadius: 22, background: D.panel, border: `1px solid ${D.border}`, padding: "30px 34px", opacity: clamp01(p * 1.4), transform: `translateY(${(1 - p) * 40}px)` }}>
                <div style={{ fontSize: 26, color: D.muted }}>{k.label}</div>
                <div style={{ marginTop: 18, fontSize: 104, fontWeight: 800, lineHeight: 1, letterSpacing: -3, color: k.c, fontVariantNumeric: "tabular-nums" }}>
                  {fmtNum(Math.round(v))}
                  {k.suf}
                </div>
                <div style={{ marginTop: 18, fontSize: 24, fontWeight: 700, color: k.delta.startsWith("▼") ? D.orange2 : D.green }}>{k.delta}</div>
              </div>
            );
          })}
        </div>
      </>
    );
  } else if (i === 2) {
    const max = Math.max(...R_BARS);
    const hi = R_BARS.indexOf(max);
    body = (
      <>
        {h1("Laporan masuk per hari")}
        <div style={{ position: "absolute", left: 96, right: 96, top: 230, height: 380, display: "flex", alignItems: "flex-end", gap: 34 }}>
          {R_BARS.map((v, j) => {
            const g = pop(t, at + 6 + j * 3, { damping: 15, stiffness: 120 });
            return (
              <div key={j} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 10, height: "100%", justifyContent: "flex-end" }}>
                <span style={{ fontSize: 24, fontWeight: 800, color: j === hi ? D.orange2 : "#fff", opacity: clamp01(g * 1.4) }}>{Math.round(v * clamp01(g))}</span>
                <div style={{ width: "100%", height: (v / max) * 290 * g, borderRadius: "10px 10px 4px 4px", background: j === hi ? `linear-gradient(180deg, ${D.orange2}, ${D.orange})` : `linear-gradient(180deg, ${D.green}, #1C5C28)` }} />
                <span style={{ fontSize: 22, color: D.muted }}>{R_DAYS[j]}</span>
              </div>
            );
          })}
        </div>
      </>
    );
  } else {
    body = (
      <>
        {h1("Kesimpulan")}
        <div style={{ position: "absolute", left: 64, right: 64, top: 240, display: "flex", flexDirection: "column", gap: 26 }}>
          {points.map((s, j) => {
            const p = pop(t, at + 6 + j * 6, { damping: 16 });
            return (
              <div key={j} style={{ display: "flex", alignItems: "center", gap: 24, borderRadius: 20, background: D.panel, border: `1px solid ${D.border}`, padding: "22px 28px", opacity: clamp01(p * 1.4), transform: `translateX(${(1 - p) * 50}px)` }}>
                <span style={{ width: 44, height: 44, flex: "none", borderRadius: 999, background: D.green, color: "#0A0A0A", fontSize: 26, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", transform: `scale(${p})` }}>✓</span>
                <span style={{ fontSize: 34, fontWeight: 600, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s}</span>
              </div>
            );
          })}
        </div>
      </>
    );
  }
  return (
    <div style={{ position: "absolute", inset: 0, width: SW, height: SH, background: D.bg, fontFamily: '"Inter Variable", ui-sans-serif, system-ui, sans-serif', overflow: "hidden" }}>
      {head}
      {body}
      {foot}
    </div>
  );
}

/** penampil slide: halaman lama dibalik (rotateY dari tepi kiri) memperlihatkan halaman baru di bawahnya */
function DeckViewer({ t, w, flips, starts, title, kpis, points, still }: { t: Clock; w: number; flips: number[]; starts: number[]; title: string; kpis: Kpi[]; points: string[]; still?: number }) {
  const s = w / SW;
  const h = SH * s;
  const idx = still ?? flips.filter((f) => t.f >= f).length;
  const turning = still === undefined ? flips.findIndex((f) => t.f >= f && t.f < f + 18) : -1;
  const k = turning >= 0 ? ramp(t, flips[turning], flips[turning] + 18, 0, 1, Easing.inOut(Easing.cubic)) : 1;
  const tc = still === undefined ? t : settled(t);
  const page = (i: number) => (
    <div style={{ position: "absolute", left: 0, top: 0, width: SW, height: SH, transform: `scale(${s})`, transformOrigin: "0 0" }}>
      <DeckSlide i={i} t={tc} at={starts[i]} title={title} kpis={kpis} points={points} />
    </div>
  );
  return (
    <div style={{ position: "relative", width: w, height: h, borderRadius: 10, overflow: "hidden", border: `1px solid ${D.border}`, background: D.bg, flex: "none" }}>
      {page(idx)}
      {turning >= 0 && (
        <>
          <div style={{ position: "absolute", inset: 0, background: `linear-gradient(90deg, rgba(0,0,0,${0.55 * (1 - k)}) 0%, rgba(0,0,0,${0.15 * (1 - k)}) 60%, rgba(0,0,0,0) 100%)` }} />
          <div style={{ position: "absolute", inset: 0, transform: `perspective(${w * 2.4}px) rotateY(${-k * 100}deg)`, transformOrigin: "0 50%", opacity: 1 - ramp(t, flips[turning] + 13, flips[turning] + 18) }}>
            {page(turning)}
            <div style={{ position: "absolute", inset: 0, background: `linear-gradient(90deg, rgba(255,255,255,0) 40%, rgba(255,255,255,${0.12 * Math.sin(k * Math.PI)}) 100%)` }} />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Laporan mingguan versi PPT (gaya DeckCard: hitam, angka hijau, aksen oranye) — slide dibalik satu per satu.
 * title = judul laporan, items berangka ("Issue selesai 186") mengganti kartu KPI, items lain = poin kesimpulan.
 */
export function ReportScreen({ e }: { e: Env }) {
  const { t, wide } = e;
  const title = e.title || "Laporan Mingguan CS";
  const stats = e.items.map(splitStat);
  const kpis = KPIS.map((k, i) => {
    const s = stats.filter((x): x is NonNullable<typeof x> => !!x)[i];
    return s ? { ...k, label: s.label, n: s.n, suf: s.suf } : k;
  });
  const points = fill(e.items.filter((_, i) => !stats[i]), R_POINTS, 3);
  const flips = [bt(t, 0.26), bt(t, 0.5), bt(t, 0.74)];
  const cardAt = en(t, 8);
  const starts = [cardAt + 6, flips[0] + 4, flips[1] + 4, flips[2] + 4];
  const idx = flips.filter((f) => t.f >= f + 9).length;
  const cp = pop(t, cardAt, { damping: 16 });
  const vw = wide ? 820 : e.w - 28 - 24;
  const thumbW = wide ? 180 : (vw - 18) / 4;
  const viewer = <DeckViewer t={t} w={vw} flips={flips} starts={starts} title={title} kpis={kpis} points={points} />;
  const thumbs = (
    <div style={{ display: "flex", gap: 6 }}>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={{ borderRadius: 8, padding: 2, border: `2px solid ${i === idx ? e.acc : "transparent"}`, transform: `scale(${i === idx ? 1 : 0.96})` }}>
          <DeckViewer t={t} w={thumbW - 8} flips={flips} starts={[0, 0, 0, 0]} title={title} kpis={kpis} points={points} still={i} />
        </div>
      ))}
    </div>
  );
  const buttons = (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      <span style={{ position: "relative", display: "inline-flex" }}>
        <Btn grad={e.grad} size={12} press={t.f >= bt(t, 0.9) - 3 && t.f < bt(t, 0.9) + 3 ? 0.9 : 1}>
          ⬇️ Unduh PPT
        </Btn>
        <TapAt t={t} at={bt(t, 0.9)} wide={wide} />
      </span>
      <Btn ghost size={12}>
        📄 PDF
      </Btn>
      <Btn ghost size={12}>
        📁 Simpan ke folder
      </Btn>
    </div>
  );
  const deckCard = (
    <div style={{ ...card(e.acc), padding: 12, display: "flex", flexDirection: "column", gap: 10, opacity: clamp01(cp * 1.4), transform: `translateY(${(1 - cp) * 30}px)` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <b style={{ fontSize: 13, color: Z[100], whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>📊 {title} · 4 slide</b>
        <span style={{ fontSize: 11.5, color: Z[500], fontVariantNumeric: "tabular-nums" }}>{idx + 1} / 4</span>
      </div>
      {viewer}
      {thumbs}
      {buttons}
    </div>
  );
  const summary = (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {kpis.map((k, i) => {
        const at = cardAt + 20 + i * 8;
        const p = pop(t, at, { damping: 15 });
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: Z[200], opacity: clamp01(p * 1.4), transform: `translateX(${(1 - p) * 16}px)` }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: k.c }} />
            {k.label}: <b style={{ color: Z[50], fontVariantNumeric: "tabular-nums" }}>
              {fmtNum(Math.round(k.n * ramp(t, at, at + 24, 0, 1, Easing.out(Easing.cubic))))}
              {k.suf}
            </b>
          </div>
        );
      })}
    </div>
  );
  if (!wide)
    return (
      <Shell e={e} nav="ai">
        <AiLine e={e} at={en(t, 2)} text="Laporan minggu ini udah jadi 📊" max={e.w - 28} />
        <div style={{ marginTop: 10 }}>{deckCard}</div>
        <div style={{ marginTop: 12, paddingLeft: 4 }}>{summary}</div>
      </Shell>
    );
  return (
    <Shell e={e} nav="ai" fill>
      <div style={{ position: "absolute", inset: 0, display: "grid", gridTemplateColumns: "844px minmax(0, 1fr)", gap: 24 }}>
        <div>{deckCard}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <AiLine e={e} at={en(t, 2)} text="Laporan minggu ini udah jadi 📊 tinggal **unduh PPT**." max={330} />
          <div style={{ ...card(e.acc), padding: 14 }}>
            <b style={{ fontSize: 13, color: Z[100] }}>Ringkasan</b>
            <div style={{ marginTop: 10 }}>{summary}</div>
          </div>
        </div>
      </div>
    </Shell>
  );
}

// ================================================================== LANDING PAGE BRAND ==================================================================
const FEATS: [string, string, string][] = [
  ["⚡", "Kerja lebih cepat", "Semua laporan masuk ke satu tempat"],
  ["🔒", "Aman & rapi", "Data tim tersimpan dan terlindungi"],
  ["📈", "Pantau hasil", "Angka penting langsung kelihatan"],
];

/**
 * Landing page generik memakai warna, font & logo brand. title = judul utama, items = fitur ("Judul: keterangan").
 * src (opsional) = gambar di kartu pratinjau.
 */
export function WebsiteScreen({ e }: { e: Env }) {
  const { t, wide, brand } = e;
  const gid = useSid("ws");
  const bg = brand.bg || "#09090b";
  const dark = lumOf(bg) < 0.55;
  const ink = dark ? brand.text || "#fafafa" : "#0a0a0a";
  const sub = mixHex(ink, bg, 0.42);
  const line = mixHex(ink, bg, 0.86);
  const panel = mixHex(bg, ink, 0.05);
  const pri = brand.primary;
  const grad = `linear-gradient(180deg, ${brand.accent || pri} 0%, ${mixHex(pri, "#000000", 0.14)} 100%)`;
  const font = fontOf(brand);
  const head = e.title || `${brand.name} bikin kerja tim lebih cepat`;
  const words = head.split(/\s+/).filter(Boolean);
  const feats = fill(
    e.items.map((s): [string, string, string] => {
      const [a, ...b] = s.split(/\s*[:—–]\s*/);
      return ["✨", a, b.join(" ") || "Satu klik, langsung beres"];
    }),
    FEATS,
    3,
  ).map((f, i) => [f[0] === "✨" ? FEATS[i % 3][0] : f[0], f[1], f[2]] as [string, string, string]);
  const top = e.top;
  const navH = wide ? 64 : 56;
  const scroll = ramp(t, bt(t, 0.56), bt(t, 0.74), 0, wide ? 430 : 560, Easing.inOut(Easing.cubic));
  const tapAt = bt(t, 0.38);
  const ctaPress = t.f >= tapAt - 3 && t.f < tapAt + 3 ? 0.92 : 1;
  const h1 = wide ? 62 : 36;
  const pad = wide ? 72 : 20;

  const logo = brand.logo ? (
    <Img src={brand.logo} style={{ height: wide ? 34 : 30, width: "auto", maxWidth: 140, objectFit: "contain" }} />
  ) : (
    <span style={{ width: wide ? 34 : 30, height: wide ? 34 : 30, borderRadius: 10, background: grad, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: wide ? 17 : 15 }}>{Array.from(brand.name.trim())[0]?.toUpperCase() ?? "B"}</span>
  );
  const nav = (
    <div style={{ position: "absolute", left: 0, right: 0, top, height: navH, display: "flex", alignItems: "center", gap: 14, padding: `0 ${pad}px`, borderBottom: `1px solid ${line}`, background: rgba(bg, 0.92), zIndex: 20 }}>
      {logo}
      {!brand.logo && <b style={{ fontSize: wide ? 17 : 15.5, fontWeight: 800, color: ink }}>{brand.name}</b>}
      <span style={{ flex: 1 }} />
      {wide && ["Fitur", "Harga", "Cerita", "Tentang"].map((x) => <span key={x} style={{ fontSize: 14, fontWeight: 550, color: sub }}>{x}</span>)}
      <span style={{ borderRadius: 999, background: grad, color: "#fff", padding: wide ? "8px 16px" : "6px 12px", fontSize: wide ? 13.5 : 12, fontWeight: 700 }}>Coba gratis</span>
      {!wide && <span style={{ fontSize: 20, color: ink }}>☰</span>}
    </div>
  );

  const heroText = (
    <div style={{ flex: 1, minWidth: 0 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 999, border: `1px solid ${rgba(pri, 0.45)}`, background: rgba(pri, 0.1), padding: "4px 12px", fontSize: wide ? 13 : 11.5, fontWeight: 650, color: mixHex(pri, ink, 0.25), opacity: ramp(t, en(t, 2), en(t, 10)) }}>✨ Baru · dibantu AI</span>
      <div style={{ marginTop: wide ? 18 : 14, fontSize: h1, fontWeight: 800, lineHeight: 1.06, letterSpacing: "-0.03em", color: ink }}>
        {words.map((w, i) => {
          const p = pop(t, en(t, 6 + i * 2.5), { damping: 16 });
          const em = i >= words.length - 2;
          return (
            <span key={i} style={{ display: "inline-block", marginRight: "0.24em", opacity: clamp01(p * 1.5), transform: `translateY(${(1 - p) * 26}px)`, color: em ? pri : ink }}>
              {w}
            </span>
          );
        })}
      </div>
      <div style={{ marginTop: wide ? 18 : 12, fontSize: wide ? 18 : 14.5, lineHeight: 1.5, color: sub, maxWidth: 520, opacity: ramp(t, en(t, 16), en(t, 26)) }}>Satu tempat buat semua kerjaan tim — rapi, cepat, dan gampang dipakai.</div>
      <div style={{ marginTop: wide ? 26 : 18, display: "flex", gap: 10, opacity: ramp(t, en(t, 20), en(t, 28)) }}>
        <span style={{ position: "relative", display: "inline-flex", borderRadius: 14, background: grad, color: "#fff", padding: wide ? "14px 24px" : "11px 18px", fontSize: wide ? 16 : 14, fontWeight: 750, boxShadow: `0 14px 30px -12px ${rgba(pri, 0.8)}`, transform: `scale(${ctaPress})` }}>
          Mulai sekarang →
          <TapAt t={t} at={tapAt} wide={wide} />
        </span>
        <span style={{ borderRadius: 14, border: `1px solid ${line}`, color: ink, padding: wide ? "14px 22px" : "11px 16px", fontSize: wide ? 16 : 14, fontWeight: 650 }}>Lihat demo ▶</span>
      </div>
    </div>
  );

  const vp = pop(t, en(t, 14), { damping: 18, stiffness: 120 });
  const vw = wide ? 500 : e.w - pad * 2;
  const vh = wide ? 330 : 220;
  const visual = (
    <div style={{ position: "relative", width: vw, height: vh, flex: "none", opacity: clamp01(vp * 1.4), transform: `translateY(${(1 - vp) * 40 + Math.sin(t.f / 30) * 4}px) rotate(${(1 - vp) * 4}deg)` }}>
      <div style={{ position: "absolute", inset: 0, borderRadius: 20, background: panel, border: `1px solid ${line}`, boxShadow: `0 40px 80px -30px rgba(0,0,0,0.7), 0 0 0 1px ${rgba(pri, 0.08)}`, overflow: "hidden", padding: wide ? 20 : 14, boxSizing: "border-box" }}>
        {e.src ? (
          <Img src={e.src} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <>
            <div style={{ display: "flex", gap: 6 }}>
              {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
                <span key={c} style={{ width: 9, height: 9, borderRadius: 5, background: c }} />
              ))}
            </div>
            <div style={{ marginTop: wide ? 16 : 10, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
              {[
                ["Pengguna", 12840, ""],
                ["Selesai", 94, "%"],
                ["Hemat", 6, " jam"],
              ].map(([l, n, s], i) => (
                <div key={i} style={{ borderRadius: 12, border: `1px solid ${line}`, padding: wide ? "10px 12px" : "7px 9px" }}>
                  <div style={{ fontSize: wide ? 11.5 : 10, color: sub }}>{l}</div>
                  <div style={{ marginTop: 2, fontSize: wide ? 22 : 16, fontWeight: 800, color: i === 0 ? pri : ink, fontVariantNumeric: "tabular-nums" }}>
                    {fmtNum(Math.round((n as number) * ramp(t, en(t, 18), en(t, 48), 0, 1, Easing.out(Easing.cubic))))}
                    {s}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: wide ? 14 : 8 }}>
              <LineChart values={[12, 18, 15, 24, 22, 31, 29, 38]} w={vw - (wide ? 40 : 28)} h={vh - (wide ? 150 : 108)} color={pri} p={ramp(t, en(t, 20), en(t, 56), 0, 1, Easing.inOut(Easing.quad))} grid={3} />
            </div>
          </>
        )}
      </div>
      <div style={{ position: "absolute", right: wide ? -26 : 10, top: wide ? -18 : -14, borderRadius: 14, background: panel, border: `1px solid ${line}`, padding: "8px 12px", fontSize: wide ? 13 : 11.5, fontWeight: 700, color: ink, boxShadow: "0 18px 36px -16px rgba(0,0,0,0.7)", transform: `scale(${pop(t, en(t, 34), { damping: 10, stiffness: 200 })})` }}>
        🎉 +128 pengguna baru
      </div>
    </div>
  );

  const logos = (
    <div style={{ marginTop: wide ? 56 : 30, textAlign: "center" }}>
      <div style={{ fontSize: wide ? 13 : 11.5, fontWeight: 650, letterSpacing: 1.5, color: sub }}>DIPERCAYA TIM KREATIF</div>
      <div style={{ marginTop: 14, display: "flex", justifyContent: "center", gap: wide ? 44 : 18, flexWrap: "wrap", fontFamily: DISPLAY, fontSize: wide ? 20 : 14, fontWeight: 800, color: mixHex(ink, bg, 0.6) }}>
        {["nusantara", "kopi.co", "Lumina", "ARKA", "byte+"].map((x) => (
          <span key={x}>{x}</span>
        ))}
      </div>
    </div>
  );

  const features = (
    <div style={{ marginTop: wide ? 60 : 36 }}>
      <div style={{ textAlign: "center", fontSize: wide ? 34 : 24, fontWeight: 800, letterSpacing: "-0.02em", color: ink }}>Kenapa {brand.name}?</div>
      <div style={{ marginTop: wide ? 24 : 16, display: "grid", gridTemplateColumns: wide ? "repeat(3, minmax(0, 1fr))" : "minmax(0, 1fr)", gap: wide ? 20 : 12 }}>
        {feats.map(([ic, h, d], i) => {
          const p = pop(t, bt(t, 0.66) + i * 5, { damping: 16 });
          return (
            <div key={i} style={{ borderRadius: 18, background: panel, border: `1px solid ${line}`, padding: wide ? 22 : 16, opacity: clamp01(p * 1.4), transform: `translateY(${(1 - p) * 30}px)` }}>
              <span style={{ width: wide ? 44 : 38, height: wide ? 44 : 38, borderRadius: 12, background: rgba(pri, 0.14), display: "flex", alignItems: "center", justifyContent: "center", fontSize: wide ? 22 : 19 }}>{ic}</span>
              <div style={{ marginTop: 12, fontSize: wide ? 18 : 16, fontWeight: 750, color: ink }}>{h}</div>
              <div style={{ marginTop: 4, fontSize: wide ? 14 : 13, lineHeight: 1.5, color: sub }}>{d}</div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div style={{ position: "absolute", inset: 0, background: bg, color: ink, fontFamily: font, overflow: "hidden" }}>
      <svg width={e.w} height={e.h * 0.7} style={{ position: "absolute", left: 0, top: 0 }} aria-hidden>
        <defs>
          <radialGradient id={gid} cx="70%" cy="10%" r="70%">
            <stop offset="0%" stopColor={pri} stopOpacity={dark ? 0.28 : 0.16} />
            <stop offset="100%" stopColor={pri} stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width={e.w} height={e.h * 0.7} fill={`url(#${gid})`} />
      </svg>
      <div style={{ position: "absolute", left: 0, right: 0, top: top + navH, bottom: e.bottom, overflow: "hidden" }}>
        <div style={{ padding: `${wide ? 56 : 26}px ${pad}px 40px`, transform: `translateY(${-scroll}px)` }}>
          {wide ? (
            <div style={{ display: "flex", alignItems: "center", gap: 48 }}>
              {heroText}
              {visual}
            </div>
          ) : (
            <>
              {heroText}
              <div style={{ marginTop: 28 }}>{visual}</div>
            </>
          )}
          {logos}
          {features}
        </div>
      </div>
      {nav}
    </div>
  );
}

// ================================================================== MEDIA ==================================================================
const VIDEO_EXT = new Set(["mp4", "webm", "mov", "m4v", "mkv", "ogv"]);
const isVideo = (src: string) => {
  const path = storagePathOf(src) ?? src;
  return VIDEO_EXT.has(path.split(/[?#]/)[0].split(".").pop()?.toLowerCase() ?? "");
};

/** foto / klip dari user memenuhi layar (cover) dengan zoom pelan; kosong → bidang warna brand. title = keterangan di bawah */
export function MediaScreen({ e }: { e: Env }) {
  const { t, brand } = e;
  const z = 1 + 0.08 * clamp01(t.f / Math.max(1, t.d));
  const fit: CSSProperties = { width: "100%", height: "100%", objectFit: "cover", display: "block" };
  const cap = e.title && pop(t, en(t, 10), { damping: 16 });
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#000", fontFamily: fontOf(brand) }}>
      <div style={{ position: "absolute", inset: 0, transform: `scale(${z})` }}>
        {e.src ? (
          isVideo(e.src) ? (
            <Video src={e.src} muted loop objectFit="cover" style={fit} />
          ) : (
            <Img src={e.src} style={fit} />
          )
        ) : (
          <div style={{ position: "absolute", inset: 0, background: `linear-gradient(160deg, ${mixHex(brand.primary, "#000000", 0.25)} 0%, ${mixHex(brand.bg || "#09090b", "#000000", 0.2)} 70%)`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
            <span style={{ fontSize: e.wide ? 64 : 48 }}>🖼️</span>
            <span style={{ fontSize: e.wide ? 18 : 14, fontWeight: 650, color: "rgba(255,255,255,0.75)" }}>Foto / klip kamu di sini</span>
          </div>
        )}
      </div>
      {e.title && (
        <>
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "38%", background: "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.75) 100%)" }} />
          <div style={{ position: "absolute", left: e.wide ? 48 : 20, right: e.wide ? 48 : 20, bottom: e.bottom + (e.wide ? 40 : 28), fontSize: e.wide ? 40 : 24, fontWeight: 800, lineHeight: 1.15, letterSpacing: "-0.02em", color: "#fff", textShadow: "0 4px 20px rgba(0,0,0,0.5)", opacity: clamp01((cap || 0) * 1.4), transform: `translateY(${(1 - (cap || 0)) * 20}px)` }}>
            {e.title}
          </div>
        </>
      )}
    </div>
  );
}

