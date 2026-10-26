"use client";

/**
 * Potongan UI website CS Tracker yang dibuat ulang untuk adegan teaser Dashboard & Video Review.
 * Ukuran px = px CSS website versi HP (lebar isi 362), warna = kelas Tailwind komponen aslinya:
 * - components/StatCard.tsx, components/Badges.tsx, components/LoadMoreList.tsx (RankBadge, panel), app/(app)/page.tsx (baris ranking)
 * - components/VrTable.tsx (kartu HP), components/VrStatusSelect.tsx, components/VrBits.tsx, lib/videoReview.ts (VR_STATUSES)
 * Semua gerak dihitung dari frame (deterministik).
 * PRIVASI: data clipper (kontak, link, email) TIDAK PERNAH digambar sebagai teks asli — selalu balok skeleton solid
 * (`Redacted`) berisi teks placeholder yang sudah disamarkan. Tidak bergantung pada CSS blur, jadi aman juga di render
 * browser (@remotion/web-renderer: blur canvas tidak ikut skala transform).
 * Render browser: tanpa box-shadow inset / ring spread (diganti border/outline), latar tanpa lapisan "gradien, warna".
 */
import type { CSSProperties, ReactNode } from "react";
import { spring } from "remotion";
import { DISPLAY, FONT, Icon, Z, rgba } from "../../screens/ui";
import { clamp01 } from "../kit";

// ------------------------------------------------------------------ warna Tailwind ------------------------------------------------------------------
export const C = {
  sky3: "#7dd3fc",
  sky4: "#38bdf8",
  sky5: "#0ea5e9",
  amber3: "#fcd34d",
  amber4: "#fbbf24",
  amber5: "#f59e0b",
  em3: "#6ee7b7",
  em4: "#34d399",
  em5: "#10b981",
  red2: "#fecaca",
  red3: "#fca5a5",
  red4: "#f87171",
  red5: "#ef4444",
  red6: "#dc2626",
  or3: "#fdba74",
  or4: "#fb923c",
  or5: "#f97316",
  or6: "#ea580c",
  blue3: "#93c5fd",
  blue5: "#3b82f6",
  zinc5: "#71717a",
} as const;

export type PillTone = { bg: string; fg: string; ring: string };
/** kelas `bg-X/15 text-X-300 ring-X/30` */
const tone = (c: string, fg: string, a = 0.15, r = 0.3): PillTone => ({ bg: rgba(c, a), fg, ring: rgba(c, r) });

export const ISSUE_STATUS = {
  open: { label: "Open", ...tone(C.sky5, C.sky3) },
  in_progress: { label: "In Progress", ...tone(C.amber5, C.amber3) },
  resolved: { label: "Resolved", ...tone(C.em5, C.em3) },
} as const;
export const PRIORITY = {
  low: { label: "Low", ...tone(C.zinc5, Z[300]) },
  medium: { label: "Medium", ...tone(C.blue5, C.blue3) },
  high: { label: "High", ...tone(C.or5, C.or3) },
  urgent: { label: "Urgent", ...tone(C.red5, C.red3, 0.2, 0.4) },
} as const;
/** HotBadge: bg-red-600/20 text-red-300 ring-red-500/40 */
/** lebar pil "🔥 HOT" (px) */
export const HOT_W = 60;
export const HOT_TONE: PillTone = { bg: rgba(C.red6, 0.2), fg: C.red3, ring: rgba(C.red5, 0.4) };
/** kategori: bg-zinc-800 text-zinc-300 ring-zinc-700 */
export const CAT_TONE: PillTone = { bg: Z[800], fg: Z[300], ring: Z[700] };
/** 📣 N laporan: merah mulai REPORT_HOT_THRESHOLD (3), selain itu amber */
export const reportTone = (n: number): PillTone => (n >= 3 ? tone(C.red5, C.red4, 0.1, 0.3) : tone(C.amber5, C.amber4, 0.1, 0.3));

