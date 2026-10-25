"use client";

import { AbsoluteFill, useCurrentFrame } from "remotion";
import { AppShell, Badge, C, Camera, Caption, DISPLAY, GRAD, card, lerp, usePop } from "./kit";

const MSGS = [
  { who: "Rina", av: "R", col: "#38bdf8", text: "Guys ada clipper komplain saldo lagi 😭", at: 8 },
  { who: "Dimas", av: "D", col: "#a78bfa", text: "Udah masuk Hot Issue kok, #1 di dashboard 🔥", at: 30 },
  { who: "me", av: "AL", col: "", text: "@Rina cek Catatan ya, udah aku update 👍", at: 54 },
];

/** Scene 6 — Chat tim: bubble muncul, @mention, reaksi emoji, "sedang mengetik" */
export function ChatScene({ dur }: { dur: number }) {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Camera
        shots={[
          { f: 0, x: 540, y: 960, s: 1 },
          { f: 50, x: 540, y: 960, s: 1.08 },
          { f: 72, x: 620, y: 1070, s: 1.25 },
          { f: 110, x: 620, y: 1080, s: 1.28 },
          { f: dur, x: 540, y: 960, s: 1.02 },
        ]}
      >
        <AppShell active="chat">
          <div style={{ ...card, position: "absolute", left: 48, top: 380, width: 984, height: 1130 }} />
          <div style={{ position: "absolute", left: 88, right: 88, top: 410, display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ fontFamily: DISPLAY, fontSize: 42, fontWeight: 800 }}># semua-cs</span>
            <span style={{ width: 18, height: 18, borderRadius: 99, background: C.green }} />
            <span style={{ fontSize: 28, color: C.sub, fontWeight: 600 }}>8 online</span>
          </div>
          <div style={{ position: "absolute", left: 48, right: 48, top: 492, height: 2, background: C.line }} />
          {MSGS.map((m, i) => (
            <Bubble key={i} {...m} top={540 + i * 240} frame={frame} />
          ))}
          {/* reaksi di pesan Dimas */}
          <div style={{ position: "absolute", left: 186, top: 948, display: "flex", gap: 12 }}>
            {[
              ["🔥", 3, 84],
              ["👍", 2, 90],
              ["🙏", 1, 96],
            ].map(([e, n, at]) => (
              <Reaction key={e as string} e={e as string} n={n as number} at={at as number} />
            ))}
          </div>
          {frame >= 104 && (
            <div style={{ position: "absolute", left: 88, top: 1400, fontSize: 28, color: C.sub, fontStyle: "italic", display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ letterSpacing: 4, fontStyle: "normal", fontWeight: 900, color: C.orange }}>{"•••".slice(0, (Math.floor(frame / 5) % 3) + 1)}</span>
              Rina sedang mengetik…
            </div>
          )}
        </AppShell>
      </Camera>
      <Caption text="Chat tim + @mention, gak perlu bolak-balik WA 💬" start={6} end={dur} hl={["@mention"]} />
    </AbsoluteFill>
  );
}

