"use client";

/**
 * Tata letak isi adegan (scene.layout.kind). Semua teks berada di dalam zona aman (`box` dari SceneCtx).
 * Prinsip animasi: anticipation kecil, follow-through (overshoot pegas), staging (latar diburamkan,
 * fokus berpindah), timing ikut durasi adegan (`tempo`).
 */
import { useMemo, type CSSProperties, type ReactNode } from "react";
import { AbsoluteFill, Img, random, useCurrentFrame, useVideoConfig } from "remotion";
import type { Card, ChartData, LayoutKind, Side } from "@/lib/studio/timeline";
import { MediaFill } from "./backgrounds";
import { Laptop, LAPTOP, laptopFit, Phone, PHONE, phoneFit } from "./devices";
import { Glow, Scrim, Shine, splitShadow, TextShine, useSplit, useSvgId } from "./fx";
import { AppScreen } from "./screens";
import { emphasisMatcher, KineticText } from "./text";
import { autoLines, clamp, clamp01, DOWN, EASE, ease, fitSize, fmtNum, ink, mix, pulse, rgba, textEm, UP, useScene, useSrc, useStudio, type Box } from "./theme";

/** blur latar (depth of field) per jenis tata letak: makin banyak isi di depan, makin buram latarnya */
export function dofFor(kind: LayoutKind | undefined): number {
  switch (kind) {
    case "phone":
    case "laptop":
    case "features":
    case "split":
      return 3.2;
    case "counter":
    case "chart":
    case "cta":
      return 2.2;
    case "title":
    case "logo":
    case "quote":
    case "kinetic":
      return 1.2;
    default:
      return 0;
  }
}

/** waktu adegan + helper masuk sesuai easing & tempo adegan */
function useT() {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sc = useScene();
  const T = (n: number) => Math.round(n * sc.tempo);
  /** progres masuk mulai `start` frame selama `len` frame (nilai dasar, diskalakan tempo) */
  const enter = (start: number, len = 16) => ease(sc.scene.ease, f - T(start), fps, T(len));
  return { f, fps, T, enter, ...sc };
}

function Area({ box, children, gap = 0, justify = "center", align = "center", style }: { box: Box; children: ReactNode; gap?: number; justify?: CSSProperties["justifyContent"]; align?: CSSProperties["alignItems"]; style?: CSSProperties }) {
  return (
    <div style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, display: "flex", flexDirection: "column", alignItems: align, justifyContent: justify, gap, ...style }}>
      {children}
    </div>
  );
}

const cut = (b: Box, top: number, gap = 0): [Box, Box] => [
  { ...b, h: top },
  { x: b.x, y: b.y + top + gap, w: b.w, h: Math.max(0, b.h - top - gap) },
];

/** label kecil di atas judul: titik warna brand + huruf kapital berjarak */
function Kicker({ text, p, size = 30 }: { text: string; p: number; size?: number }) {
  const { brand, display } = useStudio();
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: size * 0.45,
        padding: `${size * 0.32}px ${size * 0.7}px`,
        borderRadius: 999,
        background: rgba(brand.primary, 0.14),
        border: `2px solid ${rgba(brand.primary, 0.45)}`,
        color: mix(brand.primary, "#ffffff", 0.45),
        fontFamily: display,
        fontWeight: 800,
        fontSize: size,
        letterSpacing: `${(0.14 + (1 - clamp01(p)) * 0.2).toFixed(3)}em`,
        textTransform: "uppercase",
        opacity: clamp01(p * 1.5),
        transform: `translateY(${((1 - p) * 22).toFixed(1)}px)`,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: size * 0.42, height: size * 0.42, borderRadius: 99, background: brand.primary, boxShadow: `0 0 ${size * 0.6}px ${brand.primary}` }} />
      {text}
    </div>
  );
}

