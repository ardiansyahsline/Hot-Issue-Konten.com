import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { CATEGORIES, HOT_THRESHOLD, PRIORITIES, STATUSES } from "@/lib/constants";
import type { ContactStat, IssueRow } from "@/lib/types";
import { cleanSearch, isAutoHot, isHot, timeAgo } from "@/lib/utils";
import { HotBadge, PriorityBadge, StatusBadge } from "@/components/Badges";
import ContactChip from "@/components/ContactChip";
import StatCard from "@/components/StatCard";
import { topIssues, vrSegments } from "@/components/TopIssues";
import HotTop, { type HotRow } from "@/components/HotTop";
import { buildRangkuman, type VrSummaryRow } from "@/lib/videoReview";
import { agentRangkuman, topAgentIssues, type AgentIssueRow } from "@/lib/agentTop";
import { CONTACT_TYPES, displayContact } from "@/lib/contacts";

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
const HOT_OR = `is_hot.eq.true,max_contact_reports_30d.gte.${HOT_THRESHOLD}`;

type SP = Promise<Record<string, string | undefined>>;
type Counts = { open: number; in_progress: number; urgent: number; hot: number; resolved_today: number };

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export default async function Dashboard({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { supabase, user } = await getCurrentUser();

  const status = sp.status ?? "active";
  const q = cleanSearch(sp.q ?? "");

  let query = supabase.from("issue_list").select("*").order("updated_at", { ascending: false }).limit(300);
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
    const { data, error } = await supabase.rpc("dashboard_counts", { p_hot_threshold: HOT_THRESHOLD, p_today_start: todayStartWib });
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

  const [issuesRes, counts, hotContactsRes, vrRes, agentRes] = await Promise.all([
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
      .select("category, status, is_hot, max_contact_reports_30d, pic_name, created_at")
      .gte("created_at", prevFromIso)
      .limit(5000),
  ]);
  const top = topIssues((vrRes.data ?? []) as VrSummaryRow[], weekFrom, prevFrom);
  const agentTop = topAgentIssues((agentRes.data ?? []) as AgentIssueRow[], weekFrom, prevFrom);
  const vrRows: HotRow[] = top.map((t) => ({
    title: t.category,
    count: t.count,
    diff: t.count - t.prev,
    href: `/video-review?tab=daftar&category=${encodeURIComponent(t.category)}&from=${weekFrom}&to=${today}`,
    segments: vrSegments(t),
  }));
  const agentRows: HotRow[] = agentTop.map((t) => ({
    title: t.category,
    count: t.count,
    diff: t.count - t.prev,
    href: `/?status=all&category=${encodeURIComponent(t.category)}`,
    segments: [
      { key: "open", label: "open", bar: "bg-sky-400", count: t.rows.filter((r) => r.status === "open").length },
      { key: "in_progress", label: "in progress", bar: "bg-amber-400", count: t.rows.filter((r) => r.status === "in_progress").length },
      { key: "resolved", label: "resolved", bar: "bg-emerald-500", count: t.rows.filter((r) => r.status === "resolved").length },
    ],
  }));
  const BLN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  const dd = (d: string) => `${Number(d.slice(8))} ${BLN[Number(d.slice(5, 7)) - 1]}`;
  const range = `${dd(weekFrom)} – ${dd(today)} ${today.slice(0, 4)}`;

  const issues = ((issuesRes.data ?? []) as IssueRow[]).sort((a, b) => {
    const h = Number(isHot(b)) - Number(isHot(a));
    if (h) return h;
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
    { label: "Resolved hari ini", value: counts.resolved_today, href: "/?status=resolved", tone: "emerald", icon: "check", footer: "diselesaikan hari ini" },
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

      <div className="grid gap-5 lg:grid-cols-2">
        <HotTop
          title="Top 3 Video Review"
          sub={`7 hari terakhir · ${range}`}
          rows={vrRows}
          unit="kasus"
          summary={top[0] ? buildRangkuman(top[0].rows) : ""}
          moreHref={`/video-review?tab=rekap&from=${weekFrom}&to=${today}`}
          empty="Belum ada kasus Video Review dalam 7 hari terakhir."
        />
        <HotTop
          title="Top 3 dari agent"
          sub={`Hot Issue per kategori · ${range}`}
          rows={agentRows}
          unit="issue"
          summary={agentTop[0] ? agentRangkuman(agentTop[0], HOT_THRESHOLD) : ""}
          moreHref="/?status=all"
          empty="Belum ada Hot Issue baru dalam 7 hari terakhir."
        />
      </div>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <StatCard key={s.label} label={s.label} value={s.value} unit="issue" tone={s.tone} icon={s.icon} href={s.href} footer={s.footer} />
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <section className="space-y-3">
          <form className="card grid gap-2 p-3 sm:grid-cols-6">
            <input
              name="q"
              defaultValue={sp.q ?? ""}
              placeholder="Cari judul, campaign, no HP, IG, discord, email..."
              className="input sm:col-span-6"
            />
            <select name="status" defaultValue={status} className="input sm:col-span-2">
              <option value="active">Aktif (Open + In Progress)</option>
              <option value="all">Semua status</option>
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

          <div className="text-xs text-zinc-500">{issues.length} issue</div>

          {issues.length === 0 ? (
            <div className="card p-8 text-center text-sm text-zinc-400">
              Belum ada issue di filter ini.{" "}
              <Link href="/issues/new" className="text-orange-400 hover:underline">Buat issue baru</Link>
            </div>
          ) : (
            <ul className="space-y-2">
              {issues.map((i) => (
                <li key={i.id}>
                  <Link
                    href={`/issues/${i.id}`}
                    className={`card card-flat card-hover block p-5 ${
                      isHot(i) ? "border-red-900/70 bg-red-950/20" : ""
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-zinc-500">#{i.id}</span>
                      {i.status !== "resolved" && <HotBadge manual={i.is_hot} auto={isAutoHot(i)} />}
                      <StatusBadge status={i.status} />
                      <PriorityBadge priority={i.priority} />
                      <span className="badge bg-zinc-800 text-zinc-300 ring-zinc-700">{i.category}</span>
                      {i.campaign && <span className="text-xs text-zinc-400">· {i.campaign}</span>}
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
            </ul>
          )}
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
    </div>
  );
}