/** lib/videoReview.ts VR_STATUSES (warna pil + warna batang) */
export const VR = {
  menunggu: { label: "Menunggu", ...tone(C.sky5, C.sky3), bar: C.sky4 },
  diproses: { label: "Diproses", ...tone(C.amber5, C.amber3), bar: C.amber4 },
  disetujui: { label: "Disetujui", ...tone(C.em5, C.em3), bar: C.em5 },
  ditolak: { label: "Ditolak", ...tone(C.red5, C.red3), bar: C.red5 },
  selesai: { label: "Selesai / Info", ...tone(C.zinc5, Z[300]), bar: C.zinc5 },
} as const;
export type VrKey = keyof typeof VR;
export const VR_ORDER: VrKey[] = ["menunggu", "diproses", "disetujui", "ditolak", "selesai"];

/** bayangan .card (tanpa sorotan inset: inset tidak tergambar di render browser) */
export const CARD_SHADOW = "0 1px 2px rgba(0,0,0,0.5), 0 16px 40px -20px rgba(0,0,0,0.7)";
export const GLOW_UNDER = "0 16px 26px -20px rgba(249,115,22,0.30), 0 12px 22px -18px rgba(236,72,153,0.14)";
export const PRIMARY_GRAD = "linear-gradient(180deg,#fb8a3c,#ea580c)";
export const PRIMARY_SHADOW = "0 8px 20px -8px rgba(234,88,12,0.7)";

/** .card website */
export const cardCss = (extra?: CSSProperties): CSSProperties => ({
  borderRadius: 16,
  border: "1px solid rgba(39,39,42,0.8)",
  background: Z[900],
  boxShadow: `${CARD_SHADOW}, ${GLOW_UNDER}`,
  boxSizing: "border-box",
  ...extra,
});

