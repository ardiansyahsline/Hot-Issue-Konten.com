import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { CATEGORIES, HOT_THRESHOLD, PRIORITIES, STATUSES } from "@/lib/constants";
import type { ContactStat, IssueRow } from "@/lib/types";
import { cleanSearch, isAutoHot, isHot, timeAgo } from "@/lib/utils";
import { HotBadge, PriorityBadge, StatusBadge } from "@/components/Badges";
import ContactChip from "@/components/ContactChip";
import { CONTACT_TYPES, displayContact } from "@/lib/contacts";

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
const HOT_OR = `is_hot.eq.true,max_contact_reports_30d.gte.${HOT_THRESHOLD}`;

type SP = Promise<Record<string, string | undefined>>;

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

  const active = () => supabase.from("issue_list").select("id", { count: "exact", head: true }).neq("status", "resolved");
  // jam 00:00 WIB hari ini, dalam UTC
  const jkt = new Date(Date.now() + 7 * 3600 * 1000);
  const todayStartWib = new Date(
    Date.UTC(jkt.getUTCFullYear(), jkt.getUTCMonth(), jkt.getUTCDate()) - 7 * 3600 * 1000
  ).toISOString();

  const [issuesRes, openC, progC, urgentC, hotC, resolvedTodayC, hotContactsRes] = await Promise.all([
    query,
    supabase.from("issues").select("id", { count: "exact", head: true }).eq("status", "open"),
    supabase.from("issues").select("id", { count: "exact", head: true }).eq("status", "in_progress"),
    active().eq("priority", "urgent"),
    active().or(HOT_OR),
    supabase
      .from("issues")
      .select("id", { count: "exact", head: true })
      .eq("status", "resolved")
      .gte("resolved_at", todayStartWib),
    supabase
      .from("contact_stats")
      .select("*")
      .gte("issue_count_30d", HOT_THRESHOLD)
      .order("issue_count_30d", { ascending: false })
      .order("last_seen", { ascending: false })
      .limit(10),
  ]);

  const issues = ((issuesRes.data ?? []) as IssueRow[]).sort((a, b) => {
    const h = Number(isHot(b)) - Number(isHot(a));
    if (h) return h;
    const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (p) return p;
    return b.updated_at.localeCompare(a.updated_at);
  });
  const hotContacts = (hotContactsRes.data ?? []) as ContactStat[];

  const stats = [
    { label: "🔥 Hot aktif", value: hotC.count ?? 0, href: "/?hot=1", cls: "text-red-300" },
    { label: "Urgent aktif", value: urgentC.count ?? 0, href: "/?priority=urgent", cls: "text-orange-300" },
    { label: "Open", value: openC.count ?? 0, href: "/?status=open", cls: "text-sky-300" },
    { label: "In Progress", value: progC.count ?? 0, href: "/?status=in_progress", cls: "text-amber-300" },
    { label: "Resolved hari ini", value: resolvedTodayC.count ?? 0, href: "/?status=resolved", cls: "text-emerald-300" },
  ];

  return (
    <div className="space-y-6">
      {issuesRes.error && (
        <div className="card border-red-900 p-4 text-sm text-red-300">
          Gagal ambil data: {issuesRes.error.message}. Cek apakah schema.sql sudah dijalankan di Supabase.
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="card p-4 hover:border-zinc-600">
            <div className="text-xs text-zinc-400">{s.label}</div>
            <div className={`mt-1 text-2xl font-semibold ${s.cls}`}>{s.value}</div>
          </Link>
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
                    className={`card block p-4 hover:border-zinc-600 ${
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
              <Link href="/contacts" className="text-xs text-orange-400 hover:underline">Cek kontak</Link>
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
