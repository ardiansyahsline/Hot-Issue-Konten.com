"use client";

/**
 * Bagian adegan Montage teaser (adegan 10):
 * - `SceneFreeze`: memutar ULANG komponen adegan aslinya (DashboardShot, ChatShot, AiShot, …) di frame yang dibekukan, dengan konteks
 *   adegan sumber yang benar (SceneCtx pengganti: adegan, durasi, kotak aman) — jadi montage otomatis ikut versi terbaru tiap adegan.
 * - `StudioUi`: Studio Pro dibuat ulang dari komponen asli (StudioTabs, ProjectBar, PreviewPane di StudioPro.tsx, TimelineEditor,
 *   ExportPanel) dan diisi data timeline teaser INI (nama & durasi adegan, titik SFX per kategori, blok VO, playhead).
 * Semua dari frame (deterministik), tanpa radial/conic-gradient, backdrop-filter, mix-blend-mode (aman untuk render browser).
 */
import { Component, createContext, useMemo, type ComponentType, type CSSProperties, type ErrorInfo, type ReactNode } from "react";
import { AbsoluteFill, Freeze, random } from "remotion";
import { sfxById } from "@/lib/studio/sfxMeta";
import { teaserTimeline } from "@/lib/studio/teaser";
import { FORMATS, sceneStartSecs, secToFrames, totalSec, type Scene, type TeaserShot, type Timeline } from "@/lib/studio/timeline";
import { DISPLAY, FONT, Z } from "../../screens/ui";
import { clamp, rgba, SceneCtx, useScene, useStudio, type SceneCtxValue } from "../../theme";
import { AiShot } from "./ai";
import { HookShot, OutroShot, RevealShot } from "./intro";
import { ChatShot, MusicReportShot } from "./team";
import { TrainAiShot } from "./train";
import { TwsShot } from "./tws";
import { DashboardShot, VideoReviewShot } from "./work";

/** komponen adegan asli (diimpor langsung, BUKAN dari ../index supaya tidak melingkar) */
export const SOURCE: Partial<Record<TeaserShot, ComponentType>> = {
  hook: HookShot,
  reveal: RevealShot,
  dashboard: DashboardShot,
  videoReview: VideoReviewShot,
  chat: ChatShot,
  ai: AiShot,
  tws: TwsShot,
  trainAi: TrainAiShot,
  musicReport: MusicReportShot,
  outro: OutroShot,
};

/** kedalaman montage di dalam montage (preview Studio memutar ulang montage ini; di dalamnya tidak ada Studio lagi) */
export const MontageDepth = createContext(0);

let FALLBACK: Timeline | null = null;
const fallbackTl = () => (FALLBACK ??= teaserTimeline());

/** adegan sumber di timeline yang sedang diputar; kalau dihapus user → pakai data teaser bawaan */
function findScene(tl: Timeline, shot: TeaserShot): { scene: Scene; i: number } {
  const hit = (t: Timeline) => t.scenes.findIndex((s) => s.layout?.kind === "teaser" && s.layout.shot === shot);
  const i = hit(tl);
  if (i >= 0) return { scene: tl.scenes[i], i };
  const fb = fallbackTl();
  const j = Math.max(0, hit(fb));
  return { scene: fb.scenes[j], i: j };
}

/** adegan sumber yang error tidak boleh ikut menjatuhkan montage */
class Guard extends Component<{ children: ReactNode; name: string }, { bad: boolean }> {
  state = { bad: false };
  static getDerivedStateFromError() {
    return { bad: true };
  }
  componentDidCatch(e: Error, info: ErrorInfo) {
    console.warn(`[montage] adegan ${this.props.name} gagal tampil`, e, info.componentStack);
  }
  render() {
    return this.state.bad ? null : this.props.children;
  }
}

/**
 * Adegan asli `shot` dibekukan di detik `at` (detik dari awal adegan sumber) + `drift` frame (gerak lambat kecil supaya tetap hidup).
 * Konteks adegan diganti dengan adegan sumber (durasi, teks, indeks); kotak aman = kotak montage (semua adegan teaser sama).
 */
