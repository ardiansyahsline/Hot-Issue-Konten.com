"use client";

/**
 * Mockup perangkat untuk video Studio: HP (ala iPhone modern) & laptop (ala MacBook).
 * Isi layar (children) dirender di ukuran CSS asli — HP 390×844, laptop 1280×800 — lalu seluruh perangkat diskalakan,
 * jadi UI website di dalamnya tetap proporsional & tajam. Semua gerak dari useCurrentFrame (tanpa animasi CSS).
 * Hanya pakai CSS yang didukung renderer browser Remotion: linear-gradient, box-shadow, transform 3D, SVG radialGradient.
 */
import { createContext, useContext, useId, type ReactNode } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";

export type DeviceKind = "phone" | "laptop" | "none";
/** info layar untuk isi di dalamnya: ukuran (px CSS) + ruang yang tertutup status bar / bilah browser */
export type DeviceInfo = { kind: DeviceKind; w: number; h: number; top: number; bottom: number };
export const DeviceCtx = createContext<DeviceInfo>({ kind: "none", w: 390, h: 844, top: 0, bottom: 0 });
export const useDevice = () => useContext(DeviceCtx);

// ukuran asli (px CSS, sebelum diskalakan)
const P_SCREEN_W = 390;
const P_SCREEN_H = 844;
const P_RIM = 4; // bingkai logam
const P_BEZEL = 12; // bezel hitam
const P_EDGE = P_RIM + P_BEZEL;
export const PHONE = {
  screenW: P_SCREEN_W,
  screenH: P_SCREEN_H,
  w: P_SCREEN_W + P_EDGE * 2,
  h: P_SCREEN_H + P_EDGE * 2,
  /** status bar & home indicator (isi layar sebaiknya tidak menaruh teks penting di sini) */
  top: 54,
  bottom: 30,
};

const L_SCREEN_W = 1280;
const L_SCREEN_H = 800;
const L_BEZEL_X = 16;
const L_BEZEL_T = 20;
const L_BEZEL_B = 26;
const L_LID_W = L_SCREEN_W + L_BEZEL_X * 2;
const L_LID_H = L_SCREEN_H + L_BEZEL_T + L_BEZEL_B;
const L_BASE_X = 72; // alas lebih lebar dari layar
const L_BASE_H = 24;
export const LAPTOP = {
  screenW: L_SCREEN_W,
  screenH: L_SCREEN_H,
  w: L_LID_W + L_BASE_X * 2,
  h: L_LID_H + L_BASE_H,
  /** bilah browser di atas halaman */
  top: 44,
  bottom: 0,
};

/** skala bawaan supaya HP pas di kanvas (±68% tinggi, ±82% lebar) — prop `scale` adalah pengali dari ukuran ini */
export const phoneFit = (vw: number, vh: number) => Math.min((vw * 0.82) / PHONE.w, (vh * 0.68) / PHONE.h);
/** skala bawaan laptop (±90% lebar, ±72% tinggi kanvas) */
export const laptopFit = (vw: number, vh: number) => Math.min((vw * 0.9) / LAPTOP.w, (vh * 0.72) / LAPTOP.h);
/** ukuran tampil perangkat di kanvas (px) — berguna untuk menyusun tata letak di komposisi */
export const phoneSize = (vw: number, vh: number, scale = 1) => {
  const s = phoneFit(vw, vh) * scale;
  return { w: PHONE.w * s, h: PHONE.h * s, s };
};
export const laptopSize = (vw: number, vh: number, scale = 1) => {
  const s = laptopFit(vw, vh) * scale;
  return { w: LAPTOP.w * s, h: LAPTOP.h * s, s };
};

const uid = (raw: string) => raw.replace(/[^a-zA-Z0-9_-]/g, "");

/** rgba dari warna hex (#rgb / #rrggbb / #rrggbbaa); warna lain dikembalikan apa adanya */
function rgba(hex: string, a: number) {
  let h = hex.trim().replace("#", "");
  if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6,8}$/i.test(h)) return hex;
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

