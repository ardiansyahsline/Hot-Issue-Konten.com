// Top issue dari agent: laporan Hot Issue (issue baru + laporan tambahan) per topik (judul mirip digabung), 7 hari terakhir vs 7 hari sebelumnya
export type AgentIssueRow = {
  /** id topik (issue) */
  id?: number;
  /** judul issue yang diinput agent (dipakai untuk menyimpulkan nama topik) */
  title?: string | null;
  report_count?: number | null;
  category: string;
  status: "open" | "in_progress" | "resolved";
  is_hot: boolean;
  max_contact_reports_30d: number | null;
  pic_name: string | null;
  created_at: string;
  priority?: "low" | "medium" | "high" | "urgent" | null;
};
export type AgentTop = {
  category: string;
  /** nama topik hasil simpulan dari judul issue (bukan nama kategori) */
  title: string;
  count: number;
  prev: number;
  rows: AgentIssueRow[];
  /** topik (issue) di dalam kelompok ini, urut dari laporan terbanyak */
  topics: { id?: number; title: string; count: number }[];
  /** tidak ada laporan baru 7 hari ini (masuk karena masih HOT / aktif) — count = total laporan topiknya */
  quiet?: boolean;
};
const PRIO: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
/** tanggal WIB (YYYY-MM-DD) dari timestamp */
export const wibDay = (iso: string) => new Date(new Date(iso).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const tgl = (d: string) => {
  const [, m, day] = d.split("-").map(Number);
  return `${day} ${BULAN[m - 1]}`;
};

/* ---------- menyimpulkan topik dari judul issue ---------- */
const STOP = new Set(
  "yang dan di ke dari untuk dengan pada ini itu ada tidak belum sudah udah tapi atau juga karena saat jadi lagi masih bisa gak ga nggak tak sih nya dong kak min bro mohon tolong minta user clipper kreator akun saya aku kami kita mereka the a of to is and".split(" ")
);
const words = (t: string) => [...new Set((t.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((w) => !STOP.has(w)))];
const similar = (a: string[], b: string[]) => {
  if (!a.length || !b.length) return 0;
  const B = new Set(b);
  const inter = a.filter((w) => B.has(w)).length;
  return inter / Math.min(a.length, b.length);
};
/** judul issue jadi nama topik yang rapi: huruf depan kapital, tanpa titik/spasi berlebih, maks 60 huruf */
const tidyTitle = (t: string) => {
  const s = t.replace(/\s+/g, " ").replace(/[.!?\s]+$/, "").trim();
  const c = s.charAt(0).toUpperCase() + s.slice(1);
  return c.length > 60 ? `${c.slice(0, 57).trimEnd()}…` : c;
};

/**
 * Top topik dari agent, 7 hari terakhir vs 7 hari sebelumnya.
 * Bukan per kategori ("Lainnya", "Campaign" kurang jelas): laporan dikelompokkan per TOPIK issue, lalu topik yang
 * judulnya mirip (kata kunci sama) digabung. Nama kelompok = judul topik dengan laporan terbanyak.
 */
export function topAgentIssues(
  rows: AgentIssueRow[],
  from: string,
  prevFrom: string,
  opts: { limit?: number; active?: AgentIssueRow[]; hotThreshold?: number; reportHot?: number } = {}
): AgentTop[] {
  const { limit = 3, active = [], hotThreshold = 2, reportHot = 3 } = opts;
  type T = { key: string; id?: number; title: string; category: string; cur: AgentIssueRow[]; prev: number; w: string[]; info: AgentIssueRow };
  const byTopic = new Map<string, T>();
  const isHot = (r: AgentIssueRow) => r.status !== "resolved" && (r.is_hot || (r.max_contact_reports_30d ?? 0) >= hotThreshold || (r.report_count ?? 1) >= reportHot);
  for (const r of rows) {
    const d = wibDay(r.created_at);
    if (d < prevFrom) continue;
    const key = r.id != null ? `#${r.id}` : `${r.category}|${r.title ?? ""}`;
    let t = byTopic.get(key);
    if (!t) {
      const title = tidyTitle(r.title || r.category);
      t = { key, id: r.id, title, category: r.category, cur: [], prev: 0, w: words(r.title || r.category), info: r };
      byTopic.set(key, t);
    }
    if (d >= from) t.cur.push(r);
    else t.prev++;
  }
  // issue yang masih aktif (mis. HOT tapi laporannya sudah lama) tetap jadi calon Top 3
  for (const r of active) {
    const key = r.id != null ? `#${r.id}` : `${r.category}|${r.title ?? ""}`;
    if (!byTopic.has(key)) byTopic.set(key, { key, id: r.id, title: tidyTitle(r.title || r.category), category: r.category, cur: [], prev: 0, w: words(r.title || r.category), info: r });
    else byTopic.get(key)!.info = r; // status / HOT terbaru
  }
  // gabungkan topik yang mirip (kategori sama & ≥50% kata kunci sama, atau ≥75% kata kunci sama walau beda kategori)
  const groups: T[][] = [];
  for (const t of [...byTopic.values()].sort((a, b) => b.cur.length - a.cur.length || b.prev - a.prev)) {
    const g = groups.find((gr) => {
      const head = gr[0];
      const sim = similar(t.w, head.w);
      return (head.category === t.category && sim >= 0.5) || sim >= 0.75;
    });
    if (g) g.push(t);
    else groups.push([t]);
  }
  return groups
    .map((g) => {
      const cur = g.flatMap((t) => t.cur);
      const lead = g[0];
      const infos = g.map((t) => t.info);
      // urutan: HOT & masih aktif dulu, lalu aktif biasa, yang sudah resolved paling akhir
      const tier = infos.some(isHot) ? 0 : infos.some((r) => r.status !== "resolved") ? 1 : 2;
      const prio = Math.min(...infos.map((r) => PRIO[r.priority ?? "medium"] ?? 2));
      const total = infos.reduce((n, r) => n + (r.report_count ?? 1), 0);
      return {
        category: lead.category,
        title: lead.title,
        count: cur.length || total,
        prev: g.reduce((n, t) => n + t.prev, 0),
        rows: cur.length ? cur : infos,
        topics: g.map((t) => ({ id: t.id, title: t.title, count: t.cur.length })),
        quiet: !cur.length,
        tier,
        prio,
        fresh: cur.length,
      };
    })
    .filter((x) => x.fresh > 0 || x.tier < 2)
    .sort((a, b) => a.tier - b.tier || b.fresh - a.fresh || a.prio - b.prio || b.count - a.count || a.title.localeCompare(b.title))
    .slice(0, limit)
    .map(({ tier, prio, fresh, ...x }) => (void tier, void prio, void fresh, x));
}

/** Rangkuman dari data (tidak mengarang) */
export function agentRangkuman(t: AgentTop, hotThreshold: number, reportHot = 3): string {
  // status / HOT / PIC dihitung per topik (issue), bukan per laporan
  const seen = new Set<number>();
  const topics = t.rows.filter((r) => (r.id == null ? true : seen.has(r.id) ? false : (seen.add(r.id), true)));
  const n = (s: AgentIssueRow["status"]) => topics.filter((r) => r.status === s).length;
  const days = t.rows.map((r) => wibDay(r.created_at)).sort();
  const first = days[0];
  const last = days[days.length - 1];
  const what = topics.length < t.count ? `${t.count} laporan (${topics.length} topik)` : `${t.count} issue`;
  const parts = t.quiet
    ? [`Belum ada laporan baru 7 hari terakhir, tapi masih aktif (total ${t.count} laporan).`]
    : [first === last ? `${what} pada ${tgl(first)}.` : `${what} dari ${tgl(first)} sampai ${tgl(last)}.`];
  // topik lain yang digabung karena mirip (judul pertama sudah jadi nama kartu)
  const others = t.topics.slice(1, 3).map((x) => `"${x.title}"`);
  if (others.length) parts.push(`Termasuk topik serupa: ${others.join(", ")}${t.topics.length > 3 ? ` +${t.topics.length - 3} lainnya` : ""}.`);
  const st = [
    [n("open"), "masih open"],
    [n("in_progress"), "in progress"],
    [n("resolved"), "resolved"],
  ].filter(([c]) => Number(c) > 0) as [number, string][];
  if (st.length === 1 && st[0][0] === topics.length) parts.push(`Semuanya ${st[0][1]}.`);
  else if (st.length) parts.push(st.map(([c, l]) => `${c} ${l}`).join(", ") + ".");
  const hot = topics.filter(
    (r) => r.status !== "resolved" && (r.is_hot || (r.max_contact_reports_30d ?? 0) >= hotThreshold || (r.report_count ?? 1) >= reportHot)
  ).length;
  if (hot) parts.push(`${hot} ditandai HOT.`);
  const pics = new Map<string, number>();
  for (const r of topics) if (r.pic_name) pics.set(r.pic_name, (pics.get(r.pic_name) ?? 0) + 1);
  const top = [...pics.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
  if (top.length) parts.push(`PIC: ${top.length > 1 ? top.slice(0, -1).join(", ") + " & " + top.at(-1) : top[0]}.`);
  const noPic = topics.filter((r) => !r.pic_name && r.status !== "resolved").length;
  if (noPic) parts.push(`${noPic} belum ada PIC.`);
  return parts.join(" ");
}
