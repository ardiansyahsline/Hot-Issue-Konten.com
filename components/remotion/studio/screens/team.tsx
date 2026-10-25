"use client";

/** Layar tim: Chat tim (bubble, reaksi, lampiran) & pemutar musik kerja (dibuat ulang dari website). */
import type { ReactNode } from "react";
import { Easing } from "remotion";
import {
  Avatar,
  Badge,
  Blur,
  Btn,
  Caret,
  DISPLAY,
  Grow,
  LiveDot,
  ME,
  Pointer,
  Shell,
  Z,
  avatarColor,
  bt,
  card,
  clamp01,
  en,
  fill,
  pop,
  ramp,
  rgba,
  typeEnd,
  typeOut,
  type Clock,
  type Env,
  type PKey,
} from "./ui";

// ================================================================== CHAT TIM ==================================================================
type Msg = { who: string; text: string; me?: boolean; react?: [string, number, boolean?][]; file?: { name: string; size: string; img?: boolean }; time: string };
const MSGS: Msg[] = [
  { who: "Natasha", text: "Guys, ada clipper komplain saldo lagi 😭", time: "09.12" },
  { who: "Irsyad", text: "Udah masuk Hot Issue, sekarang #1 🔥", react: [["🔥", 3], ["👍", 2, true]], time: "09.13" },
  { who: "Derencalibur", text: "Ini bukti dari clipper-nya", file: { name: "bukti-transfer.png", size: "248 KB", img: true }, time: "09.14" },
  { who: ME, me: true, text: "@Natasha aku cek ke tim payout ya 👍", react: [["🙏", 2]], time: "09.15" },
  { who: "Nengok", text: "Mantap, makasih Lif! 🙌", react: [["❤️", 1]], time: "09.16" },
];
const ROOMS: [string, number][] = [
  ["semua-cs", 0],
  ["video-review", 2],
  ["payout", 0],
  ["discord-mod", 5],
];
const TEAM = ["Natasha", "Irsyad", "Derencalibur", "Nengok"];

/** isi pesan: @sebut disorot */
function Body({ text, mine, acc }: { text: string; mine: boolean; acc: string }) {
  return (
    <>
      {text.split(/(@[\p{L}\d_]+)/u).map((s, i) =>
        s.startsWith("@") ? (
          <span key={i} style={{ borderRadius: 5, padding: "0 4px", fontWeight: 650, background: mine ? "rgba(255,255,255,0.25)" : rgba(acc, 0.15), color: mine ? "#fff" : acc }}>
            {s}
          </span>
        ) : (
          <span key={i}>{s}</span>
        ),
      )}
    </>
  );
}

/** lampiran gambar bukti — isinya bisa memuat data clipper, jadi diburamkan */
function ProofImage({ w }: { w: number }) {
  return (
    <div style={{ position: "relative", width: w, height: w * 0.62, borderRadius: 12, overflow: "hidden", border: "1px solid rgba(39,39,42,0.9)", background: "linear-gradient(160deg, #f4f4f5 0%, #d4d4d8 100%)" }}>
      <Blur px={2.6} style={{ position: "absolute", inset: 10 }}>
        <span style={{ display: "block", width: "45%", height: 8, borderRadius: 4, background: "#10b981" }} />
        {[0.9, 0.7, 0.8, 0.55].map((x, i) => (
          <span key={i} style={{ display: "block", marginTop: 8, width: `${x * 100}%`, height: 6, borderRadius: 3, background: "#71717a" }} />
        ))}
        <span style={{ display: "block", marginTop: 10, width: "38%", height: 12, borderRadius: 4, background: "#18181b" }} />
      </Blur>
      <span style={{ position: "absolute", right: 6, bottom: 6, borderRadius: 6, background: "rgba(0,0,0,0.6)", padding: "2px 6px", fontSize: 9.5, fontWeight: 650, color: "#fff" }}>🔒 disamarkan</span>
    </div>
  );
}