/** campur dua warna hex (#rrggbb) → warna OPAK (untuk rona di atas latar tanpa lapisan "gradien, warna dasar") */
export function mixHex(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  const k = clamp01(t);
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * k)).join(",")})`;
}

/**
 * data clipper yang disamarkan: balok skeleton SOLID (bukan blur) selebar teks placeholder `s` (sudah disensor, mis. "0812-••••-••••").
 * Placeholder hanya hiasan samar di dalam balok — tidak ada data asli yang pernah digambar.
 */
export function Redacted({ s, color = Z[600], em = 0.56 }: { s: string; color?: string; em?: number }) {
  return (
    <span aria-hidden style={{ position: "relative", display: "inline-block", width: `${(Math.max(5, s.length) * em).toFixed(2)}em`, height: "0.95em", borderRadius: 4, background: color, overflow: "hidden", verticalAlign: "middle", flex: "none" }}>
      <span style={{ position: "absolute", left: 4, top: "50%", transform: "translateY(-50%)", fontSize: "0.85em", lineHeight: 1, letterSpacing: "0.04em", color: Z[300], opacity: 0.32, whiteSpace: "nowrap" }}>{s}</span>
    </span>
  );
}

// ------------------------------------------------------------------ waktu ------------------------------------------------------------------
type SpringCfg = { damping?: number; stiffness?: number; mass?: number };
const crossCache = new Map<string, number>();
/** frame pertama pegas menyentuh 1 (untuk menaruh "pukulan" pegas tepat di detik SFX) */
function crossFrame(fps: number, cfg: Required<SpringCfg>): number {
  const k = `${fps}|${cfg.damping}|${cfg.stiffness}|${cfg.mass}`;
  const hit = crossCache.get(k);
  if (hit !== undefined) return hit;
  let c = 0;
  for (let i = 0; i < fps * 3; i++) {
    if (spring({ frame: i, fps, config: cfg }) >= 0.999) {
      c = i;
      break;
    }
  }
  crossCache.set(k, c);
  return c;
}
/**
 * pegas 0 → 1 yang MENYENTUH target tepat di detik `hit` (lalu sedikit lewat & memantul balik).
 * Cocok untuk "kartu mendarat di bunyi whoosh".
 */
export function springLand(f: number, fps: number, hit: number, cfg: SpringCfg = {}): number {
  const c: Required<SpringCfg> = { damping: 13, stiffness: 190, mass: 0.75, ...cfg };
  const lead = crossFrame(fps, c);
  return spring({ frame: f - (hit * fps - lead), fps, config: c });
}
/** pegas biasa mulai detik `at` */
export const springFrom = (f: number, fps: number, at: number, cfg: SpringCfg = {}) =>
  spring({ frame: f - at * fps, fps, config: { damping: 14, stiffness: 160, mass: 0.8, ...cfg } });
export const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

// ------------------------------------------------------------------ lencana ------------------------------------------------------------------
/** .badge website: rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset */
export function Pill({ t, children, style }: { t: PillTone; children: ReactNode; style?: CSSProperties }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        whiteSpace: "nowrap",
        borderRadius: 999,
        // ring-1 ring-inset → border 1px (padding dikurangi 1px: ukuran sama). box-shadow inset tidak tergambar di render browser.
        padding: "1px 9px",
        border: `1px solid ${t.ring}`,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: "16px",
        color: t.fg,
        background: t.bg,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

const RANK_BG = ["linear-gradient(145deg,#f87171,#dc2626)", "linear-gradient(145deg,#fb923c,#ea580c)", "linear-gradient(145deg,#fbbf24,#d97706)"];
/** RankBadge (LoadMoreList.tsx): #1–#3 bergradasi, #4 dst abu */
export function RankBadge({ rank }: { rank: number }) {
  const top = rank <= 3;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        height: 24,
        minWidth: 33.6,
        padding: "0 6px",
        boxSizing: "border-box",
        borderRadius: 8,
        fontSize: 12,
        fontWeight: 700,
        fontVariantNumeric: "tabular-nums",
        color: top ? "#fff" : Z[400],
        background: top ? RANK_BG[rank - 1] : Z[800],
        boxShadow: top ? "0 6px 14px -6px rgba(220,38,38,.55)" : undefined,
        flex: "none",
      }}
    >
      #{rank}
    </span>
  );
}

// ------------------------------------------------------------------ StatCard ------------------------------------------------------------------
export const STAT_HEX = {
  red: ["#fca5a5", "#ef4444"],
  orange: ["#fdba74", "#f97316"],
  sky: ["#7dd3fc", "#0ea5e9"],
  amber: ["#fcd34d", "#f59e0b"],
  emerald: ["#6ee7b7", "#10b981"],
} as const;
export type StatTone = keyof typeof STAT_HEX;

/** StatCard.tsx: kartu bersih, garis warna di kiri, ikon gradasi, angka font-display 34px */
export function StatCard({ label, value, tone: tn, icon, footer, glow = 0, style }: { label: string; value: number; tone: StatTone; icon: string; footer: string; glow?: number; style?: CSSProperties }) {
  const [lt, md] = STAT_HEX[tn];
  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 16,
        border: "1px solid rgba(39,39,42,0.8)",
        background: Z[900],
        padding: "20px 20px 20px 24px",
        boxSizing: "border-box",
        boxShadow: `${CARD_SHADOW}, 0 22px 44px -22px ${rgba(md, 0.5 + glow * 0.3)}`,
        // cincin cahaya saat angka mendarat: outline (ikut border-radius di CLI & browser), bukan box-shadow spread
        outline: glow > 0.01 ? `${(2 * glow).toFixed(2)}px solid ${rgba(md, 0.55 * glow)}` : undefined,
        ...style,
      }}
    >
      <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: `linear-gradient(180deg, ${lt}, ${md})` }} />
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <span style={{ paddingTop: 6, fontSize: 13.5, fontWeight: 600, color: Z[100], whiteSpace: "nowrap" }}>{label}</span>
        <span
          style={{
            width: 36,
            height: 36,
            flex: "none",
            borderRadius: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            background: `linear-gradient(145deg, ${lt}, ${md})`,
            boxShadow: `0 6px 14px -6px ${rgba(md, 0.7)}`,
          }}
        >
          <Icon name={icon} size={18} />
        </span>
      </div>
      <div style={{ marginTop: 16, display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontFamily: DISPLAY, fontSize: 34, fontWeight: 700, lineHeight: 1, letterSpacing: "-0.015em", fontVariantNumeric: "tabular-nums", color: lt }}>{value}</span>
        <span style={{ fontSize: 14, fontWeight: 500, color: Z[500] }}>issue</span>
      </div>
      <div style={{ marginTop: 12, fontSize: 12, color: Z[500], whiteSpace: "nowrap" }}>{footer}</div>
    </div>
  );
}

// ------------------------------------------------------------------ baris ranking Hot Issue ------------------------------------------------------------------
export type RankIssue = {
  title: string;
  status: keyof typeof ISSUE_STATUS;
  priority: keyof typeof PRIORITY;
  category: string;
  reports: number;
  contact: [string, string, number];
  pic: string;
  ago: string;
  by: string;
};

/** satu <li> ranking "Dari agent" (app/(app)/page.tsx): lencana, judul, chip kontak (balok skeleton tersamar), PIC */
export function IssueRow({
  it,
  rank,
  hot = 0,
  hotGlow = 0,
  reports,
  plus = 0,
  lift = 0,
  focus = 0,
  sweep = -1,
  twoLine = false,
  hotSlot,
  bk = 1,
}: {
  it: RankIssue;
  /** pengali radius CSS blur (render browser: blur canvas tidak ikut skala dunia → dikali skala dunia) */
  bk?: number;
  rank: number;
  /** lencana dibagi 2 baris tetap (peringkat/HOT/status/prioritas | kategori/laporan) → badge HOT bisa masuk mulus tanpa loncatan wrap */
  twoLine?: boolean;
  /** 0..1 lebar slot badge HOT (twoLine) — dibuat mendahului `hot` supaya pil yang membesar tidak menimpa "Open" */
  hotSlot?: number;
  /** 0..1 pegas munculnya badge HOT (0 = belum HOT) */
  hot?: number;
  /** 0..1 cahaya badge HOT menyala */
  hotGlow?: number;
  reports: number;
  /** 0..1 "+1" melayang di lencana laporan */
  plus?: number;
  /** 0..1 baris diangkat (sedang berpindah) */
  lift?: number;
  /** 0..1 sorotan baris yang difokuskan */
  focus?: number;
  /** 0..1 kilau lewat baris (−1 = tidak ada) */
  sweep?: number;
}) {
  const rt = reportTone(reports);
  // pegas boleh lewat 1 sedikit, tapi skala tidak ikut "kempis" (overshoot diredam) dan puncak dibatasi supaya tidak menimpa pil lain
  const hs = Math.max(0.95, hot < 1 ? 1 + (1 - hot) * 0.45 : 1 + (1 - hot) * 0.2);
  const pill = hot > 0.001 && (
    <span style={{ position: "relative", display: "inline-flex", flexShrink: 0, transform: `scale(${hs.toFixed(3)}) rotate(${((1 - Math.min(1, hot)) * -10).toFixed(2)}deg)`, opacity: clamp01(hot * 1.8) }}>
      {hotGlow > 0.01 && <span style={{ position: "absolute", inset: -6, borderRadius: 999, background: rgba(C.red5, 0.35 * hotGlow), filter: `blur(${(8 * bk).toFixed(2)}px)` }} />}
      <Pill t={{ ...HOT_TONE, bg: hotGlow > 0.01 ? `linear-gradient(180deg, ${rgba(C.red5, 0.2 + 0.35 * hotGlow)}, ${rgba(C.red6, 0.2 + 0.2 * hotGlow)})` : HOT_TONE.bg, fg: hotGlow > 0.5 ? "#fff1f2" : HOT_TONE.fg }} style={{ position: "relative" }}>
        🔥 HOT
      </Pill>
    </span>
  );
  // twoLine: slot HOT melebar mulus (pil lain bergeser), lebar = lebar pil "🔥 HOT"
  const ws = clamp01(hotSlot ?? hot);
  const hotEl = twoLine ? (
    <span style={{ position: "relative", display: "inline-flex", flexShrink: 0, width: HOT_W * ws, marginLeft: -8 * (1 - ws), height: 20, overflow: "visible" }}>
      <span style={{ position: "absolute", left: (HOT_W * ws) / 2, top: 0, transform: "translateX(-50%)" }}>{pill}</span>
    </span>
  ) : (
    pill
  );
  const repEl = reports > 1 && (
  <span style={{ position: "relative", display: "inline-flex" }}>
    {plus > 0.01 && (
      <span style={{ position: "absolute", inset: -3, borderRadius: 999, outline: `${(2 + (1 - plus) * 10).toFixed(2)}px solid ${rgba(C.red4, 0.5 * plus * plus)}`, pointerEvents: "none" }} />
    )}
    <Pill t={rt} style={{ transform: plus > 0 ? `scale(${(1 + 0.22 * plus * plus * plus).toFixed(3)})` : undefined, boxShadow: plus > 0.01 ? `0 0 ${(14 * plus).toFixed(1)}px ${rgba(C.red5, 0.6 * plus)}` : undefined }}>📣 {reports} laporan</Pill>
    {plus > 0.01 && (
      <span style={{ position: "absolute", left: "100%", marginLeft: 6 + (1 - plus) * 16, top: -2 - (1 - plus) * 6, fontFamily: DISPLAY, fontSize: 17, lineHeight: "20px", fontWeight: 800, color: C.amber3, opacity: clamp01(plus * 1.6), textShadow: `0 2px 10px rgba(0,0,0,.7), 0 0 12px ${rgba(C.or5, 0.8)}` }}>+1</span>
    )}
  </span>
);
  return (
    <div
      style={{
        position: "relative",
        padding: "16px 20px",
        // satu lapisan gradien dengan stop OPAK (render browser mengabaikan warna dasar di latar "gradien, warna" → kartu tembus)
        background: focus > 0.01 ? `linear-gradient(90deg, ${mixHex(Z[900], C.or5, 0.13 * focus)} 0%, ${mixHex(Z[900], C.or5, 0.04 * focus)} 60%, ${Z[900]} 100%)` : Z[900],
        overflow: "hidden",
        boxShadow: lift > 0.01 ? `0 22px 46px -14px rgba(0,0,0,${(0.9 * lift).toFixed(2)})` : undefined,
        outline: lift > 0.01 ? `1px solid ${rgba(C.or5, 0.35 * lift)}` : undefined,
        borderRadius: lift > 0.01 ? 14 * lift : 0,
      }}
    >
      {focus > 0.01 && <span style={{ position: "absolute", left: 0, top: 10, bottom: 10, width: 3, borderRadius: 3, background: `linear-gradient(180deg, ${C.or4}, ${C.red5})`, opacity: focus }} />}
      {twoLine ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <RankBadge rank={rank} />
            {hotEl}
            <Pill t={ISSUE_STATUS[it.status]}>{ISSUE_STATUS[it.status].label}</Pill>
            <Pill t={PRIORITY[it.priority]}>{PRIORITY[it.priority].label}</Pill>
          </div>
          <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <Pill t={CAT_TONE}>{it.category}</Pill>
            {repEl}
          </div>
        </>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <RankBadge rank={rank} />
          {hotEl}
          <Pill t={ISSUE_STATUS[it.status]}>{ISSUE_STATUS[it.status].label}</Pill>
          <Pill t={PRIORITY[it.priority]}>{PRIORITY[it.priority].label}</Pill>
          <Pill t={CAT_TONE}>{it.category}</Pill>
            {repEl}
        </div>
      )}
      <div style={{ marginTop: 8, fontSize: 15, lineHeight: "22px", fontWeight: 500, color: Z[100], whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.title}</div>
      <div style={{ marginTop: 8, display: "flex", gap: 4 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, borderRadius: 6, background: Z[800], padding: "2px 6px", fontSize: 12, lineHeight: "16px", color: Z[300] }}>
          <span style={{ fontWeight: 600, color: Z[500] }}>{it.contact[0]}</span>
          <Redacted s={it.contact[1]} />
          {it.contact[2] > 1 && <span style={{ fontWeight: 600, color: it.contact[2] >= 2 ? C.red3 : undefined }}>×{it.contact[2]}</span>}
        </span>
      </div>
      <div style={{ marginTop: 8, fontSize: 12, lineHeight: "16px", color: Z[500], whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        PIC: {it.pic} · update {it.ago} oleh {it.by}
      </div>
      {sweep > 0 && sweep < 1 && (
        <span
          style={{
            position: "absolute",
            top: -30,
            bottom: -30,
            left: `${(-40 + sweep * 160).toFixed(2)}%`,
            width: "30%",
            transform: "skewX(-20deg)",
            background: "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,214,170,0.16) 45%, rgba(255,255,255,0.28) 50%, rgba(255,214,170,0.16) 55%, rgba(255,255,255,0) 100%)",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}

/** tab pil TopTabs (Video Review | Dari agent) */
export function DashTabs({ on }: { on: 0 | 1 }) {
  return (
    <div style={{ display: "inline-flex", borderRadius: 999, border: "1px solid rgba(39,39,42,0.8)", background: Z[900], padding: 4, fontSize: 13, fontWeight: 600, boxShadow: "0 1px 2px rgba(0,0,0,0.4)" }}>
      {["Video Review", "Dari agent"].map((x, i) => (
        <span key={x} style={{ borderRadius: 999, padding: "6px 14px", color: i === on ? "#fff" : Z[400], background: i === on ? PRIMARY_GRAD : undefined, boxShadow: i === on ? PRIMARY_SHADOW : undefined, whiteSpace: "nowrap" }}>
          {x}
        </span>
      ))}
    </div>
  );
}

/** judul halaman (.page-title + .page-sub) */
export function PageTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div>
      <div style={{ fontFamily: DISPLAY, fontSize: 26, fontWeight: 700, lineHeight: 1.25, letterSpacing: "-0.015em", color: Z[50] }}>{title}</div>
      {sub && <div style={{ marginTop: 4, fontSize: 14, lineHeight: "20px", color: Z[400] }}>{sub}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ Video Review ------------------------------------------------------------------
/** sub menu Video Review (rounded-2xl, aktif = gradasi oranye) */
export function VrSubNav({ total }: { total: number }) {
  const items: [string, number | null][] = [
    ["＋ Input kasus", null],
    ["Daftar kasus", total],
    ["Report", null],
  ];
  return (
    <div style={{ display: "flex", width: "100%", gap: 4, borderRadius: 16, border: "1px solid rgba(39,39,42,0.8)", background: Z[900], padding: 6, boxSizing: "border-box", boxShadow: "0 1px 2px rgba(0,0,0,0.4)" }}>
      {items.map(([label, n], i) => {
        const on = i === 1;
        return (
          <span
            key={label}
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              whiteSpace: "nowrap",
              borderRadius: 12,
              padding: "8px 8px",
              fontSize: 13,
              fontWeight: 600,
              color: on ? "#fff" : Z[400],
              background: on ? PRIMARY_GRAD : undefined,
              boxShadow: on ? PRIMARY_SHADOW : undefined,
            }}
          >
            {label}
            {n !== null && <span style={{ borderRadius: 999, padding: "2px 8px", fontSize: 11, fontVariantNumeric: "tabular-nums", background: "rgba(255,255,255,0.25)" }}>{n}</span>}
          </span>
        );
      })}
    </div>
  );
}

/** pil status VrStatusSelect (rounded-full px-2.5 py-0.5 11px ring-1 inset, warna VR_STATUSES) — bisa berganti warna halus */
export function StatusPill({ from, to, p = 1, press = 0, scale = 1, pop = 0 }: { from: VrKey; to?: VrKey; p?: number; press?: number; scale?: number; pop?: number }) {
  const a = VR[from];
  const b = VR[to ?? from];
  const k = clamp01(p);
  const show = k < 0.5 ? a : b;
  // ganti status = pil "dibalik" (scaleY) lalu warna baru
  const sy = to && to !== from ? Math.max(0.08, Math.abs(1 - 2 * k)) : 1;
  return (
    <span style={{ display: "inline-flex", transform: `scale(${(scale * (1 - press * 0.08) * (1 + 0.22 * pop)).toFixed(3)}) scaleY(${sy.toFixed(3)})`, transformOrigin: "50% 50%" }}>
      <Pill t={show} style={{ boxShadow: pop > 0.01 ? `0 0 ${(16 * pop).toFixed(1)}px ${rgba(show.bar, 0.8 * pop)}` : undefined }}>
        {show.label}
      </Pill>
    </span>
  );
}

/** tinggi satu baris menu status (px) */
export const MENU_ROW = 30;
/** menu pilihan status (isi <select> VrStatusSelect); sorotan meluncur ke indeks `hl` (pecahan = sedang pindah) */
export function StatusMenu({ open, cur, hl, chosen = 0 }: { open: number; cur: VrKey; hl: number; chosen?: number }) {
  if (open <= 0.01) return null;
  const near = VR_ORDER[Math.max(0, Math.min(VR_ORDER.length - 1, Math.round(hl)))];
  const hc = VR[near].bar;
  return (
    <div
      style={{
        position: "relative",
        width: 172,
        borderRadius: 14,
        border: "1px solid rgba(63,63,70,0.9)",
        background: "#18181b",
        padding: 5,
        boxSizing: "border-box",
        boxShadow: "0 18px 40px -10px rgba(0,0,0,0.85)",
        outline: "1px solid rgba(0,0,0,0.4)",
        transform: `translateY(${((1 - open) * -10).toFixed(2)}px) scale(${(0.86 + 0.14 * open).toFixed(3)})`,
        transformOrigin: "85% 0%",
        opacity: clamp01(open * 3),
      }}
    >
      <span
        style={{
          position: "absolute",
          left: 5,
          right: 5,
          top: 5 + hl * MENU_ROW,
          height: MENU_ROW,
          boxSizing: "border-box",
          borderRadius: 9,
          background: rgba(hc, 0.2 + 0.14 * chosen),
          border: `1px solid ${rgba(hc, 0.5 + 0.3 * chosen)}`,
          boxShadow: chosen > 0 ? `0 0 18px ${rgba(hc, 0.45)}` : undefined,
        }}
      />
      {VR_ORDER.map((k) => {
        const v = VR[k];
        const on = near === k;
        return (
          <div key={k} style={{ position: "relative", display: "flex", alignItems: "center", gap: 9, height: MENU_ROW, boxSizing: "border-box", padding: "0 9px", fontSize: 12.5, fontWeight: 600, color: on ? "#fff" : Z[300] }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: v.bar, boxShadow: on ? `0 0 10px ${rgba(v.bar, 0.9)}` : undefined }} />
            <span style={{ flex: 1 }}>{v.label}</span>
            {k === cur && (
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                <path d="M2.5 6.2 5 8.6 9.6 3.6" fill="none" stroke={Z[400]} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
        );
      })}
    </div>
  );
}

export type VrCase = {
  no: number;
  date: string;
  explanation: string;
  category: string;
  links: [string, string][];
  notes: string;
};

/** kartu kasus versi HP (VrTable md:hidden <li>), dibungkus kartu supaya bisa digeser */
export function VrCaseCard({ c, status, resolution, resP = 1, glow, glowK = 0, children }: { c: VrCase; status: ReactNode; resolution?: string; resP?: number; glow?: string; glowK?: number; children?: ReactNode }) {
  return (
    <div
      style={{
        ...cardCss(),
        position: "relative",
        width: 362,
        padding: 16,
        fontFamily: FONT,
        fontSize: 13,
        lineHeight: "19px",
        color: Z[100],
        boxShadow: `${CARD_SHADOW}, 0 30px 60px -24px rgba(0,0,0,0.85)${glow && glowK > 0.01 ? `, 0 0 46px -6px ${rgba(glow, 0.5 * glowK)}` : `, ${GLOW_UNDER}`}`,
        // cincin status terpilih: outline (bukan box-shadow spread — tidak tergambar di render browser)
        outline: glow && glowK > 0.01 ? `${(1.5 + glowK * 2).toFixed(2)}px solid ${rgba(glow, 0.55 * glowK)}` : undefined,
        overflow: "visible",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: Z[500] }}>
        <span>#{c.no}</span>
        <span>{c.date}</span>
        <span style={{ marginLeft: "auto", display: "inline-flex" }}>{status}</span>
      </div>
      <div style={{ marginTop: 8, fontWeight: 600, color: Z[50], fontSize: 14, lineHeight: "20px" }}>{c.explanation}</div>
      <div style={{ marginTop: 4, fontSize: 12, color: Z[400] }}>{c.category}</div>
      <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
        {c.links.map(([k, v], i) => (
          <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4, maxWidth: "100%", borderRadius: 6, background: Z[800], padding: "2px 6px", fontSize: 12, lineHeight: "16px", color: Z[300] }}>
            <span style={{ fontWeight: 600, color: Z[500] }}>{k}</span>
            <Redacted s={v} />
          </span>
        ))}
      </div>
      <div style={{ marginTop: 8, height: 19, position: "relative" }}>
        {resolution && resP > 0.01 ? (
          <span style={{ display: "inline-block", color: Z[300], opacity: clamp01(resP * 1.4), transform: `translateY(${((1 - resP) * 8).toFixed(2)}px)` }}>{resolution}</span>
        ) : null}
      </div>
      <div style={{ marginTop: 8, fontSize: 12, lineHeight: "17px", color: Z[400] }}>
        <span style={{ fontWeight: 600, color: Z[500] }}>Argumen clipper:</span> {c.notes}
      </div>
      <div style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: C.or4 }}>Edit</div>
      {children}
    </div>
  );
}

/** riak sentuhan jari (tap) di titik (x, y) px lokal, mulai detik `at` */
export function Tap({ f, fps, at, x, y, color = "#ffffff", len = 0.45 }: { f: number; fps: number; at: number; x: number; y: number; color?: string; len?: number }) {
  const k = (f - at * fps) / (len * fps);
  const pre = (f - (at - 0.22) * fps) / (0.22 * fps);
  if (pre < 0 || k > 1) return null;
  const down = k < 0 ? clamp01(pre) : 1 - clamp01(k * 1.6);
  return (
    <div style={{ position: "absolute", left: x, top: y, width: 0, height: 0, pointerEvents: "none", zIndex: 20 }}>
      {k >= 0 && (
        <span style={{ position: "absolute", left: -22, top: -22, width: 44, height: 44, borderRadius: 999, border: `2px solid ${rgba(color, 0.7 * (1 - k))}`, transform: `scale(${(0.5 + k * 1.3).toFixed(3)})` }} />
      )}
      <span style={{ position: "absolute", left: -13, top: -13, width: 26, height: 26, borderRadius: 999, background: rgba(color, 0.32 * down), outline: `1.5px solid ${rgba(color, 0.55 * down)}`, transform: `scale(${(1.25 - 0.25 * down).toFixed(3)})` }} />
    </div>
  );
}

/** centang hijau besar (lingkaran + garis tergambar) */
export function CheckBurst({ p, size = 120, color = C.em5 }: { p: number; size?: number; color?: string }) {
  if (p <= 0.001) return null;
  const ring = clamp01(p * 1.6);
  const draw = clamp01((p - 0.25) / 0.5);
  const len = 60;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden style={{ overflow: "visible" }}>
      <circle cx="50" cy="50" r={42} fill={rgba(color, 0.18)} stroke={color} strokeWidth="5" strokeDasharray={264} strokeDashoffset={264 * (1 - ring)} transform="rotate(-90 50 50)" />
      <circle cx="50" cy="50" r={34} fill={color} opacity={0.95 * clamp01((p - 0.15) / 0.3)} />
      <path d="M33 51 L45 63 L68 38" fill="none" stroke="#fff" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={len} strokeDashoffset={len * (1 - draw)} />
    </svg>
  );
}
