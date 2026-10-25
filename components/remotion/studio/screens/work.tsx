"use client";

/** Layar kerja CS Tracker: Dashboard, Ranking Hot Issue, Video Review (dibuat ulang dari halaman asli website). */
import type { ReactNode } from "react";
import { Easing } from "remotion";
import {
  Badge,
  Blur,
  DISPLAY,
  IconTile,
  LineChart,
  LiveDot,
  PageHead,
  Shell,
  TONE,
  Tabs,
  Toast,
  Z,
  bt,
  card,
  clamp01,
  en,
  fill,
  fmtNum,
  pop,
  ramp,
  rgba,
  splitStat,
  type Clock,
  type Env,
  type Tone,
} from "./ui";

const RANK_BG = ["linear-gradient(145deg,#f87171,#dc2626)", "linear-gradient(145deg,#fb923c,#ea580c)", "linear-gradient(145deg,#fbbf24,#d97706)"];

/** lencana peringkat (#1–#3 bergradasi, sisanya abu) */
function Rank({ n, size = 12 }: { n: number; size?: number }) {
  const top = n <= 3;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        height: size * 2,
        minWidth: size * 2.8,
        padding: "0 6px",
        boxSizing: "border-box",
        borderRadius: 8,
        fontSize: size,
        fontWeight: 750,
        color: top ? "#fff" : Z[400],
        background: top ? RANK_BG[n - 1] : Z[800],
        boxShadow: top ? "0 6px 14px -6px rgba(220,38,38,0.55)" : undefined,
        flex: "none",
      }}
    >
      #{n}
    </span>
  );
}

const STATUS = {
  open: { label: "Open", c: "#0ea5e9", fg: "#7dd3fc" },
  in_progress: { label: "In Progress", c: "#f59e0b", fg: "#fcd34d" },
  resolved: { label: "Resolved", c: "#10b981", fg: "#6ee7b7" },
} as const;

const HotBadge = ({ size = 11 }: { size?: number }) => (
  <Badge c="#dc2626" fg="#fca5a5" size={size}>
    🔥 HOT
  </Badge>
);

// ================================================================== DASHBOARD ==================================================================
type Stat = { label: string; n: number; suf: string; tone: Tone; icon: string; foot: string };
const STATS: Stat[] = [
  { label: "Hot aktif", n: 12, suf: "", tone: "red", icon: "flame", foot: "34% dari issue aktif" },
  { label: "Urgent aktif", n: 5, suf: "", tone: "orange", icon: "alert", foot: "14% dari issue aktif" },
  { label: "Open", n: 23, suf: "", tone: "sky", icon: "inbox", foot: "66% dari issue aktif" },
  { label: "In Progress", n: 12, suf: "", tone: "amber", icon: "clock", foot: "34% dari issue aktif" },
  { label: "Resolved total", n: 186, suf: "", tone: "emerald", icon: "check", foot: "18 diselesaikan hari ini" },
];
const TOP3 = ["Saldo clipper belum cair", "Video ditolak padahal sesuai brief", "Akun Discord gak bisa verifikasi"];
const WEEK = [14, 22, 18, 31, 26, 34, 29];
const DAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

