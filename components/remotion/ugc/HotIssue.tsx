"use client";

import { AbsoluteFill, useCurrentFrame } from "remotion";
import { AppShell, Badge, C, Camera, Caption, Caret, DISPLAY, card, typed, usePop } from "./kit";

const TITLE = "Saldo clipper belum cair";
const PHONE = "0812-3456-789";

const label = (top: number, text: string) => (
  <div style={{ position: "absolute", left: 88, top, fontSize: 24, fontWeight: 800, letterSpacing: 2, color: C.mute }}>{text}</div>
);

function Input({ top, value, typing, focus, prefix }: { top: number; value: string; typing: boolean; focus: boolean; prefix?: string }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 88,
        top,
        width: 904,
        height: 100,
        boxSizing: "border-box",
        borderRadius: 26,
        background: C.bg,
        border: `3px solid ${focus ? C.orange : "#3f3f46"}`,
        boxShadow: focus ? "0 0 0 10px rgba(249,115,22,.16)" : undefined,
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "0 28px",
        fontSize: 36,
        fontWeight: 600,
      }}
    >
      {prefix && <span style={{ padding: "6px 16px", borderRadius: 16, background: "#27272a", fontSize: 26, fontWeight: 800, color: C.sub }}>{prefix}</span>}
      <span>{value}</span>
      {focus && <Caret typing={typing} />}
    </div>
  );
}

/** Scene 4 — HOT otomatis: ketik kontak clipper, langsung muncul peringatan + cap HOT */
export function HotIssue({ dur }: { dur: number }) {
  const frame = useCurrentFrame();
  const title = typed(TITLE, frame, 14, 0.9);
  const phone = typed(PHONE, frame, 60, 0.55);
  const warn = usePop(90);
  const stamp = usePop(128, { damping: 9, stiffness: 160 });
  const focusTitle = frame < 54;
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Camera
        shots={[
          { f: 0, x: 540, y: 960, s: 1 },
          { f: 12, x: 360, y: 646, s: 1.75 },
          { f: 46, x: 360, y: 646, s: 1.78 },
          { f: 60, x: 360, y: 974, s: 1.75 },
          { f: 90, x: 360, y: 974, s: 1.78 },
          { f: 108, x: 540, y: 1215, s: 1.14 },
          { f: 155, x: 540, y: 1205, s: 1.18 },
          { f: dur, x: 540, y: 960, s: 1.02 },
        ]}
      >
        <AppShell active="issue">
          <div style={{ position: "absolute", left: 48, top: 380 }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 60 }}>+ Issue Baru</div>
            <div style={{ fontSize: 30, color: C.sub, marginTop: 6 }}>Catat kasus clipper</div>
          </div>
          <div style={{ ...card, position: "absolute", left: 48, top: 520, width: 984, height: 960 }} />
          {label(556, "JUDUL")}
          <Input top={596} value={title} typing={title.length < TITLE.length && frame >= 14} focus={focusTitle} />
          {label(730, "KATEGORI")}
          <div style={{ position: "absolute", left: 88, top: 772, display: "flex", gap: 16 }}>
            <Badge color={C.orange} solid size={30}>💸 Payout</Badge>
            <Badge color={C.mute} size={30}>🎬 Video</Badge>
            <Badge color={C.mute} size={30}>🎮 Discord</Badge>
          </div>
          {label(884, "KONTAK CLIPPER")}
          <Input top={924} value={phone} typing={phone.length < PHONE.length && frame >= 60} focus={!focusTitle} prefix="📱 WA" />

          {/* peringatan: kontak sudah pernah dilaporkan */}
          <div
            style={{
              position: "absolute",
              left: 88,
              top: 1060,
              width: 904,
              boxSizing: "border-box",
              padding: "30px 32px",
              borderRadius: 30,
              background: "#2a1508",
              border: `3px solid ${C.orange}`,
              opacity: warn,
              transform: `translateY(${(1 - warn) * -40}px) scale(${0.9 + 0.1 * warn})`,
            }}
          >
            <div style={{ fontSize: 34, fontWeight: 800, color: "#fdba74" }}>🔥 Kontak ini sudah ada di 2 issue lain</div>
            <div style={{ fontSize: 26, color: "#fed7aa", marginTop: 6, opacity: 0.85 }}>dalam 30 hari terakhir</div>
            {[
              ["Saldo belum masuk", "3 hari lalu", 100],
              ["Payout pending", "minggu lalu", 108],
            ].map(([t, w, at]) => (
              <div key={t as string} style={{ marginTop: 16, display: "flex", justifyContent: "space-between", padding: "16px 22px", borderRadius: 18, background: "rgba(0,0,0,.3)", fontSize: 28, fontWeight: 600, opacity: frame >= (at as number) ? 1 : 0 }}>
                <span>• {t}</span>
                <span style={{ color: C.sub }}>{w}</span>
              </div>
            ))}
            <div style={{ marginTop: 18, fontSize: 25, color: "#fed7aa", opacity: frame >= 116 ? 1 : 0 }}>
              0812-3456-789 = +62 812 3456 789 = 812 3456789 ✓ dianggap sama
            </div>
          </div>

          {/* cap HOT */}
          <div
            style={{
              position: "absolute",
              left: 690,
              top: 930,
              padding: "14px 30px",
              borderRadius: 24,
              background: "linear-gradient(180deg,#ef4444,#b91c1c)",
              color: "#fff",
              fontFamily: DISPLAY,
              fontWeight: 900,
              fontSize: 54,
              boxShadow: "0 20px 50px -10px rgba(239,68,68,.8)",
              opacity: frame < 128 ? 0 : 1,
              transform: `rotate(-10deg) scale(${3 - 2 * stamp})`,
            }}
          >
            🔥 HOT
          </div>
        </AppShell>
      </Camera>
      <Caption text="Ketik nomor clipper → sistem langsung cek riwayatnya 👀" start={8} end={100} hl={["langsung"]} />
      <Caption text="Udah lapor berkali-kali? Otomatis jadi HOT ✅" start={104} end={dur} hl={["HOT"]} />
    </AbsoluteFill>
  );
}
