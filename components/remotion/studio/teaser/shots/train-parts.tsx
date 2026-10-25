"use client";

/**
 * Bagian UI adegan 8 "Train your AI" (teaser) — dibuat ulang dari komponen website asli:
 *  - components/ai/CharacterWizard.tsx (modal max-w 540: header "🧠 Train your AI" + tahap, 4 segmen progres oranye,
 *    halaman kuis A/B/C/D, halaman hasil, halaman "Mau dilatih jadi apa AI-mu?" 2 kolom ROLES + "✓ cocok dengan tipe X",
 *    footer "← Kembali" / "Lanjut →" / "Lihat hasil →")
 *  - components/ai/TypeScene.tsx (latar lembut warna kelompok, dekorasi bergerak per kelompok, chibi pop, 4 huruf membalik, chip headline)
 *  - lib/trainAi.ts + lib/trainAiData.ts (QUIZ_QS, ROLES, TYPE_PROFILES) & lib/aiPersona.ts (GROUPS, typeInfo, registerCustom)
 * Semua gerak dihitung dari frame (CSS animation ts-* / hero-* website diganti hitungan frame). Acak = random(seed).
 */
import { useMemo, type CSSProperties, type ReactNode } from "react";
import { random } from "remotion";
import HeroArt from "@/components/ai/HeroArt";
import { CHIBI_HAIRS, CHIBI_SKINS, GROUPS, registerCustom, typeGroup, typeInfo } from "@/lib/aiPersona";
import { QUIZ_QS, ROLES, typeProfile } from "@/lib/trainAi";
import { Shine } from "../../fx";
import { DISPLAY, FONT, Z } from "../../screens/ui";
import { clamp01, EASE, prog, rgba, springAt } from "../kit";

// ---------------------------------------------------------------------------------------------
// data asli
// ---------------------------------------------------------------------------------------------
export const T_TYPE = "ENFP";
export const T_GROUP = GROUPS[typeGroup(T_TYPE)];
export const T_INFO = typeInfo(T_TYPE);
const PROF = typeProfile(T_TYPE);
export const T_HEADLINE = PROF?.headline ?? T_INFO.tag;
const T_DESC = PROF?.desc ?? "";
const FIT = PROF?.fitRoles ?? [];
/** peran yang dipilih di adegan (cocok dengan tipe ENFP) */
export const T_ROLE = "video_editor";
export const T_ROLE_IDX = Math.max(0, ROLES.findIndex((r) => r.id === T_ROLE));
/** chibi draf (sama seperti PREVIEW "__karakter_draft__" di CharacterWizard: rambut 3, kulit & warna rambut bawaan, orb) */
export const T_DRAFT = "__teaser_karakter_draft__";
registerCustom(T_DRAFT, { type: T_TYPE, hair: 3, skin: CHIBI_SKINS[0], hc: CHIBI_HAIRS[1], prop: "orb" });

/** 3 pertanyaan terakhir kuis (10/12, 11/12, 12/12 — "Gaya menjalani hari") + jawaban ala ENFP (P) */
export const T_QUIZ: { qi: number; pick: number }[] = [
  { qi: Math.max(0, QUIZ_QS.length - 3), pick: 3 },
  { qi: Math.max(0, QUIZ_QS.length - 2), pick: 2 },
  { qi: Math.max(0, QUIZ_QS.length - 1), pick: 3 },
];
export const T_STAGES = ["Mulai", "Kenali kepribadianmu", "Latih perannya", "Nama & simpan"];
export const T_QN = QUIZ_QS.length;

export const OR = "#f97316";
const OR300 = "#fdba74";
const SHADOW_POP = "inset 0 1px 0 rgba(255,255,255,0.05), 0 8px 24px -8px rgba(0,0,0,0.6)";
const btnGhost: CSSProperties = { borderRadius: 12, border: `1px solid ${Z[800]}`, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, color: Z[300], whiteSpace: "nowrap" };

// ---------------------------------------------------------------------------------------------
// efek ketuk
// ---------------------------------------------------------------------------------------------
/** indikator jari: datang, tekan tepat di `hit` (detik adegan), cincin riak, lalu terangkat */
export function TapFx({ f, fps, hit, x, y, from = [46, 70] }: { f: number; fps: number; hit: number; x: number | string; y: number | string; from?: [number, number] }) {
  const s = f / fps;
  const a = hit - 0.3;
  const b = hit + 0.24;
  if (s < a || s > b) return null;
  const inP = prog(f, fps, a, hit - 0.04, EASE.out);
  const outP = prog(f, fps, hit + 0.08, b, EASE.in);
  const dx = from[0] * (1 - inP) + 16 * outP;
  const dy = from[1] * (1 - inP) + 26 * outP;
  const hf = Math.round(hit * fps);
  const press = f >= hf - 2 && f <= hf + 1 ? 0.78 : 1;
  const ring = (f - hf) / (0.42 * fps);
  const op = clamp01(inP * 1.6) * (1 - outP);
  return (
    <span style={{ position: "absolute", left: x, top: y, width: 0, height: 0, zIndex: 20, pointerEvents: "none" }}>
      {ring >= 0 && ring <= 1 && (
        <span style={{ position: "absolute", left: -16, top: -16, width: 32, height: 32, borderRadius: 999, border: `2.5px solid rgba(255,255,255,${(0.9 * (1 - ring)).toFixed(3)})`, transform: `scale(${(1 + EASE.out(ring) * 1.9).toFixed(3)})` }} />
      )}
      <span
        style={{
          position: "absolute",
          left: dx - 15,
          top: dy - 15,
          width: 30,
          height: 30,
          borderRadius: 999,
          background: "rgba(255,255,255,0.86)",
          border: "2px solid #ffffff",
          boxShadow: "0 6px 16px rgba(0,0,0,0.5)",
          transform: `scale(${press})`,
          opacity: op,
        }}
      />
    </span>
  );
}

