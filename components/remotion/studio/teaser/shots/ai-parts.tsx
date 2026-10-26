"use client";

/**
 * Potongan UI halaman ✨ AI CS Tracker untuk adegan 6 teaser (AiShot), dibuat ulang dari komponen website asli:
 * - header AiChat (pill 💬 Chat | 💼 Cowork | 🎭 + tombol pelangi .mkchar "🧠 Train your AI" BARU)
 * - composer (placeholder asli, 📎, 📊 Data emerald, 🌐 Internet sky, chip hero ModelPicker, kirim rounded-xl + panah SVG / ■ Stop)
 * - sambutan (HeroArt 92, "Halo Alif, mau ngobrol apa?", link karakter, grid SUGGEST 2 kolom)
 * - baris asisten (avatar h-9 bg-orange-500/10 + HeroArt 42, HelperLine, badge sumber)
 * - ChoiceCard/PagedAsk + AnsweredCard, ThinkingSteps (live & "⚙️ Lihat proses ▸"), AnalysisCard (.ai-card navy),
 *   kartu chart bergaya TradePlanChart (head, bar timeframe, candle hijau #16a34a / merah #ef4444, footer disclaimer).
 * Semua ukuran = px CSS layar website (dibesarkan oleh panel/kamera). Semua gerak dihitung dari frame (deterministik).
 */
import type { CSSProperties, ReactNode } from "react";
import HeroArt from "@/components/ai/HeroArt";
import { personaIntro, personaOf, personaTagline, registerCustom, stepLabel } from "@/lib/aiPersona";
import { TextShine } from "../../fx";
import { DISPLAY, FONT, TapAt, Z, rgba, type Clock } from "../../screens/ui";

// chibi mini di tombol pelangi "Train your AI" — didaftarkan persis seperti AiChat.tsx (BTN_CHIBI)
const BTN_CHIBI = "__tombol_buat_karakter__";
registerCustom(BTN_CHIBI, { type: "ENFP", hair: 3, skin: "#f5c9a8", hc: "#3b2a1e", prop: "orb" });

export const HERO = "Harley";
export const ORANGE = "#f97316";
export const ORANGE4 = "#fb923c";
export const GRAD = "linear-gradient(180deg,#fb8a3c,#ea580c)";
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * cincin luar setebal `w` px di sekeliling induk ber-border 1px (pengganti box-shadow "0 0 0 Npx" yang tidak tergambar di
 * @remotion/web-renderer). Induk wajib position:relative & tidak overflow:hidden. Taruh sebagai anak PERTAMA (urutan DOM = urutan gambar).
 */
export function Ring({ w, r, color, edge = 1 }: { w: number; r: number; color: string; edge?: number }) {
  const o = -(edge + w);
  return <span aria-hidden style={{ position: "absolute", left: o, top: o, right: o, bottom: o, borderRadius: r + w, border: `${w.toFixed(2)}px solid ${color}`, boxSizing: "border-box", pointerEvents: "none" }} />;
}

// ------------------------------------------------------------------ header ------------------------------------------------------------------
/** baris atas halaman AI (AiChat header): pill mode + tombol pelangi Train your AI (gerak warna & kilau dari frame) */
export function AiHeader({ f }: { f: number }) {
  // gerak warna pelangi = background-size 300% + background-position bergulir (berulang) di CSS. Web-renderer tidak mengulang
  // tile background → dibuat strip 2 siklus (600%) yang digeser translateX, hasilnya sama di CLI & render browser.
  const flow = (f * 2.4) % 300;
  const flowU = ((2 * flow) / 100) % 3;
  const shine = ((f % 72) / 72) * 2.6 - 1.2;
  return (
    <div style={{ height: 46, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 8, padding: "0 12px", borderBottom: `1px solid ${rgba(Z[800], 0.8)}` }}>
      <span style={{ display: "flex", flex: "none", borderRadius: 999, border: `1px solid ${Z[800]}`, padding: 2, fontSize: 12, fontWeight: 650 }}>
        <span style={{ borderRadius: 999, padding: "4px 10px", background: rgba(ORANGE, 0.15), color: ORANGE4 }}>💬 Chat</span>
        <span style={{ borderRadius: 999, padding: "4px 10px", color: Z[500] }}>💼 Cowork</span>
        <span style={{ borderRadius: 999, padding: "4px 10px", color: Z[500] }}>🎭</span>
      </span>
      <span
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          flex: "none",
          borderRadius: 999,
          padding: "2px 11px 2px 3px",
          fontSize: 12,
          fontWeight: 800,
          color: "#fff",
          whiteSpace: "nowrap",
          background: "#f97316",
          boxShadow: "0 4px 9px rgba(236,72,153,0.32)",
          overflow: "hidden",
        }}
      >
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: "600%",
            backgroundImage: "linear-gradient(90deg, #f97316 0%, #ec4899 16.667%, #8b5cf6 33.333%, #f97316 50%, #ec4899 66.667%, #8b5cf6 83.333%, #f97316 100%)",
            transform: `translateX(${(-(flowU / 6) * 100).toFixed(3)}%)`,
          }}
        />
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.6) 50%, transparent 70%)",
            transform: `translateX(${(shine * 100).toFixed(1)}%)`,
          }}
        />
        <span style={{ position: "relative", width: 24, height: 24, borderRadius: 999, background: "#fff", display: "flex", alignItems: "flex-start", justifyContent: "center", overflow: "hidden" }}>
          <span style={{ marginTop: 5 + Math.sin(f / 6) * 1.2 }}>
            <HeroArt hero={BTN_CHIBI} size={30} still />
          </span>
        </span>
        <span style={{ position: "relative" }}>＋</span>
      </span>
      <span style={{ marginLeft: "auto", display: "flex", gap: 12, fontSize: 12, color: Z[500] }}>
        <span>✎</span>
        <span>🗑</span>
      </span>
    </div>
  );
}

