"use client";

import { AbsoluteFill, useCurrentFrame } from "remotion";
import { AppShell, Badge, C, Camera, Caption, DISPLAY, Tap, card, lerp, usePop } from "./kit";

const STATS = [
  { icon: "🔥", label: "Hot aktif", n: 12, color: C.orange },
  { icon: "⚠️", label: "Urgent", n: 5, color: C.red },
  { icon: "📥", label: "Open", n: 23, color: C.sky },
  { icon: "✅", label: "Resolved hari ini", n: 18, color: C.green },
];
const TOP = [
  { t: "Saldo clipper belum cair", sub: "Payout · 7 laporan", heat: 0.92 },
  { t: "Video ditolak padahal sesuai brief", sub: "Video Review · 5 laporan", heat: 0.7 },
  { t: "Akun Discord gak bisa verifikasi", sub: "Discord · 3 laporan", heat: 0.45 },
];

/** Scene 3 — Dashboard: angka naik, Top 3 Hot Issue, kamera zoom ke kartu Hot lalu ke issue #1 */
export function Dashboard({ dur }: { dur: number }) {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Camera
        shots={[
          { f: 0, x: 540, y: 960, s: 1 },
          { f: 22, x: 540, y: 960, s: 1 },
          { f: 42, x: 300, y: 650, s: 1.75 },
          { f: 78, x: 300, y: 650, s: 1.75 },
          { f: 100, x: 540, y: 1250, s: 1.12 },
          { f: 140, x: 540, y: 1240, s: 1.16 },
          { f: dur, x: 540, y: 960, s: 1.05 },
        ]}
      >
        <AppShell active="home">
          <DashBody frame={frame} />
          <Tap x={300} y={660} at={66} />
        </AppShell>
      </Camera>
      <Caption text="Dashboard langsung kasih tau mana yang lagi panas 🔥" start={8} end={dur} hl={["panas"]} />
    </AbsoluteFill>
  );
}

function DashBody({ frame }: { frame: number }) {
  return (
    <>
      <div style={{ position: "absolute", left: 48, top: 380 }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 60 }}>Dashboard</div>
        <div style={{ fontSize: 30, color: C.sub, marginTop: 6 }}>Ringkasan hot issue hari ini</div>
      </div>
      {STATS.map((s, i) => (
        <Stat key={s.label} {...s} i={i} frame={frame} />
      ))}
      <div style={{ position: "absolute", left: 48, top: 1024, fontFamily: DISPLAY, fontWeight: 800, fontSize: 38, display: "flex", alignItems: "center", gap: 14 }}>
        🏆 Top 3 Hot Issue <span style={{ fontSize: 26, fontWeight: 700, color: C.mute }}>· 7 hari terakhir</span>
      </div>
      {TOP.map((t, i) => (
        <TopRow key={t.t} {...t} i={i} frame={frame} />
      ))}
    </>
  );
}

function Stat({ icon, label, n, color, i, frame }: (typeof STATS)[number] & { i: number; frame: number }) {
  const pop = usePop(4 + i * 4);
  const x = 48 + (i % 2) * 504;
  const y = 540 + Math.floor(i / 2) * 234;
  const val = Math.round(lerp(frame, [8 + i * 4, 40 + i * 4], [0, n]));
  const hot = i === 0;
  const pulse = hot ? 1 + Math.max(0, Math.sin((frame - 40) / 5)) * 0.04 * (frame > 40 ? 1 : 0) : 1;
  return (
    <div
      style={{
        ...card,
        position: "absolute",
        left: x,
        top: y,
        width: 480,
        height: 210,
        padding: "28px 32px",
        boxSizing: "border-box",
        opacity: pop,
        transform: `translateY(${(1 - pop) * 60}px) scale(${pulse})`,
        border: hot ? `3px solid ${C.orange}` : card.border,
        boxShadow: hot ? `0 0 0 8px rgba(249,115,22,.14), 0 30px 60px -30px rgba(249,115,22,.7)` : card.boxShadow,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 28, fontWeight: 700, color: C.sub }}>
        <span style={{ width: 58, height: 58, borderRadius: 18, background: `${color}26`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32 }}>{icon}</span>
        {label}
      </div>
      <div style={{ fontFamily: DISPLAY, fontSize: 92, fontWeight: 900, color, marginTop: 6, lineHeight: 1 }}>{val}</div>
    </div>
  );
}

function TopRow({ t, sub, heat, i, frame }: (typeof TOP)[number] & { i: number; frame: number }) {
  const pop = usePop(18 + i * 6);
  const fill = lerp(frame, [40 + i * 6, 80 + i * 6], [0, heat]);
  const first = i === 0;
  return (
    <div
      style={{
        ...card,
        position: "absolute",
        left: 48,
        top: 1100 + i * 151,
        width: 984,
        height: 135,
        borderRadius: 32,
        boxSizing: "border-box",
        padding: "0 30px",
        display: "flex",
        alignItems: "center",
        gap: 24,
        opacity: pop,
        transform: `translateX(${(1 - pop) * 120}px)`,
        border: first && frame > 100 ? `3px solid ${C.orange}` : card.border,
      }}
    >
      <div style={{ width: 72, height: 72, borderRadius: 22, background: first ? "linear-gradient(180deg,#fb8a3c,#ea580c)" : "#2a2a30", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: DISPLAY, fontWeight: 900, fontSize: 36 }}>
        #{i + 1}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 32, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 10 }}>
          <span style={{ fontSize: 24, color: C.mute, fontWeight: 600 }}>{sub}</span>
          <div style={{ flex: 1, height: 12, borderRadius: 99, background: "#2a2a30", overflow: "hidden" }}>
            <div style={{ width: `${fill * 100}%`, height: "100%", borderRadius: 99, background: "linear-gradient(90deg,#f59e0b,#ef4444)" }} />
          </div>
        </div>
      </div>
      <Badge color={C.red} solid>
        🔥 HOT
      </Badge>
    </div>
  );
}
