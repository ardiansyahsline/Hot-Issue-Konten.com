"use client";

import { AbsoluteFill, Easing, useCurrentFrame } from "remotion";
import { Bg, C, Caption, DISPLAY, GRAD, Logo, lerp, usePop } from "./kit";

const CHIPS = [
  ["🔎", "Cek Kontak"],
  ["📝", "Catatan & Saran"],
  ["🔔", "Notifikasi push"],
  ["📎", "Lampiran Ctrl+V"],
  ["🌙", "Mode gelap/terang"],
  ["😊", "Reaksi emoji"],
  ["🎧", "Musik kerja"],
  ["🔐", "5 role akses"],
] as const;

/** Scene 8 — fitur lain, cepat-cepat (montage) */
export function Montage({ dur }: { dur: number }) {
  const frame = useCurrentFrame();
  const zoom = lerp(frame, [0, dur], [1, 1.14], Easing.linear);
  return (
    <Bg>
      <AbsoluteFill style={{ transform: `scale(${zoom}) rotate(${lerp(frame, [0, dur], [-1.5, 1.5], Easing.linear)}deg)` }}>
        {CHIPS.map(([e, t], i) => (
          <Chip key={t} e={e} t={t} i={i} />
        ))}
      </AbsoluteFill>
      <Caption text="Dan masih banyak lagi… 👀" start={2} end={dur} y={250} size={64} hl={["banyak"]} />
    </Bg>
  );
}

function Chip({ e, t, i }: { e: string; t: string; i: number }) {
  const p = usePop(6 + i * 5, { damping: 11, stiffness: 170 });
  const col = i % 2;
  const row = Math.floor(i / 2);
  const x = col ? 560 : 70;
  const y = 520 + row * 230 + (col ? 70 : 0);
  const from = col ? 600 : -600;
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: 450,
        height: 180,
        boxSizing: "border-box",
        borderRadius: 40,
        background: i % 3 === 0 ? GRAD : C.panel,
        border: `2px solid ${i % 3 === 0 ? "#fdba74" : C.line}`,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "0 34px",
        gap: 8,
        opacity: Math.min(1, p * 1.5),
        transform: `translateX(${(1 - p) * from}px) rotate(${(1 - p) * (col ? 14 : -14) + (col ? 2 : -2)}deg)`,
        boxShadow: "0 30px 60px -24px rgba(0,0,0,.8)",
      }}
    >
      <span style={{ fontSize: 56, lineHeight: 1 }}>{e}</span>
      <span style={{ fontSize: 34, fontWeight: 800 }}>{t}</span>
    </div>
  );
}

/** Scene 9 — penutup: logo + ajakan (teks CTA bisa diubah dari menu Remotion) */
export function Outro({ cta, dur }: { cta: string; dur: number }) {
  const frame = useCurrentFrame();
  const logo = usePop(2, { damping: 10, stiffness: 130 });
  const t1 = usePop(12);
  const t2 = usePop(22);
  const btn = usePop(34, { damping: 9 });
  const glow = 0.5 + 0.5 * Math.sin(frame / 7);
  const out = lerp(frame, [dur - 10, dur], [1, 0]);
  return (
    <Bg style={{ alignItems: "center", justifyContent: "center", fontFamily: DISPLAY }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", opacity: out }}>
        <div style={{ transform: `scale(${logo}) rotate(${(1 - logo) * 30}deg)`, boxShadow: `0 0 0 ${18 + glow * 14}px rgba(249,115,22,${0.1 + glow * 0.12})`, borderRadius: 90 }}>
          <Logo size={320} />
        </div>
        <div style={{ marginTop: 70, fontSize: 140, fontWeight: 900, letterSpacing: -5, opacity: t1, transform: `translateY(${(1 - t1) * 40}px)` }}>CS Tracker</div>
        <div style={{ marginTop: 10, fontSize: 48, fontWeight: 700, color: C.sub, opacity: t2, transform: `translateY(${(1 - t2) * 30}px)` }}>Semua kerjaan CS, 1 tempat.</div>
        <div
          style={{
            marginTop: 80,
            maxWidth: 900,
            padding: "34px 56px",
            borderRadius: 99,
            background: GRAD,
            fontSize: 50,
            fontWeight: 900,
            textAlign: "center",
            color: "#fff",
            transform: `scale(${btn * (1 + glow * 0.03)})`,
            boxShadow: `0 30px 70px -20px rgba(234,88,12,${0.6 + glow * 0.3})`,
          }}
        >
          {cta}
        </div>
        <div style={{ marginTop: 50, fontSize: 32, fontWeight: 700, color: C.mute, opacity: t2 }}>by Konten.com</div>
      </div>
    </Bg>
  );
}