function Reactions({ t, list, at, mine, acc, wide }: { t: Clock; list: [string, number, boolean?][]; at: number; mine: boolean; acc: string; wide: boolean }) {
  return (
    <div style={{ marginTop: 4, display: "flex", gap: 4, justifyContent: mine ? "flex-end" : "flex-start" }}>
      {list.map(([emo, n, own], i) => {
        const p = pop(t, at + i * 4, { damping: 9, stiffness: 240 });
        if (t.f < at + i * 4) return null;
        return (
          <span
            key={i}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              borderRadius: 999,
              padding: "2px 8px",
              fontSize: wide ? 12.5 : 12,
              fontWeight: 650,
              border: `1px solid ${own ? rgba(acc, 0.5) : "rgba(39,39,42,0.95)"}`,
              background: own ? rgba(acc, 0.12) : Z[900],
              color: own ? acc : Z[300],
              transform: `scale(${p})`,
            }}
          >
            {emo} <span style={{ fontSize: 11 }}>{n}</span>
          </span>
        );
      })}
    </div>
  );
}

function Bubble({ e, m, at, w }: { e: Env; m: Msg; at: number; w: number }) {
  const { t, wide } = e;
  const mine = !!m.me;
  const p = pop(t, at, { damping: 13, stiffness: 210 });
  const fs = wide ? 14 : 13.5;
  return (
    <Grow p={ramp(t, at, at + 9, 0, 1, Easing.out(Easing.quad))}>
      <div style={{ display: "flex", gap: 8, flexDirection: mine ? "row-reverse" : "row", marginTop: 12, opacity: clamp01(p * 1.5), transform: `translateY(${(1 - p) * 14}px) scale(${0.9 + 0.1 * p})`, transformOrigin: mine ? "100% 100%" : "0 100%" }}>
        <Avatar name={m.who} me={mine} size={wide ? 30 : 28} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start", maxWidth: w * 0.78 }}>
          <span style={{ marginBottom: 3, fontSize: 11, color: Z[500] }}>
            {mine ? "Kamu" : m.who} · {m.time}
            {mine && t.f > at + 20 ? <span style={{ color: "#38bdf8" }}> · Dilihat 3</span> : null}
          </span>
          {m.file?.img && (
            <div style={{ marginBottom: 5 }}>
              <ProofImage w={Math.min(220, w * 0.62)} />
            </div>
          )}
          {m.file && !m.file.img && (
            <div style={{ marginBottom: 5, display: "flex", alignItems: "center", gap: 10, borderRadius: 14, border: "1px solid rgba(39,39,42,0.95)", background: "rgba(9,9,11,0.6)", padding: "8px 12px" }}>
              <span style={{ fontSize: 20 }}>📄</span>
              <span>
                <span style={{ display: "block", fontSize: 12.5, fontWeight: 550 }}>{m.file.name}</span>
                <span style={{ display: "block", fontSize: 11, color: Z[500] }}>
                  {m.file.size} · <b style={{ color: e.acc2 }}>Unduh</b>
                </span>
              </span>
            </div>
          )}
          <div
            style={{
              fontSize: fs,
              lineHeight: 1.5,
              padding: "7px 12px",
              borderRadius: mine ? "16px 6px 16px 16px" : "6px 16px 16px 16px",
              background: mine ? e.grad : "rgba(39,39,42,0.75)",
              color: mine ? "#fff" : Z[100],
              boxShadow: mine ? `0 8px 20px -8px ${rgba(e.acc, 0.7)}` : undefined,
              wordBreak: "break-word",
            }}
          >
            <Body text={m.text} mine={mine} acc={e.acc2} />
          </div>
          {m.react && <Reactions t={t} list={m.react} at={at + en(t, 16)} mine={mine} acc={e.acc2} wide={wide} />}
        </div>
      </div>
    </Grow>
  );
}

