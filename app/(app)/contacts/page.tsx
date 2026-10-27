import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { HOT_THRESHOLD } from "@/lib/constants";
import { CONTACT_TYPES, contactLink, displayContact, isContactType, normalizeContact, type ContactType } from "@/lib/contacts";
import type { ContactStat, IssueRow, VideoReviewRow } from "@/lib/types";
import { VrLinks, VrStatusBadge } from "@/components/VrBits";
import { cleanSearch, fmtDate, isAutoHot, timeAgo } from "@/lib/utils";
import { HotBadge, PriorityBadge, StatusBadge } from "@/components/Badges";
import ContactChip from "@/components/ContactChip";
import { startTab } from "@/lib/tabs.server";

type SP = Promise<Record<string, string | undefined>>;

export default async function ContactsPage({ searchParams }: { searchParams: SP }) {
  // cek tab dashboard bareng query di bawah (tidak menambah satu putaran ke Supabase)
  const gate = startTab("dashboard");
  const sp = await searchParams;
  const { supabase } = await getCurrentUser();
  const q = (sp.q ?? "").trim();
  const typeParam = sp.type && isContactType(sp.type) ? sp.type : "";

  let matches: ContactStat[] = [];
  let partial = false;

  if (q) {
    const types: ContactType[] = typeParam ? [typeParam] : (Object.keys(CONTACT_TYPES) as ContactType[]);
    const pairs = types
      .map((t) => ({ t, n: normalizeContact(t, q) }))
      .filter((p) => p.n && !/[,()"\\]/.test(p.n));

    if (pairs.length) {
      const { data } = await supabase
        .from("contact_stats")
        .select("*")
        .or(pairs.map((p) => `and(type.eq.${p.t},normalized_value.eq."${p.n}")`).join(","));
      matches = (data ?? []) as ContactStat[];
    }

    // Tidak ada yang persis sama → cari yang mirip (sebagian)
    const term = cleanSearch(q).toLowerCase().replace(/^@/, "").replace(/^0/, "");
    if (matches.length === 0 && term.length >= 4) {
      let pq = supabase.from("contact_stats").select("*").ilike("normalized_value", `%${term}%`).limit(30);
      if (typeParam) pq = pq.eq("type", typeParam);
      const { data } = await pq;
      matches = (data ?? []) as ContactStat[];
      partial = matches.length > 0;
    }
  }

  // Issue yang terkait dengan kontak yang ketemu
  let issuesByContact: Record<string, IssueRow[]> = {};
  if (matches.length && matches.length <= 10) {
    const { data: links } = await supabase
      .from("issue_contacts")
      .select("issue_id, type, normalized_value")
      .or(matches.map((m) => `and(type.eq.${m.type},normalized_value.eq."${m.normalized_value}")`).join(","));
    const ids = [...new Set((links ?? []).map((l) => l.issue_id))];
    if (ids.length) {
      const { data: issues } = await supabase
        .from("issue_list")
        .select("*")
        .in("id", ids)
        .order("created_at", { ascending: false });
      const byId = new Map((issues as IssueRow[] | null ?? []).map((i) => [i.id, i]));
      issuesByContact = {};
      for (const l of links ?? []) {
        const k = `${l.type}:${l.normalized_value}`;
        const issue = byId.get(l.issue_id);
        if (issue) (issuesByContact[k] ??= []).push(issue);
      }
    }
  }

  // Kasus Video Review yang email/link-nya mengandung kata yang dicari
  let vrCases: VideoReviewRow[] = [];
  const vrTerm = cleanSearch(q).toLowerCase().replace(/^@/, "");
  // tab Video Review ditutup admin -> kasus Video Review tidak ikut dicari
  if (vrTerm.length >= 4 && !(await gate).blocked.has("video_review")) {
    const { data: vrLinks } = await supabase
      .from("video_review_links")
      .select("review_id")
      .ilike("normalized", `%${vrTerm}%`)
      .limit(100);
    const ids = [...new Set((vrLinks ?? []).map((l) => l.review_id as number))];
    if (ids.length) {
      const { data } = await supabase
        .from("video_review_list")
        .select("*")
        .in("id", ids)
        .order("report_date", { ascending: false });
      vrCases = (data ?? []) as VideoReviewRow[];
    }
  }

  // Tanpa pencarian: tampilkan semua kontak hot
  const [, { data: hotData }] = await Promise.all([
    gate,
    q
      ? { data: null }
      : supabase
          .from("contact_stats")
          .select("*")
          .gte("issue_count_30d", HOT_THRESHOLD)
          .order("issue_count_30d", { ascending: false })
          .order("last_seen", { ascending: false })
          .limit(100),
  ]);
  const hot = (hotData ?? []) as ContactStat[];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Cek kontak clipper</h1>
        <p className="text-sm text-zinc-400">
          Masukkan no HP, IG, Discord, atau email untuk lihat apakah clipper ini sudah pernah dilaporkan.
        </p>
      </div>

      <form className="card flex flex-wrap gap-2 p-3">
        <select name="type" defaultValue={typeParam} className="input w-44">
          <option value="">Semua tipe</option>
          {Object.entries(CONTACT_TYPES).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <input name="q" defaultValue={q} autoFocus placeholder="0812xxxx / @username / email" className="input min-w-0 flex-1" />
        <button className="btn-primary">Cek</button>
      </form>

      {q && matches.length === 0 && (
        <div className="card p-6 text-center text-sm text-zinc-400">
          ✅ Kontak <span className="text-zinc-200">{q}</span> belum pernah dilaporkan di Hot Issues.
        </div>
      )}

      {vrCases.length > 0 && (
        <section className="card p-5">
          <h2 className="font-semibold">🎬 Muncul di {vrCases.length} kasus Video Review</h2>
          <ul className="mt-3 space-y-2">
            {vrCases.map((v) => (
              <li key={v.id} className="rounded-lg bg-zinc-950/60 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-zinc-500">#{v.id}</span>
                    <VrStatusBadge status={v.status} />
                    <span className="text-xs text-zinc-400">{v.category ?? "Belum dikategorikan"}</span>
                    <span className="ml-auto text-xs text-zinc-500">{v.report_date}</span>
                  </div>
                  <Link href={`/video-review/${v.id}`} className="mt-1 block text-sm hover:underline">{v.explanation}</Link>
                  {v.resolution && <div className="mt-1 text-xs text-zinc-400">{v.resolution}</div>}
                  <div className="mt-2"><VrLinks links={v.links} max={3} /></div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {partial && <p className="text-xs text-amber-300">Tidak ada yang persis sama — ini kontak yang mirip:</p>}

      {matches.length > 10 && (
        <ul className="card divide-y divide-zinc-800">
          {matches.map((m) => (
            <li key={`${m.type}:${m.normalized_value}`} className="flex items-center justify-between p-3 text-sm">
              <ContactChip type={m.type} normalized={m.normalized_value} count30d={m.issue_count_30d} />
              <span className="text-xs text-zinc-400">{m.issue_count} issue</span>
            </li>
          ))}
        </ul>
      )}

      {matches.length > 0 && matches.length <= 10 &&
        matches.map((m) => {
          const k = `${m.type}:${m.normalized_value}`;
          const hotC = m.issue_count_30d >= HOT_THRESHOLD;
          const link = contactLink(m.type, m.normalized_value);
          return (
            <section key={k} className={`card p-5 ${hotC ? "border-red-900/70" : ""}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs text-zinc-500">{CONTACT_TYPES[m.type].label}</div>
                  <div className="text-lg font-semibold">
                    {hotC && "🔥 "}
                    {link ? (
                      <a href={link} target="_blank" rel="noreferrer" className="hover:underline">
                        {displayContact(m.type, m.normalized_value)}
                      </a>
                    ) : (
                      displayContact(m.type, m.normalized_value)
                    )}
                  </div>
                </div>
                <div className="flex gap-4 text-center text-sm">
                  <div><div className="text-xl font-semibold">{m.issue_count}</div><div className="text-xs text-zinc-500">total issue</div></div>
                  <div><div className={`text-xl font-semibold ${hotC ? "text-red-300" : ""}`}>{m.issue_count_30d}</div><div className="text-xs text-zinc-500">30 hari</div></div>
                  <div><div className="text-xl font-semibold">{m.open_issue_count}</div><div className="text-xs text-zinc-500">masih aktif</div></div>
                </div>
              </div>
              <ul className="mt-4 space-y-2">
                {(issuesByContact[k] ?? []).map((i) => (
                  <li key={i.id}>
                    <Link href={`/issues/${i.id}`} className="block rounded-lg bg-zinc-950/60 p-3 hover:bg-zinc-800/60">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-zinc-500">#{i.id}</span>
                        {i.status !== "resolved" && <HotBadge manual={i.is_hot} auto={isAutoHot(i)} />}
                        <StatusBadge status={i.status} />
                        <PriorityBadge priority={i.priority} />
                        <span className="text-xs text-zinc-400">{i.category}</span>
                        <span className="ml-auto text-xs text-zinc-500">{fmtDate(i.created_at)}</span>
                      </div>
                      <div className="mt-1 text-sm">{i.title}</div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

      {!q && (
        <section className="card p-5">
          <h2 className="font-semibold">🔥 Semua kontak hot (≥{HOT_THRESHOLD} issue / 30 hari)</h2>
          {hot.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-400">Belum ada.</p>
          ) : (
            <table className="mt-3 w-full text-sm">
              <thead className="text-left text-xs text-zinc-500">
                <tr>
                  <th className="py-2 font-medium">Kontak</th>
                  <th className="py-2 font-medium">30 hari</th>
                  <th className="py-2 font-medium">Total</th>
                  <th className="py-2 font-medium">Aktif</th>
                  <th className="py-2 font-medium">Terakhir</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {hot.map((c) => (
                  <tr key={`${c.type}:${c.normalized_value}`}>
                    <td className="py-2"><ContactChip type={c.type} normalized={c.normalized_value} /></td>
                    <td className="py-2 font-semibold text-red-300">{c.issue_count_30d}</td>
                    <td className="py-2">{c.issue_count}</td>
                    <td className="py-2">{c.open_issue_count}</td>
                    <td className="py-2 text-zinc-400">{timeAgo(c.last_seen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