/** riak warna di dalam tombol yang diketuk (induk overflow hidden) */
function Ripple({ f, fps, hit, x, y, color = OR }: { f: number; fps: number; hit: number; x: number; y: number; color?: string }) {
  const k = (f - Math.round(hit * fps)) / (0.5 * fps);
  if (k < 0 || k > 1) return null;
  const r = 14 + 300 * EASE.out(k);
  return <span style={{ position: "absolute", left: x - r, top: y - r, width: r * 2, height: r * 2, borderRadius: 999, background: rgba(color, 0.3 * (1 - k)), pointerEvents: "none" }} />;
}

/** bintang kecil memancar dari titik ketuk (Sparkles screens/ui versi detik) */
function Burst({ f, fps, at, x, y, n = 8, r = 46, color = "#fde68a" }: { f: number; fps: number; at: number; x: number; y: number; n?: number; r?: number; color?: string }) {
  const k = (f - Math.round(at * fps)) / (0.55 * fps);
  if (k < 0 || k > 1) return null;
  const e = EASE.out(k);
  return (
    <svg width={2} height={2} style={{ position: "absolute", left: x, top: y, overflow: "visible", pointerEvents: "none", zIndex: 19 }} aria-hidden>
      {Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2 + 0.35;
        const d = r * (0.35 + 0.9 * e) * (i % 2 ? 0.8 : 1);
        const sz = (3.4 + (i % 3)) * (1 - k * 0.8);
        const cx = Math.cos(a) * d;
        const cy = Math.sin(a) * d;
        return <path key={i} d={`M${cx} ${cy - sz * 2}L${cx + sz * 0.5} ${cy - sz * 0.5}L${cx + sz * 2} ${cy}L${cx + sz * 0.5} ${cy + sz * 0.5}L${cx} ${cy + sz * 2}L${cx - sz * 0.5} ${cy + sz * 0.5}L${cx - sz * 2} ${cy}L${cx - sz * 0.5} ${cy - sz * 0.5}Z`} fill={i % 2 ? color : "#ffffff"} opacity={(1 - k).toFixed(3)} />;
      })}
    </svg>
  );
}

/** pantulan kecil saat dipilih: tekan (antisipasi) → melonjak → tenang */
const bump = (f: number, fps: number, hit: number) => {
  const k = (f - Math.round(hit * fps)) / fps;
  if (k < -0.07) return 1;
  if (k < 0) return 0.975;
  return 1 + 0.035 * Math.exp(-k * 9) * Math.cos(k * 26);
};

