"use client";

/**
 * Alat bantu video UGC (Remotion): warna, kamera zoom in/out, teks ngetik, caption gaya TikTok, efek tap.
 * Semua pakai style inline + warna tetap (tidak ikut mode terang/gelap) supaya hasil video selalu sama.
 * Hindari radial-gradient / mask / backdrop-filter: renderer di browser belum mendukung semuanya.
 */
import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import { AbsoluteFill, Easing, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export const W = 1080;
export const H = 1920;
export const FPS = 30;

export const C = {
  bg: "#09090b",
  panel: "#18181b",
  panel2: "#202024",
  line: "#2e2e33",
  text: "#fafafa",
  sub: "#a1a1aa",
  mute: "#71717a",
  orange: "#f97316",
  orange2: "#ea580c",
  pink: "#ec4899",
  red: "#ef4444",
  amber: "#f59e0b",
  green: "#10b981",
  sky: "#38bdf8",
  violet: "#a78bfa",
};
export const FONT = '"Inter Variable", ui-sans-serif, system-ui, sans-serif';
export const DISPLAY = '"Plus Jakarta Sans Variable", "Inter Variable", ui-sans-serif, system-ui, sans-serif';
export const GRAD = `linear-gradient(180deg, #fb8a3c 0%, ${C.orange2} 100%)`;

const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** interpolate yang dikunci di ujung + easing halus */
export const lerp = (f: number, input: number[], output: number[], easing: (t: number) => number = Easing.inOut(Easing.cubic)) =>
  interpolate(f, input, output, { ...CLAMP, easing });

/** pegas 0 -> 1 mulai di frame `start` (buat elemen "nongol") */
export function usePop(start: number, config: { damping?: number; stiffness?: number; mass?: number } = {}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - start, fps, config: { damping: 13, stiffness: 190, mass: 0.6, ...config } });
}

/** teks yang diketik pelan-pelan: `cpf` = huruf per frame */
export const typed = (text: string, frame: number, start: number, cpf = 0.9) => {
  const chars = Array.from(text); // emoji jangan sampai terpotong setengah
  return chars.slice(0, Math.max(0, Math.floor((frame - start) * cpf))).join("");
};

/** kursor ketik: nyala terus saat mengetik, kedip saat diam */
export function Caret({ typing, color = C.orange, h = 46 }: { typing: boolean; color?: string; h?: number }) {
  const frame = useCurrentFrame();
  const on = typing || Math.floor(frame / 9) % 2 === 0;
  return <span style={{ display: "inline-block", width: 4, height: h, marginLeft: 4, verticalAlign: "middle", borderRadius: 2, background: color, opacity: on ? 1 : 0 }} />;
}

/**
 * Kamera: geser + zoom ke titik tertentu (koordinat 1080x1920 di dalam scene).
 * `shots` = keyframe {f, x, y, s}; titik (x, y) dibawa ke tengah layar dengan zoom s.
 * Ditambah goyang tangan halus supaya terasa direkam pakai HP (UGC).
 */
export type Shot = { f: number; x: number; y: number; s: number };
export function Camera({ shots, children, shake = 1 }: { shots: Shot[]; children: ReactNode; shake?: number }) {
  const frame = useCurrentFrame();
  const fs = shots.map((s) => s.f);
  const pick = (k: "x" | "y" | "s") => (shots.length === 1 ? shots[0][k] : lerp(frame, fs, shots.map((s) => s[k]), Easing.bezier(0.65, 0, 0.35, 1)));
  const s = pick("s");
  const x = pick("x") + Math.sin(frame / 11) * 4 * shake;
  const y = pick("y") + Math.cos(frame / 13) * 5 * shake;
  const rot = Math.sin(frame / 17) * 0.25 * shake;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: W,
          height: H,
          transformOrigin: "0 0",
          transform: `translate(${W / 2 - x * s}px, ${H / 2 - y * s}px) scale(${s}) rotate(${rot}deg)`,
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
}

/** efek jari nge-tap (lingkaran membesar) di titik (x, y) */
export function Tap({ x, y, at }: { x: number; y: number; at: number }) {
  const f = useCurrentFrame() - at;
  if (f < -6 || f > 20) return null;
  const p = Math.max(0, f) / 20;
  const press = f < 0 ? lerp(f, [-6, 0], [0.6, 1]) : 1;
  return (
    <>
      <div style={{ position: "absolute", left: x - 34, top: y - 34, width: 68, height: 68, borderRadius: 99, background: "rgba(255,255,255,.85)", opacity: f < 0 ? press : 1 - p, transform: `scale(${f < 0 ? press : 1 - p * 0.3})`, boxShadow: "0 6px 20px rgba(0,0,0,.45)" }} />
      {f >= 0 && (
        <div style={{ position: "absolute", left: x - 34, top: y - 34, width: 68, height: 68, borderRadius: 99, border: "5px solid rgba(255,255,255,.9)", opacity: 1 - p, transform: `scale(${1 + p * 2.2})` }} />
      )}
    </>
  );
}

/**
 * Caption gaya video UGC: kotak putih, kata muncul satu-satu, kata penting disorot oranye.
 * `hl` = kata yang disorot (cocok kalau kata mengandung teks itu).
 */
/** caption bisa dimatikan dari menu Remotion (mis. mau pakai teks sendiri di CapCut) */
export const CaptionsOn = createContext(true);