/** bayangan lantai lembut (SVG radialGradient — CSS radial-gradient tidak didukung renderer) */
function FloorShadow({ w, h, opacity }: { w: number; h: number; opacity: number }) {
  const id = `fs${uid(useId())}`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ position: "absolute", left: 0, top: 0, opacity, overflow: "visible" }} aria-hidden>
      <defs>
        <radialGradient id={id} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#000" stopOpacity="0.75" />
          <stop offset="55%" stopColor="#000" stopOpacity="0.32" />
          <stop offset="100%" stopColor="#000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} fill={`url(#${id})`} />
    </svg>
  );
}

/** cahaya warna di belakang perangkat */
function Aura({ w, h, color, opacity }: { w: number; h: number; color: string; opacity: number }) {
  const id = `au${uid(useId())}`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ position: "absolute", left: 0, top: 0, opacity }} aria-hidden>
      <defs>
        <radialGradient id={id} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={color} stopOpacity="0.55" />
          <stop offset="45%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} fill={`url(#${id})`} />
    </svg>
  );
}

/** kilau kaca tipis yang bergeser pelan (ikut arah miring perangkat) */
function Glass({ w, h, frame, tilt, radius }: { w: number; h: number; frame: number; tilt: number; radius: number }) {
  // pita cahaya menyapu layar tiap ±9 detik, sangat tipis supaya UI tetap terbaca
  const cycle = 270;
  const p = ((frame % cycle) + cycle) % cycle / cycle;
  const x = -w * 0.9 + p * w * 2.4 - tilt * 8;
  return (
    <div style={{ position: "absolute", inset: 0, borderRadius: radius, overflow: "hidden", pointerEvents: "none" }}>
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, rgba(255,255,255,0.075) 0%, rgba(255,255,255,0.02) 22%, rgba(255,255,255,0) 40%)" }} />
      <div
        style={{
          position: "absolute",
          top: -h * 0.25,
          left: x,
          width: w * 0.28,
          height: h * 1.5,
          transform: "rotate(22deg)",
          background: "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.055) 50%, rgba(255,255,255,0) 100%)",
        }}
      />
    </div>
  );
}

/** status bar iPhone: jam, sinyal, wifi, baterai */
function StatusBar() {
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: PHONE.top, pointerEvents: "none" }}>
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0.38) 0%, rgba(0,0,0,0) 100%)" }} />
      <div
        style={{
          position: "absolute",
          left: 0,
          width: 132,
          top: 17,
          textAlign: "center",
          fontFamily: '"Inter Variable", ui-sans-serif, system-ui, sans-serif',
          fontSize: 16.5,
          fontWeight: 650,
          letterSpacing: -0.2,
          color: "#fff",
        }}
      >
        9:41
      </div>
      <svg width="78" height="14" viewBox="0 0 78 14" style={{ position: "absolute", right: 26, top: 21 }} aria-hidden>
        {/* sinyal */}
        {[0, 1, 2, 3].map((i) => (
          <rect key={i} x={i * 5} y={10 - i * 3} width="3.4" height={4 + i * 3} rx="1" fill="#fff" />
        ))}
        {/* wifi */}
        <path d="M27 5.2a10 10 0 0 1 13.4 0" stroke="#fff" strokeWidth="1.9" fill="none" strokeLinecap="round" />
        <path d="M29.4 8a6.4 6.4 0 0 1 8.6 0" stroke="#fff" strokeWidth="1.9" fill="none" strokeLinecap="round" />
        <circle cx="33.7" cy="11.2" r="1.6" fill="#fff" />
        {/* baterai */}
        <rect x="47.5" y="1.5" width="24" height="11.5" rx="3.4" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1.2" />
        <rect x="49.6" y="3.6" width="17" height="7.3" rx="1.8" fill="#fff" />
        <rect x="73" y="5.3" width="1.8" height="4" rx="0.9" fill="rgba(255,255,255,0.5)" />
      </svg>
    </div>
  );
}

export type PhoneProps = {
  children: ReactNode;
  /** derajat miring 3D (±25); 0 = menghadap lurus */
  tilt?: number;
  /** pengali ukuran dari ukuran pas bawaan (1 = ±68% tinggi kanvas) */
  scale?: number;
  /** warna cahaya di belakang HP (mis. warna brand) */
  glow?: string;
  shadow?: boolean;
  /** gerak melayang halus (bawaan nyala) */
  float?: boolean;
};

