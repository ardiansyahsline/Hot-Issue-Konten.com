"use client";

/** Layar AI CS Tracker: tab ✨ AI (tanya-jawab dengan hero), Train your AI (kuis → tipe 4 huruf), Studio Pro (sutradara AI + timeline). */
import type { CSSProperties, ReactNode } from "react";
import { Easing } from "remotion";
import { GROUPS, MBTI_TYPES, personaIntro, personaOf, stepLabel, typeGroup, typeInfo, type Group } from "@/lib/aiPersona";
import { QUIZ, QUIZ_QS, typeProfile } from "@/lib/trainAi";
import {
  BarChart,
  Btn,
  Caret,
  DISPLAY,
  Grow,
  Hero,
  HeroAvatar,
  HelperChip,
  LiveDot,
  Rich,
  Shell,
  Sparkles,
  Tabs,
  TapAt,
  Toast,
  Z,
  bt,
  card,
  clamp01,
  en,
  fill,
  mixHex,
  plain,
  pop,
  ramp,
  rgba,
  tail,
  useSid,
  type Clock,
  type Env,
} from "./ui";

const HERO = "Harley";
const ORANGE4 = "#fb923c";

/** ikon proses: ✓ selesai / ⏳ berputar */
function StepIcon({ t, done, size = 12.5 }: { t: Clock; done: boolean; size?: number }) {
  return done ? (
    <b style={{ color: "#34d399", fontSize: size, fontWeight: 800 }}>✓</b>
  ) : (
    <span style={{ display: "inline-block", fontSize: size - 1, transform: `rotate(${(t.f * 14) % 360}deg)` }}>⏳</span>
  );
}