/** kata-kata dengan kata penting berwarna brand */
function EmphWords({ text, isEmph, accent }: { text: string; isEmph: (w: string) => boolean; accent: string }) {
  const ws = text.split(/\s+/).filter(Boolean);
  return (
    <>
      {ws.map((w, i) => (
        <span key={i} style={isEmph(w) ? { color: accent } : undefined}>
          {w}
          {i < ws.length - 1 ? " " : ""}
        </span>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// kinetic
// ---------------------------------------------------------------------------------------------
function KineticL() {
  const { scene, box, enter } = useT();
  const { brand } = useStudio();
  const L = scene.layout;
  const lines = scene.text.length ? scene.text : [L.title ?? scene.name];
  const extra = (L.kicker ? 90 : 0) + (L.subtitle ? 110 : 0);
  return (
    <Area box={box} gap={28}>
      {L.kicker && <Kicker text={L.kicker} p={enter(0, 12)} />}
      <KineticText lines={lines} emphasis={L.emphasis} style={L.style ?? "punch"} w={box.w} h={Math.max(120, box.h * 0.8 - extra)} />
      {L.subtitle && <Sub text={L.subtitle} p={enter(14, 16)} w={box.w} color={brand.text} />}
    </Area>
  );
}

function Sub({ text, p, w, color, size }: { text: string; p: number; w: number; color: string; size?: number }) {
  const { portrait } = useStudio();
  const s = size ?? fitSize(autoLines(text, portrait ? 26 : 44, 2), w * 0.92, 140, { max: portrait ? 44 : 42, min: 24, lh: 1.3 });
  return (
    <div style={{ maxWidth: w * 0.92, fontSize: s, lineHeight: 1.3, fontWeight: 500, color: rgba(color, 0.74), textAlign: "center", opacity: clamp01(p), transform: `translateY(${((1 - p) * 24).toFixed(1)}px)` }}>
      {text}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// title
// ---------------------------------------------------------------------------------------------
function TitleL() {
  const { scene, box, enter, f, T } = useT();
  const { brand, display, portrait } = useStudio();
  const split = useSplit();
  const L = scene.layout;
  const title = L.title ?? scene.text[0] ?? scene.name;
  const sub = L.subtitle ?? (L.title ? scene.text.find((t) => t !== title) : scene.text[1]);
  const isEmph = useMemo(() => emphasisMatcher(L.emphasis), [L.emphasis]);
  const lines = autoLines(title, portrait ? 13 : 24, 3);
  const size = fitSize(lines, box.w * 0.94, box.h * 0.5, { max: portrait ? 150 : 140, min: 40, lh: 1.04 });
  const sweep = clamp01((f - T(20)) / T(22));
  return (
    <Area box={box} gap={size * 0.28}>
      {L.kicker && <Kicker text={L.kicker} p={enter(0, 12)} size={Math.round(clamp(size * 0.24, 24, 34))} />}
      <TextShine p={sweep}>
        <div style={{ fontFamily: display, fontWeight: 800, fontSize: size, lineHeight: 1.04, letterSpacing: "-0.03em", textAlign: "center", color: brand.text, textShadow: splitShadow(split, "0 6px 40px rgba(0,0,0,.35)") }}>
          {lines.map((l, i) => {
            const p = enter(2 + i * 4, 16);
            return (
              <div key={i} style={{ overflow: "hidden", padding: "0.04em 0.1em 0.1em", margin: "-0.04em -0.1em -0.1em" }}>
                <div style={{ transform: `translateY(${((1 - p) * 112).toFixed(2)}%) rotate(${((1 - p) * 3).toFixed(2)}deg)`, transformOrigin: "0 100%" }}>
                  <EmphWords text={l} isEmph={isEmph} accent={brand.primary} />
                </div>
              </div>
            );
          })}
        </div>
      </TextShine>
      <div style={{ width: size * 1.3, height: Math.max(6, size * 0.06), borderRadius: 99, background: `linear-gradient(90deg, ${brand.primary}, ${brand.accent})`, transform: `scaleX(${clamp01(enter(10, 14)).toFixed(4)})`, boxShadow: `0 0 24px ${rgba(brand.primary, 0.6)}` }} />
      {sub && <Sub text={sub} p={enter(13, 16)} w={box.w} color={brand.text} />}
    </Area>
  );
}

// ---------------------------------------------------------------------------------------------
// lowerThird
// ---------------------------------------------------------------------------------------------
function LowerThirdL() {
  const { scene, box, enter, f, T } = useT();
  const { brand, display, portrait } = useStudio();
  const L = scene.layout;
  const name = L.name ?? L.title ?? scene.text[0] ?? scene.name;
  const role = L.role ?? L.subtitle ?? "";
  const head = scene.text.filter((t) => t !== name);
  const nameSize = fitSize([name], box.w * 0.78, 140, { max: portrait ? 70 : 64, min: 32, padEm: 1 });
  const roleSize = Math.round(nameSize * 0.56);
  const bar = enter(0, 10);
  const pn = clamp01(enter(4, 14));
  const pr = clamp01(enter(9, 14));
  const ltH = nameSize * 1.5 + (role ? roleSize * 1.7 : 0) + 16;
  return (
    <>
      {head.length > 0 && (
        <Area box={{ ...box, h: Math.max(100, box.h - ltH - 60) }}>
          <KineticText lines={head} emphasis={L.emphasis} style={L.style ?? "stack"} w={box.w} h={Math.max(100, (box.h - ltH - 60) * 0.8)} max={portrait ? 120 : 110} />
        </Area>
      )}
      <div style={{ position: "absolute", left: box.x, top: box.y + box.h - ltH, display: "flex", gap: 18, alignItems: "stretch" }}>
        <div style={{ width: 10, borderRadius: 99, background: `linear-gradient(180deg, ${brand.primary}, ${brand.accent})`, transform: `scaleY(${clamp01(bar).toFixed(4)})`, transformOrigin: "50% 0", boxShadow: `0 0 20px ${rgba(brand.primary, 0.6)}` }} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10 }}>
          <div style={{ position: "relative", padding: `${nameSize * 0.18}px ${nameSize * 0.42}px`, background: "#ffffff", color: "#0a0a0b", borderRadius: 14, fontFamily: display, fontWeight: 800, fontSize: nameSize, lineHeight: 1.1, whiteSpace: "nowrap", clipPath: `inset(0 ${((1 - pn) * 100).toFixed(2)}% 0 0 round 14px)`, boxShadow: "0 20px 50px -20px rgba(0,0,0,.6)" }}>
            <span style={{ display: "inline-block", transform: `translateX(${((1 - pn) * -30).toFixed(1)}px)` }}>{name}</span>
            <Shine p={clamp01((f - T(18)) / T(18))} radius={14} alpha={0.55} />
          </div>
          {role && (
            <div style={{ padding: `${roleSize * 0.22}px ${roleSize * 0.6}px`, background: brand.primary, color: ink(brand.primary), borderRadius: 10, fontWeight: 700, fontSize: roleSize, lineHeight: 1.15, whiteSpace: "nowrap", clipPath: `inset(0 ${((1 - pr) * 100).toFixed(2)}% 0 0 round 10px)` }}>{role}</div>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// counter
// ---------------------------------------------------------------------------------------------
function CounterL() {
  const { scene, box, enter, f, T, dur } = useT();
  const { brand, display, portrait } = useStudio();
  const split = useSplit();
  const L = scene.layout;
  const from = L.from ?? 0;
  const to = L.to ?? 100;
  const d = L.decimals ?? (Number.isInteger(from) && Number.isInteger(to) ? 0 : 1);
  const pre = L.prefix ?? "";
  const suf = L.suffix ?? "";
  const label = L.label ?? scene.text[0];
  const cStart = T(6);
  const cLen = clamp(Math.round(dur * 0.5), 14, 80);
  const t = clamp01((f - cStart) / cLen);
  const e = 1 - Math.pow(1 - t, 4);
  const v = from + (to - from) * e;
  const k = f - (cStart + cLen);
  // slam: membesar saat angka mendarat lalu mengayun kembali (follow-through), sedikit mengecil sebelum mendarat (anticipation)
  const slam = k >= 0 ? Math.exp(-k / 6) * Math.cos(k * 0.75) : 0;
  const antic = k < 0 && k > -5 ? (1 + k / 5) * -0.03 : 0;
  const shake = k >= 0 && k < 12 ? Math.sin(k * 2.1) * 7 * Math.exp(-k / 3) : 0;
  const longest = [fmtNum(from, d), fmtNum(to, d)].sort((a, b) => textEm(b) - textEm(a))[0];
  const emW = textEm(longest) + (textEm(pre) + textEm(suf)) * 0.55 + 0.2;
  const size = Math.round(clamp(Math.min((box.w * 0.94) / emW, box.h * 0.36), 60, portrait ? 300 : 280));
  const pctChip = suf.includes("%") && to !== from;
  const upward = to >= from;
  const ringK = k >= 0 ? k : -1;
  const appear = enter(0, 10);
  return (
    <Area box={box} gap={size * 0.16}>
      {L.kicker && <Kicker text={L.kicker} p={enter(0, 12)} size={Math.round(clamp(size * 0.14, 24, 34))} />}
      <div style={{ position: "relative", display: "flex", alignItems: "baseline", justifyContent: "center", fontFamily: display, fontWeight: 800, lineHeight: 1, letterSpacing: "-0.03em", color: brand.text, fontVariantNumeric: "tabular-nums", opacity: clamp01(appear * 1.5), transform: `translateX(${shake.toFixed(1)}px) scale(${(1 + 0.12 * slam + antic + (1 - appear) * 0.3).toFixed(4)})`, textShadow: splitShadow(split, `0 0 ${size * 0.25}px ${rgba(brand.primary, 0.35)}, 0 8px 40px rgba(0,0,0,.4)`) }}>
        {ringK >= 0 && ringK < 22 && (
          <svg width={size * 4} height={size * 4} style={{ position: "absolute", left: "50%", top: "50%", marginLeft: -size * 2, marginTop: -size * 2, overflow: "visible", pointerEvents: "none" }}>
            <circle cx={size * 2} cy={size * 2} r={size * (0.7 + ringK * 0.07)} fill="none" stroke={brand.primary} strokeWidth={Math.max(2, 10 - ringK * 0.4)} strokeOpacity={clamp01(1 - ringK / 22) * 0.8} />
          </svg>
        )}
        {pre && <span style={{ fontSize: size * 0.55, color: brand.primary, marginRight: size * 0.06 }}>{pre}</span>}
        <span style={{ fontSize: size }}>{fmtNum(v, d)}</span>
        {suf && <span style={{ fontSize: size * 0.55, color: brand.primary, marginLeft: size * 0.06 }}>{suf}</span>}
      </div>
      <div style={{ width: Math.min(box.w * 0.7, size * 2.6), height: 8, borderRadius: 99, background: rgba(brand.text, 0.12), overflow: "hidden" }}>
        <div style={{ width: "100%", height: "100%", background: `linear-gradient(90deg, ${brand.primary}, ${brand.accent})`, transform: `scaleX(${e.toFixed(4)})`, transformOrigin: "0 50%" }} />
      </div>
      {pctChip && (
        <div style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "8px 20px", borderRadius: 999, background: rgba(upward ? UP : DOWN, 0.16), border: `2px solid ${rgba(upward ? UP : DOWN, 0.5)}`, color: upward ? UP : DOWN, fontWeight: 800, fontSize: Math.round(clamp(size * 0.16, 26, 40)), opacity: clamp01(k / 6 + 1), transform: `scale(${(0.8 + 0.2 * clamp01(k / 6 + 1)).toFixed(4)})` }}>
          {upward ? "▲" : "▼"} {upward ? "Naik" : "Turun"}
        </div>
      )}
      {label && <Sub text={label} p={enter(10, 16)} w={box.w} color={brand.text} size={Math.round(clamp(size * 0.2, 30, portrait ? 54 : 50))} />}
    </Area>
  );
}

// ---------------------------------------------------------------------------------------------
// chart
// ---------------------------------------------------------------------------------------------
const DEMO_CHART: ChartData = { kind: "area", values: [12, 13.5, 12.8, 15.2, 14.6, 18.1, 21.4], up: true };

function ChartL() {
  const { scene, box, enter, f, T, dur, fps } = useT();
  const { brand, display, portrait } = useStudio();
  const id = useSvgId("chart");
  const L = scene.layout;
  const ch = L.chart && L.chart.values.length >= 2 ? L.chart : DEMO_CHART;
  const vals = ch.values;
  const n = vals.length;
  const up = ch.up ?? vals[n - 1] >= vals[0];
  const col = up ? UP : DOWN;
  const unit = ch.unit ?? "";
  const dec = vals.every((x) => Number.isInteger(x)) ? 0 : Math.max(...vals.map(Math.abs)) < 10 ? 2 : 1;
  const title = L.title ?? scene.text[0];
  const headH = clamp(box.h * (portrait ? 0.3 : 0.28), 170, 340);
  const [hb, cb] = cut(box, headH, 24);
  const chW = cb.w;
  const chH = cb.h;
  const padT = 30;
  const padB = ch.labels?.length ? 64 : 24;
  const padR = 30;
  const lo0 = Math.min(...vals);
  const hi0 = Math.max(...vals);
  const span = hi0 - lo0 || Math.abs(hi0) || 1;
  const lo = ch.kind === "bar" ? Math.min(0, lo0) : lo0 - span * 0.12;
  const hi = hi0 + span * 0.12;
  const X = (i: number) => (n === 1 ? 0 : (i / (n - 1)) * (chW - padR - 20)) + 10;
  const Y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (chH - padT - padB);
  const base = clamp(Y(0), padT, chH - padB);
  const drawLen = T(clamp(Math.round(dur * 0.45), 18, 60));
  const p = EASE.inOut(clamp01((f - T(8)) / drawLen));
  // titik kepala garis
  const fi = p * (n - 1);
  const i0 = Math.min(n - 2, Math.floor(fi));
  const tt = fi - i0;
  const hx = X(i0) + (X(i0 + 1) - X(i0)) * tt;
  const hv = vals[i0] + (vals[i0 + 1] - vals[i0]) * tt;
  const hy = Y(hv);
  const linePath = vals.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${X(n - 1).toFixed(1)} ${(chH - padB).toFixed(1)} L${X(0).toFixed(1)} ${(chH - padB).toFixed(1)} Z`;
  const shown = ch.kind === "bar" ? vals[n - 1] * clamp01((f - T(8) - (n - 1) * 3) / 14) : hv;
  const pct = vals[0] !== 0 ? ((vals[n - 1] - vals[0]) / Math.abs(vals[0])) * 100 : 0;
  const labelIdx = ch.labels?.length ? Array.from({ length: n }, (_, i) => i).filter((i) => i % Math.ceil(n / 6) === 0 || i === n - 1) : [];
  const valSize = Math.round(clamp(headH * 0.36, 56, portrait ? 120 : 110));
  const titleSize = title ? fitSize(autoLines(title, portrait ? 22 : 40, 2), hb.w, headH * 0.36, { max: portrait ? 54 : 50, min: 28, lh: 1.15 }) : 0;
  const pulseR = 14 + 10 * pulse(f, 30);
  return (
    <>
      <Area box={hb} align="flex-start" justify="flex-end" gap={10}>
        {title && <div style={{ fontFamily: display, fontWeight: 700, fontSize: titleSize, lineHeight: 1.15, color: rgba(brand.text, 0.82), opacity: enter(0, 12), transform: `translateY(${((1 - enter(0, 12)) * 20).toFixed(1)}px)` }}>{title}</div>}
        <div style={{ display: "flex", alignItems: "center", gap: 20, opacity: enter(4, 12) }}>
          <span style={{ fontFamily: display, fontWeight: 800, fontSize: valSize, letterSpacing: "-0.03em", color: brand.text, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
            {fmtNum(shown, dec)}
            {unit && <span style={{ fontSize: valSize * 0.45, color: rgba(brand.text, 0.7), marginLeft: 8 }}>{unit}</span>}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 18px", borderRadius: 999, background: rgba(col, 0.16), border: `2px solid ${rgba(col, 0.5)}`, color: col, fontWeight: 800, fontSize: Math.round(valSize * 0.32), transform: `scale(${(0.7 + 0.3 * clamp01((f - T(8) - drawLen) / 8 + 1)).toFixed(3)})` }}>
            {up ? "▲" : "▼"} {fmtNum(Math.abs(pct), 1)}%
          </span>
        </div>
      </Area>
      <div style={{ position: "absolute", left: cb.x, top: cb.y, width: chW, height: chH, opacity: enter(2, 12) }}>
        <svg width={chW} height={chH} style={{ overflow: "visible" }}>
          <defs>
            <linearGradient id={`${id}a`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={col} stopOpacity={0.38} />
              <stop offset="100%" stopColor={col} stopOpacity={0} />
            </linearGradient>
            <clipPath id={`${id}c`}>
              <rect x={-20} y={-40} width={Math.max(0, hx + 20)} height={chH + 80} />
            </clipPath>
          </defs>
          {[0, 1, 2, 3].map((g) => {
            const y = padT + (g / 3) * (chH - padT - padB);
            return <line key={g} x1={0} x2={chW} y1={y} y2={y} stroke={rgba(brand.text, 0.1)} strokeWidth={2} strokeDasharray="6 10" />;
          })}
          {ch.kind === "bar" ? (
            vals.map((v, i) => {
              const bw = Math.max(8, ((chW - padR) / n) * 0.62);
              const g = ease(scene.ease, f - T(8) - i * 3, fps, 14);
              const top = Y(v);
              const hgt = Math.max(0, (base - top) * g);
              const last = i === n - 1;
              const c = ch.up === undefined ? (i === 0 || v >= vals[i - 1] ? UP : DOWN) : col;
              return <rect key={i} x={X(i) - bw / 2} y={base - hgt} width={bw} height={hgt} rx={Math.min(14, bw / 3)} fill={c} fillOpacity={last ? 1 : 0.55} />;
            })
          ) : (
            <g clipPath={`url(#${id}c)`}>
              {ch.kind === "area" && <path d={areaPath} fill={`url(#${id}a)`} />}
              <path d={linePath} fill="none" stroke={col} strokeWidth={8} strokeLinejoin="round" strokeLinecap="round" style={{ filter: `drop-shadow(0 0 12px ${rgba(col, 0.6)})` }} />
            </g>
          )}
          {ch.kind !== "bar" && p > 0.01 && (
            <>
              <circle cx={hx} cy={hy} r={pulseR} fill={col} fillOpacity={0.18} />
              <circle cx={hx} cy={hy} r={11} fill="#ffffff" stroke={col} strokeWidth={6} />
            </>
          )}
          {labelIdx.map((i) => (
            <text key={i} x={X(i)} y={chH - 16} textAnchor="middle" fill={rgba(brand.text, 0.55)} fontSize={28} fontWeight={600} fontFamily='"Inter Variable", sans-serif'>
              {ch.labels?.[i] ?? ""}
            </text>
          ))}
        </svg>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// phone & laptop
// ---------------------------------------------------------------------------------------------
function DeviceL({ kind }: { kind: "phone" | "laptop" }) {
  const { scene, box, enter, f, T, dur } = useT();
  const { brand, portrait, W, H } = useStudio();
  const L = scene.layout;
  const lines = scene.text.length ? scene.text : L.title ? [L.title] : [];
  const dev = kind === "phone" ? PHONE : LAPTOP;
  const side = kind === "phone" && W > H * 1.2; // 16:9: teks kiri, HP kanan
  let textBox: Box | null = null;
  let devBox: Box;
  if (side) {
    textBox = lines.length ? { x: box.x, y: box.y, w: box.w * 0.5, h: box.h } : null;
    devBox = lines.length ? { x: box.x + box.w * 0.54, y: box.y, w: box.w * 0.46, h: box.h } : box;
  } else {
    const th = lines.length ? clamp(box.h * (portrait ? 0.24 : 0.22), 130, 400) : 0;
    textBox = lines.length ? { ...box, h: th } : null;
    devBox = cut(box, th, th ? 30 : 0)[1];
  }
  // skala muat di devBox; prop `scale` mockup = pengali dari ukuran pas bawaannya
  const fit = Math.min(devBox.w / dev.w, devBox.h / dev.h) * 0.96;
  const sc = Math.max(0.05, fit / (kind === "phone" ? phoneFit(W, H) : laptopFit(W, H)));
  const p = enter(3, 22);
  // tilt mulai lebih miring lalu mengendap (follow-through); goyang & melayang sudah diurus mockup
  const base = L.tilt ?? (kind === "phone" ? 8 : 6);
  const tilt = base * (1.7 - 0.7 * clamp01(p));
  // anticipation: turun sedikit sebelum naik masuk
  const pre = f < T(3) ? (f / Math.max(1, T(3))) * 8 : 0;
  const ty = (1 - p) * devBox.h * 0.6 + pre;
  const res = useSrc();
  const screenKind = L.screen ?? (L.src ? "media" : "dashboard");
  const screen = <AppScreen kind={screenKind} brand={brand} items={L.items} title={L.title} src={L.src ? res(L.src) : null} start={T(14)} dur={dur} compact={kind === "phone"} />;
  return (
    <>
      {textBox && (
        <Area box={textBox} align={side ? "flex-start" : "center"}>
          <KineticText lines={lines} emphasis={L.emphasis} style={L.style ?? "punch"} w={textBox.w} h={textBox.h * 0.92} max={side ? 120 : portrait ? 110 : 96} align={side ? "left" : "center"} />
        </Area>
      )}
      <div style={{ position: "absolute", left: devBox.x, top: devBox.y, width: devBox.w, height: devBox.h, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ transform: `translateY(${ty.toFixed(1)}px) scale(${(0.9 + 0.1 * p).toFixed(4)})`, opacity: clamp01(p * 2.2) }}>
          {kind === "phone" ? (
            <Phone tilt={tilt} scale={sc} glow={brand.primary} shadow>
              {screen}
            </Phone>
          ) : (
            <Laptop tilt={tilt} scale={sc} glow={brand.primary} shadow>
              {screen}
            </Laptop>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// logo
// ---------------------------------------------------------------------------------------------
function LogoL() {
  const { scene, box, enter, f, T } = useT();
  const { brand, display, portrait } = useStudio();
  const res = useSrc();
  const split = useSplit();
  const L = scene.layout;
  const name = L.title ?? brand.name;
  const tagline = L.tagline ?? L.subtitle ?? scene.text.find((t) => t !== name && !t.includes(name));
  const G = Math.round(clamp(Math.min(box.w, box.h) * 0.24, 120, portrait ? 230 : 210));
  const wordSize = fitSize([name], box.w * 0.9, box.h * 0.2, { max: portrait ? 140 : 150, min: 48, lh: 1 });
  const gp = enter(0, 16);
  const kb = f - T(8);
  const wp = clamp01(enter(9, 16));
  const sweep = clamp01((f - T(22)) / T(20));
  const breathe = 1 + 0.012 * Math.sin(f / 18) * clamp01(gp);
  const sparks = Array.from({ length: 14 }, (_, i) => {
    if (kb < 0 || kb > 26) return null;
    const a = (i / 14) * Math.PI * 2 + random(`sa${i}`) * 0.4;
    const dist = G * (0.7 + (1 - Math.exp(-kb / 7)) * (1.1 + random(`sd${i}`) * 0.9));
    const r = (3 + random(`sr${i}`) * 5) * (1 - kb / 26);
    return <circle key={i} cx={G * 2.5 + Math.cos(a) * dist} cy={G * 2.5 + Math.sin(a) * dist} r={Math.max(0, r)} fill={i % 3 ? brand.primary : "#ffffff"} fillOpacity={clamp01(1 - kb / 26)} />;
  });
  return (
    <Area box={box} gap={G * 0.22}>
      <div style={{ position: "relative", width: G, height: G }}>
        <Glow x={G / 2} y={G / 2} r={G * 2} color={brand.primary} opacity={0.5 * clamp01(gp)} />
        <svg width={G * 5} height={G * 5} style={{ position: "absolute", left: -G * 2, top: -G * 2, overflow: "visible", pointerEvents: "none" }}>
          {kb >= 0 && kb < 24 && <circle cx={G * 2.5} cy={G * 2.5} r={G * (0.62 + kb * 0.06)} fill="none" stroke={brand.primary} strokeWidth={Math.max(2, 12 - kb * 0.45)} strokeOpacity={clamp01(1 - kb / 24) * 0.9} />}
          {sparks}
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: G * 0.28,
            overflow: "hidden",
            background: brand.logo ? "transparent" : `linear-gradient(140deg, ${mix(brand.primary, "#ffffff", 0.12)} 0%, ${brand.primary} 45%, ${mix(brand.primary, "#000000", 0.25)} 100%)`,
            boxShadow: brand.logo ? undefined : `0 ${G * 0.12}px ${G * 0.4}px -${G * 0.1}px ${rgba(brand.primary, 0.8)}, inset 0 2px 0 rgba(255,255,255,.35)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transform: `scale(${((0.35 + 0.65 * gp) * breathe).toFixed(4)}) rotate(${((1 - gp) * -14).toFixed(2)}deg)`,
            opacity: clamp01(gp * 2),
          }}
        >
          {brand.logo ? (
            <Img src={res(brand.logo)} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          ) : (
            <span style={{ fontFamily: display, fontWeight: 800, fontSize: G * 0.56, color: ink(brand.primary), lineHeight: 1 }}>{Array.from(name.trim())[0]?.toUpperCase() ?? "K"}</span>
          )}
          <Shine p={clamp01((f - T(18)) / T(16))} radius={G * 0.28} alpha={0.5} />
        </div>
      </div>
      <TextShine p={sweep}>
        <div style={{ fontFamily: display, fontWeight: 800, fontSize: wordSize, lineHeight: 1.02, letterSpacing: `${(-0.03 + (1 - wp) * 0.12).toFixed(3)}em`, color: brand.text, whiteSpace: "nowrap", clipPath: `inset(-20% ${((1 - wp) * 100).toFixed(2)}% -20% 0)`, transform: `translateX(${((1 - wp) * -24).toFixed(1)}px)`, textShadow: splitShadow(split, "0 8px 40px rgba(0,0,0,.4)") }}>
          {name}
        </div>
      </TextShine>
      {tagline && <Sub text={tagline} p={enter(24, 18)} w={box.w} color={brand.text} />}
    </Area>
  );
}

// ---------------------------------------------------------------------------------------------
// split (sebelum vs sesudah)
// ---------------------------------------------------------------------------------------------
function SplitL() {
  const { scene, box, enter, f, T } = useT();
  const { brand, display, portrait, W, H } = useStudio();
  const L = scene.layout;
  const left: Side = L.left ?? { title: "Sebelum", items: [], tone: "bad" };
  const right: Side = L.right ?? { title: "Sesudah", items: [], tone: "good" };
  const head = L.title ?? scene.text[0];
  const stacked = H > W * 1.2;
  const headH = head ? clamp(box.h * 0.15, 90, 210) : 0;
  const [hb, area] = cut(box, headH, head ? 28 : 0);
  const gap = 34;
  const pA: Box = stacked ? { ...area, h: (area.h - gap) / 2 } : { ...area, w: (area.w - gap) / 2 };
  const pB: Box = stacked ? { ...area, y: area.y + pA.h + gap, h: pA.h } : { ...area, x: area.x + pA.w + gap, w: pA.w };
  const all = [left.title, right.title, ...(left.items ?? []), ...(right.items ?? [])];
  const inner = pA.w - 80;
  const itemSize = fitSize(all.length ? all : ["-"], inner - 70, pA.h * 0.7, { max: portrait ? 46 : 42, min: 24, lh: 1.25 });
  const vsP = enter(10, 14);
  const focus = clamp01((f - T(34)) / T(14));
  return (
    <>
      {head && (
        <Area box={hb}>
          <div style={{ fontFamily: display, fontWeight: 800, fontSize: fitSize(autoLines(head, portrait ? 16 : 30, 2), hb.w, hb.h, { max: portrait ? 80 : 72, min: 32 }), lineHeight: 1.08, textAlign: "center", color: brand.text, opacity: enter(0, 12), transform: `translateY(${((1 - enter(0, 12)) * 24).toFixed(1)}px)` }}>{head}</div>
        </Area>
      )}
      <Panel side={left} box={pA} p={enter(2, 18)} from={stacked ? "up" : "left"} size={itemSize} focus={left.tone === "good" ? focus : -focus} />
      <Panel side={right} box={pB} p={enter(6, 18)} from={stacked ? "down" : "right"} size={itemSize} focus={right.tone === "bad" ? -focus : focus} />
      <div
        style={{
          position: "absolute",
          left: (stacked ? area.x + area.w / 2 : pA.x + pA.w + gap / 2) - 56,
          top: (stacked ? pA.y + pA.h + gap / 2 : area.y + area.h / 2) - 56,
          width: 112,
          height: 112,
          borderRadius: 99,
          background: brand.bg,
          border: `4px solid ${brand.primary}`,
          boxShadow: `0 0 40px ${rgba(brand.primary, 0.55)}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: display,
          fontWeight: 800,
          fontSize: 40,
          color: brand.text,
          transform: `scale(${clamp(vsP, 0, 1.2).toFixed(4)}) rotate(${((1 - vsP) * -40).toFixed(2)}deg)`,
          opacity: clamp01(vsP * 2),
        }}
      >
        VS
      </div>
    </>
  );
}

function Panel({ side, box, p, from, size, focus }: { side: Side; box: Box; p: number; from: "left" | "right" | "up" | "down"; size: number; focus: number }) {
  const { f, fps, T } = useT();
  const { brand, display } = useStudio();
  const tone = side.tone === "bad" ? DOWN : side.tone === "good" ? UP : brand.primary;
  const icon = side.tone === "bad" ? "✕" : side.tone === "good" ? "✓" : "•";
  const off = (1 - p) * 0.5;
  const tx = from === "left" ? -box.w * off : from === "right" ? box.w * off : 0;
  const ty = from === "up" ? -box.h * off : from === "down" ? box.h * off : 0;
  // staging: panel "baik" sedikit maju & menyala, panel "buruk" meredup
  const lift = focus > 0 ? focus : 0;
  const dim = focus < 0 ? -focus : 0;
  const items = side.items ?? [];
  return (
    <div
      style={{
        position: "absolute",
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        borderRadius: 36,
        padding: 40,
        boxSizing: "border-box",
        background: `linear-gradient(160deg, ${rgba(tone, 0.18)} 0%, rgba(255,255,255,.03) 70%)`,
        border: `2px solid ${rgba(tone, 0.45 + 0.4 * lift)}`,
        boxShadow: `0 30px 70px -30px rgba(0,0,0,.7)${lift ? `, 0 0 ${50 * lift}px ${rgba(tone, 0.35 * lift)}` : ""}`,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: size * 0.55,
        opacity: clamp01(p * 2) * (1 - 0.25 * dim),
        transform: `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${(1 + 0.025 * lift - 0.02 * dim).toFixed(4)})`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: size * 0.5, fontFamily: display, fontWeight: 800, fontSize: size * 1.25, color: mix(tone, "#ffffff", 0.35), lineHeight: 1.1 }}>
        <span style={{ width: size * 1.5, height: size * 1.5, borderRadius: 99, background: tone, color: "#ffffff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.85, flex: "none" }}>{icon}</span>
        {side.title}
      </div>
      {items.map((it, i) => {
        const q = ease("smooth", f - T(12) - i * 4, fps, 12);
        return (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: size * 0.45, fontSize: size, lineHeight: 1.25, fontWeight: 600, color: rgba(brand.text, 0.9), opacity: q, transform: `translateX(${((1 - q) * 30).toFixed(1)}px)` }}>
            <span style={{ color: tone, fontWeight: 800, flex: "none" }}>{icon}</span>
            <span>{it}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// features
// ---------------------------------------------------------------------------------------------
function FeaturesL() {
  const { scene, box, enter, f, T, dur } = useT();
  const { brand, display, portrait, W, H } = useStudio();
  const L = scene.layout;
  // kartu: dari layout.cards → layout.items → teks layar (baris pertama jadi judul kalau barisnya ≥ 2)
  const fromText = !L.cards?.length && !L.items?.length;
  const textHead = fromText && !L.title && scene.text.length >= 2;
  const src: string[] = L.items?.length ? L.items : textHead ? scene.text.slice(1) : scene.text;
  let cards: Card[] = L.cards?.length ? L.cards : src.slice(0, 4).map((t) => ({ title: t }));
  if (!cards.length) cards = [{ title: L.title ?? scene.name }];
  const head = L.title ?? (fromText ? (textHead ? scene.text[0] : undefined) : scene.text[0]);
  const n = cards.length;
  const wide = W > H * 1.2;
  const cols = wide ? n : !portrait && n === 4 ? 2 : 1;
  const rows = Math.ceil(n / cols);
  const headH = head ? clamp(box.h * 0.15, 90, 200) : 0;
  const [hb, gb] = cut(box, headH, head ? 30 : 0);
  const gap = 24;
  const cw = (gb.w - gap * (cols - 1)) / cols;
  const chh = Math.min((gb.h - gap * (rows - 1)) / rows, wide ? gb.h : 260);
  const totalH = chh * rows + gap * (rows - 1);
  const y0 = gb.y + (gb.h - totalH) / 2;
  const vertical = wide; // kartu tegak (ikon di atas) untuk 16:9
  const icon = Math.round(clamp(vertical ? cw * 0.22 : chh * 0.5, 56, 110));
  const textW = vertical ? cw - 70 : cw - icon - 90;
  const tSize = fitSize(cards.map((c) => c.title), textW, chh * 0.35, { max: portrait ? 50 : 46, min: 26, lh: 1.15 });
  const dSize = Math.round(tSize * 0.66);
  const seg = Math.max(1, (dur - T(30)) / n);
  return (
    <>
      {head && (
        <Area box={hb}>
          <div style={{ fontFamily: display, fontWeight: 800, fontSize: fitSize(autoLines(head, portrait ? 16 : 30, 2), hb.w, hb.h, { max: portrait ? 80 : 72, min: 32 }), lineHeight: 1.08, textAlign: "center", color: brand.text, opacity: enter(0, 12), transform: `translateY(${((1 - enter(0, 12)) * 24).toFixed(1)}px)` }}>{head}</div>
        </Area>
      )}
      <div style={{ position: "absolute", left: gb.x, top: y0, width: gb.w, height: totalH, perspective: 1400 }}>
        {cards.map((c, i) => {
          const p = enter(4 + i * 5, 16);
          const col = i % cols;
          const row = Math.floor(i / cols);
          const hl = clamp01(1 - Math.abs(f - (T(30) + i * seg + seg / 2)) / (seg * 0.7));
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: col * (cw + gap),
                top: row * (chh + gap),
                width: cw,
                height: chh,
                boxSizing: "border-box",
                borderRadius: 32,
                padding: vertical ? 34 : "0 34px",
                display: "flex",
                flexDirection: vertical ? "column" : "row",
                alignItems: vertical ? "flex-start" : "center",
                justifyContent: vertical ? "center" : "flex-start",
                gap: vertical ? 22 : 28,
                background: `linear-gradient(150deg, rgba(255,255,255,${(0.07 + 0.04 * hl).toFixed(3)}) 0%, rgba(255,255,255,.02) 100%)`,
                border: `2px solid ${hl > 0.05 ? rgba(brand.primary, 0.3 + 0.5 * hl) : "rgba(255,255,255,.09)"}`,
                boxShadow: `0 30px 60px -30px rgba(0,0,0,.75)${hl > 0.05 ? `, 0 0 ${40 * hl}px ${rgba(brand.primary, 0.3 * hl)}` : ""}`,
                opacity: clamp01(p * 2),
                transform: `translateY(${((1 - p) * 90 - 8 * hl).toFixed(1)}px) rotateX(${((1 - p) * 28).toFixed(2)}deg) scale(${(0.94 + 0.06 * p + 0.02 * hl).toFixed(4)})`,
                transformOrigin: "50% 100%",
              }}
            >
              <div style={{ width: icon, height: icon, flex: "none", borderRadius: icon * 0.3, background: c.icon ? rgba(brand.primary, 0.16) : `linear-gradient(140deg, ${brand.accent}, ${brand.primary})`, border: `2px solid ${rgba(brand.primary, 0.4)}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: icon * (c.icon ? 0.52 : 0.44), fontWeight: 800, fontFamily: display, color: c.icon ? undefined : ink(brand.primary) }}>
                {c.icon ?? i + 1}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
                <div style={{ fontFamily: display, fontWeight: 800, fontSize: tSize, lineHeight: 1.15, color: brand.text }}>{c.title}</div>
                {c.desc && <div style={{ fontSize: dSize, lineHeight: 1.3, fontWeight: 500, color: rgba(brand.text, 0.66) }}>{c.desc}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// cta
// ---------------------------------------------------------------------------------------------
function CtaL() {
  const { scene, box, enter, f, T, dur } = useT();
  const { brand, display, portrait, beat } = useStudio();
  const res = useSrc();
  const L = scene.layout;
  const title = L.title ?? scene.text[0] ?? "Coba sekarang";
  const button = L.button ?? "Mulai sekarang";
  const sub = L.subtitle ?? scene.text.find((t) => t !== title && t !== button);
  const lines = autoLines(title, portrait ? 12 : 22, 3);
  const bSize = Math.round(clamp(fitSize([button], box.w * 0.7, 120, { max: portrait ? 54 : 50, min: 28, padEm: 2.2 }), 28, 54));
  const bIn = f - T(12);
  const bp = ease("overshoot", bIn, 30, T(14));
  const beatLoop = Math.max(8, Math.round(beat * 2));
  const tapAt = Math.round(dur * 0.62);
  const tk = f - tapAt;
  const press = tk >= -4 && tk < 6 ? (tk < 0 ? (tk + 4) / 4 : 1 - tk / 6) * 0.06 : 0;
  const puls = bIn > T(14) ? 0.03 * pulse(bIn - T(14), beatLoop) : 0;
  const ringK = bIn > T(14) ? (bIn - T(14)) % beatLoop : -1;
  const shine = bIn > T(16) ? (((bIn - T(16)) % 48) / 30) : 0;
  return (
    <Area box={box} gap={36}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, opacity: enter(0, 12), fontFamily: display, fontWeight: 800, fontSize: 34, color: rgba(brand.text, 0.85) }}>
        {brand.logo ? <Img src={res(brand.logo)} style={{ width: 64, height: 64, objectFit: "contain", borderRadius: 16 }} /> : <span style={{ width: 22, height: 22, borderRadius: 7, background: brand.primary, boxShadow: `0 0 20px ${brand.primary}` }} />}
        {brand.name}
      </div>
      <KineticText lines={lines} emphasis={L.emphasis} style={L.style ?? "punch"} w={box.w} h={box.h * 0.4} max={portrait ? 140 : 130} start={T(2)} />
      {sub && <Sub text={sub} p={enter(10, 16)} w={box.w} color={brand.text} />}
      <div style={{ position: "relative", marginTop: 12, opacity: clamp01(bp * 2), transform: `scale(${(clamp(bp, 0, 1.2) * (1 + puls - press)).toFixed(4)})` }}>
        {ringK >= 0 && (
          <div style={{ position: "absolute", inset: 0, borderRadius: 999, border: `4px solid ${brand.primary}`, opacity: 0.6 * (1 - ringK / beatLoop), transform: `scale(${(1 + 0.32 * (ringK / beatLoop)).toFixed(4)})` }} />
        )}
        <div style={{ position: "relative", overflow: "hidden", display: "inline-flex", alignItems: "center", gap: bSize * 0.4, padding: `${bSize * 0.5}px ${bSize * 1.1}px`, borderRadius: 999, background: `linear-gradient(180deg, ${brand.accent} 0%, ${brand.primary} 100%)`, color: ink(brand.primary), fontFamily: display, fontWeight: 800, fontSize: bSize, lineHeight: 1, whiteSpace: "nowrap", boxShadow: `0 ${bSize * 0.4}px ${bSize * 1.2}px -${bSize * 0.3}px ${rgba(brand.primary, 0.85)}, inset 0 2px 0 rgba(255,255,255,.35)` }}>
          {button}
          <span style={{ display: "inline-block", transform: `translateX(${(Math.sin(f / 7) * 4).toFixed(1)}px)` }}>→</span>
          <Shine p={shine} radius={999} alpha={0.45} />
        </div>
        {tk >= -6 && tk < 18 && (
          <div style={{ position: "absolute", right: bSize * 0.6, bottom: -bSize * 0.5, width: bSize * 1.1, height: bSize * 1.1, borderRadius: 99, background: "rgba(255,255,255,.85)", boxShadow: "0 6px 20px rgba(0,0,0,.45)", opacity: tk < 0 ? (tk + 6) / 6 : 1 - tk / 18, transform: `scale(${tk < 0 ? 1.2 - 0.2 * ((tk + 6) / 6) : 1 + tk * 0.04})` }} />
        )}
      </div>
    </Area>
  );
}

// ---------------------------------------------------------------------------------------------
// media (klip / gambar user)
// ---------------------------------------------------------------------------------------------
function MediaL() {
  const { scene, box, enter, f, dur } = useT();
  const { portrait } = useStudio();
  const L = scene.layout;
  const src = L.src ?? scene.bg.media ?? null;
  if (!src) return <TitleL />;
  const fit = L.fit ?? "cover";
  const kb = L.kenburns !== false;
  const t = EASE.soft(clamp01(f / Math.max(1, dur)));
  const p = enter(0, 14);
  const s = (kb ? 1.02 + 0.1 * t : 1) * (1.06 - 0.06 * clamp01(p));
  const x = kb ? (0.5 - t) * 30 : 0;
  const lines = scene.text;
  if (fit === "contain") {
    const th = lines.length ? clamp(box.h * 0.26, 120, 360) : 0;
    const [mb, tb] = lines.length ? [{ ...box, h: box.h - th - 30 }, { ...box, y: box.y + box.h - th, h: th }] : [box, null];
    return (
      <>
        <div style={{ position: "absolute", left: mb.x, top: mb.y, width: mb.w, height: mb.h, borderRadius: 36, overflow: "hidden", background: "#000", boxShadow: "0 40px 90px -30px rgba(0,0,0,.8)", opacity: clamp01(p * 2), transform: `scale(${(0.94 + 0.06 * p).toFixed(4)})` }}>
          <AbsoluteFill style={{ transform: `scale(${s.toFixed(4)}) translateX(${x.toFixed(1)}px)` }}>
            <MediaFill src={src} fit="contain" />
          </AbsoluteFill>
        </div>
        {tb && (
          <Area box={tb}>
            <KineticText lines={lines} emphasis={L.emphasis} style={L.style ?? "stack"} w={tb.w} h={tb.h * 0.9} max={portrait ? 96 : 86} />
          </Area>
        )}
      </>
    );
  }
  const th = lines.length ? clamp(box.h * 0.3, 120, 420) : 0;
  return (
    <>
      <AbsoluteFill style={{ opacity: clamp01(p * 2), transform: `scale(${s.toFixed(4)}) translateX(${x.toFixed(1)}px)` }}>
        <MediaFill src={src} fit="cover" />
      </AbsoluteFill>
      {lines.length > 0 && <Scrim from={0.15} mid={0.05} to={0.75} />}
      {lines.length > 0 && (
        <Area box={{ ...box, y: box.y + box.h - th, h: th }} justify="flex-end">
          <KineticText lines={lines} emphasis={L.emphasis} style={L.style ?? "stack"} w={box.w} h={th * 0.92} max={portrait ? 100 : 90} />
        </Area>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// quote
// ---------------------------------------------------------------------------------------------
function QuoteL() {
  const { scene, box, enter, T } = useT();
  const { brand, display, portrait } = useStudio();
  const L = scene.layout;
  const text = scene.text.length ? scene.text.join(" ") : L.title ?? scene.name;
  const by = L.by ?? L.name;
  const lines = autoLines(text, portrait ? 16 : 30, 5);
  const qp = enter(0, 14);
  const words = text.split(/\s+/).length;
  const byAt = 10 + words * 3;
  const Q = Math.round(clamp(box.w * 0.18, 100, 180));
  return (
    <Area box={box} gap={36} align="flex-start">
      <svg width={Q} height={Q * 0.8} viewBox="0 0 100 80" style={{ transform: `scale(${clamp(qp, 0, 1.2).toFixed(4)}) rotate(${((1 - qp) * -20).toFixed(2)}deg)`, transformOrigin: "0 100%", opacity: clamp01(qp * 2), filter: `drop-shadow(0 0 24px ${rgba(brand.primary, 0.55)})` }}>
        <path d="M8 76 C8 46 18 22 42 8 L46 16 C32 26 27 38 27 48 L42 48 L42 76 Z M58 76 C58 46 68 22 92 8 L96 16 C82 26 77 38 77 48 L92 48 L92 76 Z" fill={brand.primary} />
      </svg>
      <KineticText lines={lines} emphasis={L.emphasis} style="rise" w={box.w} h={box.h * 0.6} max={portrait ? 92 : 84} weight={700} align="left" lh={1.18} start={T(6)} wrap={false} />
      {by && (
        <div style={{ display: "flex", alignItems: "center", gap: 18, opacity: enter(byAt, 14), transform: `translateX(${((1 - enter(byAt, 14)) * -24).toFixed(1)}px)`, fontFamily: display, fontWeight: 700, fontSize: portrait ? 38 : 34, color: rgba(brand.text, 0.8) }}>
          <span style={{ width: 56 * clamp01(enter(byAt, 14)), height: 5, borderRadius: 9, background: brand.primary }} />
          {by}
        </div>
      )}
    </Area>
  );
}

// ---------------------------------------------------------------------------------------------
/** isi adegan sesuai scene.layout.kind */
export function SceneLayout() {
  const { scene } = useScene();
  switch (scene.layout?.kind) {
    case "title":
      return <TitleL />;
    case "lowerThird":
      return <LowerThirdL />;
    case "counter":
      return <CounterL />;
    case "chart":
      return <ChartL />;
    case "phone":
      return <DeviceL kind="phone" />;
    case "laptop":
      return <DeviceL kind="laptop" />;
    case "logo":
      return <LogoL />;
    case "split":
      return <SplitL />;
    case "features":
      return <FeaturesL />;
    case "cta":
      return <CtaL />;
    case "media":
      return <MediaL />;
    case "quote":
      return <QuoteL />;
    default:
      return <KineticL />;
  }
}
