"use client";

import type { ReactNode } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { AppShell, Badge, C, Camera, Caption, Caret, DISPLAY, GRAD, Tap, lerp, typed, usePop } from "./kit";

export const PROMPT = "Rangkum hot issue minggu ini + saran tindakannya dong 🙏";

const T_TYPE = 16; // mulai ngetik
const T_SEND = 112; // tap tombol kirim
const T_THINK = 136;
const T_ANSWER = 178;

const STEPS = [
  { t: "Baca data CS Tracker…", at: T_THINK },
  { t: "Hitung tren 7 hari…", at: T_THINK + 12 },
  { t: "Susun saran…", at: T_THINK + 24 },
];
const ROWS = [
  ["💸 Payout", "5", "▲ 2", C.red],
  ["🎬 Video ditolak", "4", "▲ 1", C.red],
  ["🎮 Verifikasi Discord", "3", "▼ 1", C.green],
] as const;
const TIPS = ["Prioritaskan cek payout batch Senin", "Kirim ulang panduan brief ke clipper", "Pin info verifikasi di Discord"];

/** Scene 5 — AI: zoom in ke kolom ketik, prompt diketik, kirim, zoom out, jawaban mengalir + tabel */
export function AiScene({ dur, prompt = PROMPT }: { dur: number; prompt?: string }) {
  const frame = useCurrentFrame();
  const cpf = Math.max(0.55, prompt.length / 88); // prompt panjang -> ngetik lebih cepat, selesai sebelum kirim
  const text = frame < T_SEND + 4 ? typed(prompt, frame, T_TYPE, cpf) : "";
  const sent = frame >= T_SEND + 4;
  const bubble = usePop(T_SEND + 6);
  const answer = usePop(T_ANSWER);
  // teks jawaban mengalir
  const scroll = lerp(frame, [T_ANSWER + 86, T_ANSWER + 112], [0, -190]);
  const intro = typed("Minggu ini ada 12 Hot Issue 🔥 — naik 33% dari minggu lalu. Paling banyak soal payout.", frame, T_ANSWER, 1.4);
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Camera
        shots={[
          { f: 0, x: 540, y: 960, s: 1 },
          { f: 14, x: 430, y: 1452, s: 1.55 },
          { f: T_SEND - 16, x: 430, y: 1452, s: 1.6 },
          { f: T_SEND - 4, x: 720, y: 1452, s: 1.6 },
          { f: T_SEND + 8, x: 720, y: 1452, s: 1.55 },
          { f: T_SEND + 30, x: 540, y: 960, s: 1 },
          { f: T_ANSWER + 2, x: 540, y: 960, s: 1 },
          // punch-in ke "12 Hot Issue"
          { f: T_ANSWER + 18, x: 450, y: 740, s: 1.75 },
          { f: T_ANSWER + 38, x: 460, y: 740, s: 1.78 },
          { f: T_ANSWER + 56, x: 588, y: 990, s: 1.2 },
          { f: T_ANSWER + 104, x: 588, y: 1000, s: 1.22 },
          { f: T_ANSWER + 128, x: 560, y: 1090, s: 1.22 },
          { f: dur - 26, x: 560, y: 1090, s: 1.26 },
          { f: dur, x: 540, y: 960, s: 1.04 },
        ]}
      >
        <AppShell active="ai">
          {/* kepala halaman AI */}
          <div style={{ position: "absolute", left: 48, right: 48, top: 380, display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 56 }}>✨ AI</div>
            <div style={{ flex: 1 }} />
            <Badge color={C.violet} size={26}>🦋 Layla · otomatis</Badge>
            <Badge color={C.sky} size={26}>📊 Data CS Tracker</Badge>
          </div>
          <div style={{ position: "absolute", left: 48, right: 48, top: 476, height: 2, background: C.line }} />

          {/* area pesan: ikut "scroll" ke atas saat jawaban makin panjang, seperti chat asli */}
          <div style={{ position: "absolute", left: 0, top: 480, width: 1080, height: 895, overflow: "hidden" }}>
            <div style={{ position: "absolute", left: 0, top: -480, width: 1080, height: 1920, transform: `translateY(${scroll}px)` }}>
              {/* pesan user */}
              {sent && (
                <div style={{ position: "absolute", right: 48, top: 510, maxWidth: 760, padding: "24px 30px", borderRadius: "34px 34px 10px 34px", background: GRAD, fontSize: 32, fontWeight: 600, lineHeight: 1.35, opacity: bubble, transform: `translateY(${(1 - bubble) * 80}px) scale(${0.85 + 0.15 * bubble})`, transformOrigin: "100% 100%" }}>
                  {prompt}
                </div>
              )}

              {/* AI: langkah mikir lalu jawaban */}
              {frame >= T_THINK - 4 && (
                <div style={{ position: "absolute", left: 48, top: 690, display: "flex", gap: 20, width: 984 }}>
                  <div style={{ width: 76, height: 76, flex: "none", borderRadius: 26, background: "linear-gradient(135deg,#a78bfa,#ec4899)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40 }}>🦋</div>
                  <div style={{ flex: 1 }}>
                    {frame < T_ANSWER ? (
                      <Thinking frame={frame} />
                    ) : (
                      <div style={{ opacity: answer }}>
                        <div style={{ fontSize: 32, lineHeight: 1.45, fontWeight: 500, minHeight: 96 }}>
                          {bold(intro)}
                          {intro.length < 80 && <Caret typing h={36} />}
                        </div>
                        <Table frame={frame} />
                        <Tips frame={frame} />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* kolom ketik */}
          <div
            style={{
              position: "absolute",
              left: 48,
              top: 1390,
              width: 984,
              height: 124,
              boxSizing: "border-box",
              borderRadius: 40,
              background: "#121215",
              border: `3px solid ${frame > 12 && !sent ? C.orange : C.line}`,
              boxShadow: frame > 12 && !sent ? "0 0 0 10px rgba(249,115,22,.14)" : undefined,
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "0 18px 0 30px",
            }}
          >
            <span style={{ fontSize: 38, color: C.mute }}>📎</span>
            <div style={{ flex: 1, minWidth: 0, fontSize: 30, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", display: "flex", alignItems: "center" }}>
              {text ? (
                // kolom ketik "menggeser" teks lama ke kiri seperti input asli
                <span>{text.length > 30 ? `…${text.slice(-29)}` : text}</span>
              ) : (
                <span style={{ color: C.mute }}>Tanya apa aja…</span>
              )}
              {!sent && frame > 12 && <Caret typing={text.length < prompt.length} h={38} />}
            </div>
            <div
              style={{
                width: 88,
                height: 88,
                flex: "none",
                borderRadius: 30,
                background: text.length >= prompt.length ? GRAD : "#2a2a30",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 40,
                fontWeight: 900,
                transform: `scale(${frame >= T_SEND - 3 && frame < T_SEND + 4 ? 0.88 : 1})`,
              }}
            >
              ↑
            </div>
          </div>
          <Tap x={940} y={1452} at={T_SEND} />
        </AppShell>
      </Camera>
      <Caption text="Tinggal ketik pertanyaan ke AI…" start={4} end={T_SEND + 20} y={1600} hl={["AI"]} />
      <Caption text="…dia baca data CS Tracker & kasih saran sendiri 🤯" start={T_ANSWER - 10} end={dur} y={1600} hl={["sendiri"]} />
    </AbsoluteFill>
  );
}

/** **tebal** sederhana: "12 Hot Issue" & "33%" ditebalkan */
function bold(s: string): ReactNode {
  const parts = s.split(/(12 Hot Issue|33%|payout)/);
  return parts.map((p, i) => (i % 2 ? <b key={i} style={{ color: "#fdba74", fontWeight: 800 }}>{p}</b> : <span key={i}>{p}</span>));
}

function Thinking({ frame }: { frame: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingTop: 6 }}>
      {STEPS.map((s, i) => {
        if (frame < s.at) return null;
        const done = i < STEPS.length - 1 ? frame >= (STEPS[i + 1]?.at ?? 0) : false;
        return (
          <div key={s.t} style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 30, fontWeight: 600, color: done ? C.sub : C.text, opacity: lerp(frame, [s.at, s.at + 6], [0, 1]) }}>
            <span style={{ width: 44, height: 44, borderRadius: 99, display: "flex", alignItems: "center", justifyContent: "center", background: done ? "rgba(16,185,129,.2)" : "rgba(167,139,250,.2)", color: done ? C.green : C.violet, fontSize: 26, fontWeight: 900 }}>
              {done ? "✓" : ["◐", "◓", "◑", "◒"][Math.floor(frame / 3) % 4]}
            </span>
            {s.t}
          </div>
        );
      })}
    </div>
  );
}

function Table({ frame }: { frame: number }) {
  const t0 = T_ANSWER + 44;
  if (frame < t0) return null;
  return (
    <div style={{ marginTop: 22, borderRadius: 26, overflow: "hidden", border: `2px solid ${C.line}`, background: "#0b1220", opacity: lerp(frame, [t0, t0 + 6], [0, 1]) }}>
      <div style={{ display: "flex", padding: "18px 26px", background: "#111a2e", fontSize: 24, fontWeight: 800, letterSpacing: 1.5, color: "#94a3b8" }}>
        <span style={{ flex: 1 }}>KATEGORI</span>
        <span style={{ width: 120, textAlign: "right" }}>KASUS</span>
        <span style={{ width: 130, textAlign: "right" }}>TREN</span>
      </div>
      {ROWS.map(([k, n, tr, col], i) => {
        const at = t0 + 8 + i * 9;
        const p = lerp(frame, [at, at + 8], [0, 1]);
        return (
          <div key={k} style={{ display: "flex", alignItems: "center", padding: "20px 26px", borderTop: "2px solid #1e293b", fontSize: 30, fontWeight: 600, opacity: p, transform: `translateX(${(1 - p) * 40}px)` }}>
            <span style={{ flex: 1 }}>{k}</span>
            <span style={{ width: 120, textAlign: "right", fontFamily: DISPLAY, fontWeight: 800 }}>{n}</span>
            <span style={{ width: 130, textAlign: "right", fontWeight: 800, color: col }}>{tr}</span>
          </div>
        );
      })}
    </div>
  );
}

function Tips({ frame }: { frame: number }) {
  const t0 = T_ANSWER + 92;
  if (frame < t0) return null;
  return (
    <div style={{ marginTop: 26 }}>
      <div style={{ fontSize: 32, fontWeight: 800, opacity: lerp(frame, [t0, t0 + 5], [0, 1]) }}>💡 Saran:</div>
      {TIPS.map((t, i) => {
        const at = t0 + 8 + i * 16;
        const s = typed(t, frame, at, 1.6);
        if (!s) return null;
        return (
          <div key={t} style={{ marginTop: 12, display: "flex", gap: 14, fontSize: 30, lineHeight: 1.4 }}>
            <span style={{ color: C.orange, fontWeight: 800 }}>{i + 1}.</span>
            <span>{s}</span>
          </div>
        );
      })}
    </div>
  );
}
