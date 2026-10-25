import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { CATEGORIES, HOT_THRESHOLD, PRIORITIES, REPORT_HOT_THRESHOLD, STATUSES } from "@/lib/constants";
import type { ContactStat, IssueRow } from "@/lib/types";
import { cleanSearch, isAutoHot, isHot, timeAgo } from "@/lib/utils";
import { HotBadge, PriorityBadge, StatusBadge } from "@/components/Badges";
import ContactChip from "@/components/ContactChip";
import StatCard from "@/components/StatCard";
import { topIssues, vrSegments } from "@/components/TopIssues";
import TopTabs, { type TopCardData } from "@/components/TopTabs";
import { buildRangkuman, type VrSummaryRow } from "@/lib/videoReview";
import { agentRangkuman, topAgentIssues, type AgentIssueRow } from "@/lib/agentTop";
import { CONTACT_TYPES, displayContact } from "@/lib/contacts";
import { DashTabProvider, TabOnly } from "@/components/DashTab";
import LoadMoreList, { RankBadge } from "@/components/LoadMoreList";

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
const HOT_OR = `is_hot.eq.true,max_contact_reports_30d.gte.${HOT_THRESHOLD},report_count.gte.${REPORT_HOT_THRESHOLD}`;

type SP = Promise<Record<string, string | undefined>>;
type Counts = { open: number; in_progress: number; urgent: number; hot: number; resolved_today: number };

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export default async function Dashboard({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { supabase, user } = await getCurrentUser();

  // default: semua status — yang aktif di atas, yang sudah resolved tetap ikut ranking di bawahnya
  const status = sp.status ?? "all";
  const q = cleanSearch(sp.q ?? "");

  let query = supabase.from("issue_list").select("*").order("updated_at", { ascending: false }).limit(500);
  if (status === "active") query = query.neq("status", "resolved");
  else if (status !== "all") query = query.eq("status", status);
  if (sp.category) query = query.eq("category", sp.category);
  if (sp.priority) query = query.eq("priority", sp.priority);
  if (sp.mine === "1") query = query.eq("pic_id", user.id);
  if (sp.hot === "1") query = query.or(HOT_OR);
  if (q) {
    query = query.or(
      ["title", "description", "campaign", "contacts_text"].map((col) => `${col}.ilike."*${q}*"`).join(",")
    );
  }

  // jam 00:00 WIB hari ini, dalam UTC
  const jkt = new Date(Date.now() + 7 * 3600 * 1000);
  const todayStartWib = new Date(
    Date.UTC(jkt.getUTCFullYear(), jkt.getUTCMonth(), jkt.getUTCDate()) - 7 * 3600 * 1000
  ).toISOString();
  // Top 3 Video Review: 7 hari terakhir (termasuk hari ini, WIB) vs 7 hari sebelumnya
  const DAY = 86400000;
  const today = isoDay(jkt.getTime());
  const weekFrom = isoDay(jkt.getTime() - 6 * DAY);
  const prevFrom = isoDay(jkt.getTime() - 13 * DAY);

  /** Semua angka kartu dalam 1 panggilan (migration-06). Kalau belum dijalankan, pakai cara lama. */
  async function loadCounts(): Promise<Counts> {
    const { data, error } = await supabase.rpc("dashboard_counts", {
      p_hot_threshold: HOT_THRESHOLD,
      p_today_start: todayStartWib,
      p_report_threshold: REPORT_HOT_THRESHOLD,
    });
    if (!error && data) return data as Counts;
    const active = () => supabase.from("issue_list").select("id", { count: "exact", head: true }).neq("status", "resolved");
    const [o, p, u, h, r] = await Promise.all([
      supabase.from("issues").select("id", { count: "exact", head: true }).eq("status", "open"),
      supabase.from("issues").select("id", { count: "exact", head: true }).eq("status", "in_progress"),
      active().eq("priority", "urgent"),
      active().or(HOT_OR),
      supabase.from("issues").select("id", { count: "exact", head: true }).eq("status", "resolved").gte("resolved_at", todayStartWib),
    ]);
    return { open: o.count ?? 0, in_progress: p.count ?? 0, urgent: u.count ?? 0, hot: h.count ?? 0, resolved_today: r.count ?? 0 };
  }

  // 00:00 WIB tanggal prevFrom (untuk ambil Hot Issue 14 hari terakhir)
  const prevFromIso = new Date(new Date(`${prevFrom}T00:00:00Z`).getTime() - 7 * 3600 * 1000).toISOString();

  const AGENT_COLS = "id, title, category, status, priority, is_hot, max_contact_reports_30d, report_count, pic_name, created_at";
  const [issuesRes, counts, hotContactsRes, vrRes, agentRes, activeRes, resolvedTotalRes] = await Promise.all([
    query,
    loadCounts(),
    supabase
      .from("contact_stats")
      .select("*")
      .gte("issue_count_30d", HOT_THRESHOLD)
      .order("issue_count_30d", { ascending: false })
      .order("last_seen", { ascending: false })
      .limit(10),
    supabase
      .from("video_reviews")
      .select("category, status, resolution, report_date")
      .gte("report_date", prevFrom)
      .lte("report_date", today)
      .limit(5000),
    supabase
      .from("issue_list")
      .select(AGENT_COLS)
      .gte("created_at", prevFromIso)
      .limit(5000),
    // issue yang masih aktif (HOT walau laporannya sudah lama tetap bisa masuk Top 3)
    supabase.from("issue_list").select(AGENT_COLS).neq("status", "resolved").order("updated_at", { ascending: false }).limit(300),
    // total issue yang sudah resolved (kartu "Resolved total")
    supabase.from("issues").select("id", { count: "exact", head: true }).eq("status", "resolved"),
  ]);

  // laporan tambahan (migration-11) ikut dihitung: tiap laporan = 1, dengan kategori / status topiknya
  const agentRows0 = (agentRes.data ?? []) as AgentIssueRow[];
  const { data: repData } = await supabase.from("issue_reports").select("issue_id, created_at").gte("created_at", prevFromIso).limit(5000);
  const reps = (repData ?? []) as { issue_id: number; created_at: string }[];
  const topicById = new Map(agentRows0.map((r) => [r.id, r]));
  const missing = [...new Set(reps.map((r) => r.issue_id))].filter((id) => !topicById.has(id));
  if (missing.length) {
    const { data: more } = await supabase
      .from("issue_list")
      .select(AGENT_COLS)
      .in("id", missing.slice(0, 500));
    for (const r of (more ?? []) as AgentIssueRow[]) topicById.set(r.id, r);
  }
  const agentAll: AgentIssueRow[] = [
    ...agentRows0,
    ...reps.flatMap((r) => {
      const t = topicById.get(r.issue_id);
      return t ? [{ ...t, created_at: r.created_at }] : [];
    }),
  ];

  const vrAll = topIssues((vrRes.data ?? []) as VrSummaryRow[], weekFrom, prevFrom, 100);
  const top = vrAll.slice(0, 3);
  const agentTop = topAgentIssues(agentAll, weekFrom, prevFrom, {
    active: (activeRes.data ?? []) as AgentIssueRow[],
    hotThreshold: HOT_THRESHOLD,
    reportHot: REPORT_HOT_THRESHOLD,
  });
  const vrRows: TopCardData[] = top.map((t) => ({
    summary: buildRangkuman(t.rows),
    title: t.category,
    count: t.count,
    diff: t.count - t.prev,
    href: `/video-review?tab=daftar&category=${encodeURIComponent(t.category)}&from=${weekFrom}&to=${today}`,
    segments: vrSegments(t),
  }));
  const agentRows: TopCardData[] = agentTop.map((t) => ({
    summary: agentRangkuman(t, HOT_THRESHOLD, REPORT_HOT_THRESHOLD),
    title: t.title,
    count: t.count,
    // masuk karena masih HOT/aktif tanpa laporan baru -> tidak dibandingkan dengan minggu lalu
    diff: t.quiet ? 0 : t.count - t.prev,
    // satu topik -> buka issue-nya langsung; gabungan beberapa topik -> daftar issue kategori itu
    href: t.topics.length === 1 && t.topics[0].id != null ? `/issues/${t.topics[0].id}` : `/?status=all&category=${encodeURIComponent(t.category)}`,
    segments: [
      { key: "open", label: "open", bar: "bg-sky-400", count: t.rows.filter((r) => r.status === "open").length },
      { key: "in_progress", label: "in progress", bar: "bg-amber-400", count: t.rows.filter((r) => r.status === "in_progress").length },
      { key: "resolved", label: "resolved", bar: "bg-emerald-500", count: t.rows.filter((r) => r.status === "resolved").length },
    ],
  }));
  const BLN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  const dd = (d: string) => `${Number(d.slice(8))} ${BLN[Number(d.slice(5, 7)) - 1]}`;
  const range = `${dd(weekFrom)} – ${dd(today)} ${today.slice(0, 4)}`;

  // peringkat: HOT dulu, lalu jumlah laporan terbanyak, prioritas, terakhir update
  // (issue resolved selalu di bawah issue yang masih aktif)
  const issues = ((issuesRes.data ?? []) as IssueRow[]).sort((a, b) => {
    const done = Number(a.status === "resolved") - Number(b.status === "resolved");
    if (done) return done;
    const h = Number(isHot(b)) - Number(isHot(a));
    if (h) return h;
    const r = (b.report_count ?? 1) - (a.report_count ?? 1);
    if (r) return r;
    const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (p) return p;
    return b.updated_at.localeCompare(a.updated_at);
  });
  const hotContacts = (hotContactsRes.data ?? []) as ContactStat[];

  const activeTotal = counts.open + counts.in_progress;
  const ofActive = (n: number) => `${activeTotal ? Math.round((n / activeTotal) * 100) : 0}% dari issue aktif`;
  const stats = [
    { label: "Hot aktif", value: counts.hot, href: "/?hot=1", tone: "red", icon: "flame", footer: ofActive(counts.hot) },
    { label: "Urgent aktif", value: counts.urgent, href: "/?priority=urgent", tone: "orange", icon: "alert", footer: ofActive(counts.urgent) },
    { label: "Open", value: counts.open, href: "/?status=open", tone: "sky", icon: "inbox", footer: ofActive(counts.open) },
    { label: "In Progress", value: counts.in_progress, href: "/?status=in_progress", tone: "amber", icon: "clock", footer: ofActive(counts.in_progress) },
    {
      label: "Resolved total",
      value: resolvedTotalRes.count ?? 0,
      href: "/?status=resolved",
      tone: "emerald",
      icon: "check",
      footer: counts.resolved_today ? `${counts.resolved_today} diselesaikan hari ini` : "semua issue yang sudah selesai",
    },
  ] as const;

  return (
    <div className="space-y-6">
      {issuesRes.error && (
        <div className="card border-red-900 p-4 text-sm text-red-300">
          Gagal ambil data: {issuesRes.error.message}. Cek apakah schema.sql sudah dijalankan di Supabase.
        </div>
      )}

      <div>
        <h1 className="page-title">Dashboard Hot Issues</h1>
        <p className="page-sub">Pantau issue clipper yang lagi ramai, siapa yang pegang, dan kontak yang dilaporkan berulang.</p>
      </div>

      <DashTabProvider>
      <TopTabs
        vr={vrRows}
        agent={agentRows}
        range={range}
        vrMore={`/video-review?tab=report&view=compare`}
        agentMore="/?status=all"
      />

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <StatCard key={s.label} label={s.label} value={s.value} unit="issue" tone={s.tone} icon={s.icon} href={s.href} footer={s.footer} />
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <section className="space-y-3">
          <TabOnly when="vr">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold">Ranking kasus Video Review · 7 hari terakhir</h2>
              <Link href="/video-review?tab=report&view=compare" className="text-xs text-orange-400 hover:underline">Lihat report →</Link>
            </div>
            {vrAll.length === 0 ? (
              <div className="card p-8 text-center text-sm text-zinc-400">Belum ada kasus Video Review dalam 7 hari terakhir.</div>
            ) : (
              <LoadMoreList panel header="Kategori dengan kasus terbanyak di atas · klik untuk lihat daftarnya">
                {vrAll.map((t, idx) => {
                  const diff = t.count - t.prev;
                  const segs = vrSegments(t).filter((x) => x.count > 0);
                  return (
                    <li key={t.category}>
                      <Link
                        href={`/video-review?tab=daftar&category=${encodeURIComponent(t.category)}&from=${weekFrom}&to=${today}`}
                        className="flex items-center gap-4 px-5 py-4 transition hover:bg-zinc-800/40"
                      >
                        <RankBadge rank={idx + 1} />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">{t.category}</div>
                          <div className="mt-2 flex h-1.5 max-w-sm overflow-hidden rounded-full bg-zinc-800">
                            {segs.map((x) => (
                              <span key={x.key} className={x.bar} style={{ width: `${(x.count / Math.max(1, t.count)) * 100}%` }} />
                            ))}
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11.5px] text-zinc-500">
                            {segs.map((x) => (
                              <span key={x.key}><b className="font-semibold text-zinc-300">{x.count}</b> {x.label}</span>
                            ))}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="font-display text-[20px] font-bold tabular-nums">
                            {t.count} <span className="text-[12px] font-medium text-zinc-500">kasus</span>
                          </div>
                          <div className={`text-[12px] font-semibold ${diff > 0 ? "text-red-400" : diff < 0 ? "text-emerald-500" : "text-zinc-500"}`}>
                            {diff > 0 ? `▲ ${diff}` : diff < 0 ? `▼ ${-diff}` : "="} vs minggu lalu
                          </div>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </LoadMoreList>
            )}
          </TabOnly>

          <TabOnly when="agent">
          <form className="card grid gap-2 p-3 sm:grid-cols-6">
            <input
              name="q"
              defaultValue={sp.q ?? ""}
              placeholder="Cari judul, campaign, no HP, IG, discord, email..."
              className="input sm:col-span-6"
            />
            <select name="status" defaultValue={status} className="input sm:col-span-2">
              <option value="all">Semua status (aktif di atas)</option>
              <option value="active">Aktif saja (Open + In Progress)</option>
              {Object.entries(STATUSES).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            <select name="category" defaultValue={sp.category ?? ""} className="input sm:col-span-2">
              <option value="">Semua kategori</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select name="priority" defaultValue={sp.priority ?? ""} className="input sm:col-span-2">
              <option value="">Semua prioritas</option>
              {Object.entries(PRIORITIES).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-zinc-300 sm:col-span-2">
              <input type="checkbox" name="hot" value="1" defaultChecked={sp.hot === "1"} className="accent-orange-500" />
              Hanya HOT
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-300 sm:col-span-2">
              <input type="checkbox" name="mine" value="1" defaultChecked={sp.mine === "1"} className="accent-orange-500" />
              PIC saya
            </label>
            <div className="flex gap-2 sm:col-span-2 sm:justify-end">
              <Link href="/" className="btn-ghost">Reset</Link>
              <button className="btn-primary">Filter</button>
            </div>
          </form>

          {issues.length === 0 ? (
            <div className="card p-8 text-center text-sm text-zinc-400">
              Belum ada issue di filter ini.{" "}
              <Link href="/issues/new" className="text-orange-400 hover:underline">Buat issue baru</Link>
            </div>
          ) : (
            <LoadMoreList
              panel
              header={`${issues.length} issue · paling HOT & paling banyak laporan di atas${status === "all" ? " · yang sudah resolved tetap ikut ranking di bawah" : ""}`}
            >
              {issues.map((i, idx) => (
                <li key={i.id}>
                  <Link
                    href={`/issues/${i.id}`}
                    className={`block px-5 py-4 transition hover:bg-zinc-800/40 ${i.status === "resolved" ? "opacity-70 hover:opacity-100" : ""}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <RankBadge rank={idx + 1} />
                      {i.status !== "resolved" && <HotBadge manual={i.is_hot} auto={isAutoHot(i)} />}
                      <StatusBadge status={i.status} />
                      <PriorityBadge priority={i.priority} />
                      <span className="badge bg-zinc-800 text-zinc-300 ring-zinc-700">{i.category}</span>
                      {(i.report_count ?? 1) > 1 && (
                        <span className={`badge ${(i.report_count ?? 1) >= REPORT_HOT_THRESHOLD ? "bg-red-500/10 text-red-400 ring-red-500/30" : "bg-amber-500/10 text-amber-400 ring-amber-500/30"}`}>
                          📣 {i.report_count} laporan
                        </span>
                      )}
                      {i.campaign && <span className="text-xs text-zinc-400">· {i.campaign}</span>}
                      {i.status === "resolved" && i.resolved_at && (
                        <span className="text-xs text-emerald-500">✓ selesai {timeAgo(i.resolved_at)}</span>
                      )}
                    </div>
                    <div className="mt-2 font-medium">{i.title}</div>
                    {i.contacts.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {i.contacts.map((c) => (
                          <span key={c.id} className="inline-flex items-center gap-1 rounded-md bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300">
                            <span className="font-semibold text-zinc-500">{CONTACT_TYPES[c.type].short}</span>
                            {displayContact(c.type, c.normalized_value)}
                            {c.issue_count_30d > 1 && (
                              <span className={c.issue_count_30d >= HOT_THRESHOLD ? "font-semibold text-red-300" : ""}>
                                ×{c.issue_count_30d}
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="mt-2 text-xs text-zinc-500">
                      PIC: {i.pic_name ?? "-"} · update {timeAgo(i.updated_at)} oleh {i.updated_by_name ?? "-"}
                    </div>
                  </Link>
                </li>
              ))}
            </LoadMoreList>
          )}
          </TabOnly>
        </section>

        <aside className="space-y-3">
          <div className="card p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">🔥 Kontak lagi hot</h2>
              <Link href="/contacts" className="text-xs text-orange-400 hover:underline">Lihat semua</Link>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              Dilaporkan di ≥{HOT_THRESHOLD} issue dalam 30 hari terakhir.
            </p>
            {hotContacts.length === 0 ? (
              <p className="mt-4 text-sm text-zinc-400">Belum ada kontak berulang.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {hotContacts.map((c) => (
                  <li key={`${c.type}:${c.normalized_value}`} className="flex items-center justify-between gap-2">
                    <ContactChip type={c.type} normalized={c.normalized_value} />
                    <span className="shrink-0 text-xs text-zinc-400">
                      <span className="font-semibold text-red-300">{c.issue_count_30d}×</span> · {c.open_issue_count} aktif
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
      </DashTabProvider>
    </div>
  );
}