/**
 * HP ala iPhone modern: bingkai titanium, sudut membulat, dynamic island, status bar, home indicator,
 * kilau kaca, bayangan lantai, tilt 3D halus + melayang pelan. Isi layar = 390×844 px CSS.
 */
export function Phone({ children, tilt = 0, scale = 1, glow, shadow = true, float = true }: PhoneProps) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const s = phoneFit(width, height) * Math.max(0.05, scale);
  const W = PHONE.w;
  const H = PHONE.h;
  const t = Math.max(-35, Math.min(35, tilt));
  // melayang & bergoyang sangat halus supaya terasa "hidup"
  const fy = float ? Math.sin(frame / 34) * 7 : 0;
  const ry = -t + (float ? Math.sin(frame / 57) * 1.1 : 0);
  const rx = Math.abs(t) * 0.32 + (float ? Math.cos(frame / 71) * 0.7 : 0);
  const rz = t * 0.06;
  const R = 66; // radius luar
  const shadowLift = 1 - (fy + 7) / 14; // HP naik -> bayangan lebih tipis

  return (
    <div style={{ position: "relative", width: W * s, height: H * s, flex: "none" }}>
      <div style={{ position: "absolute", left: (W * s - W) / 2, top: (H * s - H) / 2, width: W, height: H, transform: `scale(${s})`, transformOrigin: "50% 50%" }}>
        {glow && (
          <div style={{ position: "absolute", left: -W * 0.45, top: -H * 0.18, width: W * 1.9, height: H * 1.36 }}>
            <Aura w={W * 1.9} h={H * 1.36} color={glow} opacity={0.85 + Math.sin(frame / 40) * 0.15} />
          </div>
        )}
        {shadow && (
          <div style={{ position: "absolute", left: W * 0.08, top: H - 10, width: W * 0.84, height: 70, transform: `scale(${0.92 + shadowLift * 0.08})` }}>
            <FloorShadow w={W * 0.84} h={70} opacity={0.55 + shadowLift * 0.3} />
          </div>
        )}
        <div
          style={{
            position: "absolute",
            inset: 0,
            transform: `translateY(${fy}px) perspective(2200px) rotateY(${ry}deg) rotateX(${rx}deg) rotateZ(${rz}deg)`,
            transformOrigin: "50% 50%",
          }}
        >
          {/* tombol samping */}
          {[
            { left: -3, top: 150, h: 34 },
            { left: -3, top: 208, h: 64 },
            { left: -3, top: 284, h: 64 },
            { right: -3, top: 238, h: 102 },
          ].map((b, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: b.left,
                right: b.right,
                top: b.top,
                width: 6,
                height: b.h,
                borderRadius: 3,
                background: "linear-gradient(90deg, #26262b 0%, #5a5a62 50%, #26262b 100%)",
              }}
            />
          ))}
          {/* bingkai logam */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: R,
              background: "linear-gradient(135deg, #6b6b74 0%, #2c2c31 16%, #1a1a1e 46%, #34343a 74%, #77777f 100%)",
              boxShadow: shadow
                ? `0 60px 110px -40px rgba(0,0,0,0.9), 0 30px 60px -30px rgba(0,0,0,0.75)${glow ? `, 0 0 70px -6px ${rgba(glow, 0.45)}` : ""}`
                : glow
                  ? `0 0 70px -6px ${rgba(glow, 0.45)}`
                  : undefined,
            }}
          />
          {/* bezel hitam */}
          <div
            style={{
              position: "absolute",
              inset: P_RIM,
              borderRadius: R - P_RIM,
              background: "#030304",
              border: "1px solid rgba(255,255,255,0.07)",
            }}
          />
          {/* layar */}
          <div
            style={{
              position: "absolute",
              left: P_EDGE,
              top: P_EDGE,
              width: P_SCREEN_W,
              height: P_SCREEN_H,
              borderRadius: R - P_EDGE + 2,
              overflow: "hidden",
              background: "#000",
            }}
          >
            <DeviceCtx.Provider value={{ kind: "phone", w: P_SCREEN_W, h: P_SCREEN_H, top: PHONE.top, bottom: PHONE.bottom }}>
              <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>{children}</div>
            </DeviceCtx.Provider>
            <StatusBar />
            {/* dynamic island */}
            <div style={{ position: "absolute", left: (P_SCREEN_W - 124) / 2, top: 11, width: 124, height: 36, borderRadius: 18, background: "#000" }}>
              <div style={{ position: "absolute", right: 14, top: 12, width: 12, height: 12, borderRadius: 6, background: "linear-gradient(135deg, #1e293b 0%, #0b0f19 70%)" }} />
            </div>
            {/* home indicator */}
            <div style={{ position: "absolute", left: (P_SCREEN_W - 136) / 2, bottom: 8, width: 136, height: 5, borderRadius: 3, background: "rgba(255,255,255,0.78)" }} />
            <Glass w={P_SCREEN_W} h={P_SCREEN_H} frame={frame} tilt={t} radius={R - P_EDGE + 2} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** bilah browser gelap (lampu jendela + alamat situs) */