// ---------------------------------------------------------------------------------------------
// halaman (masuk geser dari kanan dengan pegas, keluar ke kiri + blur sebanding kecepatan)
// ---------------------------------------------------------------------------------------------
export function Page({ f, fps, enter, exit, children }: { f: number; fps: number; enter: number; exit?: number; children: ReactNode }) {
  const s = f / fps;
  if (enter > 0 && s < enter) return null;
  if (exit !== undefined && s > exit + 0.24) return null;
  const xAt = (ff: number) => {
    const pin = enter <= 0 ? 1 : springAt(ff, fps, enter, { damping: 17, stiffness: 200, mass: 0.7 });
    const pout = exit === undefined ? 0 : prog(ff, fps, exit, exit + 0.22, EASE.in);
    return { x: (1 - pin) * 80 - pout * 110, pin, pout };
  };
  const a = xAt(f);
  const v = Math.abs(xAt(f + 1).x - a.x);
  const blur = Math.min(5, Math.max(0, v - 2) * 0.35);
  return (
    <div
      style={{
        position: "absolute",
        left: 16,
        right: 16,
        top: 16,
        transform: `translateX(${a.x.toFixed(2)}px)`,
        opacity: clamp01(a.pin * 1.5) * (1 - a.pout),
        filter: blur > 0.2 ? `blur(${blur.toFixed(2)}px)` : undefined,
      }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// kerangka modal Train your AI (CharacterWizard)
// ---------------------------------------------------------------------------------------------
export function TrainModal({
  w,
  h,
  sub,
  bars,
  next,
  nextOn,
  nextPress = 1,
  children,
  footerFx,
  sheen = 0,
  headOp = 1,
  subOp = 1,
  barsOp = 1,
  dim = 0,
}: {
  w: number;
  h: number;
  sub: ReactNode;
  /** isi 0..1 tiap segmen progres */
  bars: number[];
  next: string;
  nextOn: boolean;
  nextPress?: number;
  children: ReactNode;
  footerFx?: ReactNode;
  /** posisi kilau kaca 0..1 saat modal masuk */
  sheen?: number;
  /** opasitas judul header / teks tahap / progres — memudar saat kamera mendorong header ke pita caption */
  headOp?: number;
  subOp?: number;
  barsOp?: number;
  /** rack focus: header & footer ikut buram + redup (0..1) */
  dim?: number;
}) {
  const soft: CSSProperties | undefined = dim > 0.02 ? { filter: `blur(${(dim * 2.6).toFixed(2)}px)`, opacity: 1 - dim * 0.5 } : undefined;
  return (
    <div
      style={{
        position: "relative",
        width: w,
        height: h,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        borderRadius: 16,
        border: `1px solid ${Z[800]}`,
        background: Z[900],
        boxShadow: `${SHADOW_POP}, 0 40px 90px -30px rgba(0,0,0,0.85)`,
        fontFamily: FONT,
        color: Z[100],
        lineHeight: 1.5,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid rgba(39,39,42,0.8)", padding: "12px 16px", ...soft }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: DISPLAY, fontSize: 15, fontWeight: 700, lineHeight: 1.45, opacity: headOp }}>🧠 Train your AI</div>
          <div style={{ fontSize: 11.5, color: Z[500], whiteSpace: "nowrap", overflow: "hidden", height: 17, opacity: subOp }}>{sub}</div>
        </div>
        <span style={{ marginLeft: "auto", borderRadius: 8, padding: "4px 8px", color: Z[500], fontSize: 14, opacity: headOp }}>✕</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 4, padding: "12px 16px 0", opacity: barsOp, ...soft }}>
        {T_STAGES.map((st, i) => (
          <span key={st} style={{ position: "relative", height: 6, borderRadius: 99, background: Z[800], overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", borderRadius: 99, background: OR, width: `${(clamp01(bars[i] ?? 0) * 100).toFixed(2)}%`, boxShadow: `0 0 8px ${rgba(OR, 0.7)}` }} />
          </span>
        ))}
      </div>
      <div style={{ position: "relative", flex: 1, minHeight: 0, overflow: "hidden" }}>
        {children}
        {/* isi yang terpotong tepi bawah memudar (gradasi linear ke warna modal — aman untuk web renderer) */}
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 26, background: `linear-gradient(180deg, ${rgba(Z[900], 0)} 0%, ${rgba(Z[900], 0.92)} 70%, ${Z[900]} 100%)`, pointerEvents: "none" }} />
      </div>
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 8, borderTop: "1px solid rgba(39,39,42,0.8)", padding: "12px 16px", ...soft }}>
        <span style={btnGhost}>← Kembali</span>
        <span
          style={{
            position: "relative",
            marginLeft: "auto",
            borderRadius: 12,
            background: OR,
            padding: "8px 16px",
            fontSize: 12.5,
            fontWeight: 700,
            color: "#fff",
            whiteSpace: "nowrap",
            opacity: nextOn ? 1 : 0.5,
            transform: `scale(${nextPress.toFixed(4)})`,
          }}
        >
          {next}
          {footerFx}
        </span>
      </div>
      {sheen > 0 && sheen < 1 && <Shine p={sheen} alpha={0.09} radius={16} angle={115} />}
    </div>
  );
}

/** teks tahap di header: "Kenali kepribadianmu · 11/12" — angka berganti menggulung */
export function StageSub({ f, fps, label, n, changeAt }: { f: number; fps: number; label: string; n?: number; changeAt?: number }) {
  if (n === undefined) return <span>{label}</span>;
  const k = changeAt === undefined ? 1 : prog(f, fps, changeAt, changeAt + 0.18, EASE.out);
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline" }}>
      {label} ·&nbsp;
      <span style={{ position: "relative", display: "inline-block", height: 17, overflow: "hidden", verticalAlign: "top" }}>
        {k < 1 && <span style={{ display: "block", transform: `translateY(${(-k * 17).toFixed(1)}px)`, opacity: 1 - k }}>{n - 1}/{T_QN}</span>}
        <span style={{ display: "block", position: k < 1 ? "absolute" : "relative", top: 0, transform: `translateY(${((1 - k) * 17).toFixed(1)}px)`, color: k < 1 ? OR300 : undefined }}>
          {n}/{T_QN}
        </span>
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// halaman kuis
// ---------------------------------------------------------------------------------------------
export function QuizCard({ f, fps, qi, pick, hit, enter }: { f: number; fps: number; qi: number; pick: number; hit: number; enter: number }) {
  const q = QUIZ_QS[qi];
  const hf = Math.round(hit * fps);
  return (
    <div>
      <div style={{ marginBottom: 4, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: T_GROUP.color }}>{q.dimTitle}</div>
      <div style={{ marginBottom: 12, fontSize: 15.5, fontWeight: 700, lineHeight: 1.375, color: Z[100] }}>{q.q}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {q.options.map((o, i) => {
          const on = i === pick && f >= hf;
          const isPick = i === pick;
          const ap = enter <= 0 ? 1 : springAt(f, fps, enter + 0.03 + i * 0.035, { damping: 16, stiffness: 210, mass: 0.6 });
          const sc = isPick ? bump(f, fps, hit) : 1;
          const shine = isPick ? prog(f, fps, hit + 0.02, hit + 0.42, EASE.inOut) : 0;
          return (
            <div
              key={o.label}
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                gap: 12,
                borderRadius: 12,
                border: `1px solid ${on ? OR : Z[800]}`,
                background: on ? rgba(OR, 0.1) : "transparent",
                padding: "10px 14px",
                fontSize: 13.5,
                lineHeight: 1.5,
                color: on ? OR300 : Z[300],
                textAlign: "left",
                transform: `translateX(${((1 - ap) * 36).toFixed(2)}px) scale(${sc.toFixed(4)})`,
                opacity: clamp01(ap * 1.4),
                boxShadow: on ? `0 0 0 1px ${rgba(OR, 0.35)}, 0 10px 26px -12px ${rgba(OR, 0.75)}` : undefined,
              }}
            >
              {isPick && (
                <span style={{ position: "absolute", inset: 0, borderRadius: 12, overflow: "hidden", pointerEvents: "none" }}>
                  <Ripple f={f} fps={fps} hit={hit} x={334} y={34} />
                  {shine > 0 && shine < 1 && <Shine p={shine} alpha={0.22} radius={12} />}
                </span>
              )}
              <span
                style={{
                  position: "relative",
                  display: "flex",
                  width: 24,
                  height: 24,
                  flex: "none",
                  boxSizing: "border-box",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 700,
                  background: on ? OR : "transparent",
                  color: on ? "#fff" : Z[500],
                  border: on ? "none" : `1px solid ${Z[700]}`,
                }}
              >
                {String.fromCharCode(65 + i)}
              </span>
              <span style={{ position: "relative", minWidth: 0 }}>{o.label}</span>
              {isPick && <TapFx f={f} fps={fps} hit={hit} x="calc(100% - 13px)" y="calc(100% - 9px)" from={[40, 64]} />}
            </div>
          );
        })}
      </div>
      <p style={{ margin: 0, marginTop: 12, fontSize: 11.5, color: Z[500] }}>Pilih yang paling sering terjadi, bukan yang paling ideal.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// halaman hasil: TypeScene (NF = hati & kilau) + "Karakter kamu"
// ---------------------------------------------------------------------------------------------
const HEARTS: [number, number, number][] = [
  [36, 60, 0],
  [196, 54, 0.8],
  [58, 30, 1.6],
  [176, 24, 2.3],
];
const TWINKLES: [number, number][] = [
  [30, 30],
  [204, 84],
];
/** dekorasi kelompok Diplomat (NF) dari TypeScene: hati melayang (ts-float 3,2 dtk) & kilau (ts-twinkle 1,8 dtk) */
function DecoNF({ s, c }: { s: number; c: string }) {
  return (
    <>
      {HEARTS.map(([x, y, d], i) => {
        const k = (((s + d) % 3.2) + 3.2) % 3.2 / 3.2;
        const ty = 8 - 34 * k * k;
        const op = k < 0.25 ? (k / 0.25) * 0.9 : 0.9 * (1 - (k - 0.25) / 0.75);
        return <path key={i} transform={`translate(0 ${ty.toFixed(2)})`} opacity={(0.85 * op).toFixed(3)} d={`M${x} ${y} c-6 -8 -16 -2 -10 6 l10 9 l10 -9 c6 -8 -4 -14 -10 -6z`} fill={i % 2 ? "#f472b6" : c} />;
      })}
      {TWINKLES.map(([x, y], i) => {
        const ph = (((s + i * 0.7) % 1.8) + 1.8) % 1.8 / 1.8;
        const v = 0.5 - 0.5 * Math.cos(ph * Math.PI * 2);
        const sc = 0.4 + 0.75 * v;
        return <path key={i} opacity={(0.3 + 0.7 * v).toFixed(3)} transform={`translate(${x} ${y}) scale(${sc.toFixed(3)}) translate(${-x} ${-y})`} d={`M${x} ${y - 7} l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2z`} fill="#fde68a" />;
      })}
    </>
  );
}

/** sinar halus yang berputar di belakang chibi saat hasil terungkap */
function Rays({ s, at, c }: { s: number; at: number; c: string }) {
  const p = clamp01((s - at + 0.05) / 0.35);
  if (p <= 0) return null;
  const fade = 1 - clamp01((s - at - 1.6) / 1.2) * 0.55;
  const rot = (s - at) * 14;
  return (
    <svg viewBox="-100 -100 200 200" style={{ position: "absolute", left: "50%", top: 92, width: 300, height: 300, marginLeft: -150, marginTop: -150, opacity: p * fade, pointerEvents: "none", overflow: "visible" }} aria-hidden>
      <g transform={`rotate(${rot.toFixed(2)}) scale(${(0.6 + 0.4 * EASE.out(p)).toFixed(3)})`}>
        {Array.from({ length: 12 }, (_, i) => (
          <path key={i} d="M0 0 L-7 -98 L7 -98 Z" fill={i % 2 ? rgba(c, 0.22) : "rgba(255,255,255,0.08)"} transform={`rotate(${i * 30})`} />
        ))}
      </g>
    </svg>
  );
}

/** antisipasi: energi berkumpul di titik chibi (titik cahaya + partikel menuju pusat) lalu pecah tepat di `at` */
function Charge({ s, from, at, c }: { s: number; from: number; at: number; c: string }) {
  if (s < from || s > at + 0.3) return null;
  const p = clamp01((s - from) / Math.max(0.05, at - from));
  const burst = clamp01((s - at) / 0.3);
  const r = burst > 0 ? 40 + 120 * EASE.out(burst) : 4 + 30 * p * p;
  const op = burst > 0 ? 1 - burst : 0.25 + 0.75 * p;
  return (
    <svg viewBox="-100 -100 200 200" style={{ position: "absolute", left: "50%", top: 80, width: 200, height: 200, marginLeft: -100, marginTop: -100, overflow: "visible", pointerEvents: "none" }} aria-hidden>
      <defs>
        <radialGradient id="trainCharge" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="35%" stopColor={c} stopOpacity="0.85" />
          <stop offset="100%" stopColor={c} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle r={r} fill="url(#trainCharge)" opacity={op.toFixed(3)} />
      {burst <= 0 &&
        Array.from({ length: 12 }, (_, i) => {
          const a = (i / 12) * Math.PI * 2 + 0.3;
          const pi = clamp01((s - from - (i % 4) * 0.04) / Math.max(0.05, at - from - 0.12));
          const d = 96 * (1 - EASE.inOut(pi)) + 6;
          return <circle key={i} cx={Math.cos(a) * d} cy={Math.sin(a) * d} r={2.2 + (i % 3) * 0.8} fill={i % 3 ? "#ffffff" : "#fde68a"} opacity={(clamp01(pi * 3) * (1 - pi * 0.4)).toFixed(3)} />;
        })}
    </svg>
  );
}

export function TypeSceneFx({ f, fps, enter, at, hopAt }: { f: number; fps: number; enter: number; at: number; hopAt: number }) {
  const s = f / fps;
  const G = T_GROUP;
  const bgP = prog(f, fps, enter, at + 0.15, EASE.inOut);
  const decoP = prog(f, fps, enter + 0.12, at, EASE.out);
  // chibi muncul tepat di ketukan: pegas mulai 3 frame lebih awal → di frame pukulan sudah ±90% & tajam, puncak overshoot 1–3 frame sesudahnya (ts-pop .4 → 1.06 → 1)
  const chib = springAt(f, fps, at - 3 / fps, { damping: 10, stiffness: 210, mass: 0.7 });
  // lompat sekali (hero-hop) di ketukan konfeti
  const hk = (s - hopAt) / 0.44;
  const hop = hk > 0 && hk < 1 ? Math.sin(hk * Math.PI) * (hk < 0.5 ? 1 : 1) : 0;
  const squash = hk > 0.85 && hk < 1.15 ? 1 - 0.06 * Math.sin(((hk - 0.85) / 0.3) * Math.PI) : 1;
  const chipP = springAt(f, fps, at + 0.3, { damping: 18, stiffness: 160 });
  // ledakan cahaya hangat di BELAKANG chibi & huruf saat konfeti (huruf tetap terbaca)
  const wb = (s - hopAt) / 0.45;
  const sweep = prog(f, fps, at + 0.32, at + 0.9, EASE.inOut);
  return (
    <div style={{ position: "relative", overflow: "hidden", borderRadius: 16 }}>
      {/* latar radial lembut warna kelompok (radial-gradient TypeScene → SVG) */}
      <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0 }} aria-hidden>
        <defs>
          <radialGradient id="trainTsBg" cx="50%" cy="100%" r="100%">
            <stop offset="0%" stopColor={G.color} stopOpacity={(0.22 * bgP).toFixed(3)} />
            <stop offset="45%" stopColor={G.color} stopOpacity={(0.08 * bgP).toFixed(3)} />
            <stop offset="72%" stopColor={G.color} stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="100" height="100" fill="url(#trainTsBg)" />
      </svg>
      <Rays s={s} at={at} c={G.color} />
      {wb > 0 && wb < 1 && (
        <svg viewBox="-100 -100 200 200" style={{ position: "absolute", left: "50%", top: 118, width: 320, height: 320, marginLeft: -160, marginTop: -160, overflow: "visible", pointerEvents: "none" }} aria-hidden>
          <defs>
            <radialGradient id="trainWarm" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#fff7ed" stopOpacity="0.85" />
              <stop offset="35%" stopColor="#fde68a" stopOpacity="0.45" />
              <stop offset="100%" stopColor={OR} stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle r={40 + 70 * EASE.out(wb)} fill="url(#trainWarm)" opacity={(1 - wb).toFixed(3)} />
          <circle r={30 + 90 * EASE.out(wb)} fill="none" stroke="#fde68a" strokeWidth={2.5 * (1 - wb)} opacity={(0.8 * (1 - wb)).toFixed(3)} />
        </svg>
      )}
      <Charge s={s} from={enter + 0.04} at={at} c={G.color} />
      <svg viewBox="0 0 232 110" preserveAspectRatio="xMidYMid meet" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: decoP }} aria-hidden>
        <DecoNF s={Math.max(0, s - enter)} c={G.color} />
      </svg>
      <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 16, paddingBottom: 12 }}>
        <div
          style={{
            width: 128,
            height: 128,
            transform: `translateY(${((1 - chib) * 26 - hop * 14).toFixed(2)}px) scale(${(0.4 + 0.6 * chib).toFixed(4)}) scaleY(${squash.toFixed(4)})`,
            transformOrigin: "50% 100%",
            opacity: clamp01(chib * 2.2),
          }}
        >
          <HeroArt hero={T_DRAFT} size={128} still title={`Karakter ${T_TYPE}`} />
        </div>
        <div style={{ position: "relative", marginTop: 4, display: "flex", gap: 6 }}>
          {T_TYPE.split("").map((l, i) => {
            const ti = at + (i * 2.5 - 3) / fps;
            const p = springAt(f, fps, ti, { damping: 11, stiffness: 230, mass: 0.6 });
            const fl = clamp01(1 - (s - Math.max(ti, at)) / 0.22);
            const pulse = s > hopAt ? 1 + 0.08 * Math.exp(-(s - hopAt - i * 0.04) * 8) * Math.max(0, Math.sin((s - hopAt - i * 0.04) * 22)) : 1;
            return (
              <span
                key={i}
                style={{
                  position: "relative",
                  display: "flex",
                  width: 36,
                  height: 36,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 12,
                  background: G.color,
                  color: "#fff",
                  fontSize: 18,
                  fontWeight: 900,
                  transform: `perspective(160px) rotateX(${((1 - p) * 90).toFixed(2)}deg) scale(${((0.6 + 0.4 * p) * pulse).toFixed(4)})`,
                  opacity: clamp01(p * 2),
                  boxShadow: `0 8px 18px -8px ${G.color}, 0 0 ${(24 * fl).toFixed(1)}px ${rgba("#ffffff", 0.5 * fl)}`,
                  overflow: "hidden",
                }}
              >
                {l}
                {fl > 0 && s >= at && <span style={{ position: "absolute", inset: 0, background: `rgba(255,255,255,${(0.7 * fl).toFixed(3)})` }} />}
              </span>
            );
          })}
          {sweep > 0 && sweep < 1 && <Shine p={sweep} alpha={0.55} radius={12} />}
        </div>
        <div
          style={{
            marginTop: 8,
            maxWidth: "92%",
            borderRadius: 999,
            background: "rgba(24,24,27,0.8)",
            padding: "4px 12px",
            textAlign: "center",
            fontSize: 12,
            fontWeight: 600,
            color: Z[100],
            opacity: clamp01(chipP * 1.4),
            transform: `translateY(${((1 - chipP) * 6).toFixed(2)}px)`,
          }}
        >
          {G.icon} {T_HEADLINE}
        </div>
      </div>
    </div>
  );
}