// ------------------------------------------------------------------ composer ------------------------------------------------------------------
/** kolom tulis AiChat: teks diketik (caret oranye), chip Data/Internet, chip hero, tombol kirim → ■ Stop saat AI kerja */
export function Composer({
  f,
  draft,
  focus,
  press,
  busy,
  glow = 0,
  fit = 1,
  back = 1,
}: {
  f: number;
  draft: string;
  focus: boolean;
  press: number;
  busy: boolean;
  glow?: number;
  fit?: number;
  back?: number;
}) {
  const ready = draft.length > 0;
  const caretOn = focus && (ready || Math.floor(f / 9) % 2 === 0);
  const ringW = (focus ? 4 : 0) + glow * 6;
  return (
    <div
      style={{
        position: "relative",
        borderRadius: 16,
        border: `1px solid ${focus ? rgba(ORANGE, 0.75) : Z[800]}`,
        background: Z[900],
        padding: 10,
        boxShadow: "0 12px 22px rgba(0,0,0,0.5)",
      }}
    >
      {/* cincin fokus = div ber-border (box-shadow spread "0 0 0 Npx" tidak tergambar di web-renderer) */}
      {ringW > 0.05 && <Ring w={ringW} r={16} color={rgba(ORANGE, 0.12 + glow * 0.2)} />}
      <div style={{ height: 40, boxSizing: "border-box", padding: "1px 8px", fontSize: 14, lineHeight: "19px", color: Z[100], overflow: "hidden" }}>
        {caretOn && !ready && <Caret pre />}
        {ready ? <span>{draft}</span> : <span style={{ color: Z[500] }}>Tanya apa aja… (Ctrl+V buat tempel screenshot)</span>}
        {caretOn && ready && <Caret />}
      </div>
      <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6, width: `${(100 / fit).toFixed(2)}%`, transform: `scale(${fit})`, transformOrigin: "0 50%" }}>
        <span style={{ width: 32, height: 32, flex: "none", borderRadius: 999, border: `1px solid ${Z[800]}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>📎</span>
        <span
          style={{
            flex: "none",
            whiteSpace: "nowrap",
            borderRadius: 999,
            border: "1px solid rgba(16,185,129,0.4)",
            background: "rgba(16,185,129,0.1)",
            padding: "4px 11px",
            fontSize: 12,
            fontWeight: 650,
            color: "#34d399",
          }}
        >
          📊 Data
        </span>
        <span
          style={{
            flex: "none",
            whiteSpace: "nowrap",
            borderRadius: 999,
            border: "1px solid rgba(14,165,233,0.4)",
            background: "rgba(14,165,233,0.1)",
            padding: "4px 11px",
            fontSize: 12,
            fontWeight: 650,
            color: "#38bdf8",
          }}
        >
          🌐 Internet
        </span>
        <span
          style={{
            flex: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            whiteSpace: "nowrap",
            borderRadius: 999,
            border: `1px solid ${Z[800]}`,
            padding: "2px 10px 2px 2px",
            fontSize: 12,
            fontWeight: 650,
            color: Z[300],
          }}
        >
          <HeroDot size={22} />
          {HERO} ▾
        </span>
        <span style={{ flex: 1 }} />
        {busy ? (
          <span
            style={{
              height: 36,
              flex: "none",
              display: "flex",
              alignItems: "center",
              gap: 6,
              whiteSpace: "nowrap",
              borderRadius: 12,
              border: `1px solid ${Z[700]}`,
              padding: "0 12px",
              fontSize: 13,
              fontWeight: 650,
              color: Z[200],
            }}
          >
            ■ Stop
          </span>
        ) : (
          <span
            style={{
              position: "relative",
              width: 36,
              height: 36,
              flex: "none",
              borderRadius: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              backgroundImage: GRAD,
              opacity: ready ? 1 : 0.4,
              transform: `scale(${(press * back).toFixed(3)})`,
              boxShadow: ready ? `0 5px 10px ${rgba(ORANGE, 0.4)}` : undefined,
            }}
          >
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </span>
        )}
      </div>
    </div>
  );
}

function Caret({ pre }: { pre?: boolean }) {
  return <span style={{ display: "inline-block", width: 2, height: 17, verticalAlign: -3, marginLeft: pre ? 0 : 2, marginRight: pre ? 2 : 0, borderRadius: 1, background: ORANGE }} />;
}

/** foto hero bulat (HeroAvatar website: lingkaran oranye tipis, chibi sedikit lebih besar) */
export function HeroDot({ size, talk = 0, f = 0 }: { size: number; talk?: number; f?: number }) {
  const y = talk > 0 ? -Math.abs(Math.sin(f / 3.2)) * size * 0.05 * talk : 0;
  return (
    <span
      style={{
        width: size,
        height: size,
        flex: "none",
        borderRadius: 999,
        overflow: "hidden",
        display: "inline-flex",
        alignItems: "flex-end",
        justifyContent: "center",
        background: rgba(ORANGE, 0.1),
      }}
    >
      <span style={{ display: "inline-flex", transform: `translateY(${y.toFixed(2)}px)` }}>
        <HeroArt hero={HERO} size={size * 1.17} still />
      </span>
    </span>
  );
}

// ------------------------------------------------------------------ sambutan ------------------------------------------------------------------
const SUGGEST = [
  ["📈", "Analisa chart trading"],
  ["📊", "Rangkum Hot Issue minggu ini"],
  ["🎬", "Kasus Video Review terbanyak"],
  ["🖼️", "Jelaskan isi screenshot"],
  ["✍️", "Bikin caption campaign"],
  ["🌐", "Terjemahin teks"],
] as const;

/** layar kosong AiChat: hero besar + salam + link karakter + grid saran 2 kolom (masuk bergantian) */
export function Welcome({ f, fps, inAt }: { f: number; fps: number; inAt: number }) {
  const p = personaOf(HERO);
  const k = (at: number) => clamp01((f - (inAt + at) * fps) / (0.32 * fps));
  const e = (x: number) => 1 - Math.pow(1 - x, 3);
  const bob = Math.sin(f / 9) * 2.2;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "0 6px" }}>
      <div style={{ transform: `translateY(${((1 - e(k(0))) * 26 + bob).toFixed(1)}px) scale(${(0.7 + 0.3 * e(k(0))).toFixed(3)})`, opacity: k(0), transformOrigin: "50% 100%" }}>
        <HeroArt hero={HERO} size={92} still />
      </div>
      <div style={{ marginTop: 6, fontFamily: DISPLAY, fontSize: 22, fontWeight: 700, color: Z[50], opacity: k(0.12), transform: `translateY(${((1 - e(k(0.12))) * 10).toFixed(1)}px)` }}>
        Halo Alif, mau ngobrol apa?
      </div>
      <div style={{ marginTop: 3, fontSize: 12, fontWeight: 650, color: ORANGE4, opacity: k(0.2) }}>
        {HERO} · {p.type} {p.label} — ganti karakter 🎭
      </div>
      <div style={{ marginTop: 3, fontSize: 13, color: Z[500], opacity: k(0.24) }}>Tanya bebas, kirim screenshot / chart trading, atau tanya isi CS Tracker.</div>
      <div style={{ marginTop: 16, width: "100%", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, textAlign: "left" }}>
        {SUGGEST.map(([ic, label], i) => {
          const a = e(k(0.28 + i * 0.05));
          return (
            <span
              key={label}
              style={{
                borderRadius: 12,
                border: `1px solid ${Z[800]}`,
                padding: "10px 12px",
                fontSize: 12,
                lineHeight: 1.35,
                color: Z[300],
                opacity: a,
                transform: `translateY(${((1 - a) * 12).toFixed(1)}px)`,
              }}
            >
              {ic} {label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ pesan ------------------------------------------------------------------
export function UserBubble({ text, p }: { text: string; p: number }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end" }}>
      <div
        style={{
          borderRadius: "16px 16px 6px 16px",
          padding: "10px 16px",
          fontSize: 14,
          lineHeight: 1.45,
          color: "#fff",
          backgroundImage: GRAD,
          boxShadow: `0 7px 14px ${rgba(ORANGE, 0.32)}`,
          whiteSpace: "nowrap",
          transform: `translateY(${((1 - p) * 26).toFixed(1)}px) scale(${(0.86 + 0.14 * p).toFixed(3)})`,
          transformOrigin: "100% 100%",
          opacity: clamp01(p * 2),
        }}
      >
        {text}
      </div>
    </div>
  );
}

/**
 * keterangan penjawab (HelperLine website): "👋 Kamu dibantu oleh Harley · ENFP Si Pesulap Ide — kreatif, …", selalu 1 baris.
 * Aturan sama dengan HelperChip (screens/ui): sifat ikut tampil kalau hurufnya masih ≥ 9,5 px; kalau tidak (kolom HP sempit),
 * sifat dilepas dulu baru huruf dikecilkan — supaya tetap terbaca di video.
 * `pop` 0..1 = denyut sorot (chip membesar sesaat), `shine` 0..1 = kilau lewat di huruf.
 */
export function HelperLine({ max, p, glow, pop = 0, shine = 0 }: { max: number; p: number; glow: number; pop?: number; shine?: number }) {
  const tg = personaTagline(HERO);
  const fit = (x: string) => Math.min(11.5, (max - 22) / (Array.from(x).length * 0.53 + 2));
  const fullFs = fit(`👋 Kamu dibantu oleh ${tg.name} · ${tg.kind} — ${tg.sifat}`);
  const full = fullFs >= 9.5;
  const fs = full ? fullFs : fit(`👋 Kamu dibantu oleh ${tg.name} · ${tg.kind}`);
  const hot = Math.max(glow, pop);
  return (
    <div style={{ height: 30, opacity: clamp01(p * 1.5), transform: `translateX(${((1 - p) * -14).toFixed(1)}px)` }}>
      <TextShine p={shine} glow="rgba(251,146,60,.9)" style={{ display: "inline-block", maxWidth: max, transform: `scale(${(1 + pop * 0.12).toFixed(4)})`, transformOrigin: "0% 60%" }}>
        <span
          style={{
            position: "relative",
            display: "inline-block",
            maxWidth: max,
            whiteSpace: "nowrap",
            borderRadius: 12,
            border: `1px solid ${hot > 0.01 ? rgba(ORANGE, 0.35 + hot * 0.5) : Z[800]}`,
            background: Z[900],
            padding: "4px 10px",
            fontSize: fs,
            lineHeight: 1.3,
            color: Z[400],
            boxShadow: `0 1px 2px rgba(0,0,0,0.4)${pop > 0.01 ? `, 0 0 ${(pop * 26).toFixed(1)}px ${rgba(ORANGE, 0.45 * pop)}` : ""}`,
          }}
        >
          {hot * 4 > 0.05 && <Ring w={hot * 4} r={12} color={rgba(ORANGE, 0.2 * hot)} />}
          👋 Kamu dibantu oleh <b style={{ fontWeight: 650, color: Z[100] }}>{tg.name}</b> · <span style={{ color: pop > 0.01 ? ORANGE4 : Z[400] }}>{tg.kind}</span>
          {full ? ` — ${tg.sifat}` : ""}
        </span>
      </TextShine>
    </div>
  );
}

/** baris jawaban asisten: avatar hero (h-9, HeroArt 42) + kolom isi */
export function AssistantRow({ f, talk, p, bounce = 0, children }: { f: number; talk: number; p: number; bounce?: number; children: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 12 }}>
      <span
        style={{
          alignSelf: "flex-start",
          display: "inline-flex",
          transform: `translateY(${(-bounce * 7).toFixed(2)}px) scale(${(0.5 + 0.5 * p + bounce * 0.1).toFixed(3)})`,
          opacity: clamp01(p * 1.6),
          transformOrigin: "50% 50%",
        }}
      >
        <HeroDot size={36} talk={talk} f={f} />
      </span>
      <div style={{ minWidth: 0, flex: 1, fontSize: 14, lineHeight: 1.6, color: Z[200] }}>{children}</div>
    </div>
  );
}

// ------------------------------------------------------------------ kartu tanya balik ------------------------------------------------------------------
export type AskOpt = { label: string; desc: string; rec?: boolean };

/** ChoiceCard (PagedAsk): judul, pertanyaan, pilihan bernomor + "Disarankan", Lainnya…, footer Lewati / Kirim → */
export function ChoiceCard({ t, title, q, opts, pick, tapAt, inAt, tapF }: { t: Clock; title: string; q: string; opts: AskOpt[]; pick: number; tapAt: number; inAt: number; tapF: number }) {
  const chosen = t.f >= tapF;
  const pressIn = clamp01((t.f - (tapF - 3)) / 3) * (1 - clamp01((t.f - tapF - 2) / 6));
  return (
    <div
      style={{
        height: "100%",
        boxSizing: "border-box",
        overflow: "hidden",
        borderRadius: 16,
        border: `1px solid ${Z[800]}`,
        background: Z[900],
        boxShadow: "0 1px 2px rgba(0,0,0,0.4), 0 14px 24px rgba(0,0,0,0.4)",
      }}
    >
      <div style={{ padding: "12px 14px 4px" }}>
        <div style={{ fontSize: 12, color: Z[500], marginBottom: 2, whiteSpace: "nowrap" }}>{title}</div>
        <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.35, color: Z[100] }}>{q}</div>
      </div>
      <div style={{ padding: "4px 8px 2px" }}>
        {opts.map((o, i) => {
          const on = chosen && i === pick;
          const a = clamp01((t.f - (inAt + 4 + i * 3)) / 7);
          const ea = 1 - Math.pow(1 - a, 3);
          const sc = i === pick ? 1 - pressIn * 0.03 : 1;
          return (
            <div
              key={o.label}
              style={{
                position: "relative",
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                borderRadius: 12,
                padding: "6px 8px",
                background: on ? rgba(ORANGE, 0.12) : undefined,
                opacity: ea,
                transform: `translateX(${((1 - ea) * 18).toFixed(1)}px) scale(${sc.toFixed(3)})`,
              }}
            >
              {/* cincin terpilih = div ber-border (box-shadow inset tidak tergambar di web-renderer) */}
              {on && <div style={{ position: "absolute", inset: 0, borderRadius: 12, border: `1px solid ${rgba(ORANGE, 0.35)}`, boxSizing: "border-box", pointerEvents: "none" }} />}
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
                  background: on ? ORANGE : undefined,
                  border: on ? undefined : `1px solid ${Z[700]}`,
                }}
              >
                {i + 1}
              </span>
              <span style={{ minWidth: 0 }}>
                <b style={{ display: "block", fontSize: 13.5, fontWeight: 650, color: Z[100], lineHeight: 1.35 }}>
                  {o.label}
                  {o.rec && <span style={{ marginLeft: 6, borderRadius: 6, background: rgba(ORANGE, 0.15), padding: "1px 6px", fontSize: 10, fontWeight: 700, color: ORANGE }}>Disarankan</span>}
                </b>
                <span style={{ display: "block", fontSize: 12, color: Z[500], whiteSpace: "nowrap", lineHeight: 1.4 }}>{o.desc}</span>
              </span>
              {i === pick && <TapAt t={t} at={tapAt} wide={false} x="82%" y="50%" from={[90, 110]} />}
            </div>
          );
        })}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 8px 6px" }}>
          <span style={{ width: 20, textAlign: "center", fontSize: 12, color: Z[500] }}>✍️</span>
          <span style={{ flex: 1, borderRadius: 12, border: `1px dashed ${Z[700]}`, padding: "6px 10px", fontSize: 12.5, color: Z[500] }}>Lainnya… ketik sendiri, Enter</span>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderTop: `1px solid ${rgba(Z[800], 0.7)}`,
          height: 40,
          boxSizing: "border-box",
          padding: "0 14px",
          fontSize: 12.5,
          fontWeight: 650,
          color: Z[500],
        }}
      >
        <span>Lewati, langsung kerjain</span>
        {chosen && <span style={{ borderRadius: 12, background: "#ea580c", padding: "5px 12px", fontSize: 12.5, fontWeight: 700, color: "#fff" }}>Kirim →</span>}
      </div>
    </div>
  );
}

/** AnsweredCard: judul + pertanyaan & jawaban dengan centang oranye */
export function AnsweredCard({ title, pairs }: { title: string; pairs: [string, string][] }) {
  return (
    <div style={{ borderRadius: 16, border: `1px solid ${Z[800]}`, background: Z[900], overflow: "hidden", boxShadow: "0 1px 2px rgba(0,0,0,0.4)" }}>
      <div style={{ borderBottom: `1px solid ${rgba(Z[800], 0.7)}`, padding: "8px 14px", fontSize: 12, color: Z[500], whiteSpace: "nowrap" }}>{title}</div>
      {pairs.map(([q, a]) => (
        <div key={q} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 14px", fontSize: 13 }}>
          <span
            style={{
              marginTop: 3,
              width: 16,
              height: 16,
              flex: "none",
              borderRadius: 999,
              background: ORANGE,
              color: "#fff",
              fontSize: 9,
              fontWeight: 800,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ✓
          </span>
          <span style={{ minWidth: 0, lineHeight: 1.4 }}>
            <span style={{ display: "block", fontSize: 12, color: Z[500] }}>{q}</span>
            <span style={{ display: "block", fontWeight: 650, color: Z[100] }}>{a}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ proses berpikir ------------------------------------------------------------------
export type ThinkStep = { k: string; at: number; q?: string; sym?: string; n?: number; src?: string };

/** ThinkingSteps live: "Harley (ENFP): “…”" oranye + langkah ⏳ → ✓ (kalimat sesuai karakter hero dari lib/aiPersona) */
export function ThinkingLive({ f, fps, steps, doneAt, hot }: { f: number; fps: number; steps: ThinkStep[]; doneAt: number; hot: number }) {
  const p = personaOf(HERO);
  return (
    <div
      style={{
        position: "relative",
        borderRadius: 12,
        border: `1px solid ${hot > 0.01 ? rgba(ORANGE, 0.25 + 0.35 * hot) : Z[800]}`,
        background: rgba(Z[900], 0.6 + 0.4 * hot),
        padding: "9px 12px 10px",
        boxShadow: hot > 0.01 ? `0 14px 26px ${rgba("#000000", 0.5 * hot)}` : undefined,
      }}
    >
      {hot * 3 > 0.05 && <Ring w={hot * 3} r={12} color={rgba(ORANGE, 0.08 * hot)} />}
      <div style={{ fontSize: 12.5, fontWeight: 700, color: ORANGE4, lineHeight: 1.4 }}>
        {HERO} ({p.type}): “{personaIntro(HERO)}”
      </div>
      <div style={{ marginTop: 5, display: "flex", flexDirection: "column", gap: 5 }}>
        {steps.map((s, i) => {
          const a = clamp01((f - s.at * fps) / (0.22 * fps));
          if (a <= 0) return null;
          const end = steps[i + 1]?.at ?? doneAt;
          const done = f >= end * fps - 1;
          const tick = done ? clamp01((f - (end * fps - 1)) / 5) : 0;
          const ea = 1 - Math.pow(1 - a, 3);
          return (
            <div
              key={s.k + i}
              style={{ height: 20, display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: done ? Z[300] : Z[100], opacity: ea, transform: `translateY(${((1 - ea) * 8).toFixed(1)}px)` }}
            >
              <span style={{ width: 16, flex: "none", textAlign: "center" }}>
                {done ? (
                  <b style={{ display: "inline-block", color: "#34d399", fontWeight: 800, transform: `scale(${(1 + (1 - tick) * 0.6).toFixed(2)})` }}>✓</b>
                ) : (
                  <span style={{ display: "inline-block", fontSize: 11.5, transform: `rotate(${((f * 14) % 360).toFixed(0)}deg)` }}>⏳</span>
                )}
              </span>
              <span style={{ minWidth: 0, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {stepLabel(HERO, { k: s.k, q: s.q, sym: s.sym } as Parameters<typeof stepLabel>[1], done)}
              </span>
              {done && s.k === "search" && s.n !== undefined && <span style={{ flex: "none", fontSize: 11, color: Z[500], opacity: tick }}>{s.n} sumber</span>}
              {done && s.src && <span style={{ flex: "none", fontSize: 11, color: Z[500], opacity: tick }}>{s.src}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** ThinkingSteps setelah jawaban keluar: dilipat jadi tombol "⚙️ Lihat proses ▸ (n langkah · s detik)" */
export function ProcessLine({ n, secs }: { n: number; secs: number }) {
  return (
    <div style={{ height: 22, fontSize: 11.5, fontWeight: 650, color: Z[500], whiteSpace: "nowrap" }}>
      ⚙️ Lihat proses ▸{" "}
      <span style={{ fontWeight: 400 }}>
        ({n} langkah · {secs} detik)
      </span>
    </div>
  );
}

/** badge sumber di atas jawaban */
export function SourceBadges({ p }: { p: number }) {
  const ep = clamp01(p);
  return (
    <div style={{ height: 28, display: "flex", alignItems: "center", gap: 6 }}>
      {[["🌐 pakai internet", "rgba(14,165,233,0.1)", "#38bdf8"]].map(([label, bg, c], i) => {
        const a = clamp01(ep * 2 - i * 0.6);
        return (
          <span
            key={label}
            style={{
              display: "inline-block",
              borderRadius: 999,
              background: bg,
              padding: "2px 9px",
              fontSize: 11,
              fontWeight: 650,
              color: c,
              opacity: a,
              transform: `scale(${(0.7 + 0.3 * a).toFixed(3)})`,
              transformOrigin: "0 50%",
            }}
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ AnalysisCard (.ai-card) ------------------------------------------------------------------
export type Tile = { k: string; v: string; n?: string; tone?: "up" | "down" | "neutral" };
export type Sig = { text: string; tone: "good" | "warn" | "bad" };

/** kartu analisa navy (gaya .ai-card di globals.css, mode gelap): simbol, pill bias, kalimat utama, kartu metrik, sinyal penting */
export function AnalysisCard({
  f,
  fps,
  inAt,
  sym,
  bias,
  lead,
  tiles,
  sigs,
  flash,
}: {
  f: number;
  fps: number;
  inAt: number;
  sym: string;
  bias: "bullish" | "bearish" | "netral";
  lead: ReactNode;
  tiles: Tile[];
  sigs: Sig[];
  flash: number;
}) {
  const k = (at: number, len = 0.28) => {
    const x = clamp01((f - (inAt + at) * fps) / (len * fps));
    return 1 - Math.pow(1 - x, 3);
  };
  const pill: Record<string, CSSProperties> = {
    bearish: { background: "rgba(239,68,68,0.14)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.35)" },
    bullish: { background: "rgba(34,197,94,0.14)", color: "#86efac", border: "1px solid rgba(34,197,94,0.35)" },
    netral: { background: "rgba(148,163,184,0.14)", color: "#cbd5e1", border: "1px solid rgba(148,163,184,0.3)" },
  };
  // pill bias "meletup" (pegas) — puncaknya ±0,12 dtk setelah inAt+0,02 (dipakai untuk pukulan SFX)
  const pillP = clamp01((f - (inAt + 0.02) * fps) / (0.2 * fps));
  const pillS = pillP <= 0 ? 0.4 : 1 + 2.4 * Math.pow(pillP - 1, 3) + 1.4 * Math.pow(pillP - 1, 2);
  const tileBar = { up: "#22c55e", down: "#ef4444", neutral: "#334155" };
  const tileV = { up: "#4ade80", down: "#f87171", neutral: "#f8fafc" };
  const dot = { good: "#4ade80", warn: "#fbbf24", bad: "#f87171" };
  return (
    <div
      style={{ position: "relative", borderRadius: 18, overflow: "hidden", border: "1px solid #1e293b", background: "#0b1220", color: "#e5e7eb", boxShadow: "0 10px 20px rgba(15,23,42,0.45)" }}
    >
      <div style={{ padding: "13px 15px 11px", background: "#111a2e", borderBottom: "1px solid #1e293b" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#f8fafc" }}>{sym}</span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: "0.03em",
              borderRadius: 999,
              padding: "2px 10px",
              ...pill[bias],
              transform: `scale(${pillS.toFixed(3)})`,
              opacity: clamp01(pillP * 3),
              boxShadow: `0 0 ${(18 * (1 - pillP)).toFixed(1)}px rgba(239,68,68,${(0.7 * (1 - pillP) * (pillP > 0 ? 1 : 0)).toFixed(2)})`,
            }}
          >
            {bias.toUpperCase()}
          </span>
        </div>
        <p style={{ margin: "7px 0 0", fontSize: 13.5, lineHeight: 1.55, color: "#cbd5e1", opacity: k(0.04, 0.24), transform: `translateY(${((1 - k(0.04, 0.24)) * 6).toFixed(1)}px)` }}>{lead}</p>
      </div>
      <div style={{ padding: "13px 15px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {tiles.map((m, i) => {
            const a = k(0.07 + i * 0.06, 0.26);
            const tone = m.tone ?? "neutral";
            return (
              <div
                key={m.k}
                style={{
                  position: "relative",
                  borderRadius: 12,
                  padding: "9px 10px 9px 12px",
                  background: "#111a2e",
                  border: "1px solid #1f2a40",
                  opacity: a,
                  transform: `translateY(${((1 - a) * 14).toFixed(1)}px)`,
                }}
              >
                <span style={{ position: "absolute", left: 0, top: 10, bottom: 10, width: 3, borderRadius: "0 3px 3px 0", background: tileBar[tone] }} />
                <span style={{ display: "block", fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#94a3b8" }}>{m.k}</span>
                <b
                  style={{
                    display: "block",
                    marginTop: 2,
                    fontSize: 18,
                    fontWeight: 750,
                    lineHeight: 1.25,
                    color: tileV[tone],
                    textShadow: tone === "down" && flash > 0 ? `0 0 ${(flash * 18).toFixed(1)}px rgba(248,113,113,${(0.8 * flash).toFixed(2)})` : undefined,
                  }}
                >
                  {m.v}
                </b>
                {m.n && <span style={{ display: "block", marginTop: 2, fontSize: 11, lineHeight: 1.35, color: "#94a3b8" }}>{m.n}</span>}
              </div>
            );
          })}
        </div>
        <div style={{ margin: "13px 0 5px", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", color: "#fbbf24", opacity: k(0.2) }}>Sinyal penting</div>
        {sigs.map((s, i) => {
          const a = k(0.24 + i * 0.09);
          return (
            <div
              key={s.text}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 9,
                padding: "7px 0",
                fontSize: 13,
                lineHeight: 1.4,
                color: "#e2e8f0",
                borderBottom: i < sigs.length - 1 ? "1px solid #1e293b" : undefined,
                opacity: a,
                transform: `translateX(${((1 - a) * 12).toFixed(1)}px)`,
              }}
            >
              <span style={{ flex: "none", width: 8, height: 8, marginTop: 6, borderRadius: 999, background: dot[s.tone] }} />
              <span>{s.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ chart (gaya TradePlanChart) ------------------------------------------------------------------
export type Candle = { o: number; h: number; l: number; c: number };

/** deret candle deterministik dari pola gerak (tanpa angka acak runtime) */
export function makeCandles(n: number, seed: number, drift: (i: number) => number, vol = 0.9, start = 100): Candle[] {
  const out: Candle[] = [];
  let prev = start;
  for (let i = 0; i < n; i++) {
    const w = Math.sin(i * 1.73 + seed) * 0.6 + Math.sin(i * 0.61 + seed * 2.1) * 0.5 + Math.cos(i * 2.9 + seed * 0.7) * 0.35;
    const o = prev;
    const c = o * (1 + (drift(i) + w * vol) / 100);
    const span = Math.abs(c - o);
    const h = Math.max(o, c) + (0.25 + Math.abs(Math.sin(i * 3.1 + seed)) * 0.6) * (span * 0.5 + o * 0.002);
    const l = Math.min(o, c) - (0.25 + Math.abs(Math.cos(i * 2.3 + seed)) * 0.6) * (span * 0.5 + o * 0.002);
    out.push({ o, h, l, c });
    prev = c;
  }
  return out;
}

const TFS_ALL = ["1m", "5m", "15m", "30m", "1H", "4H", "1D", "1W"];
/** tinggi kepala chart (2 baris: judul / "Rencana dari ⚔️ Harley · ilustrasi") */
export const HEAD_H = 52;

/** kepala + bar timeframe TradePlanChart */
export function ChartHead({ title, right, tf, stock, lines }: { title: string; right?: ReactNode; tf: string; stock?: boolean; lines?: boolean }) {
  return (
    <>
      <div
        style={{
          height: HEAD_H,
          boxSizing: "border-box",
          display: "flex",
          flexWrap: "wrap",
          alignContent: "center",
          alignItems: "center",
          columnGap: 8,
          rowGap: 2,
          borderBottom: `1px solid ${Z[800]}`,
          padding: "6px 12px",
          fontSize: 12.5,
          lineHeight: 1.3,
        }}
      >
        <b style={{ color: Z[100], whiteSpace: "nowrap" }}>{title}</b>
        {right}
      </div>
      <div style={{ display: "flex", gap: 1, borderBottom: `1px solid ${Z[800]}`, padding: "5px 8px", fontSize: 11, whiteSpace: "nowrap", overflow: "hidden" }}>
        {TFS_ALL.map((x) => {
          const off = stock && x !== "1D" && x !== "1W";
          const on = x === tf;
          return (
            <span key={x} style={{ flex: "none", borderRadius: 6, padding: "2px 6px", fontWeight: 650, background: on ? rgba(ORANGE, 0.2) : undefined, color: on ? ORANGE4 : off ? Z[700] : Z[400] }}>
              {x}
            </span>
          );
        })}
        {lines && (
          <span style={{ marginLeft: "auto", flex: "none", borderRadius: 6, padding: "2px 7px", fontWeight: 650, background: "rgba(168,85,247,0.15)", color: "#a855f7" }}>📏 Garis analisa</span>
        )}
      </div>
    </>
  );
}

export function ChartFoot() {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, borderTop: `1px solid ${Z[800]}`, padding: "6px 12px", fontSize: 11, color: Z[500], whiteSpace: "nowrap" }}>
      <span>⚠️ Analisa edukasi, bukan saran finansial</span>
    </div>
  );
}

/**
 * area candle (SVG): candle muncul dari kiri ke kanan sampai `reveal` (0..1). `slam` (0..1) = candle terakhir memanjang (jatuh).
 * Tanpa skala angka; label hanya yang diberikan lewat `tags`.
 */
export function CandleArea({
  w,
  h,
  data,
  reveal,
  slam = 1,
  grid = true,
  children,
}: {
  w: number;
  h: number;
  data: Candle[];
  reveal: number;
  slam?: number;
  grid?: boolean;
  children?: (y: (v: number) => number, x: (i: number) => number) => ReactNode;
}) {
  const lo = Math.min(...data.map((d) => d.l));
  const hi = Math.max(...data.map((d) => d.h));
  const pad = (hi - lo) * 0.08;
  const y = (v: number) => 8 + ((hi + pad - v) / (hi - lo + pad * 2)) * (h - 16);
  const step = (w - 20) / data.length;
  const x = (i: number) => 10 + step * (i + 0.5);
  const shown = reveal * data.length;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }} aria-hidden>
      {grid && [0.2, 0.4, 0.6, 0.8].map((g) => <line key={g} x1={0} x2={w} y1={h * g} y2={h * g} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />)}
      {grid && [0.25, 0.5, 0.75].map((g) => <line key={`v${g}`} y1={0} y2={h} x1={w * g} x2={w * g} stroke="rgba(255,255,255,0.045)" strokeWidth={1} />)}
      {data.map((d, i) => {
        const a = clamp01(shown - i);
        if (a <= 0) return null;
        const last = i === data.length - 1;
        const c = last ? d.o + (d.c - d.o) * slam : d.c;
        const l = last ? Math.min(d.o, c) - (Math.min(d.o, d.c) - d.l) * slam : d.l;
        const up = c >= d.o;
        const col = up ? "#16a34a" : "#ef4444";
        const yo = y(d.o);
        const yc = y(c);
        const bw = Math.max(2, step * 0.62);
        return (
          <g key={i} opacity={a}>
            <line x1={x(i)} x2={x(i)} y1={y(d.h)} y2={y(l)} stroke={col} strokeWidth={1.2} />
            <rect x={x(i) - bw / 2} y={Math.min(yo, yc)} width={bw} height={Math.max(1.2, Math.abs(yc - yo))} fill={col} rx={0.8} />
          </g>
        );
      })}
      {children?.(y, x)}
    </svg>
  );
}

export { FONT };