function BrowserBar({ url }: { url: string }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        height: LAPTOP.top,
        background: "linear-gradient(180deg, #232327 0%, #1b1b1e 100%)",
        borderBottom: "1px solid #2c2c31",
        fontFamily: '"Inter Variable", ui-sans-serif, system-ui, sans-serif',
      }}
    >
      {["#ff5f57", "#febc2e", "#28c840"].map((c, i) => (
        <span key={c} style={{ position: "absolute", left: 18 + i * 20, top: 16, width: 12, height: 12, borderRadius: 6, background: c }} />
      ))}
      <span style={{ position: "absolute", left: 92, top: 10, fontSize: 18, color: "#52525b", letterSpacing: 10 }}>‹›</span>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 8,
          width: 480,
          height: 28,
          marginLeft: -240,
          borderRadius: 8,
          background: "#2a2a2f",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 7,
          fontSize: 13,
          fontWeight: 500,
          color: "#d4d4d8",
        }}
      >
        <svg width="11" height="13" viewBox="0 0 11 13" aria-hidden>
          <rect x="1" y="5.5" width="9" height="7" rx="1.6" fill="#a1a1aa" />
          <path d="M3 5.5V4a2.5 2.5 0 0 1 5 0v1.5" stroke="#a1a1aa" strokeWidth="1.5" fill="none" />
        </svg>
        {url}
      </div>
      <span style={{ position: "absolute", right: 20, top: 9, fontSize: 18, color: "#71717a" }}>＋</span>
    </div>
  );
}

export type LaptopProps = {
  children: ReactNode;
  /** derajat miring 3D (±25) */
  tilt?: number;
  /** pengali ukuran dari ukuran pas bawaan (1 = ±90% lebar / ±72% tinggi kanvas) */
  scale?: number;
  /** alamat di bilah browser */
  url?: string;
  /** sembunyikan bilah browser (mis. isi berupa video/gambar penuh) */
  bare?: boolean;
  glow?: string;
  shadow?: boolean;
  float?: boolean;
};

/**
 * Laptop ala MacBook: layar 1280×800 px CSS dengan bezel tipis + kamera, bilah browser, engsel, alas aluminium
 * dengan lekukan jari, bayangan lantai, perspektif + tilt 3D halus.
 */
