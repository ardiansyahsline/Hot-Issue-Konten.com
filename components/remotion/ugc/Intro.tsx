"use client";

import { AbsoluteFill, Easing, useCurrentFrame } from "remotion";
import { Bg, C, Camera, Caption, DISPLAY, GRAD, Logo, lerp, usePop } from "./kit";

const ROWS = [
  ["0812-3456-789", "Saldo belum cair", "open"],
  ["@riko.clips", "Video ditolak", "open"],
  ["+62 812 3456 789", "Saldo belum masuk", "??"],
  ["riko#2231", "Gak bisa verif", "open"],
  ["812 3456789", "Payout pending", "??"],
  ["@nadia.edit", "Brief gak jelas", "done"],
  ["0857-1111-222", "Akun dibanned", "open"],
];
const DUP = [0, 2, 4]; // nomor yang sama, ditulis beda-beda

/** Scene 1 — hook: catat hot issue di spreadsheet itu ribet */
export function Hook({ text, dur }: { text: string; dur: number }) {
  const frame = useCurrentFrame();
  const flag = usePop(42);
  return (
    <Bg>
      <Camera shots={[{ f: 0, x: 540, y: 1000, s: 1.35 }, { f: dur, x: 540, y: 980, s: 1.0 }]} shake={2.2}>
        <div
          style={{
            position: "absolute",
            left: 70,
            top: 620,
            width: 940,
            borderRadius: 26,
            overflow: "hidden",
            background: "#f8fafc",
            color: "#0f172a",
            transform: `rotate(${-5 + Math.sin(frame / 6) * 0.6}deg)`,
            boxShadow: "0 40px 90px rgba(0,0,0,.6)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "18px 24px", background: "#16a34a", color: "#fff", fontWeight: 800, fontSize: 30 }}>
            <span style={{ fontSize: 34 }}>📗</span> hot-issue-FINAL-revisi3.xlsx
          </div>
          {[["Kontak", "Masalah", "Status"], ...ROWS].map((r, i) => {
            const dup = i > 0 && DUP.includes(i - 1);
            const lit = dup && frame > 30 + (i - 1) * 4;
            return (
              <div key={i} style={{ display: "flex", borderBottom: "2px solid #e2e8f0", background: i === 0 ? "#e2e8f0" : lit ? "#fee2e2" : "#fff", fontSize: 30, fontWeight: i === 0 ? 800 : 500 }}>
                {r.map((c, j) => (
                  <div key={j} style={{ flex: j === 1 ? 1.3 : 1, padding: "16px 18px", borderRight: j < 2 ? "2px solid #e2e8f0" : undefined, color: lit && j === 0 ? "#dc2626" : undefined, fontWeight: lit && j === 0 ? 800 : undefined, whiteSpace: "nowrap", overflow: "hidden" }}>
                    {c}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        {/* stempel: nomor sama dilaporin berkali-kali tapi nggak ketahuan */}
        <div
          style={{
            position: "absolute",
            left: 560,
            top: 1270,
            padding: "16px 26px",
            borderRadius: 22,
            border: `6px solid ${C.red}`,
            color: C.red,
            background: "rgba(9,9,11,.9)",
            fontFamily: DISPLAY,
            fontWeight: 900,
            fontSize: 44,
            opacity: frame < 42 ? 0 : 1,
            transform: `rotate(-9deg) scale(${2.2 - 1.2 * flag})`,
          }}
        >
          3x LAPOR 💀
        </div>
      </Camera>
      <Caption text={text} start={2} y={260} hl={["sheet", "spreadsheet", "excel"]} size={66} />
      <Caption text="Nomor sama, ditulis beda… gak ketauan 😵‍💫" start={50} y={1560} hl={["gak", "ketauan"]} size={52} />
    </Bg>
  );
}

/** Scene 2 — kenalin CS Tracker */
export function Reveal({ dur }: { dur: number }) {
  const frame = useCurrentFrame();
  const logo = usePop(4, { damping: 10, stiffness: 140 });
  const title = usePop(16);
  const sub = usePop(26);
  const zoom = lerp(frame, [0, dur], [1.08, 1], Easing.out(Easing.quad));
  return (
    <AbsoluteFill style={{ background: GRAD, fontFamily: DISPLAY, color: "#fff", alignItems: "center", justifyContent: "center" }}>
      {/* garis-garis cahaya berputar */}
      {Array.from({ length: 10 }).map((_, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: 540 - 40,
            top: 960 - 1400,
            width: 80,
            height: 2800,
            background: "linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,.16) 50%, rgba(255,255,255,0) 100%)",
            transform: `rotate(${i * 18 + frame * 0.6}deg)`,
          }}
        />
      ))}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", transform: `scale(${zoom})` }}>
        <div style={{ fontSize: 58, fontWeight: 800, marginBottom: 40, opacity: title, transform: `translateY(${(1 - title) * 30}px)` }}>Kenalin 👋</div>
        <div style={{ transform: `scale(${logo}) rotate(${(1 - logo) * -40}deg)`, borderRadius: 80, boxShadow: "0 0 0 16px rgba(255,255,255,.18)" }}>
          <Logo size={300} />
        </div>
        <div style={{ marginTop: 56, fontSize: 130, fontWeight: 900, letterSpacing: -4, opacity: title, transform: `scale(${0.8 + 0.2 * title})` }}>CS Tracker</div>
        <div style={{ marginTop: 18, fontSize: 46, fontWeight: 700, opacity: sub, transform: `translateY(${(1 - sub) * 24}px)`, padding: "12px 30px", borderRadius: 99, background: "rgba(0,0,0,.22)" }}>
          Semua kerjaan CS, 1 tempat.
        </div>
      </div>
    </AbsoluteFill>
  );
}