function StatCard({ e, s, i, bump }: { e: Env; s: Stat; i: number; bump: number }) {
  const { t, wide } = e;
  const [lt, md] = TONE[s.tone];
  const at = en(t, 6 + i * 4);
  const p = pop(t, at);
  const val = s.n * ramp(t, at, at + en(t, 30) + 8, 0, 1, Easing.out(Easing.cubic)) + bump;
  const flash = bump > 0 ? Math.max(0, 1 - (t.f - bt(t, 0.55)) / 24) : 0;
  return (
    <div
      style={{
        ...card(md),
        position: "relative",
        overflow: "hidden",
        padding: wide ? "18px 18px 16px 22px" : "12px 12px 11px 16px",
        boxShadow: `0 1px 2px rgba(0,0,0,0.5), 0 22px 44px -22px ${rgba(md, 0.5)}${flash > 0 ? `, 0 0 0 ${2 + flash * 4}px ${rgba(md, 0.45 * flash)}` : ""}`,
        opacity: clamp01(p * 1.4),
        transform: `translateY(${(1 - p) * 26}px) scale(${0.94 + 0.06 * p + flash * 0.03})`,
      }}
    >
      <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: wide ? 4 : 3, background: `linear-gradient(180deg, ${lt}, ${md})` }} />
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <span style={{ paddingTop: 4, fontSize: wide ? 13.5 : 12, fontWeight: 650, color: Z[100], whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.label}</span>
        <IconTile name={s.icon} tone={s.tone} size={wide ? 36 : 28} />
      </div>
      <div style={{ marginTop: wide ? 14 : 8, display: "flex", alignItems: "baseline", gap: 5 }}>
        <span style={{ fontFamily: DISPLAY, fontSize: wide ? 34 : 27, fontWeight: 750, lineHeight: 1, color: lt, fontVariantNumeric: "tabular-nums" }}>
          {fmtNum(Math.round(val))}
          {s.suf}
        </span>
        {!s.suf && <span style={{ fontSize: wide ? 14 : 11.5, fontWeight: 550, color: Z[500] }}>issue</span>}
      </div>
      <div style={{ marginTop: wide ? 10 : 6, fontSize: wide ? 12 : 10.5, color: Z[500], whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.foot}</div>
      {flash > 0 && (
        <span style={{ position: "absolute", right: wide ? 18 : 12, top: wide ? 58 : 44, fontSize: wide ? 15 : 13, fontWeight: 800, color: lt, opacity: flash, transform: `translateY(${-(1 - flash) * 18}px)` }}>+1</span>
      )}
    </div>
  );
}

function TrendCard({ e, height }: { e: Env; height: number }) {
  const { t, wide, acc } = e;
  const at = en(t, 14);
  const p = pop(t, at - 4, { damping: 20 });
  const grow = ramp(t, bt(t, 0.55), bt(t, 0.55) + 16, 0, 1, Easing.out(Easing.back(1.6)));
  const vals = WEEK.map((v, i) => (i === WEEK.length - 1 ? v + grow * 6 : v));
  const cw = (wide ? 906 : 362) - (wide ? 40 : 28);
  const ch = height - (wide ? 92 : 78);
  return (
    <div style={{ ...card(acc), padding: wide ? "16px 20px" : "12px 14px", height, boxSizing: "border-box", opacity: clamp01(p * 1.3), transform: `translateY(${(1 - p) * 20}px)` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: wide ? 14 : 12.5, fontWeight: 650 }}>📈 Laporan masuk · 7 hari</span>
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: wide ? 12 : 10.5, fontWeight: 650, color: "#34d399" }}>
          <LiveDot t={t} size={7} /> Realtime
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
        <span style={{ fontFamily: DISPLAY, fontSize: wide ? 26 : 21, fontWeight: 750 }}>{fmtNum(Math.round(vals.reduce((a, b) => a + b, 0) * ramp(t, at, at + 34, 0, 1, Easing.out(Easing.cubic))))}</span>
        <span style={{ fontSize: wide ? 12.5 : 11, fontWeight: 700, color: "#f87171" }}>▲ 18% vs minggu lalu</span>
      </div>
      <div style={{ marginTop: 2 }}>
        <LineChart values={vals} w={cw} h={ch} color={acc} p={ramp(t, at, at + en(t, 42) + 6, 0, 1, Easing.inOut(Easing.quad))} grid={3} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", padding: "0 6px", fontSize: wide ? 11 : 9.5, color: Z[500], fontWeight: 600 }}>
        {DAYS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
    </div>
  );
}