export function Caption({ text, start = 0, end, y = 1590, hl = [], size = 56 }: { text: string; start?: number; end?: number; y?: number; hl?: string[]; size?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = text.split(/\s+/).filter(Boolean);
  const boxIn = spring({ frame: frame - start, fps, config: { damping: 14, stiffness: 220, mass: 0.5 } });
  const out = end === undefined ? 1 : lerp(frame, [end - 6, end], [1, 0]);
  const on = useContext(CaptionsOn);
  if (!on || frame < start) return null;
  return (
    <div style={{ position: "absolute", left: 70, right: 70, top: y, display: "flex", justifyContent: "center", opacity: out, transform: `scale(${(0.6 + 0.4 * boxIn) * (0.9 + 0.1 * out)}) rotate(${(1 - boxIn) * -4}deg)` }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "6px 14px",
          padding: "22px 30px",
          borderRadius: 30,
          background: "#ffffff",
          boxShadow: "0 18px 50px rgba(0,0,0,.55)",
          fontFamily: DISPLAY,
          fontWeight: 800,
          fontSize: size,
          lineHeight: 1.18,
          color: "#0a0a0a",
          textAlign: "center",
        }}
      >
        {words.map((w, i) => {
          const at = start + 3 + i * 3;
          const p = spring({ frame: frame - at, fps, config: { damping: 12, stiffness: 260, mass: 0.4 } });
          const strong = hl.some((h) => w.toLowerCase().includes(h.toLowerCase()));
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                opacity: frame < at ? 0 : 1,
                transform: `translateY(${(1 - p) * 18}px) scale(${0.7 + 0.3 * p})`,
                ...(strong ? { background: GRAD, color: "#fff", borderRadius: 14, padding: "0 12px", margin: "0 -4px" } : null),
              }}
            >
              {w}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** latar gelap dengan cahaya oranye di atas (sama dengan web) */
export function Bg({ children, style }: { children?: ReactNode; style?: CSSProperties }) {
  return (
    <AbsoluteFill style={{ background: C.bg, fontFamily: FONT, color: C.text, ...style }}>
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(249,115,22,.20) 0%, rgba(236,72,153,.06) 22%, rgba(9,9,11,0) 42%)" }} />
      {children}
    </AbsoluteFill>
  );
}

export function Logo({ size = 96 }: { size?: number }) {
  return <Img src="/konten-logo.png" style={{ width: size, height: size, borderRadius: size * 0.28, boxShadow: "0 14px 34px -10px rgba(245,73,0,.7)" }} />;
}

export const card: CSSProperties = {
  background: C.panel,
  border: `2px solid ${C.line}`,
  borderRadius: 40,
  boxShadow: "0 2px 4px rgba(0,0,0,.5), 0 40px 80px -40px rgba(0,0,0,.8)",
};

const NAV = [
  { k: "home", icon: "🏠", label: "Home" },
  { k: "issue", icon: "➕", label: "Issue" },
  { k: "video", icon: "🎬", label: "Video" },
  { k: "saran", icon: "📝", label: "Saran" },
  { k: "chat", icon: "💬", label: "Chat" },
  { k: "ai", icon: "✨", label: "AI" },
] as const;
export type NavKey = (typeof NAV)[number]["k"];

/** tampilan web CS Tracker versi HP: logo + akun di atas, menu ikon di bawahnya; isi mulai y = 380 */
export function AppShell({ active, children }: { active: NavKey; children: ReactNode }) {
  return (
    <Bg>
      <div style={{ position: "absolute", left: 48, right: 48, top: 70, height: 110, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <Logo size={92} />
          <div style={{ lineHeight: 1.1 }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 44 }}>CS Tracker</div>
            <div style={{ fontSize: 26, fontWeight: 600, color: C.mute }}>Konten.com</div>
          </div>
        </div>
        <div style={{ width: 92, height: 92, borderRadius: 99, background: "linear-gradient(135deg, #fb923c, #ec4899)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 34, border: `4px solid ${C.panel2}` }}>
          AL
        </div>
      </div>
      <div style={{ position: "absolute", left: 40, right: 40, top: 206, height: 130, display: "flex", gap: 6, padding: 8, borderRadius: 40, background: C.panel, border: `2px solid ${C.line}` }}>
        {NAV.map((n) => {
          const on = n.k === active;
          return (
            <div key={n.k} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 30, background: on ? "#2a2a30" : "transparent", color: on ? C.text : C.mute, boxShadow: on ? "0 10px 26px -10px rgba(0,0,0,.8)" : undefined }}>
              <span style={{ fontSize: 42, lineHeight: 1 }}>{n.icon}</span>
              <span style={{ fontSize: 24, fontWeight: 700 }}>{n.label}</span>
            </div>
          );
        })}
      </div>
      {children}
    </Bg>
  );
}

/** transisi masuk/keluar tiap scene: zoom + blur cepat (whip) */
export function SceneFx({ dur, children }: { dur: number; children: ReactNode }) {
  const frame = useCurrentFrame();
  const inP = lerp(frame, [0, 9], [0, 1], Easing.out(Easing.cubic));
  const outP = lerp(frame, [dur - 7, dur], [0, 1], Easing.in(Easing.cubic));
  const scale = (1.18 - 0.18 * inP) * (1 + 0.22 * outP);
  const blur = (1 - inP) * 14 + outP * 16;
  return (
    <AbsoluteFill style={{ opacity: inP * (1 - outP), transform: `scale(${scale})`, filter: blur > 0.3 ? `blur(${blur}px)` : undefined }}>
      {children}
    </AbsoluteFill>
  );
}

export function Badge({ children, color, solid, size = 26 }: { children: ReactNode; color: string; solid?: boolean; size?: number }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: `${size * 0.22}px ${size * 0.6}px`,
        borderRadius: 99,
        fontSize: size,
        fontWeight: 800,
        whiteSpace: "nowrap",
        color: solid ? "#fff" : color,
        background: solid ? color : `${color}22`,
        border: `2px solid ${color}55`,
      }}
    >
      {children}
    </span>
  );
}