function Typing({ e, who, from, to }: { e: Env; who: string; from: number; to: number }) {
  const { t } = e;
  const on = t.f >= from && t.f < to;
  const p = on ? ramp(t, from, from + 6) : 0;
  if (!on) return null;
  return (
    <Grow p={p} max={60}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
        <Avatar name={who} size={22} />
        <span style={{ display: "inline-flex", gap: 4, borderRadius: 14, background: "rgba(39,39,42,0.75)", padding: "9px 12px" }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ width: 6, height: 6, borderRadius: 3, background: Z[400], transform: `translateY(${Math.sin(t.f / 3 - i * 0.9) * 2.5}px)`, opacity: 0.6 + 0.4 * Math.sin(t.f / 3 - i * 0.9) }} />
          ))}
        </span>
        <span style={{ fontSize: 11, color: Z[500], fontStyle: "italic" }}>{who} sedang mengetik…</span>
      </div>
    </Grow>
  );
}

export function ChatScreen({ e }: { e: Env }) {
  const { t, wide } = e;
  const texts = fill(e.items, MSGS.map((m) => m.text), Math.max(MSGS.length, Math.min(e.items.length, 6)));
  const msgs: Msg[] = texts.map((text, i) => {
    const base = MSGS[i] ?? { who: TEAM[i % TEAM.length], text, time: `09.${17 + i}` };
    return { ...base, text, file: e.items[i] && base.file && !base.file.img ? base.file : e.items[i] ? undefined : base.file };
  });
  const gap = 0.74 / Math.max(1, msgs.length - 1);
  const times = msgs.map((_, i) => bt(t, 0.04 + i * gap));
  const meIdx = msgs.findIndex((m) => m.me);
  // pesan sendiri diketik dulu di kolom tulis, lalu dikirim
  const meAt = meIdx >= 0 ? times[meIdx] : -1;
  const typeFrom = meIdx >= 0 ? Math.max(times[Math.max(0, meIdx - 1)] + en(t, 10), meAt - t.fps * 1.6) : -1;
  const cps = meIdx >= 0 ? Math.max(18, (Array.from(msgs[meIdx].text).length / Math.max(6, meAt - 4 - typeFrom)) * t.fps) : 30;
  const draft = meIdx >= 0 && t.f >= typeFrom && t.f < meAt ? typeOut(t, msgs[meIdx].text, typeFrom, cps) : "";
  const sending = meIdx >= 0 && t.f >= meAt - 4 && t.f < meAt + 3;
  const typingDone = meIdx >= 0 && t.f >= typeEnd(t, msgs[meIdx].text, typeFrom, cps);
  const online = 3 + (t.f > bt(t, 0.5) ? 1 : 0);

  const thread = (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", height: "100%", minWidth: 0, flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: wide ? "12px 20px" : "10px 14px", borderBottom: "1px solid rgba(39,39,42,0.8)" }}>
        <span style={{ width: 32, height: 32, borderRadius: 999, background: rgba(e.acc, 0.12), color: e.acc2, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 750, fontSize: 15 }}>#</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: wide ? 15 : 14.5, fontWeight: 650 }}>semua-cs</div>
          <div style={{ fontSize: 11.5, color: Z[500] }}>
            Room bersama · 5 anggota · <span style={{ color: "#10b981" }}>{online} online</span>
          </div>
        </div>
        <div style={{ display: "flex" }}>
          {TEAM.slice(0, 3).map((n, i) => (
            <span key={n} style={{ marginLeft: i ? -8 : 0 }}>
              <Avatar name={n} size={24} ring={Z[900]} />
            </span>
          ))}
        </div>
      </div>
      <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: wide ? "0 20px 12px" : "0 12px 10px", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
          <div style={{ margin: "8px 0 0", display: "flex", alignItems: "center", gap: 10, fontSize: 11, fontWeight: 650, color: Z[500] }}>
            <span style={{ flex: 1, height: 1, background: Z[800] }} />
            Hari ini
            <span style={{ flex: 1, height: 1, background: Z[800] }} />
          </div>
          {msgs.map((m, i) => (
            <div key={i}>
              {!m.me && i > 0 && <Typing e={e} who={m.who} from={times[i] - Math.min(t.fps * 0.9, (times[i] - times[i - 1]) * 0.55)} to={times[i]} />}
              {t.f >= times[i] && <Bubble e={e} m={m} at={times[i]} w={wide ? 1224 - 250 - 220 - 40 : 338} />}
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, padding: wide ? "10px 20px" : "9px 12px", borderTop: "1px solid rgba(39,39,42,0.8)" }}>
        <span style={{ width: 38, height: 38, flex: "none", borderRadius: 12, border: "1px solid rgba(63,63,70,0.8)", display: "flex", alignItems: "center", justifyContent: "center", color: Z[400], fontSize: 16 }}>📎</span>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            height: 38,
            boxSizing: "border-box",
            borderRadius: 12,
            border: `1px solid ${draft ? e.acc : "rgba(63,63,70,0.8)"}`,
            boxShadow: draft ? `0 0 0 4px ${rgba(e.acc, 0.16)}` : undefined,
            background: Z[950],
            padding: "0 12px",
            display: "flex",
            alignItems: "center",
            fontSize: 13.5,
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          {draft ? (
            <>
              <span style={{ overflow: "hidden", textOverflow: "clip", direction: "rtl", textAlign: "left", unicodeBidi: "plaintext" }}>{draft}</span>
              <Caret t={t} typing={!typingDone} color={e.acc} h={17} />
            </>
          ) : (
            <span style={{ color: Z[500] }}>Tulis pesan… (@ untuk sebut)</span>
          )}
        </div>
        <Btn grad={e.grad} size={13} press={sending ? 0.9 : 1} style={{ height: 38, boxSizing: "border-box", padding: "0 14px" }}>
          {wide ? "Kirim" : "➤"}
        </Btn>
      </div>
    </div>
  );

  return (
    <Shell e={e} nav="chat" fill>
      <div style={{ ...card(e.acc), position: "absolute", inset: 0, overflow: "hidden", display: "flex" }}>
        {wide && (
          <div style={{ width: 250, flex: "none", borderRight: "1px solid rgba(39,39,42,0.8)", padding: 12, boxSizing: "border-box" }}>
            <div style={{ height: 38, borderRadius: 12, border: "1px solid rgba(63,63,70,0.8)", background: Z[950], display: "flex", alignItems: "center", padding: "0 12px", fontSize: 13, color: Z[500] }}>Cari orang / room…</div>
            <div style={{ marginTop: 16, fontSize: 11, fontWeight: 650, letterSpacing: 1.2, color: Z[500], padding: "0 4px" }}>ROOM</div>
            {ROOMS.map(([r, n], i) => (
              <div key={r} style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 10, borderRadius: 12, padding: "8px 10px", background: i === 0 ? rgba(e.acc, 0.1) : undefined }}>
                <span style={{ width: 28, height: 28, borderRadius: 999, background: Z[800], color: Z[400], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>#</span>
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: i === 0 || n ? 650 : 400, color: i === 0 ? e.acc2 : Z[200] }}>{r}</span>
                {n > 0 && <span style={{ minWidth: 20, borderRadius: 999, background: e.acc, color: "#fff", fontSize: 11, fontWeight: 700, textAlign: "center", lineHeight: "20px" }}>{n}</span>}
              </div>
            ))}
            <div style={{ marginTop: 16, fontSize: 11, fontWeight: 650, letterSpacing: 1.2, color: Z[500], padding: "0 4px" }}>PESAN PRIBADI</div>
            {TEAM.map((n, i) => (
              <div key={n} style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 10, padding: "7px 10px" }}>
                <Avatar name={n} size={26} />
                <span style={{ flex: 1, fontSize: 13.5, color: Z[200] }}>{n}</span>
                <span style={{ width: 8, height: 8, borderRadius: 4, background: i < online - 1 ? "#10b981" : Z[600] }} />
              </div>
            ))}
          </div>
        )}
        {thread}
        {wide && (
          <div style={{ width: 220, flex: "none", borderLeft: "1px solid rgba(39,39,42,0.8)", padding: 16, boxSizing: "border-box" }}>
            <div style={{ fontSize: 13, fontWeight: 650 }}>Anggota · 5</div>
            {[ME, ...TEAM].map((n, i) => (
              <div key={n} style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ position: "relative", display: "inline-flex" }}>
                  <Avatar name={n} me={n === ME} size={30} />
                  <span style={{ position: "absolute", right: -1, bottom: -1, width: 10, height: 10, borderRadius: 5, border: `2px solid ${Z[900]}`, background: i < online ? "#10b981" : Z[600] }} />
                </span>
                <span>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{n === ME ? `${n} (kamu)` : n}</span>
                  <span style={{ display: "block", fontSize: 11, color: i < online ? "#10b981" : Z[500] }}>{i < online ? "online" : "10 mnt lalu"}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}

// ================================================================== PEMUTAR MUSIK ==================================================================
const PRESETS = [
  ["🎹", "Piano klasik santai", "Piano solo lembut, tenang", 70],
  ["🎻", "String quartet", "Biola & cello hangat", 76],
  ["🧠", "Fokus kerja", "Ambient klasik minim drum", 72],
  ["🎸", "Gitar akustik", "Petikan gitar akustik hangat", 78],
  ["🪕", "Gitar klasik (nylon)", "Gitar klasik lembut, ala Spanyol", 72],
  ["☕", "Lo-fi klasik", "Klasik + beat santai", 80],
] as const;
const EM = "#10b981";

/** batang equalizer (gerak dari frame) */
function Eq({ t, n, h, on, w = 4 }: { t: Clock; n: number; h: number; on: number; w?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: w * 0.7, height: h }}>
      {Array.from({ length: n }, (_, i) => {
        const v = 0.5 + 0.5 * Math.sin(t.f / (3.2 + (i % 4) * 0.9) + i * 1.7) * Math.cos(t.f / (7 + (i % 3)) + i);
        return <span key={i} style={{ width: w, height: Math.max(3, h * (0.12 + 0.88 * Math.abs(v) * on)), borderRadius: w, background: `linear-gradient(180deg, #6ee7b7 0%, ${EM} 100%)` }} />;
      })}
    </div>
  );
}