export function SceneFreeze({ shot, at, drift = 0 }: { shot: TeaserShot; at: number; drift?: number }) {
  const { tl, fps } = useStudio();
  const here = useScene();
  const found = useMemo(() => findScene(tl, shot), [tl, shot]);
  const value = useMemo<SceneCtxValue>(() => {
    const dur = secToFrames(found.scene.dur, fps);
    return { scene: found.scene, i: found.i, n: here.n, dur, box: here.box, subs: here.subs, tempo: clamp(dur / (3 * fps), 0.6, 1.4) };
  }, [found, fps, here.n, here.box, here.subs]);
  const Shot = SOURCE[shot];
  if (!Shot) return null;
  const frame = Math.round(clamp(at * fps + drift, 0, value.dur - 1));
  return (
    <SceneCtx.Provider value={value}>
      <Guard key={shot} name={shot}>
        <Freeze frame={frame}>
          <Shot />
        </Freeze>
      </Guard>
    </SceneCtx.Provider>
  );
}

// ---------------------------------------------------------------------------------------------
// Glitch: pita horizontal bergeser + garis warna (tanpa blend mode)
// ---------------------------------------------------------------------------------------------
/** salinan isi dalam pita-pita yang digeser (amt 0..1). `render` dipanggil per pita → pakai hanya beberapa frame. */
export function GlitchBands({ amt, seed, W, H, render }: { amt: number; seed: string; W: number; H: number; render: () => ReactNode }) {
  if (amt <= 0.02) return null;
  const n = 4;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {Array.from({ length: n }, (_, i) => {
        const y = Math.round(random(`${seed}-y${i}`) * H * 0.86);
        const h = Math.round(40 + random(`${seed}-h${i}`) * 170);
        const dx = (random(`${seed}-x${i}`) * 2 - 1) * 120 * amt;
        return (
          <div key={i} style={{ position: "absolute", left: 0, top: y, width: W, height: h, overflow: "hidden" }}>
            <div style={{ position: "absolute", left: dx, top: -y, width: W, height: H }}>{render()}</div>
            <div style={{ position: "absolute", left: 0, top: 0, width: W, height: 3, background: i % 2 ? "rgba(34,211,238,0.85)" : "rgba(249,115,22,0.9)", opacity: amt }} />
          </div>
        );
      })}
      {Array.from({ length: 6 }, (_, i) => {
        const y = random(`${seed}-l${i}`) * H;
        const w = (0.25 + random(`${seed}-w${i}`) * 0.75) * W;
        const x = random(`${seed}-o${i}`) * (W - w);
        return <div key={`l${i}`} style={{ position: "absolute", left: x, top: y, width: w, height: 2 + random(`${seed}-t${i}`) * 5, background: i % 3 === 0 ? "#22d3ee" : i % 3 === 1 ? "#f97316" : "#ffffff", opacity: 0.75 * amt }} />;
      })}
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------------------------------------
// Studio Pro (dibuat ulang dari components/remotion/pro/*)
// ---------------------------------------------------------------------------------------------
/** lebar kolom UI (px CSS layar HP) */
export const UI_W = 394;
/** tinggi tiap bagian (px CSS) — tetap, supaya kamera bisa membidik posisi persis */
export const UI = (() => {
  const gap = 14;
  const tabs = 36;
  const bar = 58;
  const prevHead = 40;
  const playerW = 196;
  const playerH = Math.round((playerW * 16) / 9);
  const prev = 12 + prevHead + 10 + playerH + 12;
  const tlHead = 62;
  const rows = { ruler: 22, scene: 54, sfx: 44, vo: 22 };
  const tlRows = rows.ruler + rows.scene + rows.sfx + rows.vo + 2;
  const tl = 12 + tlHead + 8 + tlRows + 8 + 34 + 12;
  const ex = 16 + 16 + 10 + 50 + 12 + 44 + 16;
  const y = { tabs: 0, bar: tabs + gap, prev: tabs + gap + bar + gap, tl: 0, ex: 0, end: 0 };
  y.tl = y.prev + prev + gap;
  y.ex = y.tl + tl + gap;
  y.end = y.ex + ex;
  const player = { x: (UI_W - playerW) / 2, y: y.prev + 12 + prevHead + 10, w: playerW, h: playerH };
  const scenesRow = y.tl + 12 + tlHead + 8 + rows.ruler;
  const button = { x: 16, y: y.ex + 16 + 16 + 10 + 50 + 12, w: UI_W - 32, h: 44 };
  return { gap, tabs, bar, prevHead, prev, tlHead, rows, tlRows, tl, ex, y, player, scenesRow, button };
})();

/** warna titik SFX per kategori — sama dengan CAT di TimelineEditor.tsx (kelas Tailwind → hex) */
const CAT_DOT: Record<string, [string, string]> = {
  whoosh: ["#38bdf8", "Whoosh"],
  transisi: ["#0284c7", "Transisi"],
  ui: ["#34d399", "Klik UI"],
  koin: ["#fbbf24", "Koin"],
  magic: ["#a78bfa", "Magis"],
  boom: ["#ef4444", "Boom"],
  braam: ["#f87171", "Braam"],
  "bass-drop": ["#f97316", "Bass drop"],
  impact: ["#fb923c", "Hantaman"],
  riser: ["#818cf8", "Riser"],
  glitch: ["#60a5fa", "Glitch"],
  "trailer-pulse": ["#6366f1", "Denyut"],
  ambience: ["#a1a1aa", "Suasana"],
  foley: ["#d97706", "Foley"],
};
const catDot = (c: string | undefined) => CAT_DOT[c ?? ""] ?? ["#d4d4d8", c || "Lainnya"];

/** 2.5 -> "2,5" (sama dengan fmt di TimelineEditor/ExportPanel) */
const fmt = (n: number, d = 1) => String(Number(n.toFixed(d))).replace(".", ",");
const clockLabel = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

const cardStyle = (extra?: CSSProperties): CSSProperties => ({
  background: Z[900],
  border: "1px solid rgba(39,39,42,0.9)",
  borderRadius: 16,
  boxShadow: "0 1px 2px rgba(0,0,0,0.5), 0 18px 44px -22px rgba(0,0,0,0.8), 0 18px 30px -24px rgba(249,115,22,0.35)",
  boxSizing: "border-box",
  ...extra,
});
const labelStyle: CSSProperties = { fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: Z[500] };
const ghostBtn = (extra?: CSSProperties): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 5,
  borderRadius: 12,
  border: "1px solid rgba(63,63,70,0.8)",
  background: Z[900],
  color: Z[200],
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: "nowrap",
  boxShadow: "0 1px 2px rgba(0,0,0,0.4)",
  boxSizing: "border-box",
  ...extra,
});
const ORANGE = "linear-gradient(180deg, #fb8a3c 0%, #ea580c 100%)";