export function ResultBody({ f, fps, enter, at, hopAt }: { f: number; fps: number; enter: number; at: number; hopAt: number }) {
  const k = springAt(f, fps, at + 0.2, { damping: 18, stiffness: 150 });
  const d = springAt(f, fps, at + 0.55, { damping: 20, stiffness: 140 });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <TypeSceneFx f={f} fps={fps} enter={enter} at={at} hopAt={hopAt} />
      <div style={{ textAlign: "center", opacity: clamp01(k * 1.3), transform: `translateY(${((1 - k) * 10).toFixed(2)}px)` }}>
        <div style={{ fontSize: 12, color: Z[500] }}>Karakter kamu</div>
        <div style={{ fontFamily: DISPLAY, fontSize: 20, fontWeight: 900, lineHeight: 1.25, color: Z[50] }}>
          {T_TYPE} · <span style={{ color: T_GROUP.color }}>{T_INFO.label}</span>
        </div>
      </div>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.625, color: Z[300], opacity: clamp01(d * 1.2), transform: `translateY(${((1 - d) * 8).toFixed(2)}px)` }}>{T_DESC}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// halaman pilih peran
// ---------------------------------------------------------------------------------------------
export function RoleBody({ f, fps, enter, hit, focus }: { f: number; fps: number; enter: number; hit: number; focus: number }) {
  const hf = Math.round(hit * fps);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 15.5, fontWeight: 700, lineHeight: 1.375, color: Z[100], opacity: 1 - focus * 0.5, filter: focus > 0.05 ? `blur(${(focus * 2.6).toFixed(2)}px)` : undefined }}>Mau dilatih jadi apa AI-mu?</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
        {ROLES.map((r, i) => {
          const isPick = r.id === T_ROLE;
          const on = isPick && f >= hf;
          const fit = FIT.includes(r.id);
          const ap = springAt(f, fps, enter + 0.02 + (Math.floor(i / 2) * 0.05 + (i % 2) * 0.025), { damping: 16, stiffness: 200, mass: 0.65 });
          const sc = isPick ? bump(f, fps, hit) : 1;
          const shine = isPick ? prog(f, fps, hit + 0.06, hit + 0.62, EASE.inOut) : 0;
          const dim = isPick ? 0 : focus;
          return (
            <div
              key={r.id}
              style={{
                position: "relative",
                minWidth: 0,
                borderRadius: 12,
                border: `1px solid ${on ? OR : Z[800]}`,
                background: on ? rgba(OR, 0.1) : "transparent",
                padding: 10,
                textAlign: "left",
                transform: `translateY(${((1 - ap) * 26).toFixed(2)}px) scale(${sc.toFixed(4)})`,
                opacity: clamp01(ap * 1.4) * (1 - dim * 0.5),
                filter: dim > 0.05 ? `blur(${(dim * 2.6).toFixed(2)}px)` : undefined,
                boxShadow: on ? `0 0 0 1px ${rgba(OR, 0.4)}, 0 14px 30px -12px ${rgba(OR, 0.8)}` : undefined,
                zIndex: isPick ? 2 : 1,
              }}
            >
              {isPick && (
                <span style={{ position: "absolute", inset: 0, borderRadius: 12, overflow: "hidden", pointerEvents: "none" }}>
                  <Ripple f={f} fps={fps} hit={hit} x={146} y={20} />
                  {shine > 0 && shine < 1 && <Shine p={shine} alpha={0.3} radius={12} />}
                </span>
              )}
              <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 18, lineHeight: 1.4 }}>{r.icon}</span>
                <b style={{ minWidth: 0, fontSize: 13, lineHeight: 1.25, fontWeight: 700, color: on ? "#ffffff" : Z[100] }}>{r.name}</b>
              </div>
              <div style={{ position: "relative", marginTop: 4, fontSize: 11.5, lineHeight: 1.375, color: Z[500] }}>{r.desc}</div>
              {fit && (
                <div style={{ position: "relative", marginTop: 4, fontSize: 10.5, fontWeight: 700, color: T_GROUP.color, textShadow: on ? `0 0 10px ${rgba(T_GROUP.color, 0.8)}` : undefined }}>
                  ✓ cocok dengan tipe {T_TYPE}
                </div>
              )}
              {/* ketuk di pojok kanan atas kartu yang kosong (nama & deskripsi tetap terbaca) */}
              {isPick && <TapFx f={f} fps={fps} hit={hit} x="calc(100% - 22px)" y={20} from={[44, 74]} />}
              {isPick && <Burst f={f} fps={fps} at={hit} x={146} y={20} />}
            </div>
          );
        })}
        <div style={{ gridColumn: "span 2 / span 2", borderRadius: 12, border: `1px dashed ${Z[800]}`, padding: 10, opacity: 1 - focus * 0.5, filter: focus > 0.05 ? `blur(${(focus * 2.6).toFixed(2)}px)` : undefined }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 18 }}>✍️</span>
            <span style={{ flex: 1, minWidth: 0, borderRadius: 12, border: `1px solid ${Z[800]}`, background: Z[950], padding: "6px 12px", fontSize: 13, color: Z[600], whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              Peran lain… mis. Admin keuangan, Social media specialist
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// konfeti (deterministik, random(seed)) — ditembakkan dari "meriam" di sisi layar supaya huruf tipe di tengah tetap terbaca
// ---------------------------------------------------------------------------------------------
const CONF_COLORS = [OR, "#fb923c", T_GROUP.color, "#34d399", "#fde68a", "#ffffff", "#f472b6", "#38bdf8", OR];
type Bit = { cx: number; cy: number; vx: number; vy: number; drag: number; rot0: number; spin: number; flip: number; ph: number; w: number; h: number; c: string; shape: number; delay: number; sway: number };
export type Cannon = { x: number; y: number; /** arah tembak (radian, -π/2 = lurus ke atas) */ ang: number; spread: number };

export function Confetti({ f, fps, at, cannons, n = 44, scale = 1 }: { f: number; fps: number; at: number; cannons: Cannon[]; n?: number; scale?: number }) {
  const key = cannons.map((c) => `${c.x.toFixed(0)},${c.y.toFixed(0)},${c.ang.toFixed(3)},${c.spread.toFixed(3)}`).join("|");
  const bits = useMemo<Bit[]>(
    () =>
      cannons.flatMap((cn, ci) =>
        Array.from({ length: n }, (_, i) => {
          const r = (k: string) => random(`train-confetti-${ci}-${i}-${k}`);
          const ang = cn.ang + (r("a") - 0.5) * cn.spread;
          const sp = (1100 + r("s") * 1700) * scale;
          const shape = r("k") < 0.62 ? 0 : r("k2") < 0.55 ? 1 : 2;
          // mulai ≥ 70 px dari mulut meriam (tidak menumpuk di satu titik)
          const r0 = (70 + r("r0") * 40) * scale;
          return {
            cx: cn.x + Math.cos(ang) * r0,
            cy: cn.y + Math.sin(ang) * r0,
            vx: Math.cos(ang) * sp,
            vy: Math.sin(ang) * sp,
            drag: 2.4 + r("d") * 1.4,
            rot0: r("r") * 360,
            spin: (r("sp") - 0.5) * 900,
            flip: 8 + r("f") * 14,
            ph: r("p") * Math.PI * 2,
            w: (shape === 2 ? 7 : 12 + r("w") * 8) * scale,
            h: (shape === 2 ? 30 + r("h") * 16 : 18 + r("h") * 10) * scale,
            c: CONF_COLORS[Math.floor(r("c") * CONF_COLORS.length) % CONF_COLORS.length],
            shape,
            delay: r("dl") * 0.07,
            sway: 5 + r("sw") * 5,
          };
        }),
      ),
    [key, n, scale],
  );
  const t = f / fps - at;
  if (t < 0 || t > 1.9) return null;
  const g = 1100 * scale;
  return (
    <svg width={2} height={2} style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none" }} aria-hidden>
      {/* kilatan moncong meriam */}
      {t < 0.22 &&
        cannons.map((c, i) => (
          <circle key={`m${i}`} cx={c.x + Math.cos(c.ang) * 60 * scale} cy={c.y + Math.sin(c.ang) * 60 * scale} r={(30 + 70 * EASE.out(t / 0.22)) * scale} fill="#fde68a" opacity={(0.35 * (1 - t / 0.22)).toFixed(3)} />
        ))}
      {bits.map((b, i) => {
        const tt = t - b.delay;
        if (tt < 0) return null;
        const e = Math.exp(-b.drag * tt);
        const swayA = Math.min(1, tt * 1.5) * 22 * scale;
        const x = b.cx + (b.vx * (1 - e)) / b.drag + Math.sin(tt * b.sway + b.ph) * swayA;
        const y = b.cy + (b.vy * (1 - e)) / b.drag + 0.5 * g * tt * tt * (1 / (1 + tt * 0.9));
        const vx = b.vx * e;
        const vy = b.vy * e + g * tt;
        const v = Math.hypot(vx, vy);
        const ang = (Math.atan2(vy, vx) * 180) / Math.PI;
        // regangan motion blur dibatasi (≤ 1,6×) supaya terbaca sebagai kertas, bukan serpihan
        const st = 1 + Math.min(0.6, v / 2400);
        const op = tt < 1.1 ? 1 : Math.max(0, 1 - (tt - 1.1) / 0.7);
        if (op <= 0) return null;
        const fl = Math.cos(tt * b.flip + b.ph);
        const tf = `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${ang.toFixed(1)}) scale(${st.toFixed(3)} 1) rotate(${(-ang).toFixed(1)}) rotate(${(b.rot0 + b.spin * tt).toFixed(1)}) scale(1 ${fl.toFixed(3)})`;
        return (
          <g key={i} transform={tf} opacity={op.toFixed(3)}>
            {b.shape === 0 ? (
              <rect x={-b.w / 2} y={-b.h / 2} width={b.w} height={b.h} rx={2 * scale} fill={b.c} />
            ) : b.shape === 1 ? (
              <circle r={b.w * 0.45} fill={b.c} />
            ) : (
              <path d={`M${-b.w / 2} ${-b.h / 2} q${b.w * 1.6} ${b.h * 0.25} 0 ${b.h * 0.5} q${-b.w * 1.6} ${b.h * 0.25} 0 ${b.h * 0.5} h${b.w} q${-b.w * 1.6} ${-b.h * 0.25} 0 ${-b.h * 0.5} q${b.w * 1.6} ${-b.h * 0.25} 0 ${-b.h * 0.5}z`} fill={b.c} />
            )}
          </g>
        );
      })}
    </svg>
  );
}