function Bubble({ who, av, col, text, at, top }: (typeof MSGS)[number] & { top: number; frame: number }) {
  const p = usePop(at);
  const me = who === "me";
  const parts = text.split(/(@\w+)/);
  return (
    <div style={{ position: "absolute", left: me ? undefined : 88, right: me ? 88 : undefined, top, display: "flex", gap: 18, flexDirection: me ? "row-reverse" : "row", alignItems: "flex-end", opacity: p, transform: `translateY(${(1 - p) * 60}px) scale(${0.8 + 0.2 * p})`, transformOrigin: me ? "100% 100%" : "0 100%" }}>
      <div style={{ width: 80, height: 80, borderRadius: 99, flex: "none", background: me ? "linear-gradient(135deg,#fb923c,#ec4899)" : col, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 30, color: "#fff" }}>{av}</div>
      <div style={{ maxWidth: 680 }}>
        {!me && <div style={{ fontSize: 24, fontWeight: 800, color: col, marginBottom: 8 }}>{who}</div>}
        <div style={{ padding: "22px 28px", fontSize: 32, fontWeight: 500, lineHeight: 1.35, borderRadius: me ? "32px 32px 8px 32px" : "32px 32px 32px 8px", background: me ? GRAD : "#26262b", color: "#fff" }}>
          {parts.map((s, i) =>
            s.startsWith("@") ? (
              <span key={i} style={{ fontWeight: 800, padding: "0 10px", borderRadius: 12, background: "rgba(255,255,255,.25)" }}>{s}</span>
            ) : (
              <span key={i}>{s}</span>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

function Reaction({ e, n, at }: { e: string; n: number; at: number }) {
  const p = usePop(at, { damping: 8, stiffness: 220 });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 18px", borderRadius: 99, background: "#26262b", border: `2px solid ${C.line}`, fontSize: 30, fontWeight: 700, transform: `scale(${p})` }}>
      {e} <span style={{ fontSize: 24, color: C.sub }}>{n}</span>
    </div>
  );
}

const DAYS = [
  ["Sen", 14],
  ["Sel", 22],
  ["Rab", 18],
  ["Kam", 31],
  ["Jum", 26],
  ["Sab", 12],
  ["Min", 9],
] as const;
const STATUS = [
  ["Rilis", 62, C.green],
  ["Banding", 21, C.amber],
  ["Saldo dibekukan", 9, C.red],
  ["Menunggu", 8, C.sky],
] as const;

/** Scene 7 — Report Video Review: grafik batang tumbuh + status per kategori + compare */
export function ReportScene({ dur }: { dur: number }) {
  const frame = useCurrentFrame();
  const max = 31;
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Camera
        shots={[
          { f: 0, x: 540, y: 960, s: 1 },
          { f: 16, x: 540, y: 960, s: 1 },
          // punch-in ke batang tertinggi, lalu ke status, lalu ke badge naik 18%
          { f: 38, x: 540, y: 770, s: 1.8 },
          { f: 66, x: 540, y: 770, s: 1.84 },
          { f: 88, x: 540, y: 1250, s: 1.1 },
          { f: 116, x: 540, y: 1250, s: 1.12 },
          { f: 132, x: 800, y: 1066, s: 1.7 },
          { f: dur, x: 800, y: 1066, s: 1.75 },
        ]}
      >
        <AppShell active="video">
          <div style={{ position: "absolute", left: 48, top: 380, fontFamily: DISPLAY, fontWeight: 800, fontSize: 56 }}>Report Video Review</div>
          <div style={{ position: "absolute", left: 48, top: 466, display: "flex", gap: 12 }}>
            <Badge color={C.mute} size={26}>Detail</Badge>
            <Badge color={C.orange} solid size={26}>Visualisasi</Badge>
            <Badge color={C.mute} size={26}>Compare</Badge>
          </div>
          <div style={{ ...card, position: "absolute", left: 48, top: 550, width: 984, height: 430, boxSizing: "border-box", padding: "30px 36px" }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: C.sub }}>Kasus per hari · 7 hari</div>
            <div style={{ position: "absolute", left: 36, right: 36, bottom: 30, height: 300, display: "flex", alignItems: "flex-end", gap: 22 }}>
              {DAYS.map(([d, n], i) => {
                const g = lerp(frame, [10 + i * 4, 36 + i * 4], [0, 1]);
                const peak = n === max;
                return (
                  <div key={d} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 24, fontWeight: 800, color: peak ? "#fdba74" : C.sub, opacity: g }}>{Math.round(n * g)}</span>
                    <div style={{ width: "100%", height: (n / max) * 200 * g, borderRadius: 14, background: peak ? GRAD : "linear-gradient(180deg,#52525b,#3f3f46)" }} />
                    <span style={{ fontSize: 24, color: C.mute, fontWeight: 600 }}>{d}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ ...card, position: "absolute", left: 48, top: 1010, width: 984, height: 500, boxSizing: "border-box", padding: "30px 36px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: C.sub }}>Status kasus</span>
              <Badge color={C.green} size={26}>▲ 18% vs minggu lalu</Badge>
            </div>
            {STATUS.map(([k, v, col], i) => {
              const g = lerp(frame, [60 + i * 6, 96 + i * 6], [0, 1]);
              return (
                <div key={k} style={{ marginTop: 30 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 28, fontWeight: 700 }}>
                    <span>{k}</span>
                    <span style={{ color: col }}>{Math.round(v * g)}%</span>
                  </div>
                  <div style={{ marginTop: 10, height: 18, borderRadius: 99, background: "#2a2a30", overflow: "hidden" }}>
                    <div style={{ width: `${v * g}%`, height: "100%", borderRadius: 99, background: col }} />
                  </div>
                </div>
              );
            })}
          </div>
        </AppShell>
      </Camera>
      <Caption text="Report Video Review langsung jadi grafik 📊" start={6} end={dur} hl={["grafik"]} />
    </AbsoluteFill>
  );
}