type VoBlock = { i: number; at: number; dur: number };
/** blok VO per adegan: pakai baris VO hasil generate kalau ada, kalau belum perkiraan dari jumlah kata */
function voBlocks(tl: Timeline): VoBlock[] {
  const lines = tl.vo?.lines ?? [];
  return tl.scenes
    .map((s, i): VoBlock | null => {
      const l = lines.find((x) => x.sceneId === s.id);
      if (l) return { i, at: l.at ?? 0.15, dur: l.dur };
      const words = (s.vo?.text ?? "").split(/\s+/).filter(Boolean).length;
      if (!words) return null;
      return { i, at: 0.15, dur: Math.min(s.dur - 0.25, 0.42 + words * 0.36) };
    })
    .filter((x): x is VoBlock => !!x);
}

/** isi Studio Pro (kolom HP 394 px CSS). `head` = posisi playhead (detik teaser), `player` = isi pemutar, `press`/`progress` = tombol download */
export function StudioUi({ head, player, press, progress, sheen }: { head: number; player: ReactNode; press: number; progress: number; sheen: number }) {
  const { tl, fps } = useStudio();
  const { scene: cur } = useScene();
  const total = totalSec(tl);
  const starts = useMemo(() => sceneStartSecs(tl), [tl]);
  const meta = useMemo(() => {
    const secs = (tl.scenes.reduce((a, s) => a + secToFrames(s.dur, fps), 0) + Math.round(0.5 * fps)) / fps;
    return { secs };
  }, [tl, fps]);
  const ratio = FORMATS[tl.ratio] ?? FORMATS["9:16"];

  // --- timeline (sama dengan TimelineEditor zoom 1: MIN_PPS 36 px/dtk, bergulir horizontal) ---
  const pps = 36;
  const viewW = UI_W - 24 - 24 - 6 - 2;
  const scroll = clamp(head * pps - viewW * 0.58, 0, Math.max(0, total * pps - viewW));
  const dots = useMemo(() => {
    const out: { x: number; lane: number; color: string; on: boolean }[] = [];
    const last: number[] = [];
    tl.scenes.forEach((s, si) =>
      s.sfx.forEach((c) => {
        const x = (starts[si] + c.at) * pps;
        let lane = 0;
        while (lane < 2 && last[lane] !== undefined && x - last[lane] < 12) lane++;
        last[lane] = x;
        out.push({ x, lane, color: catDot(sfxById(c.id)?.cat)[0], on: c.on !== false });
      }),
    );
    return out;
  }, [tl, starts]);
  const cats = useMemo(() => {
    const seen: string[] = [];
    tl.scenes.forEach((s) => s.sfx.forEach((c) => {
      const k = sfxById(c.id)?.cat ?? "";
      if (k && !seen.includes(k)) seen.push(k);
    }));
    return seen;
  }, [tl]);
  const vo = useMemo(() => voBlocks(tl), [tl]);
  const beatStep = 0.6;
  const ticks: number[] = [];
  for (let t = 0; t <= total + 1e-6; t += 2) ticks.push(t);

  const R = UI.rows;
  return (
    <div style={{ position: "relative", width: UI_W, height: UI.y.end, fontFamily: FONT, color: Z[100] }}>
      {/* StudioTabs: pil 3 kolom, tab aktif bergradasi oranye */}
      <div style={{ position: "absolute", left: 0, top: UI.y.tabs, width: UI_W, height: UI.tabs, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", padding: 4, boxSizing: "border-box", borderRadius: 999, border: "1px solid rgba(39,39,42,0.8)", background: Z[900], fontSize: 11.5, fontWeight: 600 }}>
        {["🎬 Studio Pro", "🧩 Template lama", "🎙️ Bank suara"].map((l, i) => (
          <div key={l} style={{ display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 999, whiteSpace: "nowrap", color: i === 0 ? "#fff" : Z[400], backgroundImage: i === 0 ? ORANGE : undefined, boxShadow: i === 0 ? "0 8px 18px -8px rgba(234,88,12,0.65)" : undefined }}>
            {l}
          </div>
        ))}
      </div>

      {/* ProjectBar */}
      <div style={cardStyle({ position: "absolute", left: 0, top: UI.y.bar, width: UI_W, height: UI.bar, display: "flex", alignItems: "center", gap: 8, padding: "0 10px" })}>
        <span style={{ fontSize: 18 }}>📁</span>
        <div style={{ flex: 1, minWidth: 0, lineHeight: 1.25 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: Z[100], whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tl.title || "Teaser CS Tracker"}</div>
          <div style={{ fontSize: 11.5, color: Z[500], whiteSpace: "nowrap" }}>Diubah baru saja · 3 proyek</div>
        </div>
        <span style={{ fontSize: 11.5, color: "#34d399", whiteSpace: "nowrap" }}>✓ Tersimpan</span>
        <span style={ghostBtn({ padding: "6px 10px" })}>✏️</span>
      </div>

      {/* PreviewPane */}
      <div style={cardStyle({ position: "absolute", left: 0, top: UI.y.prev, width: UI_W, height: UI.prev, padding: 12 })}>
        <div style={{ height: UI.prevHead, display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontFamily: DISPLAY, fontSize: 15, fontWeight: 700, color: Z[50] }}>▶️ Preview</div>
            <div style={{ fontSize: 11.5, color: Z[500] }}>
              {fmt(total)} dtk · {tl.ratio} · {ratio.label}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: Z[300], marginTop: 6 }}>
            <span style={{ position: "relative", width: 36, height: 20, borderRadius: 999, background: Z[700] }}>
              <span style={{ position: "absolute", top: 2, left: 2, width: 16, height: 16, borderRadius: 999, background: "#fff" }} />
            </span>
            Zona aman
          </div>
        </div>
        <div style={{ position: "absolute", left: UI.player.x, top: UI.player.y - UI.y.prev, width: UI.player.w, height: UI.player.h, borderRadius: 14, overflow: "hidden", background: "#000", boxShadow: "0 0 0 1px rgba(63,63,70,0.6), 0 22px 40px -18px rgba(249,115,22,0.45)" }}>
          {player}
          {/* kontrol Player */}
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 34, background: "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.7) 100%)" }} />
          <div style={{ position: "absolute", left: 8, right: 8, bottom: 22, height: 3, borderRadius: 3, background: "rgba(255,255,255,0.28)" }}>
            <div style={{ width: `${clamp((head / Math.max(1, total)) * 100, 0, 100)}%`, height: "100%", borderRadius: 3, background: "#fff" }} />
          </div>
          <div style={{ position: "absolute", left: 9, bottom: 5, display: "flex", alignItems: "center", gap: 6, fontSize: 9.5, fontWeight: 600, color: "#fff" }}>
            <span style={{ display: "inline-flex", gap: 2 }}>
              <span style={{ width: 3, height: 9, background: "#fff", borderRadius: 1 }} />
              <span style={{ width: 3, height: 9, background: "#fff", borderRadius: 1 }} />
            </span>
            {clockLabel(head)} / {clockLabel(total)}
          </div>
        </div>
      </div>

      {/* TimelineEditor */}
      <div style={cardStyle({ position: "absolute", left: 0, top: UI.y.tl, width: UI_W, height: UI.tl, padding: 12 })}>
        <div style={{ height: UI.tlHead, display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 12, rowGap: 8, alignContent: "flex-start" }}>
          <div style={labelStyle}>Timeline</div>
          <div style={{ fontSize: 12, color: Z[400] }}>
            Total <b style={{ color: Z[200] }}>{fmt(total)} dtk</b> · {tl.scenes.length} adegan
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={ghostBtn({ padding: "6px 10px", height: 30 })}>🎯 Tempel ke ketukan</span>
            <span style={ghostBtn({ width: 30, height: 30, fontSize: 16 })}>−</span>
            <span style={ghostBtn({ width: 30, height: 30, fontSize: 16 })}>+</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <div style={{ width: 24, flex: "none", display: "flex", flexDirection: "column", textAlign: "center", fontSize: 13, lineHeight: 1, color: Z[500] }}>
            <div style={{ height: R.ruler }} />
            <div style={{ height: R.scene, display: "flex", alignItems: "center", justifyContent: "center" }}>🎬</div>
            <div style={{ height: R.sfx, display: "flex", alignItems: "center", justifyContent: "center" }}>🔊</div>
            <div style={{ height: R.vo, display: "flex", alignItems: "center", justifyContent: "center" }}>🎙️</div>
          </div>
          <div style={{ position: "relative", width: viewW, height: UI.tlRows, overflow: "hidden", borderRadius: 12, border: `1px solid ${Z[800]}`, background: rgba(Z[950], 0.6), boxSizing: "border-box" }}>
            <div style={{ position: "absolute", left: -scroll, top: 0, width: total * pps, height: "100%" }}>
              {/* penggaris + ketukan */}
              <div style={{ position: "relative", height: R.ruler, borderBottom: `1px solid ${Z[800]}` }}>
                {Array.from({ length: Math.floor(total / beatStep) + 1 }, (_, k) => (
                  <span key={`b${k}`} style={{ position: "absolute", bottom: 0, left: k * beatStep * pps, width: 1, height: 6, background: "rgba(249,115,22,0.5)" }} />
                ))}
                {ticks.map((t) => (
                  <span key={t} style={{ position: "absolute", top: 0, left: t * pps, height: "100%", borderLeft: "1px solid rgba(63,63,70,0.7)", paddingLeft: 4, fontSize: 10, lineHeight: "20px", color: Z[500] }}>
                    {clockLabel(t)}
                  </span>
                ))}
              </div>
              {/* blok adegan */}
              <div style={{ position: "relative", height: R.scene }}>
                {tl.scenes.map((s, i) => {
                  const w = Math.max(6, s.dur * pps);
                  const sel = s.id === cur.id;
                  return (
                    <div
                      key={s.id}
                      style={{
                        position: "absolute",
                        top: 6,
                        bottom: 6,
                        left: starts[i] * pps + 1,
                        width: w - 2,
                        overflow: "hidden",
                        borderRadius: 8,
                        border: `1px solid ${sel ? "#f97316" : Z[700]}`,
                        background: sel ? "rgba(249,115,22,0.15)" : i % 2 ? rgba(Z[800], 0.8) : rgba(Z[800], 0.5),
                        boxShadow: sel ? "0 0 18px -2px rgba(249,115,22,0.55)" : undefined,
                        boxSizing: "border-box",
                      }}
                    >
                      <div style={{ padding: "4px 16px 0 6px" }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: sel ? "#fdba74" : Z[200], whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{w > 40 ? `${i + 1}. ${s.name}` : i + 1}</div>
                        {w > 34 && (
                          <div style={{ fontSize: 10, color: Z[500], whiteSpace: "nowrap", overflow: "hidden" }}>
                            {fmt(s.dur, 2)}s{s.vo?.text && w > 60 ? " · 🎙" : ""}
                          </div>
                        )}
                      </div>
                      <div style={{ position: "absolute", right: 0, top: 0, width: 14, height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: rgba(Z[700], 0.3) }}>
                        <span style={{ width: 2, height: 16, borderRadius: 2, background: rgba(Z[400], 0.7) }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* titik SFX */}
              <div style={{ position: "relative", height: R.sfx, borderTop: `1px solid ${rgba(Z[800], 0.7)}` }}>
                {dots.map((d, k) => (
                  <span key={k} style={{ position: "absolute", left: d.x - 5, top: 6 + d.lane * 11, width: 10, height: 10, borderRadius: 999, background: d.on ? d.color : "transparent", boxShadow: d.on ? `0 0 0 2px ${Z[950]}` : `0 0 0 1px ${Z[500]}` }} />
                ))}
              </div>
              {/* blok VO */}
              <div style={{ position: "relative", height: R.vo, borderTop: `1px solid ${rgba(Z[800], 0.7)}` }}>
                {vo.map((l) => (
                  <div key={l.i} style={{ position: "absolute", top: 4, bottom: 4, left: (starts[l.i] + l.at) * pps, width: Math.max(4, l.dur * pps), borderRadius: 4, border: "1px solid rgba(52,211,153,0.6)", background: "rgba(52,211,153,0.2)", color: "#6ee7b7", fontSize: 9, lineHeight: "12px", padding: "0 4px", boxSizing: "border-box", overflow: "hidden" }}>
                    {l.dur * pps > 26 ? "VO" : ""}
                  </div>
                ))}
              </div>
              {/* playhead */}
              <div style={{ position: "absolute", top: 0, bottom: 0, left: head * pps, width: 1.5, background: "#f97316", boxShadow: "0 0 8px rgba(249,115,22,0.9)" }}>
                <span style={{ position: "absolute", left: -4, top: 0, width: 0, height: 0, borderLeft: "4.5px solid transparent", borderRight: "4.5px solid transparent", borderTop: "6px solid #f97316" }} />
              </div>
            </div>
          </div>
        </div>
        <div style={{ marginTop: 8, height: 34, overflow: "hidden", display: "flex", flexWrap: "wrap", alignContent: "flex-start", columnGap: 12, rowGap: 4, fontSize: 11, color: Z[500] }}>
          {cats.map((c) => (
            <span key={c} style={{ display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: catDot(c)[0] }} />
              {catDot(c)[1]}
            </span>
          ))}
          <span style={{ color: Z[600], whiteSpace: "nowrap" }}>· Trailer bed · 100 BPM</span>
        </div>
      </div>

      {/* ExportPanel */}
      <div style={cardStyle({ position: "absolute", left: 0, top: UI.y.ex, width: UI_W, height: UI.ex, padding: 16 })}>
        <div style={{ ...labelStyle, height: 16 }}>Download</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10, height: 50 }}>
          {[
            ["Dengan VO", "Suara + musik + SFX", true],
            ["Tanpa VO", "Musik + SFX + teks", false],
          ].map(([t, sub, on]) => (
            <div key={String(t)} style={{ borderRadius: 12, border: `1px solid ${on ? "#f97316" : Z[800]}`, background: on ? "rgba(249,115,22,0.1)" : undefined, padding: "7px 12px", boxSizing: "border-box" }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: Z[100] }}>{t}</div>
              <div style={{ fontSize: 11, color: Z[500] }}>{sub}</div>
            </div>
          ))}
        </div>
        <div style={{ position: "relative", marginTop: 12, height: 44 }}>
          {progress <= 0 ? (
            <div style={{ position: "relative", height: 44, borderRadius: 12, overflow: "hidden", backgroundImage: ORANGE, boxShadow: "0 10px 24px -8px rgba(234,88,12,0.75)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 600, color: "#fff", transform: `scale(${press.toFixed(4)})` }}>
              ⬇️ Download MP4 ({fmt(meta.secs)} dtk)
              {sheen > 0 && sheen < 1 && (
                <div style={{ position: "absolute", inset: 0, background: `linear-gradient(105deg, rgba(255,255,255,0) ${sheen * 160 - 40}%, rgba(255,255,255,0.55) ${sheen * 160 - 25}%, rgba(255,255,255,0) ${sheen * 160 - 10}%)` }} />
              )}
            </div>
          ) : (
            <div>
              <div style={{ height: 10, borderRadius: 999, overflow: "hidden", background: Z[800] }}>
                <div style={{ width: `${Math.round(progress * 100)}%`, height: "100%", borderRadius: 999, background: "#f97316", boxShadow: "0 0 12px rgba(249,115,22,0.8)" }} />
              </div>
              <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", fontSize: 12, color: Z[400] }}>
                <span>Bikin video… {Math.round(progress * 100)}% — jangan tutup tab ini</span>
                <span style={{ fontWeight: 600, color: "#f87171" }}>Batal</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