/** sampul lagu: gradasi + gelombang SVG yang bergerak */
function Cover({ t, size, on, icon }: { t: Clock; size: number; on: number; icon: string }) {
  const waves = [0, 1, 2].map((k) => {
    const pts = Array.from({ length: 13 }, (_, i) => {
      const x = (i / 12) * size;
      const y = size * (0.62 + k * 0.1) + Math.sin(i * 0.9 + t.f / (9 - k * 2) + k) * size * 0.05 * (0.4 + on * 0.6);
      return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    });
    return `${pts.join(" ")} L${size} ${size} L0 ${size} Z`;
  });
  return (
    <div style={{ position: "relative", width: size, height: size, flex: "none", borderRadius: size * 0.16, overflow: "hidden", background: "linear-gradient(145deg, #34d399 0%, #0ea5e9 55%, #6366f1 100%)", boxShadow: `0 18px 40px -16px ${rgba(EM, 0.7)}` }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: "absolute", inset: 0 }} aria-hidden>
        {waves.map((d, k) => (
          <path key={k} d={d} fill={`rgba(255,255,255,${0.12 + k * 0.08})`} />
        ))}
      </svg>
      <span style={{ position: "absolute", left: 0, right: 0, top: size * 0.18, textAlign: "center", fontSize: size * 0.34, transform: `scale(${1 + Math.sin(t.f / 7.5) * 0.04 * on})` }}>{icon}</span>
    </div>
  );
}