/** kolom tulis tab AI: teks diketik, chip Data/Internet, tombol kirim */
function Composer({ e, draft, focus, sendAt, placeholder }: { e: Env; draft: string; focus: boolean; sendAt: number; placeholder: string }) {
  const { t, wide } = e;
  const ready = draft.length > 0;
  const press = t.f >= sendAt - 3 && t.f < sendAt + 3 ? 0.86 : 1;
  return (
    <div
      style={{
        flex: "none",
        borderRadius: 18,
        border: `1px solid ${focus ? rgba(e.acc, 0.8) : Z[800]}`,
        background: Z[900],
        padding: wide ? "10px 12px 8px" : "8px 10px 7px",
        boxShadow: focus ? `0 0 0 4px ${rgba(e.acc, 0.14)}, 0 12px 30px -16px rgba(0,0,0,0.8)` : "0 12px 30px -16px rgba(0,0,0,0.8)",
      }}
    >
      <div style={{ minHeight: 26, display: "flex", alignItems: "center", padding: "0 4px", fontSize: 14, color: Z[100], whiteSpace: "nowrap", overflow: "hidden" }}>
        {ready ? (
          <>
            <span style={{ whiteSpace: "nowrap" }}>{tail(draft, wide ? 80 : 34)}</span>
            {focus && <Caret t={t} typing color={e.acc} h={17} />}
          </>
        ) : (
          <span style={{ color: Z[500] }}>{placeholder}</span>
        )}
      </div>
      <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 30, height: 30, flex: "none", borderRadius: 999, border: `1px solid ${Z[800]}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>📎</span>
        <span style={{ whiteSpace: "nowrap", borderRadius: 999, border: "1px solid rgba(16,185,129,0.4)", background: "rgba(16,185,129,0.1)", padding: "4px 10px", fontSize: 11.5, fontWeight: 650, color: "#34d399" }}>
          {wide ? "📊 Data CS Tracker: Otomatis" : "📊 Data"}
        </span>
        <span style={{ whiteSpace: "nowrap", borderRadius: 999, border: `1px solid ${Z[800]}`, padding: "4px 10px", fontSize: 11.5, fontWeight: 650, color: Z[500] }}>🌐 Internet</span>
        <span style={{ flex: 1 }} />
        <span
          style={{
            position: "relative",
            width: 34,
            height: 34,
            flex: "none",
            borderRadius: 999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 17,
            fontWeight: 900,
            color: "#fff",
            background: ready ? e.grad : Z[800],
            boxShadow: ready ? `0 8px 18px -8px ${rgba(e.acc, 0.8)}` : undefined,
            transform: `scale(${press})`,
          }}
        >
          ↑
          <TapAt t={t} at={sendAt} wide={wide} from={[-70, -40]} />
        </span>
      </div>
    </div>
  );
}

type Opt = { label: string; desc?: string };

/** kartu pertanyaan balik (ChoiceCard / PagedAsk website): pilihan bernomor, "Disarankan", Lainnya, Lewati */
function AskBox({ e, title, q, opts, pick, tapAt, at }: { e: Env; title: string; q: string; opts: Opt[]; pick: number; tapAt: number; at: number }) {
  const { t, wide } = e;
  const chosen = t.f >= tapAt - 1;
  return (
    <div style={{ borderRadius: 16, border: `1px solid ${Z[800]}`, background: Z[900], boxShadow: "0 1px 2px rgba(0,0,0,0.4), 0 18px 40px -24px rgba(0,0,0,0.8)" }}>
      <div style={{ padding: "11px 14px 3px" }}>
        <div style={{ fontSize: 12, color: Z[500], marginBottom: 2 }}>{title}</div>
        <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.35, color: Z[100] }}>{q}</div>
      </div>
      <div style={{ padding: "3px 8px 2px" }}>
        {opts.map((o, i) => {
          const on = chosen && i === pick;
          const a = pop(e.t, at + 4 + i * 3, { damping: 18 });
          return (
            <div
              key={i}
              style={{
                position: "relative",
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                borderRadius: 12,
                padding: "7px 8px",
                background: on ? rgba(e.acc, 0.1) : undefined,
                opacity: clamp01(a * 1.4),
                transform: `translateX(${(1 - a) * 14}px)`,
              }}
            >
              <span
                style={{
                  marginTop: 1,
                  width: 20,
                  height: 20,
                  flex: "none",
                  boxSizing: "border-box",
                  borderRadius: 999,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 700,
                  color: on ? "#fff" : Z[500],
                  background: on ? e.acc : undefined,
                  border: on ? undefined : `1px solid ${Z[700]}`,
                }}
              >
                {i + 1}
              </span>
              <span style={{ minWidth: 0 }}>
                <b style={{ display: "block", fontSize: 13, fontWeight: 650, color: Z[100] }}>
                  {o.label}
                  {i === 0 && <span style={{ marginLeft: 6, borderRadius: 6, background: rgba(e.acc, 0.15), padding: "1px 6px", fontSize: 10, fontWeight: 700, color: e.acc }}>Disarankan</span>}
                </b>
                {o.desc && <span style={{ display: "block", fontSize: 12, color: Z[500], whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.desc}</span>}
              </span>
              {i === pick && <TapAt t={t} at={tapAt} wide={wide} x="34%" from={[110, 30]} />}
            </div>
          );
        })}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 8px 7px" }}>
          <span style={{ width: 20, textAlign: "center", fontSize: 12 }}>✍️</span>
          <span style={{ flex: 1, borderRadius: 12, border: `1px dashed ${Z[700]}`, padding: "5px 10px", fontSize: 12.5, color: Z[500] }}>Lainnya… ketik sendiri, Enter</span>
        </div>
      </div>
      <div style={{ borderTop: "1px solid rgba(39,39,42,0.7)", padding: "8px 14px", fontSize: 12.5, fontWeight: 650, color: Z[500] }}>Lewati, langsung kerjain</div>
    </div>
  );
}

/** kartu yang sudah dijawab (AnsweredCard) */
function AnsweredBox({ title, pairs, acc }: { title: string; pairs: [string, string][]; acc: string }) {
  return (
    <div style={{ borderRadius: 16, border: `1px solid ${Z[800]}`, background: Z[900], overflow: "hidden" }}>
      <div style={{ borderBottom: "1px solid rgba(39,39,42,0.7)", padding: "7px 14px", fontSize: 12, color: Z[500] }}>{title}</div>
      {pairs.map(([q, a], i) => (
        <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "7px 14px", fontSize: 13 }}>
          <span style={{ marginTop: 2, width: 16, height: 16, flex: "none", borderRadius: 999, background: acc, color: "#fff", fontSize: 9, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>✓</span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 12, color: Z[500] }}>{q}</span>
            <span style={{ display: "block", fontWeight: 650, color: Z[100] }}>{a}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

type Step = { k: string; at: number };
/** proses "lagi mikir" (ThinkingSteps live) dengan gaya bicara hero */
function ThinkingBox({ e, hero, steps, end }: { e: Env; hero: string; steps: Step[]; end: number }) {
  const { t } = e;
  const p = personaOf(hero);
  return (
    <div style={{ borderRadius: 12, border: `1px solid ${Z[800]}`, padding: "8px 12px" }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: ORANGE4, lineHeight: 1.35 }}>
        {hero} ({p.type}): “{personaIntro(hero)}”
      </div>
      <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 4 }}>
        {steps.map((s, i) => {
          if (t.f < s.at) return null;
          const done = t.f >= (steps[i + 1]?.at ?? end) - 2;
          const a = ramp(t, s.at, s.at + 7);
          return (
            <div key={s.k} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: Z[300], opacity: a, transform: `translateY(${(1 - a) * 6}px)` }}>
              <span style={{ width: 16, textAlign: "center" }}>
                <StepIcon t={t} done={done} />
              </span>
              <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{stepLabel(hero, { k: s.k }, done)}</span>
              {done && s.k === "data" && <span style={{ marginLeft: "auto", fontSize: 11, color: Z[500], whiteSpace: "nowrap" }}>34 issue</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ================================================================== TAB ✨ AI ==================================================================
const AI_Q = "Rangkum hot issue minggu ini + saran dong 🙏";
const AI_A = "Minggu ini ada **12 Hot Issue** 🔥 — naik **33%**. Paling banyak soal **payout**.";
const AI_OPTS: Opt[] = [
  { label: "Payout", desc: "Saldo & pencairan clipper" },
  { label: "Video Review", desc: "Video ditolak & banding" },
  { label: "Semua kategori", desc: "Ringkasan lengkap 7 hari" },
];
const AI_TIPS = ["Cek batch payout tiap Senin pagi", "Kirim ulang panduan brief ke clipper"];
const AI_CHATS = ["Rangkum hot issue minggu ini", "Kenapa video banyak ditolak?", "Ide konten minggu depan", "Draft balasan ke clipper", "Analisa BTC 4H"];

/**
 * Tab AI: pertanyaan diketik → hero muncul ("Kamu dibantu oleh …") → kartu tanya balik dipilih →
 * langkah berpikir → jawaban mengalir + grafik mini + saran. title = pertanyaan, items = [jawaban, pilihan 1–3].
 */
export function AiScreen({ e }: { e: Env }) {
  const { t, wide } = e;
  const q = e.title || AI_Q;
  const ans = e.items[0] || AI_A;
  const opts = fill(e.items.slice(1).map((label): Opt => ({ label })), AI_OPTS, 3);
  const pick = 0;

  // jalan cerita (pecahan panjang cerita)
  const typeAt = bt(t, 0.02);
  const sendAt = bt(t, 0.16);
  const cps = Math.max(26, (Array.from(q).length / Math.max(8, sendAt - 6 - typeAt)) * t.fps);
  const draft = t.f < sendAt + 1 ? Array.from(q).slice(0, Math.max(0, Math.floor(((t.f - typeAt) / t.fps) * cps))).join("") : "";
  const rowAt = bt(t, 0.21);
  const askAt = bt(t, 0.25);
  const tapAt = bt(t, 0.37);
  const doneAsk = tapAt + 8;
  const thAt = bt(t, 0.42);
  const ansAt = bt(t, 0.6);
  const steps: Step[] = [
    { k: "understand", at: thAt + 3 },
    { k: "data", at: thAt + (ansAt - thAt) * 0.33 },
    { k: "write", at: thAt + (ansAt - thAt) * 0.66 },
  ];
  const ansLen = Array.from(plain(ans)).length;
  const ansN = t.f >= ansAt ? ((t.f - ansAt) / t.fps) * 48 : 0;
  const chartAt = Math.max(bt(t, 0.7), ansAt + (ansLen / 48) * t.fps * 0.7);
  const tipsAt = Math.max(bt(t, 0.8), chartAt + 14);
  const colW = wide ? 712 : 314;
  const helperP = pop(t, rowAt, { damping: 13 });
  const helperGlow = t.f >= rowAt ? Math.max(0, 1 - (t.f - rowAt) / 30) : 0;
  const speaking = t.f >= ansAt && ansN < ansLen;

  const assistant = t.f >= rowAt && (
    <Grow p={ramp(t, rowAt, rowAt + 8, 0, 1, Easing.out(Easing.quad))} max={wide ? 640 : 560} style={{ marginTop: 14 }}>
      <div style={{ display: "flex", gap: 12 }}>
        <span style={{ position: "relative", display: "inline-flex", alignSelf: "flex-start", transform: `scale(${0.6 + 0.4 * helperP})` }}>
          <HeroAvatar t={t} hero={HERO} size={36} acc={e.acc} talk={speaking} />
          <span style={{ position: "absolute", left: 18, top: 18 }}>
            <Sparkles t={t} at={rowAt + 2} r={34} />
          </span>
        </span>
        <div style={{ minWidth: 0, flex: 1, fontSize: 14, lineHeight: 1.55, color: Z[200] }}>
          <HelperChip hero={HERO} max={colW} p={helperP} glow={helperGlow} acc={e.acc} />
          {t.f >= askAt && t.f < doneAsk + 8 && (
            <Grow p={ramp(t, askAt, askAt + 10, 0, 1, Easing.out(Easing.cubic)) * (1 - ramp(t, doneAsk, doneAsk + 8))} max={250}>
              <AskBox e={e} title="Biar pas, aku tanya dulu ya ✨" q="Mau fokus ke mana?" opts={opts} pick={pick} tapAt={tapAt} at={askAt} />
            </Grow>
          )}
          {t.f >= doneAsk && (
            <Grow p={ramp(t, doneAsk, doneAsk + 8)} max={80}>
              <AnsweredBox title="Biar pas, aku tanya dulu ya ✨" pairs={[["Mau fokus ke mana", opts[pick].label]]} acc={e.acc} />
            </Grow>
          )}
          {t.f >= thAt && (
            <Grow p={ramp(t, thAt, thAt + 8) * (1 - ramp(t, ansAt - 2, ansAt + 6))} max={110} style={{ marginTop: 8 }}>
              <ThinkingBox e={e} hero={HERO} steps={steps} end={ansAt} />
            </Grow>
          )}
          {t.f >= ansAt && (
            <Grow p={ramp(t, ansAt, ansAt + 6)} max={24} style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11.5, fontWeight: 650, color: Z[500] }}>
                ⚙️ Lihat proses ▸ <span style={{ fontWeight: 400 }}>(3 langkah · 4 detik)</span>
              </div>
            </Grow>
          )}
          {t.f >= ansAt && (
            <div style={{ marginTop: 4 }}>
              <Rich text={ans} n={ansN} bold={{ color: "#fdba74" }} />
              {speaking && <Caret t={t} typing color={e.acc} h={15} />}
            </div>
          )}
          {t.f >= chartAt && (
            <Grow p={ramp(t, chartAt, chartAt + 10, 0, 1, Easing.out(Easing.cubic))} max={wide ? 190 : 150} style={{ marginTop: 10 }}>
              <div style={{ ...card(e.acc), borderRadius: 14, padding: "10px 12px 8px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 650 }}>
                  <span>📊 Issue per kategori · 7 hari</span>
                  <span style={{ color: "#f87171" }}>▲ 33%</span>
                </div>
                <div style={{ marginTop: 6 }}>
                  <BarChart values={[9, 6, 5, 4]} labels={["Payout", "Video", "Discord", "Views"]} h={wide ? 140 : 102} color={e.acc} t={t} at={chartAt + 4} hi={pick} label={wide ? 11 : 10} gap={wide ? 18 : 10} />
                </div>
              </div>
            </Grow>
          )}
          {t.f >= tipsAt && (
            <Grow p={ramp(t, tipsAt, tipsAt + 8)} max={90} style={{ marginTop: 8 }}>
              <b style={{ fontWeight: 750, color: Z[50] }}>💡 Saran:</b>
              {AI_TIPS.map((x, i) => {
                const at = tipsAt + 6 + i * 14;
                const n = ((t.f - at) / t.fps) * 50;
                if (n <= 0) return null;
                return (
                  <div key={i} style={{ display: "flex", gap: 8 }}>
                    <b style={{ color: e.acc }}>{i + 1}.</b>
                    <span>
                      <Rich text={x} n={n} />
                    </span>
                  </div>
                );
              })}
            </Grow>
          )}
        </div>
      </div>
    </Grow>
  );

  const userMsg = t.f >= sendAt && (
    <Grow p={ramp(t, sendAt, sendAt + 8, 0, 1, Easing.out(Easing.quad))} max={110}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div
          style={{
            maxWidth: "85%",
            borderRadius: "16px 16px 6px 16px",
            padding: "9px 15px",
            fontSize: 14,
            lineHeight: 1.45,
            color: "#fff",
            background: e.grad,
            boxShadow: `0 10px 22px -12px ${rgba(e.acc, 0.8)}`,
            transform: `scale(${0.9 + 0.1 * pop(t, sendAt, { damping: 13 })})`,
            transformOrigin: "100% 100%",
          }}
        >
          {q}
        </div>
      </div>
    </Grow>
  );

  const topBar = (
    <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, paddingBottom: 10, borderBottom: `1px solid ${Z[800]}` }}>
      <b style={{ fontFamily: DISPLAY, fontSize: wide ? 22 : 19, fontWeight: 750, color: Z[50] }}>✨ AI</b>
      <span style={{ flex: 1 }} />
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 999, border: `1px solid ${Z[800]}`, background: Z[900], padding: "2px 10px 2px 3px", fontSize: 11.5, fontWeight: 650, color: Z[200] }}>
        <HeroAvatar t={t} hero={HERO} size={22} acc={e.acc} />
        {HERO} · {personaOf(HERO).type}
      </span>
      {wide && <span style={{ borderRadius: 999, background: "rgba(14,165,233,0.12)", padding: "4px 10px", fontSize: 11.5, fontWeight: 650, color: "#38bdf8" }}>🌐 Internet siap</span>}
    </div>
  );

  // layar sambutan (belum ada pesan) — hilang saat pertanyaan dikirim
  const wOut = ramp(t, sendAt - 2, sendAt + 8);
  const wIn = pop(t, 0, { damping: 18 });
  const welcome = wOut < 1 && (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 6, opacity: (1 - wOut) * clamp01(wIn * 1.4), transform: `translateY(${-wOut * 30}px) scale(${1 - wOut * 0.05})` }}>
      <Hero name={HERO} size={wide ? 96 : 84} t={t} />
      <div style={{ fontFamily: DISPLAY, fontSize: wide ? 22 : 19, fontWeight: 750, color: Z[50] }}>Halo Alif, mau ngobrol apa?</div>
      <div style={{ fontSize: wide ? 13 : 12, color: Z[500], maxWidth: 300 }}>Tanya bebas, kirim screenshot, atau tanya isi CS Tracker.</div>
      <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 6, maxWidth: wide ? 520 : 330 }}>
        {["📊 Rangkum hot issue", "🎬 Video ditolak kenapa?", "✍️ Draft balasan clipper"].map((x, i) => {
          const a = pop(t, en(t, 6 + i * 3), { damping: 16 });
          return (
            <span key={x} style={{ borderRadius: 999, border: `1px solid ${Z[800]}`, background: Z[900], padding: "5px 11px", fontSize: 11.5, fontWeight: 600, color: Z[300], opacity: clamp01(a * 1.4), transform: `translateY(${(1 - a) * 8}px)` }}>
              {x}
            </span>
          );
        })}
      </div>
    </div>
  );

  const thread = (
    <div style={{ position: "relative", flex: 1, minHeight: 0, overflow: "hidden" }}>
      {welcome}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 10, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
        {userMsg}
        {assistant}
      </div>
    </div>
  );

  const composer = <Composer e={e} draft={draft} focus={t.f >= typeAt - 6 && t.f < sendAt + 2} sendAt={sendAt} placeholder="Tanya apa aja…" />;

  return (
    <Shell e={e} nav="ai" fill>
      {wide ? (
        <div style={{ position: "absolute", inset: 0, display: "flex", gap: 20 }}>
          <div style={{ ...card(e.acc), width: 250, flex: "none", padding: 12, boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 10 }}>
            <Btn grad={e.grad} size={13} style={{ width: "100%", boxSizing: "border-box" }}>
              ＋ Chat baru
            </Btn>
            <div style={{ borderRadius: 12, border: `1px solid ${Z[800]}`, background: Z[950], padding: "8px 12px", fontSize: 12.5, color: Z[500] }}>Cari percakapan…</div>
            <div style={{ marginTop: 4, fontSize: 10.5, fontWeight: 700, letterSpacing: 1.2, color: Z[500] }}>HARI INI</div>
            {AI_CHATS.map((c, i) => (
              <div key={c} style={{ borderRadius: 10, padding: "7px 10px", fontSize: 12.5, fontWeight: i === 0 ? 650 : 450, color: i === 0 ? Z[50] : Z[400], background: i === 0 ? Z[800] : undefined, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {i === 0 ? q : c}
              </div>
            ))}
            <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 10, borderRadius: 14, border: `1px solid ${Z[800]}`, padding: 10 }}>
              <Hero name="Layla" size={40} t={t} />
              <span style={{ minWidth: 0, lineHeight: 1.3 }}>
                <b style={{ display: "block", fontSize: 12.5, color: Z[100] }}>🦋 Otomatis</b>
                <span style={{ display: "block", fontSize: 11, color: Z[500] }}>Layla pilihkan hero</span>
              </span>
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ width: 760, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
              {topBar}
              {thread}
              {composer}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
          {topBar}
          {thread}
          {composer}
        </div>
      )}
    </Shell>
  );
}

// ================================================================== TRAIN YOUR AI ==================================================================
const STAGES = ["Mulai", "Kenali kepribadianmu", "Latih perannya", "Nama & simpan"];
/** hero contoh untuk tiap tipe (dipakai sebagai chibi hasil) */
const TYPE_HERO: Record<string, string> = {
  ESFJ: "Layla",
  ENTJ: "Alucard",
  INTP: "Gord",
  INTJ: "Yve",
  INFJ: "Pharsa",
  INFP: "Kagura",
  ENFP: "Harley",
  ENFJ: "Lunox",
  ISFJ: "Tigreal",
  ISTJ: "Granger",
  ESTJ: "Valir",
  ISTP: "Saber",
  ESTP: "Zilong",
  ESFP: "Miya",
  ISFP: "Chou",
  ENTP: "Harith",
};
const DIM_PCT = [72, 64, 58, 69];

/** dekorasi bergerak per kelompok kepribadian (TypeScene website, digerakkan frame) */
function Deco({ g, c, f }: { g: Group; c: string; f: number }) {
  if (g === "NT")
    return (
      <>
        <g transform={`rotate(${(f * 3) % 360} 34 38)`}>
          <circle cx="34" cy="38" r="11" fill="none" stroke={c} strokeWidth="5" strokeDasharray="5 4" />
          <circle cx="34" cy="38" r="4" fill={c} />
        </g>
        <g transform={`rotate(${(-f * 4) % 360} 52 26)`}>
          <circle cx="52" cy="26" r="7" fill="none" stroke={c} strokeWidth="4" strokeDasharray="4 3" opacity=".7" />
        </g>
        <g transform={`translate(190 34) scale(${1 + Math.sin(f / 6) * 0.08}) translate(-190 -34)`}>
          <circle cx="190" cy="32" r="11" fill="#facc15" opacity=".9" />
          <rect x="185" y="42" width="10" height="7" rx="2" fill="#a1a1aa" />
          <path d="M190 22 v-6 M178 26 l-5 -4 M202 26 l5 -4" stroke="#facc15" strokeWidth="2.5" strokeLinecap="round" opacity={0.6 + 0.4 * Math.sin(f / 5)} />
        </g>
      </>
    );
  if (g === "NF")
    return (
      <>
        {[
          [36, 60, 0],
          [196, 54, 24],
          [58, 30, 48],
          [176, 24, 70],
        ].map(([x, y, d], i) => {
          const k = ((f + d) % 90) / 90;
          return <path key={i} transform={`translate(0 ${-k * 18})`} opacity={0.85 * Math.sin(k * Math.PI)} d={`M${x} ${y} c-6 -8 -16 -2 -10 6 l10 9 l10 -9 c6 -8 -4 -14 -10 -6z`} fill={i % 2 ? "#f472b6" : c} />;
        })}
        {[
          [30, 30],
          [204, 84],
        ].map(([x, y], i) => (
          <path key={i} transform={`translate(${x} ${y}) scale(${0.6 + 0.4 * Math.abs(Math.sin(f / 9 + i))}) translate(${-x} ${-y})`} d={`M${x} ${y - 7} l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2z`} fill="#fde68a" />
        ))}
      </>
    );
  if (g === "SJ")
    return (
      <>
        <g transform="translate(18 20)">
          <rect width="46" height="58" rx="6" fill="rgba(255,255,255,.9)" stroke={c} strokeWidth="2" />
          {[0, 1, 2].map((i) => (
            <g key={i} transform={`translate(8 ${12 + i * 15})`}>
              <rect width="9" height="9" rx="2" fill="none" stroke={c} strokeWidth="1.8" />
              <path d="M1.5 4.5 l2.5 2.5 l4 -5" fill="none" stroke="#16a34a" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="12" strokeDashoffset={12 * (1 - clamp01((f - 10 - i * 14) / 10))} />
              <rect x="13" y="3" width="18" height="3" rx="1.5" fill="#d4d4d8" />
            </g>
          ))}
        </g>
        <g transform={`translate(192 40) scale(${1 + Math.sin(f / 7) * 0.06}) translate(-192 -40)`}>
          <path d="M180 24 h24 v16 q0 14 -12 20 q-12 -6 -12 -20z" fill={c} />
          <path d="M186 40 l4 4 l8 -9" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
        </g>
      </>
    );
  return (
    <>
      <path opacity={Math.sin(f / 3) > 0 ? 1 : 0.35} d="M40 16 l-12 26 h11 l-7 22 l20 -30 h-11 l8 -18z" fill="#facc15" />
      <path opacity={Math.sin(f / 3 + 1.5) > 0 ? 1 : 0.35} d="M200 50 l-8 17 h7 l-5 14 l13 -20 h-7 l5 -11z" fill="#fb923c" />
      <g transform={`translate(${Math.sin(f / 8) * 3} ${Math.cos(f / 8) * -3})`}>
        <path d="M178 40 q8 -22 22 -26 q-4 14 -26 22z" fill={c} />
        <circle cx="191" cy="25" r="3" fill="#fff" />
        <path d="M176 38 l-8 8 M180 42 l-6 10" stroke="#fb923c" strokeWidth="3" strokeLinecap="round" />
      </g>
      {[0, 1, 2].map((i) => (
        <rect key={i} x={20 - ((f * 2 + i * 12) % 30)} y={70 + i * 9} width="34" height="3" rx="1.5" fill={c} opacity=".5" />
      ))}
    </>
  );
}

/** adegan hasil tipe: latar warna kelompok, chibi muncul, 4 huruf satu per satu, kalimat ringkas */
function TypeArt({ t, at, type, h }: { t: Clock; at: number; type: string; h: number }) {
  const id = useSid("ta");
  const g = typeGroup(type);
  const G = GROUPS[g];
  const hero = TYPE_HERO[type] ?? HERO;
  const p = pop(t, at, { damping: 11, stiffness: 160 });
  const prof = typeProfile(type);
  const head = prof?.headline ?? typeInfo(type).tag;
  const hp = pop(t, at + 30, { damping: 18 });
  const size = Math.min(122, h * 0.5);
  return (
    <div style={{ position: "relative", height: h, borderRadius: 16, overflow: "hidden" }}>
      <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0 }} aria-hidden>
        <defs>
          <radialGradient id={id} cx="50%" cy="100%" r="80%">
            <stop offset="0%" stopColor={G.color} stopOpacity={0.34 * clamp01(p)} />
            <stop offset="100%" stopColor={G.color} stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="100" height="100" fill={`url(#${id})`} />
      </svg>
      <svg viewBox="0 0 232 110" preserveAspectRatio="xMidYMid meet" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: clamp01((t.f - at) / 10) }} aria-hidden>
        <Deco g={g} c={G.color} f={Math.max(0, t.f - at)} />
      </svg>
      <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 10 }}>
        <span style={{ display: "inline-flex", transform: `scale(${0.3 + 0.7 * p}) translateY(${(1 - p) * 30}px)`, opacity: clamp01(p * 2), transformOrigin: "50% 100%" }}>
          <Hero name={hero} size={size} t={t} />
        </span>
        <div style={{ marginTop: 4, display: "flex", gap: 6 }}>
          {type.split("").map((l, i) => {
            const lp = pop(t, at + 10 + i * 5, { damping: 10, stiffness: 220 });
            return (
              <span key={i} style={{ width: 36, height: 36, borderRadius: 12, background: G.color, color: "#fff", fontSize: 18, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", transform: `scale(${lp}) rotate(${(1 - lp) * -20}deg)`, boxShadow: `0 8px 18px -8px ${G.color}` }}>
                {l}
              </span>
            );
          })}
        </div>
        <div style={{ marginTop: 8, maxWidth: "92%", borderRadius: 999, background: "rgba(24,24,27,0.85)", padding: "4px 12px", fontSize: 12, fontWeight: 650, color: Z[100], textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", opacity: clamp01(hp * 1.3), transform: `translateY(${(1 - hp) * 8}px)` }}>
          {G.icon} {head}
        </div>
      </div>
    </div>
  );
}

/**
 * Train your AI: jendela kuis kepribadian di atas tab AI → 3 pertanyaan dijawab → dihitung → hasil tipe 4 huruf
 * (chibi, huruf muncul satu-satu, persentase tiap dimensi). title = tipe hasil (mis. "INTJ"), items = teks pertanyaan.
 */
export function TrainAiScreen({ e }: { e: Env }) {
  const { t, wide } = e;
  const want = (e.title || "").toUpperCase().replace(/[^A-Z]/g, "");
  const type = MBTI_TYPES.includes(want) ? want : "ENFP";
  const g = typeGroup(type);
  const G = GROUPS[g];
  const qs = QUIZ.slice(0, 3).map((d, di) => {
    const q = d.questions[0];
    const idx = QUIZ_QS.findIndex((x) => x.id === q.id);
    const pick = Math.max(0, q.options.findIndex((o) => o.letter === type[di]));
    return { ...q, q: e.items[di] || q.q, title: d.title, idx, pick };
  });
  const cuts = [bt(t, 0.2), bt(t, 0.36), bt(t, 0.52)];
  const resAt = bt(t, 0.6);
  const page = cuts.filter((c) => t.f >= c).length + (t.f >= resAt ? 1 : 0); // 0..2 kuis, 3 hitung, 4 hasil
  const enter = page === 0 ? en(t, 6) : page <= 3 ? cuts[page - 1] : resAt;
  const k = ramp(t, enter, enter + 9, 0, 1, Easing.out(Easing.cubic));
  const mw = wide ? 540 : e.w - 24;
  const mh = wide ? 620 : Math.min(660, e.h - e.top - e.bottom - 24);
  const modal = pop(t, 0, { damping: 18 });
  const qp = page < 3 ? qs[page] : null;
  const progress = page >= 3 ? 1 : (qp!.idx + 1) / (QUIZ_QS.length + 1);
  const prof = typeProfile(type);
  const info = typeInfo(type);

  let body: ReactNode = null;
  if (qp) {
    const tap = cuts[page] - 8;
    body = (
      <div>
        <div style={{ fontSize: 11, fontWeight: 750, letterSpacing: 1, color: G.color, marginBottom: 4 }}>{qp.title.toUpperCase()}</div>
        <div style={{ fontSize: wide ? 16.5 : 15.5, fontWeight: 700, lineHeight: 1.35, color: Z[50], marginBottom: 12 }}>{qp.q}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {qp.options.map((o, i) => {
            const on = t.f >= tap - 1 && i === qp.pick;
            const a = pop(t, enter + 3 + i * 3, { damping: 18 });
            return (
              <div
                key={i}
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  borderRadius: 12,
                  border: `1px solid ${on ? e.acc : Z[800]}`,
                  background: on ? rgba(e.acc, 0.1) : undefined,
                  padding: "9px 12px",
                  fontSize: 13.5,
                  lineHeight: 1.35,
                  color: on ? "#fdba74" : Z[300],
                  opacity: clamp01(a * 1.4),
                  transform: `translateY(${(1 - a) * 10}px) scale(${on ? 1 + 0.03 * Math.max(0, 1 - (t.f - tap) / 8) : 1})`,
                }}
              >
                <span style={{ width: 24, height: 24, flex: "none", boxSizing: "border-box", borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: on ? "#fff" : Z[500], background: on ? e.acc : undefined, border: on ? undefined : `1px solid ${Z[700]}` }}>
                  {String.fromCharCode(65 + i)}
                </span>
                <span style={{ minWidth: 0 }}>{o.label}</span>
                {i === qp.pick && <TapAt t={t} at={tap} wide={wide} x="60%" from={[90, 60]} />}
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 12, fontSize: 11.5, color: Z[500] }}>Pilih yang paling sering terjadi, bukan yang paling ideal.</div>
      </div>
    );
  } else if (page === 3) {
    const pairs = ["EI", "SN", "TF", "JP"];
    body = (
      <div style={{ height: mh - 190, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 }}>
        <span style={{ fontSize: 40, transform: `rotate(${Math.sin(t.f / 4) * 12}deg) scale(${1 + Math.sin(t.f / 3) * 0.05})` }}>🔮</span>
        <div style={{ fontSize: 15, fontWeight: 700, color: Z[100] }}>Lagi ngitung tipe kamu…</div>
        <div style={{ display: "flex", gap: 6 }}>
          {pairs.map((pr, i) => (
            <span key={pr} style={{ width: 36, height: 36, borderRadius: 12, border: `1px solid ${Z[700]}`, background: Z[850], color: Z[300], fontSize: 18, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {pr[Math.floor((t.f + i * 2) / 3) % 2]}
            </span>
          ))}
        </div>
      </div>
    );
  } else {
    body = (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <TypeArt t={t} at={resAt} type={type} h={wide ? 236 : 222} />
        <div style={{ textAlign: "center", opacity: ramp(t, resAt + 18, resAt + 28) }}>
          <div style={{ fontSize: 12, color: Z[500] }}>Karakter kamu</div>
          <div style={{ fontFamily: DISPLAY, fontSize: 20, fontWeight: 800, lineHeight: 1.2, color: Z[50] }}>
            {type} · <span style={{ color: G.color }}>{info.label}</span>
          </div>
        </div>
        {prof && (
          <div style={{ fontSize: 12.5, lineHeight: 1.5, color: Z[300], maxHeight: 12.5 * 1.5 * 2, overflow: "hidden", opacity: ramp(t, resAt + 24, resAt + 34) }}>{prof.desc}</div>
        )}
        <div style={{ borderRadius: 12, border: `1px solid ${Z[800]}`, padding: "8px 12px", display: "flex", flexDirection: "column", gap: 7 }}>
          {QUIZ.map((d, i) => {
            const [la, lb] = d.letters;
            const win = type[i];
            const pa = win === la.letter ? DIM_PCT[i] : 100 - DIM_PCT[i];
            const gr = ramp(t, resAt + 30 + i * 4, resAt + 50 + i * 4, 0, 1, Easing.out(Easing.cubic));
            return (
              <div key={d.dim}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: Z[500] }}>
                  <span style={{ fontWeight: win === la.letter ? 750 : 400, color: win === la.letter ? Z[100] : Z[500] }}>
                    {la.letter} · {la.name} {Math.round(pa * gr)}%
                  </span>
                  <span style={{ fontWeight: win === lb.letter ? 750 : 400, color: win === lb.letter ? Z[100] : Z[500] }}>
                    {Math.round((100 - pa) * gr)}% {lb.name} · {lb.letter}
                  </span>
                </div>
                <div style={{ marginTop: 3, height: 7, borderRadius: 99, background: Z[800], overflow: "hidden" }}>
                  <div style={{ width: `${pa * gr}%`, height: "100%", borderRadius: 99, background: G.color }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <>
      <Shell e={e} nav="ai" fill>
        {/* halaman AI samar di belakang jendela */}
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", gap: 14, opacity: 0.6 }}>
          <b style={{ fontFamily: DISPLAY, fontSize: wide ? 22 : 19 }}>✨ AI</b>
          {[0.7, 0.5, 0.8].map((w, i) => (
            <div key={i} style={{ alignSelf: i % 2 ? "flex-end" : "flex-start", width: `${w * 100}%`, height: 46, borderRadius: 16, background: i % 2 ? rgba(e.acc, 0.5) : Z[800] }} />
          ))}
        </div>
      </Shell>
      <div style={{ position: "absolute", inset: 0, background: `rgba(0,0,0,${0.6 * clamp01(modal * 1.5)})`, zIndex: 50 }} />
      <div
        style={{
          position: "absolute",
          left: (e.w - mw) / 2,
          top: e.top + (e.h - e.top - e.bottom - mh) / 2,
          width: mw,
          height: mh,
          zIndex: 51,
          display: "flex",
          flexDirection: "column",
          borderRadius: 18,
          border: `1px solid ${Z[800]}`,
          background: Z[900],
          overflow: "hidden",
          boxShadow: "0 30px 80px -20px rgba(0,0,0,0.9)",
          fontFamily: '"Inter Variable", ui-sans-serif, system-ui, sans-serif',
          color: Z[100],
          opacity: clamp01(modal * 1.4),
          transform: `translateY(${(1 - modal) * 30}px) scale(${0.94 + 0.06 * modal})`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid rgba(39,39,42,0.8)", padding: "12px 16px" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: DISPLAY, fontSize: 15, fontWeight: 750 }}>🧠 Train your AI</div>
            <div style={{ fontSize: 11.5, color: Z[500], whiteSpace: "nowrap" }}>
              {STAGES[1]}
              {qp && ` · ${qp.idx + 1}/${QUIZ_QS.length}`}
            </div>
          </div>
          <span style={{ marginLeft: "auto", color: Z[500], fontSize: 15 }}>✕</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 4, padding: "12px 16px 0" }}>
          {STAGES.map((s, i) => (
            <span key={s} style={{ height: 6, borderRadius: 99, background: Z[800], overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", borderRadius: 99, background: e.acc, width: `${i === 0 ? 100 : i === 1 ? progress * 100 : 0}%` }} />
            </span>
          ))}
        </div>
        <div style={{ position: "relative", flex: 1, minHeight: 0, overflow: "hidden", padding: "16px 16px 0" }}>
          <div style={{ opacity: k, transform: `translateX(${(1 - k) * 40}px)` }}>{body}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, borderTop: "1px solid rgba(39,39,42,0.8)", padding: "10px 16px" }}>
          <span style={{ borderRadius: 12, border: `1px solid ${Z[800]}`, padding: "7px 14px", fontSize: 12.5, fontWeight: 700, color: Z[300] }}>‹ Kembali</span>
          <Btn grad={e.grad} size={12.5} press={page === 4 ? 1 + 0.03 * Math.max(0, Math.sin((t.f - resAt) / 5)) : 1} style={{ opacity: page === 4 ? 1 : 0.45 }}>
            Lanjut →
          </Btn>
        </div>
      </div>
    </>
  );
}

// ================================================================== STUDIO PRO ==================================================================
type Sc = { n: string; d: number; x: string };
const ST_SCENES: Sc[] = [
  { n: "Hook", d: 3, x: "Clipper komplain numpuk?" },
  { n: "Masalah", d: 6, x: "Data nyebar di WA" },
  { n: "Dashboard", d: 8, x: "Semua di 1 dashboard" },
  { n: "Hot Issue", d: 7, x: "Yang ramai naik ke #1" },
  { n: "Penutup", d: 6, x: "CS Tracker · Konten.com" },
];
const ST_PROMPT = "Bikin teaser 30 detik fitur Hot Issue 🔥";
const ST_REPLY = "Siap! Aku bikin **5 adegan**, hook 1,5 detik pertama 🔥";
const ST_STEPS = ["Pahami", "Rencana", "Tulis", "Cek"];
const SC_COLS = ["#f97316", "#8b5cf6", "#0ea5e9", "#10b981", "#f59e0b", "#ec4899"];
const fmtT = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** pratinjau video mini (9:16): teks adegan muncul per kata, latar warna brand, bar progres */
function MiniVideo({ t, w, h, scenes, sec, total, playing, acc }: { t: Clock; w: number; h: number; scenes: Sc[]; sec: number; total: number; playing: boolean; acc: string }) {
  const id = useSid("mv");
  let i = 0;
  let s0 = 0;
  while (i < scenes.length - 1 && sec >= s0 + scenes[i].d) s0 += scenes[i++].d;
  const sc = scenes[i];
  const local = Math.max(0, sec - s0);
  const words = sc.x.split(/\s+/).filter(Boolean);
  const fs = Math.min(w * 0.12, (w * 1.6) / Math.max(6, sc.x.length * 0.55));
  const col = SC_COLS[i % SC_COLS.length];
  const gx = 50 + Math.sin(sec * 0.9) * 22;
  return (
    <div style={{ position: "relative", width: w, height: h, flex: "none", borderRadius: 12, overflow: "hidden", background: "#050506", boxShadow: "0 14px 34px -14px rgba(0,0,0,0.9)" }}>
      <svg width={w} height={h} viewBox="0 0 100 178" preserveAspectRatio="none" style={{ position: "absolute", inset: 0 }} aria-hidden>
        <defs>
          <radialGradient id={id} cx={`${gx}%`} cy="38%" r="70%">
            <stop offset="0%" stopColor={i === 0 ? acc : col} stopOpacity="0.55" />
            <stop offset="100%" stopColor="#050506" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="100" height="178" fill={`url(#${id})`} />
      </svg>
      <div style={{ position: "absolute", left: 8, right: 8, top: h * 0.3, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: `${fs * 0.1}px ${fs * 0.28}px`, fontFamily: DISPLAY, fontWeight: 800, fontSize: fs, lineHeight: 1.08, color: "#fff", textAlign: "center" }}>
        {words.map((wd, j) => {
          const at = j * 0.16;
          const p = playing ? clamp01((local - at) / 0.22) : 1;
          const last = j === words.length - 1;
          return (
            <span key={`${i}-${j}`} style={{ display: "inline-block", opacity: p, transform: `translateY(${(1 - p) * fs * 0.4}px) scale(${0.8 + 0.2 * p})`, color: last ? mixHex(acc, "#ffffff", 0.15) : "#fff" }}>
              {wd}
            </span>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: 8, top: 8, borderRadius: 6, background: "rgba(0,0,0,0.5)", padding: "1px 6px", fontSize: 9, fontWeight: 700, color: Z[300] }}>{sc.n}</div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 3, background: "rgba(255,255,255,0.15)" }}>
        <div style={{ width: `${(sec / total) * 100}%`, height: "100%", background: acc }} />
      </div>
      {!playing && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.35)" }}>
          <span style={{ width: 38, height: 38, borderRadius: 999, background: "rgba(255,255,255,0.92)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 20px rgba(0,0,0,0.5)" }}>
            <svg width="14" height="14" viewBox="0 0 12 12" aria-hidden>
              <path d="M3 1.5 L10.5 6 L3 10.5 Z" fill="#111" />
            </svg>
          </span>
        </div>
      )}
    </div>
  );
}

/** bentuk gelombang suara (deterministik) */
const wave = (i: number) => 0.25 + 0.75 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.63 + 1.1));

/** timeline adegan + trek VO, musik (turun saat VO), SFX, kepala putar */
function TimelineView({ e, w, scenes, total, sec, planAt, voAt, labels }: { e: Env; w: number; scenes: Sc[]; total: number; sec: number; planAt: number; voAt: number; labels: boolean }) {
  const { t } = e;
  const lw = labels ? 58 : 0;
  const tw = w - lw;
  const rowH = labels ? 24 : 19;
  const starts = scenes.reduce<number[]>((a, s, i) => (a.push(i ? a[i - 1] + scenes[i - 1].d : 0), a), []);
  const x = (s: number) => (s / total) * tw;
  const voP = ramp(t, voAt, voAt + 24, 0, 1, Easing.out(Easing.cubic));
  const musicP = ramp(t, planAt + 10, planAt + 30);
  const head = x(sec);
  const label = (s: string) => (labels ? <span style={{ width: lw, flex: "none", fontSize: 10.5, fontWeight: 650, color: Z[500] }}>{s}</span> : null);
  const track = (children: ReactNode, style?: CSSProperties) => <div style={{ position: "relative", width: tw, height: rowH, flex: "none", ...style }}>{children}</div>;
  const bars = Math.floor(tw / 4);
  const musicPath = Array.from({ length: 41 }, (_, i) => {
    const s = (i / 40) * total;
    const duck = scenes.some((_, j) => j < scenes.length - 1 && s >= starts[j] + 0.3 && s <= starts[j] + scenes[j].d - 0.2) ? 0.45 : 1;
    const y = rowH / 2 - Math.sin(i * 1.3 + t.f / 12) * (rowH * 0.32) * duck;
    return `${i ? "L" : "M"}${((i / 40) * tw).toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", alignItems: "flex-end", height: 16, marginBottom: 4 }}>
        {label("")}
        {track(
          Array.from({ length: Math.floor(total / 5) + 1 }, (_, i) => (
            <span key={i} style={{ position: "absolute", left: x(i * 5), bottom: 0, fontSize: 9, color: Z[600], transform: i ? "translateX(-50%)" : undefined }}>
              {fmtT(i * 5)}
            </span>
          )),
          { height: 14 },
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          {label("Adegan")}
          {track(
            scenes.map((s, i) => {
              const g = pop(t, planAt + i * 3, { damping: 16 });
              const c = SC_COLS[i % SC_COLS.length];
              const on = sec >= starts[i] && sec < starts[i] + s.d;
              return (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    left: x(starts[i]) + 1,
                    width: Math.max(2, x(s.d) - 2),
                    top: 0,
                    bottom: 0,
                    borderRadius: 6,
                    background: `linear-gradient(180deg, ${rgba(c, on ? 0.5 : 0.32)} 0%, ${rgba(c, on ? 0.34 : 0.2)} 100%)`,
                    border: `1px solid ${rgba(c, on ? 0.95 : 0.5)}`,
                    boxSizing: "border-box",
                    padding: "0 5px",
                    fontSize: 9.5,
                    fontWeight: 700,
                    lineHeight: `${rowH - 2}px`,
                    color: "#fff",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    transform: `scaleX(${g})`,
                    transformOrigin: "0 50%",
                    opacity: clamp01(g * 1.5),
                  }}
                >
                  {s.n}
                </div>
              );
            }),
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center" }}>
          {label("VO")}
          {track(
            <div style={{ position: "absolute", inset: 0, overflow: "hidden", width: tw * voP, display: "flex", alignItems: "center", gap: 1 }}>
              {Array.from({ length: bars }, (_, i) => {
                const s = (i / bars) * total;
                const gap = starts.some((st, j) => j > 0 && Math.abs(s - st) < 0.25) || s > total - scenes[scenes.length - 1].d * 0.4;
                return <span key={i} style={{ width: 3, flex: "none", height: gap ? 2 : Math.max(2, wave(i) * (rowH - 4)), borderRadius: 2, background: s <= sec ? "#38bdf8" : "rgba(56,189,248,0.45)" }} />;
              })}
            </div>,
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center" }}>
          {label("Musik")}
          {track(
            <svg width={tw} height={rowH} viewBox={`0 0 ${tw} ${rowH}`} style={{ position: "absolute", inset: 0, opacity: musicP }} aria-hidden>
              <rect x="0" y="0" width={tw} height={rowH} rx="6" fill="rgba(16,185,129,0.1)" />
              <path d={musicPath} fill="none" stroke="#34d399" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>,
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center" }}>
          {label("SFX")}
          {track(
            starts.map((st, i) => {
              const p = pop(t, planAt + 12 + i * 3, { damping: 10, stiffness: 220 });
              return <span key={i} style={{ position: "absolute", left: x(st + (i ? 0 : 0.4)) - 5, top: rowH / 2 - 5, width: 10, height: 10, borderRadius: 2, background: "#fbbf24", transform: `rotate(45deg) scale(${p})`, boxShadow: "0 0 10px rgba(251,191,36,0.6)" }} />;
            }),
          )}
        </div>
      </div>
      {/* kepala putar */}
      <div style={{ position: "absolute", left: lw + head - 1, top: 12, bottom: -2, width: 2, background: e.acc, boxShadow: `0 0 10px ${rgba(e.acc, 0.8)}`, opacity: musicP }}>
        <span style={{ position: "absolute", left: -5, top: -4, width: 12, height: 8, borderRadius: "3px 3px 6px 6px", background: e.acc }} />
      </div>
    </div>
  );
}

/** daftar adegan rencana (PlanCard ringkas): baris aktif mengikuti kepala putar */
function PlanList({ e, scenes, sec, planAt, total, title, rowH }: { e: Env; scenes: Sc[]; sec: number; planAt: number; total: number; title: string; rowH: number }) {
  const { t } = e;
  let s0 = 0;
  return (
    <div style={{ minWidth: 0, flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginBottom: 6 }}>
        <b style={{ fontSize: 12.5, color: Z[100], whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>📋 {title}</b>
        <span style={{ fontSize: 10.5, color: Z[500], whiteSpace: "nowrap" }}>{total} dtk</span>
      </div>
      {t.f < planAt && (
        <div style={{ marginTop: 8, fontSize: 11.5, color: Z[500] }}>
          <StepIcon t={t} done={false} size={11.5} /> Harley lagi nyusun adegan…
        </div>
      )}
      {scenes.map((s, i) => {
        const st = s0;
        s0 += s.d;
        const p = pop(t, planAt + i * 3, { damping: 16 });
        const on = t.f >= planAt && sec >= st && sec < st + s.d;
        const c = SC_COLS[i % SC_COLS.length];
        return (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              height: rowH,
              boxSizing: "border-box",
              padding: "0 7px",
              borderRadius: 9,
              marginTop: 2,
              background: on ? rgba(c, 0.14) : undefined,
              border: `1px solid ${on ? rgba(c, 0.5) : "transparent"}`,
              opacity: clamp01(p * 1.4),
              transform: `translateX(${(1 - p) * 16}px)`,
            }}
          >
            <span style={{ width: 16, height: 16, flex: "none", borderRadius: 5, background: c, color: "#fff", fontSize: 9.5, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: 650, color: Z[100], whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.n}</span>
            <span style={{ fontSize: 10.5, color: Z[500], fontVariantNumeric: "tabular-nums" }}>{s.d}s</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Studio Pro: minta video ke Harley → langkah kerja → rencana adegan masuk → timeline (adegan, VO, musik, SFX) →
 * pratinjau diputar. title = judul proyek, items = nama/teks adegan.
 */
export function StudioScreen({ e }: { e: Env }) {
  const { t, wide } = e;
  const scenes: Sc[] = ST_SCENES.map((s, i) => (e.items[i] ? { ...s, n: e.items[i].length > 14 ? e.items[i].split(/\s+/).slice(0, 2).join(" ") : e.items[i], x: e.items[i] } : s));
  const total = scenes.reduce((a, s) => a + s.d, 0);
  const title = e.title || "Teaser Hot Issue";
  const stepAt = [0.05, 0.11, 0.17, 0.23].map((x) => bt(t, x));
  const replyAt = bt(t, 0.2);
  const planAt = bt(t, 0.3);
  const voAt = bt(t, 0.38);
  const playAt = bt(t, 0.46);
  const playEnd = Math.max(playAt + 30, t.L * 0.98);
  const playing = t.f >= playAt;
  const sec = playing ? Math.min(total - 0.01, ramp(t, playAt, playEnd, 0, total, Easing.linear)) : 0;
  const replyN = t.f >= replyAt ? ((t.f - replyAt) / t.fps) * 40 : 0;
  const replying = t.f >= replyAt && replyN < Array.from(plain(ST_REPLY)).length;
  const userP = pop(t, en(t, 2), { damping: 15 });

  const steps = (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
      {ST_STEPS.map((s, i) => {
        if (t.f < stepAt[i]) return null;
        const done = t.f >= (stepAt[i + 1] ?? planAt) - 2;
        const a = pop(t, stepAt[i], { damping: 14 });
        return (
          <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 4, borderRadius: 999, border: `1px solid ${done ? "rgba(16,185,129,0.35)" : Z[800]}`, background: done ? "rgba(16,185,129,0.08)" : Z[900], padding: "2px 8px", fontSize: 10.5, fontWeight: 650, color: done ? "#6ee7b7" : Z[300], transform: `scale(${a})` }}>
            <StepIcon t={t} done={done} size={10.5} /> {s}
          </span>
        );
      })}
    </div>
  );

  const chat = (max: number) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "flex-end", opacity: clamp01(userP * 1.4), transform: `translateY(${(1 - userP) * 10}px)` }}>
        <div style={{ maxWidth: "88%", borderRadius: "14px 14px 5px 14px", padding: "7px 12px", fontSize: 12.5, lineHeight: 1.45, color: "#fff", background: e.grad }}>{ST_PROMPT}</div>
      </div>
      {t.f >= stepAt[0] && (
        <div style={{ display: "flex", gap: 9 }}>
          <HeroAvatar t={t} hero={HERO} size={30} acc={e.acc} talk={replying} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <HelperChip hero={HERO} max={max - 39} p={pop(t, stepAt[0], { damping: 14 })} acc={e.acc} />
            {t.f >= replyAt && (
              <div style={{ fontSize: 12.5, lineHeight: 1.5, color: Z[200] }}>
                <Rich text={ST_REPLY} n={replyN} bold={{ color: "#fdba74" }} />
                {replying && <Caret t={t} typing color={e.acc} h={13} />}
              </div>
            )}
            {steps}
          </div>
        </div>
      )}
    </div>
  );

  const toast = (
    <Toast t={t} at={planAt + 6} until={planAt + 54} acc="#10b981" top={wide ? 6 : 44}>
      ✅ Rencana siap · {scenes.length} adegan · {total} dtk
    </Toast>
  );

  const tabs = <Tabs items={["🎬 Studio Pro", "Template lama", "🎙️ Bank suara"]} on={0} grad={e.grad} size={wide ? 12.5 : 11} round={12} full={!wide} />;
  const timeHead = (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <span style={{ width: 22, height: 22, borderRadius: 999, background: playing ? e.acc : Z[800], color: "#fff", fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>{playing ? "❚❚" : "▶"}</span>
      <span style={{ fontSize: 11.5, fontWeight: 650, color: Z[200], fontVariantNumeric: "tabular-nums" }}>
        {fmtT(sec)} / {fmtT(total)}
      </span>
      <span style={{ flex: 1 }} />
      {t.f >= voAt && <span style={{ borderRadius: 999, background: "rgba(56,189,248,0.12)", padding: "2px 8px", fontSize: 10, fontWeight: 700, color: "#7dd3fc", opacity: ramp(t, voAt, voAt + 8) }}>🎙️ VO sementara</span>}
    </div>
  );

  if (!wide) {
    const W = e.w - 28;
    return (
      <Shell e={e} nav="studio" fill>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {tabs}
          <div style={{ ...card(e.acc), height: 168, flex: "none", padding: "10px 12px", boxSizing: "border-box", overflow: "hidden" }}>{chat(W - 24)}</div>
          <div style={{ ...card(e.acc), height: 224, flex: "none", padding: 10, boxSizing: "border-box", display: "flex", gap: 10 }}>
            <MiniVideo t={t} w={115} h={204} scenes={scenes} sec={sec} total={total} playing={playing} acc={e.acc} />
            <PlanList e={e} scenes={scenes} sec={sec} planAt={planAt} total={total} title={title} rowH={33} />
          </div>
          <div style={{ ...card(e.acc), flex: 1, minHeight: 0, padding: "10px 12px", boxSizing: "border-box", overflow: "hidden" }}>
            {timeHead}
            <TimelineView e={e} w={W - 24} scenes={scenes} total={total} sec={sec} planAt={planAt} voAt={voAt} labels={false} />
          </div>
        </div>
        {toast}
      </Shell>
    );
  }

  return (
    <Shell e={e} nav="studio" fill>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {tabs}
          <span style={{ flex: 1 }} />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 650, color: Z[400] }}>📁 {title} · tersimpan</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 999, border: "1px solid rgba(16,185,129,0.35)", padding: "4px 10px", fontSize: 11.5, fontWeight: 650, color: "#6ee7b7" }}>
            <LiveDot t={t} size={7} /> Mesin suara online
          </span>
        </div>
        <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "400px minmax(0, 1fr)", gap: 18 }}>
          <div style={{ ...card(e.acc), padding: 14, display: "flex", flexDirection: "column", gap: 12, overflow: "hidden" }}>
            <b style={{ fontSize: 13.5, color: Z[100] }}>🎬 Sutradara AI</b>
            {chat(372)}
            {t.f >= planAt && (
              <Grow p={ramp(t, planAt, planAt + 12, 0, 1, Easing.out(Easing.cubic))} max={260}>
                <div style={{ borderRadius: 14, border: `1px solid ${Z[800]}`, background: Z[925], padding: 10 }}>
                  <PlanList e={e} scenes={scenes} sec={sec} planAt={planAt} total={total} title={title} rowH={30} />
                  <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
                    <Btn grad={e.grad} size={11.5}>
                      ✅ Pakai rencana
                    </Btn>
                    <Btn ghost size={11.5}>
                      ✏️ Ubah
                    </Btn>
                  </div>
                </div>
              </Grow>
            )}
            <div style={{ marginTop: "auto", borderRadius: 14, border: `1px solid ${Z[800]}`, background: Z[950], padding: "9px 12px", fontSize: 12.5, color: Z[500] }}>Ceritakan video yang kamu mau…</div>
          </div>
          <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", gap: 14, height: 330, flex: "none" }}>
              <div style={{ ...card(e.acc), flex: 1, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(180deg, #111114 0%, #0b0b0d 100%)" }}>
                <MiniVideo t={t} w={168} h={300} scenes={scenes} sec={sec} total={total} playing={playing} acc={e.acc} />
              </div>
              <div style={{ ...card(e.acc), width: 250, flex: "none", padding: 14, boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 8 }}>
                <b style={{ fontSize: 13, color: Z[100] }}>⬇️ Ekspor</b>
                {["🎬 MP4 dengan VO", "🎵 MP4 tanpa VO", "🎙️ VO .mp3", "📝 Subtitle .srt", "📄 Naskah & storyboard"].map((x, i) => (
                  <span key={x} style={{ borderRadius: 10, border: `1px solid ${i === 0 ? rgba(e.acc, 0.5) : Z[800]}`, background: i === 0 ? rgba(e.acc, 0.1) : undefined, padding: "7px 10px", fontSize: 12, fontWeight: 650, color: i === 0 ? "#fdba74" : Z[300] }}>
                    {x}
                  </span>
                ))}
                <span style={{ marginTop: "auto", fontSize: 10.5, color: Z[500] }}>1080×1920 · 30 fps · siap TikTok</span>
              </div>
            </div>
            <div style={{ ...card(e.acc), flex: 1, minHeight: 0, padding: "12px 16px", overflow: "hidden" }}>
              {timeHead}
              <TimelineView e={e} w={e.w - 56 - 400 - 18 - 32} scenes={scenes} total={total} sec={sec} planAt={planAt} voAt={voAt} labels />
            </div>
          </div>
        </div>
      </div>
      {toast}
    </Shell>
  );
}
