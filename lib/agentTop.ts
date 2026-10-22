// Top issue dari agent: laporan Hot Issue (issue baru + laporan tambahan) per kategori, 7 hari terakhir vs 7 hari sebelumnya
export type AgentIssueRow = {
  /** id topik (issue) */
  id?: number;
  report_count?: number | null;
  category: string;
  status: "open" | "in_progress" | "resolved";
  is_hot: boolean;
  max_contact_reports_30d: number | null;
  pic_name: string | null;
  created_at: string;
};
export type AgentTop = { category: string; count: number; prev: number; rows: AgentIssueRow[] };

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
/** tanggal WIB (YYYY-MM-DD) dari timestamp */
export const wibDay = (iso: string) => new Date(new Date(iso).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const tgl = (d: string) => {
  const [, m, day] = d.split("-").map(Number);
  return `${day} ${BULAN[m - 1]}`;
};

export function topAgentIssues(rows: AgentIssueRow[], from: string, prevFrom: string, limit = 3): AgentTop[] {
  const cur = new Map<string, AgentIssueRow[]>();
  const prev = new Map<string, number>();
  for (const r of rows) {
    const d = wibDay(r.created_at);
    if (d >= from) {
      if (!cur.has(r.category)) cur.set(r.category, []);
      cur.get(r.category)!.push(r);
    } else if (d >= prevFrom) prev.set(r.category, (prev.get(r.category) ?? 0) + 1);
  }
  return [...cur.entries()]
    .map(([category, list]) => ({ category, count: list.length, prev: prev.get(category) ?? 0, rows: list }))
    .sort((a, b) => b.count - a.count || a.prev - b.prev || a.category.localeCompare(b.category))
    .slice(0, limit);
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
  const what = topics.length < t.count ? `${t.count} laporan ${t.category} (${topics.length} topik)` : `${t.count} issue ${t.category}`;
  const parts = [first === last ? `${what} pada ${tgl(first)}.` : `${what} dari ${tgl(first)} sampai ${tgl(last)}.`];
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