export function MusicScreen({ e }: { e: Env }) {
  const { t, wide } = e;
  const names = fill(e.items, PRESETS.map((p) => p[1]), 6);
  const list = PRESETS.map((p, i) => ({ icon: p[0], name: names[i], desc: e.items[i] ? "Musik pilihanmu" : p[2], bpm: p[3] }));
  const target = e.items.length ? 0 : 5;
  const tap = bt(t, 0.18);
  const startAt = bt(t, 0.3);
  const picked = t.f >= tap ? target : 0;
  const connecting = t.f >= tap && t.f < startAt;
  const on = ramp(t, startAt, startAt + 12);
  const playing = t.f >= startAt;
  const vol = ramp(t, bt(t, 0.62), bt(t, 0.72), 0.5, 0.82, Easing.inOut(Easing.quad));
  const secs = playing ? 72 + Math.floor((t.f - startAt) / t.fps) : 0;
  const clock = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
  const cur = list[picked];
  const title = e.title || cur.name;

  const rowH = wide ? 54 : 48;
  const listTop = wide ? 0 : 252;
  const presetList = (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {list.map((p, i) => {
        const a = pop(t, en(t, 10 + i * 3));
        const sel = i === picked;
        return (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              height: rowH,
              boxSizing: "border-box",
              borderRadius: 12,
              padding: "0 10px",
              background: sel ? rgba(EM, 0.1) : undefined,
              border: `1px solid ${sel ? rgba(EM, 0.45) : "transparent"}`,
              opacity: clamp01(a * 1.3),
              transform: `translateX(${(1 - a) * 20}px)`,
            }}
          >
            <span style={{ fontSize: 19 }}>{p.icon}</span>
            <span style={{ minWidth: 0, flex: 1 }}>
              <span style={{ display: "block", fontSize: 13, fontWeight: 650, color: Z[200], whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
              <span style={{ display: "block", fontSize: 11, color: Z[500], whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.desc}</span>
            </span>
            {sel && playing && <span style={{ fontSize: 11, fontWeight: 750, color: "#34d399", whiteSpace: "nowrap" }}>▶ diputar</span>}
            {sel && connecting && <span style={{ fontSize: 11, fontWeight: 650, color: Z[400], whiteSpace: "nowrap" }}>menyambung{".".repeat(1 + (Math.floor(t.f / 6) % 3))}</span>}
          </div>
        );
      })}
    </div>
  );

  const art = wide ? 210 : 112;
  const player = (
    <div style={{ display: "flex", flexDirection: wide ? "column" : "row", alignItems: wide ? "center" : "center", gap: wide ? 18 : 14 }}>
      <Cover t={t} size={art} on={on} icon={cur.icon} />
      <div style={{ flex: 1, minWidth: 0, width: wide ? "100%" : undefined, textAlign: wide ? "center" : "left" }}>
        <div style={{ fontFamily: DISPLAY, fontSize: wide ? 22 : 16, fontWeight: 750, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
        <div style={{ marginTop: 3, fontSize: wide ? 13 : 11.5, color: Z[500] }}>Musik AI · tempo {cur.bpm}</div>
        <div style={{ marginTop: wide ? 14 : 10, display: "flex", alignItems: "center", justifyContent: wide ? "center" : "flex-start", gap: 10 }}>
          <Eq t={t} n={wide ? 18 : 12} h={wide ? 34 : 26} on={on} w={wide ? 5 : 4} />
          {playing ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 750, color: "#34d399" }}>
              <LiveDot t={t} color={EM} size={7} /> LIVE {clock}
            </span>
          ) : (
            <span style={{ fontSize: 11, color: Z[500] }}>{connecting ? "menyambung…" : "siap diputar"}</span>
          )}
        </div>
      </div>
    </div>
  );

  const controls = (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {playing ? (
        <span style={{ borderRadius: 12, background: Z[800], padding: "8px 14px", fontSize: 12.5, fontWeight: 750, color: Z[100] }}>⏸ Jeda</span>
      ) : (
        <span style={{ borderRadius: 12, background: "#059669", padding: "8px 14px", fontSize: 12.5, fontWeight: 750, color: "#fff" }}>▶ Putar</span>
      )}
      <span style={{ borderRadius: 12, border: "1px solid rgba(39,39,42,0.95)", padding: "8px 12px", fontSize: 12.5, fontWeight: 700, color: Z[300] }}>⟳ Ganti</span>
      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: Z[500] }}>
        🔊
        <div style={{ position: "relative", flex: 1, height: 5, borderRadius: 3, background: Z[800] }}>
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${vol * 100}%`, borderRadius: 3, background: EM }} />
          <span style={{ position: "absolute", left: `${vol * 100}%`, top: -5, width: 15, height: 15, marginLeft: -7, borderRadius: 999, background: "#fff", boxShadow: "0 2px 6px rgba(0,0,0,0.5)" }} />
        </div>
      </div>
    </div>
  );

  const head = (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <b style={{ fontSize: wide ? 16 : 14.5 }}>🎵 Musik</b>
      <div style={{ marginLeft: "auto", display: "flex", borderRadius: 999, background: Z[800], padding: 2, fontSize: 11.5, fontWeight: 650 }}>
        <span style={{ borderRadius: 999, padding: "4px 10px", background: "#059669", color: "#fff" }}>✨ Musik AI</span>
        <span style={{ borderRadius: 999, padding: "4px 10px", color: Z[400] }}>▶ YouTube</span>
      </div>
    </div>
  );

  // jari mengetuk preset, lalu menggeser volume
  const volX = wide ? 0 : 0;
  const keys: PKey[] = wide
    ? [
        { f: tap - 16, x: 900, y: 220 },
        { f: tap, x: 980, y: 104 + 22 + 12 + target * (rowH + 3) + rowH / 2 + 60, click: true },
        { f: bt(t, 0.6), x: 360, y: 552 },
        { f: bt(t, 0.62), x: 300 + 0.5 * 200, y: 552, click: true },
        { f: bt(t, 0.72), x: 300 + 0.82 * 200, y: 552 },
      ]
    : [
        { f: tap - 16, x: 250, y: 600 },
        { f: tap, x: 200, y: 54 + 112 + 14 + 14 + listTop + target * (rowH + 3) + rowH / 2, click: true },
        { f: bt(t, 0.6) - 6, x: 300, y: 54 + 112 + 14 + 196 },
        { f: bt(t, 0.62), x: 210 + volX + 0.5 * 120, y: 54 + 112 + 14 + 196, click: true },
        { f: bt(t, 0.72), x: 210 + 0.82 * 120, y: 54 + 112 + 14 + 196 },
      ];

  return (
    <Shell e={e} nav="music" fill>
      {wide ? (
        <div style={{ position: "absolute", inset: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) 420px", gap: 20 }}>
          <div style={{ ...card(EM), padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
            {head}
            <div style={{ fontSize: 12, color: Z[500], marginTop: -12 }}>Instrumental dibuat AI langsung, tanpa jeda</div>
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>{player}</div>
            <div style={{ width: 400, alignSelf: "center" }}>{controls}</div>
          </div>
          <div style={{ ...card(EM), padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 10 }}>Pilih suasana</div>
            {presetList}
          </div>
        </div>
      ) : (
        <div style={{ ...card(EM), position: "absolute", inset: 0, padding: 14, boxSizing: "border-box" }}>
          {head}
          <div style={{ marginTop: 3, fontSize: 11, color: Z[500] }}>Instrumental dibuat AI langsung, tanpa jeda</div>
          <div style={{ marginTop: 14 }}>{player}</div>
          <div style={{ marginTop: 16 }}>{controls}</div>
          <div style={{ marginTop: 14, height: 1, background: Z[800] }} />
          <div style={{ position: "absolute", left: 10, right: 10, top: listTop }}>{presetList}</div>
        </div>
      )}
      <MusicPointer e={e} keys={keys} />
    </Shell>
  );
}

/** jari di atas seluruh layar (koordinat layar, bukan koordinat isi) */
function MusicPointer({ e, keys }: { e: Env; keys: PKey[] }): ReactNode {
  return (
    <div style={{ position: "absolute", left: e.wide ? -28 : -14, top: -(e.top + (e.wide ? 64 : 112)) - (e.wide ? 22 : 14) }}>
      <Pointer t={e.t} keys={keys} wide={e.wide} />
    </div>
  );
}

export const _badge = Badge;