function TopList({ e, titles, counts }: { e: Env; titles: string[]; counts: number[] }) {
  const { t, wide, acc } = e;
  return (
    <div style={{ ...card(acc), overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: wide ? "12px 18px" : "9px 14px", borderBottom: "1px solid rgba(39,39,42,0.8)" }}>
        <span style={{ fontFamily: DISPLAY, fontSize: wide ? 15 : 13, fontWeight: 750 }}>🔥 Top 3 issue — 7 hari</span>
        <span style={{ fontSize: wide ? 12 : 10.5, fontWeight: 650, color: e.acc2 }}>Lihat semua →</span>
      </div>
      {titles.map((x, i) => {
        const p = pop(t, en(t, 22 + i * 5));
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, height: wide ? 44 : 40, padding: wide ? "0 18px" : "0 14px", borderTop: i ? "1px solid rgba(39,39,42,0.6)" : undefined, opacity: clamp01(p * 1.3), transform: `translateX(${(1 - p) * 26}px)` }}>
            <Rank n={i + 1} size={wide ? 12 : 11} />
            <span style={{ flex: 1, minWidth: 0, fontSize: wide ? 14 : 12.5, fontWeight: 550, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x}</span>
            <span style={{ fontFamily: DISPLAY, fontSize: wide ? 15 : 13, fontWeight: 750, fontVariantNumeric: "tabular-nums" }}>
              {counts[i]} <span style={{ fontSize: wide ? 11 : 10, fontWeight: 550, color: Z[500] }}>laporan</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** daftar kontak berulang — kontak clipper selalu diburamkan */
function HotContacts({ e, height }: { e: Env; height?: number }) {
  const { t, acc } = e;
  const rows = [
    ["WA", "0812-3456-7890", 4, 2],
    ["IG", "@clipper.sample", 3, 1],
    ["DC", "clipper#2231", 3, 2],
    ["WA", "0857-1122-3344", 2, 1],
    ["EM", "nama@email.com", 2, 0],
  ] as const;
  return (
    <div style={{ ...card(acc), padding: "14px 16px", height, boxSizing: "border-box" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 14, fontWeight: 650 }}>🔥 Kontak lagi hot</span>
        <span style={{ fontSize: 11.5, color: e.acc2, fontWeight: 600 }}>Lihat semua</span>
      </div>
      <div style={{ marginTop: 3, fontSize: 11.5, color: Z[500] }}>Dilaporkan di ≥2 issue dalam 30 hari.</div>
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 9 }}>
        {rows.map(([k, v, n, a], i) => {
          const p = pop(t, en(t, 26 + i * 4));
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, opacity: clamp01(p * 1.3), transform: `translateX(${(1 - p) * 20}px)` }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 8, background: Z[800], padding: "3px 8px", fontSize: 12 }}>
                <b style={{ color: Z[500], fontSize: 10.5 }}>{k}</b>
                <Blur px={3.5}>{v}</Blur>
              </span>
              <span style={{ fontSize: 11.5, color: Z[400], whiteSpace: "nowrap" }}>
                <b style={{ color: "#fca5a5" }}>{n}×</b> · {a} aktif
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DashboardScreen({ e }: { e: Env }) {
  const { t, wide } = e;
  // item berangka ("Hot aktif 12") mengganti kartu angka; item lain = judul Top 3
  const custom = e.items.map(splitStat);
  const nums = custom.filter((x): x is NonNullable<typeof x> => !!x);
  const stats = STATS.map((s, i) => (nums[i] ? { ...s, label: nums[i].label, n: nums[i].n, suf: nums[i].suf } : s));
  const titles = fill(e.items.filter((_, i) => !custom[i]), TOP3, 3);
  const at = bt(t, 0.55);
  const bump = t.f >= at ? 1 : 0;
  const counts = [8 + bump, 6, 5];
  const shown = wide ? stats : stats.slice(0, 4);
  return (
    <Shell e={e} nav="home">
      <PageHead
        e={e}
        title={e.title || "Dashboard Hot Issues"}
        sub={wide ? "Pantau issue clipper yang lagi ramai, siapa yang pegang, dan kontak yang dilaporkan berulang." : "Pantau issue yang lagi ramai hari ini"}
        right={wide ? <Tabs items={["Video Review", "Dari agent"]} on={1} grad={e.grad} size={13} /> : undefined}
      />
      <div style={{ marginTop: wide ? 18 : 12, display: "grid", gridTemplateColumns: `repeat(${shown.length === 5 ? 5 : 2}, minmax(0, 1fr))`, gap: wide ? 16 : 10 }}>
        {shown.map((s, i) => (
          <StatCard key={i} e={e} s={s} i={i} bump={i === 0 ? bump : 0} />
        ))}
      </div>
      {wide ? (
        <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px", gap: 18 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <TrendCard e={e} height={220} />
            <TopList e={e} titles={titles} counts={counts} />
          </div>
          <HotContacts e={e} height={404} />
        </div>
      ) : (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
          <TrendCard e={e} height={150} />
          <TopList e={e} titles={titles} counts={counts} />
        </div>
      )}
      <Toast t={t} at={at - 4} until={at + 46} acc={e.acc} top={-6}>
        🔥 Laporan baru · <span style={{ maxWidth: wide ? 360 : 200, overflow: "hidden", textOverflow: "ellipsis" }}>{titles[0]}</span>
      </Toast>
    </Shell>
  );
}

// ================================================================== RANKING HOT ISSUE ==================================================================
type Issue = { t: string; cat: string; n: number; st: keyof typeof STATUS; pic: string; hot: boolean; ago: string; ct: [string, string] };
const OTHERS: Issue[] = [
  { t: "Video ditolak padahal sesuai brief", cat: "Video Review", n: 6, st: "in_progress", pic: "Irsyad", hot: true, ago: "12 mnt lalu", ct: ["IG", "@clipper.video"] },
  { t: "Akun Discord gak bisa verifikasi", cat: "Discord", n: 5, st: "open", pic: "Nengok", hot: true, ago: "25 mnt lalu", ct: ["DC", "clipper#2231"] },
  { t: "Views tidak terhitung di dashboard", cat: "Views", n: 4, st: "in_progress", pic: "Derencalibur", hot: false, ago: "1 jam lalu", ct: ["WA", "0857-1122-3344"] },
  { t: "Link campaign error 404", cat: "Campaign", n: 2, st: "open", pic: "Natasha", hot: false, ago: "2 jam lalu", ct: ["EM", "nama@email.com"] },
];
const FEATURED = "Saldo clipper belum cair";

function IssueRow({ e, it, rank, n, hot, glow, sweep, rowH, plus }: { e: Env; it: Issue; rank: number; n: number; hot: number; glow: number; sweep: number; rowH: number; plus: number }) {
  const { wide } = e;
  const fs = wide ? 1 : 0.92;
  const many = n >= 3;
  return (
    <div
      style={{
        position: "relative",
        height: rowH,
        boxSizing: "border-box",
        padding: wide ? "13px 20px" : "11px 14px",
        background: glow > 0 ? `linear-gradient(90deg, ${rgba(e.acc, 0.12 * glow)} 0%, rgba(24,24,27,0) 70%)` : undefined,
        overflow: "hidden",
      }}
    >
      {glow > 0 && <span style={{ position: "absolute", left: 0, top: 6, bottom: 6, width: 3, borderRadius: 3, background: e.acc, opacity: glow }} />}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "nowrap" }}>
        <Rank n={rank} size={11.5 * fs} />
        {hot > 0 && (
          <span style={{ display: "inline-flex", transform: `scale(${1 + (1 - hot) * 0.9}) rotate(${(1 - hot) * -12}deg)`, opacity: clamp01(hot * 1.6) }}>
            <HotBadge size={11 * fs} />
          </span>
        )}
        <Badge c={STATUS[it.st].c} fg={STATUS[it.st].fg} size={11 * fs}>
          {STATUS[it.st].label}
        </Badge>
        <span style={{ position: "relative", display: "inline-flex" }}>
          <Badge c={many ? "#ef4444" : "#f59e0b"} fg={many ? "#fca5a5" : "#fcd34d"} size={11 * fs}>
            📣 {n} laporan
          </Badge>
          {plus > 0 && (
            <span style={{ position: "absolute", right: -4, top: -4 - (1 - plus) * 16, fontSize: 12, fontWeight: 800, color: "#fca5a5", opacity: plus }}>+1</span>
          )}
        </span>
        {wide && (
          <Badge c="#71717a" fg={Z[300]} size={11}>
            {it.cat}
          </Badge>
        )}
      </div>
      <div style={{ marginTop: wide ? 8 : 7, fontSize: wide ? 15.5 : 14, fontWeight: 600, color: Z[50], whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.t}</div>
      <div style={{ marginTop: wide ? 6 : 6, display: "flex", alignItems: "center", gap: 8, fontSize: wide ? 12 : 11, color: Z[500], whiteSpace: "nowrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, borderRadius: 6, background: Z[800], padding: "1px 6px", color: Z[300] }}>
          <b style={{ color: Z[500], fontSize: 10 }}>{it.ct[0]}</b>
          <Blur px={3}>{it.ct[1]}</Blur>
        </span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
          PIC: {it.pic} · update {it.ago}
        </span>
      </div>
      {sweep > 0 && sweep < 1 && (
        <span style={{ position: "absolute", top: -20, bottom: -20, left: `${-30 + sweep * 140}%`, width: "26%", transform: "skewX(-18deg)", background: "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.09) 50%, rgba(255,255,255,0) 100%)" }} />
      )}
    </div>
  );
}

export function HotIssueScreen({ e }: { e: Env }) {
  const { t, wide } = e;
  const others = OTHERS.map((o, i) => (e.items[i + 1] ? { ...o, t: e.items[i + 1] } : o));
  const feat: Issue = { t: e.items[0] || FEATURED, cat: "Payout", n: 3, st: "open", pic: "Natasha", hot: false, ago: "baru saja", ct: ["WA", "0812-3456-7890"] };
  const rowH = wide ? 92 : 96;
  // laporan bertambah 3 -> 9
  const c0 = bt(t, 0.2);
  const c1 = bt(t, 0.46);
  const adds = 6;
  const step = (c1 - c0) / adds;
  const got = t.f < c0 ? 0 : Math.min(adds, Math.floor((t.f - c0) / step) + 1);
  const n = feat.n + got;
  const lastAdd = got > 0 ? c0 + (got - 1) * step : -1;
  const plus = got > 0 ? Math.max(0, 1 - (t.f - lastAdd) / 14) : 0;
  const hotAt = c0 + 1 * step; // laporan ke-5 -> otomatis HOT
  const hot = t.f >= hotAt ? pop(t, hotAt, { damping: 10, stiffness: 200 }) : 0;
  // naik peringkat
  const move = pop(t, bt(t, 0.52), { damping: 17, stiffness: 90, mass: 1 });
  const fpos = 3 - 3 * move;
  const glow = clamp01(ramp(t, c0 - 4, c0 + 8)) * (0.75 + 0.25 * Math.sin(t.f / 6));
  const sweep = ramp(t, bt(t, 0.7), bt(t, 0.7) + 22, 0, 1, Easing.linear);
  const chip = pop(t, bt(t, 0.68), { damping: 11, stiffness: 180 });
  const rows = [
    ...others.map((o, i) => ({ it: o, pos: i < 3 ? i + move : i, feat: false, i0: i < 3 ? i : 4 })),
    { it: { ...feat, n }, pos: fpos, feat: true, i0: 3 },
  ];
  const listW = wide ? 1224 - 320 : 362;
  const list = (
    <div style={{ ...card(e.acc), overflow: "hidden", width: listW }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: wide ? "11px 20px" : "9px 14px", borderBottom: "1px solid rgba(39,39,42,0.8)", fontSize: wide ? 12 : 11, color: Z[500] }}>
        <span>5 issue · paling HOT & paling banyak laporan di atas</span>
        <LiveDot t={t} size={7} />
      </div>
      <div style={{ position: "relative", height: rowH * 5 }}>
        {rows
          .slice()
          .sort((a, b) => Number(a.feat) - Number(b.feat))
          .map((r, i) => {
            const p = pop(t, en(t, 6 + r.i0 * 4));
            const rank = Math.round(r.pos) + 1;
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: r.pos * rowH,
                  borderTop: Math.round(r.pos) ? "1px solid rgba(39,39,42,0.7)" : undefined,
                  background: Z[900],
                  opacity: clamp01(p * 1.3),
                  transform: `translateX(${(1 - p) * 30}px) scale(${r.feat ? 1 + Math.sin(move * Math.PI) * 0.025 : 1})`,
                  boxShadow: r.feat && move > 0.02 && move < 0.98 ? "0 18px 40px -12px rgba(0,0,0,0.85)" : undefined,
                  zIndex: r.feat ? 2 : 1,
                }}
              >
                <IssueRow
                  e={e}
                  it={r.it}
                  rank={rank}
                  n={r.it.n}
                  hot={r.feat ? hot : r.it.hot ? 1 : 0}
                  glow={r.feat ? glow : 0}
                  sweep={r.feat ? sweep : 0}
                  rowH={rowH}
                  plus={r.feat ? plus : 0}
                />
                {r.feat && chip > 0.01 && (
                  <span style={{ position: "absolute", right: wide ? 20 : 12, bottom: wide ? 12 : 10, transform: `scale(${chip})`, transformOrigin: "100% 50%" }}>
                    <Badge c={e.acc} solid size={wide ? 12 : 11}>
                      ⬆ Naik ke #1
                    </Badge>
                  </span>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
  return (
    <Shell e={e} nav="home">
      <PageHead e={e} title={e.title || "Ranking Hot Issue"} sub={wide ? "Issue paling ramai dilaporkan clipper · 7 hari terakhir" : "Paling banyak laporan di atas · 7 hari"} />
      <div style={{ marginTop: wide ? 18 : 12, display: "flex", gap: 20, alignItems: "flex-start" }}>
        {list}
        {wide && (
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
            <HotContacts e={e} />
            <CategoryBars e={e} n={n} />
          </div>
        )}
      </div>
    </Shell>
  );
}

function CategoryBars({ e, n }: { e: Env; n: number }) {
  const { t } = e;
  const rows: [string, number][] = [
    ["Payout", n],
    ["Video Review", 6],
    ["Discord", 5],
    ["Views", 4],
  ];
  const max = Math.max(...rows.map((r) => r[1]));
  return (
    <div style={{ ...card(e.acc), padding: "14px 16px" }}>
      <div style={{ fontSize: 14, fontWeight: 650 }}>📊 Kategori terbanyak</div>
      {rows
        .slice()
        .sort((a, b) => b[1] - a[1])
        .map(([k, v], i) => {
          const g = ramp(t, en(t, 30 + i * 5), en(t, 30 + i * 5) + 24, 0, 1, Easing.out(Easing.cubic));
          return (
            <div key={k} style={{ marginTop: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 600 }}>
                <span>{k}</span>
                <span style={{ color: Z[400] }}>{v}</span>
              </div>
              <div style={{ marginTop: 5, height: 6, borderRadius: 99, background: Z[800], overflow: "hidden" }}>
                <div style={{ width: `${(v / max) * 100 * g}%`, height: "100%", borderRadius: 99, background: k === "Payout" ? e.grad : "#52525b" }} />
              </div>
            </div>
          );
        })}
    </div>
  );
}

// ================================================================== VIDEO REVIEW ==================================================================
type VrS = "menunggu" | "banding" | "rilis";
const VS: Record<VrS, { label: string; icon: string; c: string; fg: string }> = {
  menunggu: { label: "Menunggu", icon: "⏳", c: "#0ea5e9", fg: "#7dd3fc" },
  banding: { label: "Banding", icon: "⚖️", c: "#f59e0b", fg: "#fcd34d" },
  rilis: { label: "Rilis", icon: "✅", c: "#10b981", fg: "#6ee7b7" },
};
const VIDEOS = [
  { t: "Review video campaign Ramadan", cat: "Permintaan review video", dur: "0:32", ago: "2 jam" },
  { t: "Banding: video dianggap reupload", cat: "Pengajuan banding", dur: "0:47", ago: "3 jam" },
  { t: "Video lewat estimasi rilis", cat: "Rilis melewati estimasi", dur: "0:21", ago: "5 jam" },
  { t: "Cek kesesuaian video dengan brief", cat: "Kesesuaian brief", dur: "0:58", ago: "6 jam" },
  { t: "Refresh views top clipper", cat: "Refresh views", dur: "0:39", ago: "8 jam" },
  { t: "Misskom info brief campaign", cat: "Misskom info brief", dur: "0:26", ago: "9 jam" },
];
/** urutan status tiap kartu: [status awal, [pecahan cerita, status baru], …] */
const FLOW: [VrS, ...[number, VrS][]][] = [
  ["menunggu", [0.26, "banding"], [0.56, "rilis"]],
  ["menunggu", [0.4, "rilis"]],
  ["banding", [0.66, "rilis"]],
  ["menunggu", [0.48, "banding"]],
  ["menunggu", [0.6, "rilis"]],
  ["banding", [0.74, "rilis"]],
];
const THUMBS = [
  ["#fb923c", "#7c2d12"],
  ["#a78bfa", "#1e1b4b"],
  ["#38bdf8", "#082f49"],
  ["#f472b6", "#500724"],
  ["#34d399", "#022c22"],
  ["#fbbf24", "#451a03"],
];

/** status kartu saat ini + frame pergantian terakhir */
function statusAt(t: Clock, flow: (typeof FLOW)[number]): { s: VrS; prev: VrS; at: number } {
  let s = flow[0] as VrS;
  let prev = s;
  let at = -999;
  for (const step of flow.slice(1) as [number, VrS][]) {
    const f = bt(t, step[0]);
    if (t.f >= f - 5) (prev = s), (s = step[1]), (at = f);
  }
  return { s, prev, at };
}

/** cuplikan video (dibuat dengan gradasi; wajah/nama clipper diburamkan) */
function Thumb({ i, w, h, dur, t, playing }: { i: number; w: number; h: number; dur: string; t: Clock; playing: boolean }) {
  const [a, b] = THUMBS[i % THUMBS.length];
  const prog = playing ? ((t.f % 150) / 150) : 0;
  return (
    <div style={{ position: "relative", width: w, height: h, flex: "none", borderRadius: 12, overflow: "hidden", background: `linear-gradient(160deg, ${a} 0%, ${b} 100%)` }}>
      <Blur px={2.5} style={{ position: "absolute", left: w * 0.22, top: h * 0.2, width: w * 0.56, height: h * 0.7 }}>
        <span style={{ position: "absolute", left: "28%", top: 0, width: "44%", height: "34%", borderRadius: 999, background: "rgba(0,0,0,0.35)" }} />
        <span style={{ position: "absolute", left: 0, top: "38%", width: "100%", height: "70%", borderRadius: "45% 45% 8px 8px", background: "rgba(0,0,0,0.3)" }} />
      </Blur>
      <span style={{ position: "absolute", left: "14%", right: "14%", bottom: h * 0.2, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.8)" }} />
      <span style={{ position: "absolute", left: "24%", right: "24%", bottom: h * 0.2 - 8, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.6)" }} />
      <span style={{ position: "absolute", left: w / 2 - 15, top: h / 2 - 15, width: 30, height: 30, borderRadius: 999, background: "rgba(0,0,0,0.35)", border: "1.5px solid rgba(255,255,255,0.7)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
          <path d="M3 1.5 L10.5 6 L3 10.5 Z" fill="#fff" />
        </svg>
      </span>
      <span style={{ position: "absolute", right: 5, bottom: 5, borderRadius: 5, background: "rgba(0,0,0,0.55)", padding: "1px 5px", fontSize: 9.5, fontWeight: 700, color: "#fff" }}>{dur}</span>
      {playing && (
        <span style={{ position: "absolute", left: 0, bottom: 0, height: 3, width: `${prog * 100}%`, background: "#fff" }} />
      )}
    </div>
  );
}

function StatusChip({ t, st, size }: { t: Clock; st: { s: VrS; prev: VrS; at: number }; size: number }) {
  // ganti status = kartu chip "dibalik" (scaleY) lalu warna baru
  const q = ramp(t, st.at - 5, st.at + 5, 0, 1, Easing.linear);
  const show = q < 0.5 ? st.prev : st.s;
  const sy = Math.abs(1 - 2 * q);
  const burst = st.s === "rilis" && t.f >= st.at ? (t.f - st.at) / 20 : -1;
  const v = VS[show];
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      {burst >= 0 && burst < 1 && (
        <span style={{ position: "absolute", inset: -2, borderRadius: 999, border: `2px solid ${rgba("#10b981", 1 - burst)}`, transform: `scale(${1 + burst * 0.6})` }} />
      )}
      <span style={{ display: "inline-flex", transform: `scaleY(${st.at > 0 ? Math.max(0.05, sy) : 1})` }}>
        <Badge c={v.c} fg={v.fg} size={size}>
          {v.icon} {v.label}
        </Badge>
      </span>
    </span>
  );
}

function VideoCard({ e, i, v, playing }: { e: Env; i: number; v: (typeof VIDEOS)[number]; playing: boolean }) {
  const { t, wide } = e;
  const st = statusAt(t, FLOW[i % FLOW.length]);
  const p = pop(t, en(t, 12 + i * 4));
  const flash = st.at > 0 && t.f >= st.at ? Math.max(0, 1 - (t.f - st.at) / 22) : 0;
  const col = VS[st.s].c;
  const h = wide ? 148 : 128;
  return (
    <div
      style={{
        ...card(e.acc),
        height: h,
        boxSizing: "border-box",
        padding: 10,
        display: "flex",
        gap: 12,
        border: `1px solid ${flash > 0 ? rgba(col, 0.4 + flash * 0.5) : "rgba(39,39,42,0.9)"}`,
        boxShadow: `0 1px 2px rgba(0,0,0,0.5), 0 16px 40px -20px rgba(0,0,0,0.7)${flash > 0 ? `, 0 0 0 ${flash * 5}px ${rgba(col, 0.25 * flash)}` : ""}`,
        opacity: clamp01(p * 1.3),
        transform: `translateY(${(1 - p) * 24}px)`,
      }}
    >
      <Thumb i={i} w={(h - 20) * 0.74} h={h - 20} dur={v.dur} t={t} playing={playing} />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <span style={{ alignSelf: "flex-start", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", borderRadius: 6, background: Z[800], padding: "2px 7px", fontSize: wide ? 11 : 10.5, fontWeight: 600, color: Z[300] }}>{v.cat}</span>
        <span style={{ marginTop: 6, fontSize: wide ? 14.5 : 13.5, fontWeight: 650, lineHeight: 1.3, color: Z[50], overflow: "hidden", maxHeight: (wide ? 14.5 : 13.5) * 1.3 * 2 }}>{v.t}</span>
        <span style={{ marginTop: 5, display: "flex", alignItems: "center", gap: 5, fontSize: wide ? 11.5 : 11, color: Z[500], whiteSpace: "nowrap" }}>
          👤 <Blur px={3}>@clipper_{1203 + i * 77}</Blur> · TikTok
        </span>
        <div style={{ marginTop: "auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
          <StatusChip t={t} st={st} size={wide ? 11.5 : 11} />
          <span style={{ fontSize: wide ? 11 : 10.5, color: Z[500] }}>{v.ago} lalu</span>
        </div>
      </div>
    </div>
  );
}

export function VideoReviewScreen({ e }: { e: Env }) {
  const { t, wide } = e;
  const n = wide ? 6 : 3;
  const vids = VIDEOS.slice(0, n).map((v, i) => (e.items[i] ? { ...v, t: e.items[i] } : v));
  const cur = vids.map((_, i) => statusAt(t, FLOW[i]).s);
  const count = (s: VrS) => ({ menunggu: 4, banding: 1, rilis: 18 })[s] + cur.filter((x) => x === s).length;
  // kartu yang "sedang ditonton" = yang paling dekat berganti status berikutnya
  const next = FLOW.slice(0, n)
    .map((fl, i) => ({ i, f: Math.min(...(fl.slice(1) as [number, VrS][]).map((s) => bt(t, s[0])).filter((f) => f > t.f), Infinity) }))
    .sort((a, b) => a.f - b.f)[0];
  const sumP = pop(t, en(t, 8));
  const chips: ReactNode = (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", opacity: clamp01(sumP * 1.3), transform: `translateY(${(1 - sumP) * 12}px)` }}>
      {(Object.keys(VS) as VrS[]).map((k) => (
        <Badge key={k} c={VS[k].c} fg={VS[k].fg} size={wide ? 12.5 : 11.5}>
          {VS[k].icon} {VS[k].label} <b style={{ color: Z[50], fontVariantNumeric: "tabular-nums" }}>{count(k)}</b>
        </Badge>
      ))}
    </div>
  );
  return (
    <Shell e={e} nav="video">
      <PageHead e={e} title={e.title || "Video Review"} sub={wide ? "Log kasus review video dari WA / Discord — status rilis & banding" : "Kasus review video dari WA / Discord"} />
      <div style={{ marginTop: wide ? 16 : 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: wide ? "nowrap" : "wrap" }}>
        <Tabs
          items={[
            "＋ Input kasus",
            <span key="d">
              Daftar kasus <span style={{ marginLeft: 4, borderRadius: 999, background: "rgba(255,255,255,0.25)", padding: "1px 6px", fontSize: 10.5 }}>24</span>
            </span>,
            "Report",
          ]}
          on={1}
          grad={e.grad}
          size={wide ? 13.5 : 12}
          round={12}
          full={!wide}
        />
        {chips}
      </div>
      <div style={{ marginTop: wide ? 18 : 12, display: "grid", gridTemplateColumns: wide ? "repeat(3, minmax(0, 1fr))" : "minmax(0, 1fr)", gap: wide ? 16 : 10 }}>
        {vids.map((v, i) => (
          <VideoCard key={i} e={e} i={i} v={v} playing={next?.f !== Infinity && next?.i === i} />
        ))}
      </div>
    </Shell>
  );
}