export function Laptop({ children, tilt = 0, scale = 1, url = "cstracker.konten.com", bare = false, glow, shadow = true, float = true }: LaptopProps) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const s = laptopFit(width, height) * Math.max(0.05, scale);
  const W = LAPTOP.w;
  const H = LAPTOP.h;
  const t = Math.max(-35, Math.min(35, tilt));
  const fy = float ? Math.sin(frame / 40) * 5 : 0;
  const ry = -t * 0.8 + (float ? Math.sin(frame / 63) * 0.6 : 0);
  const rx = 6 + Math.abs(t) * 0.18 + (float ? Math.cos(frame / 77) * 0.4 : 0);
  const top = bare ? 0 : LAPTOP.top;

  return (
    <div style={{ position: "relative", width: W * s, height: H * s, flex: "none" }}>
      <div style={{ position: "absolute", left: (W * s - W) / 2, top: (H * s - H) / 2, width: W, height: H, transform: `scale(${s})`, transformOrigin: "50% 50%" }}>
        {glow && (
          <div style={{ position: "absolute", left: -W * 0.2, top: -H * 0.25, width: W * 1.4, height: H * 1.4 }}>
            <Aura w={W * 1.4} h={H * 1.4} color={glow} opacity={0.75 + Math.sin(frame / 44) * 0.12} />
          </div>
        )}
        {shadow && (
          <div style={{ position: "absolute", left: W * 0.02, top: H - 26, width: W * 0.96, height: 64 }}>
            <FloorShadow w={W * 0.96} h={64} opacity={0.85} />
          </div>
        )}
        <div style={{ position: "absolute", inset: 0, transform: `translateY(${fy}px) perspective(3000px) rotateY(${ry}deg) rotateX(${rx}deg)`, transformOrigin: "50% 100%" }}>
          {/* tutup layar */}
          <div
            style={{
              position: "absolute",
              left: L_BASE_X,
              top: 0,
              width: L_LID_W,
              height: L_LID_H,
              borderRadius: "24px 24px 8px 8px",
              background: "linear-gradient(180deg, #3a3a40 0%, #232327 100%)",
              padding: 2,
              boxSizing: "border-box",
              boxShadow: shadow ? "0 40px 90px -40px rgba(0,0,0,0.85)" : undefined,
            }}
          >
            <div style={{ position: "absolute", inset: 2, borderRadius: "22px 22px 6px 6px", background: "#050506" }} />
            {/* kamera */}
            <div style={{ position: "absolute", left: L_LID_W / 2 - 4, top: 7, width: 8, height: 8, borderRadius: 4, background: "#16161a", border: "1px solid #2a2a30" }} />
            <div
              style={{
                position: "absolute",
                left: L_BEZEL_X,
                top: L_BEZEL_T,
                width: L_SCREEN_W,
                height: L_SCREEN_H,
                overflow: "hidden",
                borderRadius: 6,
                background: "#000",
              }}
            >
              <DeviceCtx.Provider value={{ kind: "laptop", w: L_SCREEN_W, h: L_SCREEN_H, top, bottom: 0 }}>
                <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>{children}</div>
              </DeviceCtx.Provider>
              {!bare && <BrowserBar url={url} />}
              <Glass w={L_SCREEN_W} h={L_SCREEN_H} frame={frame} tilt={t} radius={6} />
            </div>
          </div>
          {/* engsel */}
          <div style={{ position: "absolute", left: L_BASE_X + 40, top: L_LID_H - 2, width: L_LID_W - 80, height: 8, borderRadius: "0 0 6px 6px", background: "linear-gradient(180deg, #111114 0%, #2a2a2f 100%)" }} />
          {/* alas */}
          <div
            style={{
              position: "absolute",
              left: 0,
              top: L_LID_H + 4,
              width: W,
              height: L_BASE_H - 4,
              borderRadius: "4px 4px 22px 22px",
              background: "linear-gradient(180deg, #c9c9cf 0%, #8f8f97 38%, #5d5d65 78%, #3a3a40 100%)",
              boxShadow: "0 18px 30px -12px rgba(0,0,0,0.8)",
            }}
          >
            <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 2, borderRadius: 2, background: "rgba(255,255,255,0.55)" }} />
            <div style={{ position: "absolute", left: W / 2 - 110, top: 0, width: 220, height: 9, borderRadius: "0 0 12px 12px", background: "linear-gradient(180deg, #6f6f77 0%, #9a9aa2 100%)" }} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Layar polos tanpa bingkai (mis. untuk adegan split / layar penuh): isi tetap di ukuran asli HP / laptop,
 * diskalakan supaya pas di kotak w×h px.
 */
export function ScreenBox({ w, h, kind = "phone", radius = 0, children }: { w: number; h: number; kind?: "phone" | "laptop"; radius?: number; children: ReactNode }) {
  const sw = kind === "laptop" ? L_SCREEN_W : P_SCREEN_W;
  const sh = kind === "laptop" ? L_SCREEN_H : P_SCREEN_H;
  const s = Math.min(w / sw, h / sh);
  return (
    <div style={{ position: "relative", width: sw * s, height: sh * s, overflow: "hidden", borderRadius: radius, flex: "none" }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: sw, height: sh, transform: `scale(${s})`, transformOrigin: "0 0", overflow: "hidden" }}>
        <DeviceCtx.Provider value={{ kind, w: sw, h: sh, top: 0, bottom: 0 }}>{children}</DeviceCtx.Provider>
      </div>
    </div>
  );
}
