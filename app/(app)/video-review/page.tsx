import Link from "next/link";
import { getCurrentUser, getProfile } from "@/lib/auth";
import { canWriteReviews } from "@/lib/roles";
import { VR_CATEGORIES, VR_STATUSES, type VrStatus } from "@/lib/videoReview";
import type { VideoReviewRow } from "@/lib/types";
import { cleanSearch, fmtDay } from "@/lib/utils";
import { VrLinks, VrStatusBadge } from "@/components/VrBits";
import VrCategorySelect from "@/components/VrCategorySelect";

type SP = Promise<Record<string, string | undefined>>;
const NONE = "__none";
const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export default async function VideoReviewPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const [{ supabase }, profile] = await Promise.all([getCurrentUser(), getProfile()]);
  const canWrite = canWriteReviews(profile?.role);

  const from = isDate(sp.from) ? sp.from! : null;
  const to = isDate(sp.to) ? sp.to! : null;
  const q = cleanSearch(sp.q ?? "");

  let query = supabase
    .from("video_review_list")
    .select("*", { count: "exact" })
    .order("report_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(300);
  if (from) query = query.gte("report_date", from);
  if (to) query = query.lte("report_date", to);
  if (sp.category === NONE) query = query.is("category", null);
  else if (sp.category) query = query.eq("category", sp.category);
  if (sp.status) query = query.eq("status", sp.status);
  if (q) {
    query = query.or(
      ["explanation", "resolution", "insight", "clipper_argument", "links_text"]
        .map((c) => `${c}.ilike."*${c === "links_text" ? q.toLowerCase() : q}*"`)
        .join(",")
    );
  }

  const [listRes, sumRes] = await Promise.all([
    query,
    supabase.rpc("video_review_summary", { p_from: from, p_to: to }),
  ]);
  const rows = (listRes.data ?? []) as VideoReviewRow[];
  const summary = (sumRes.data ?? []) as { category: string | null; status: VrStatus; total: number }[];

  // susun rekap per kategori
  const statusKeys = Object.keys(VR_STATUSES) as VrStatus[];
  const cats = [...VR_CATEGORIES.map((c) => c as string | null), null];
  for (const s of summary) if (s.category && !cats.includes(s.category)) cats.splice(cats.length - 1, 0, s.category);
  const rekap = cats
    .map((c) => {
      const byStatus = Object.fromEntries(statusKeys.map((k) => [k, 0])) as Record<VrStatus, number>;
      for (const s of summary) if (s.category === c) byStatus[s.status] = (byStatus[s.status] ?? 0) + s.total;
      return { category: c, byStatus, total: statusKeys.reduce((a, k) => a + byStatus[k], 0) };
    })
    .filter((r) => r.total > 0 || r.category !== null);
  const grand = rekap.reduce((a, r) => a + r.total, 0);

  const filterHref = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { q: sp.q, from: sp.from, to: sp.to, category: sp.category, status: sp.status, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return `/video-review${s ? `?${s}` : ""}`;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Video Review</h1>
          <p className="text-sm text-zinc-400">Kasus review video dari WA / Discord: banding, rilis, saldo dibekukan, kesesuaian brief, dll.</p>
        </div>
        {canWrite && (
          <div className="flex gap-2">
            <Link href="/video-review/import" className="btn-ghost">Import dari Sheet</Link>
            <Link href="/video-review/new" className="btn-primary">+ Kasus baru</Link>
          </div>
        )}
      </div>

      {listRes.error && (
        <div className="card border-red-900 p-4 text-sm text-red-300">
          Gagal ambil data: {listRes.error.message}. Pastikan <b>migration-02-roles-video-review.sql</b> sudah dijalankan di Supabase.
        </div>
      )}

      <section className="card overflow-x-auto">
        <div className="flex items-center justify-between p-4 pb-2">
          <h2 className="font-semibold">Rekap per kategori</h2>
          <span className="text-xs text-zinc-500">
            {from || to ? `${from ? fmtDay(from) : "awal"} – ${to ? fmtDay(to) : "sekarang"}` : "Semua tanggal"} · total {grand}
          </span>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-zinc-500">
            <tr className="border-b border-zinc-800">
              <th className="p-3 font-medium">Kategori</th>
              <th className="p-3 text-right font-medium">Total</th>
              {statusKeys.map((k) => (
                <th key={k} className="p-3 text-right font-medium">{VR_STATUSES[k].label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {rekap.map((r) => (
              <tr key={r.category ?? NONE} className={r.total === 0 ? "text-zinc-600" : ""}>
                <td className="p-3">
                  <Link href={filterHref({ category: r.category ?? NONE, status: undefined })} className="hover:underline">
                    {r.category ?? <span className="text-amber-300">Belum dikategorikan</span>}
                  </Link>
                </td>
                <td className="p-3 text-right font-semibold">{r.total}</td>
                {statusKeys.map((k) => (
                  <td key={k} className="p-3 text-right">
                    {r.byStatus[k] ? (
                      <Link href={filterHref({ category: r.category ?? NONE, status: k })} className="hover:underline">
                        {r.byStatus[k]}
                      </Link>
                    ) : (
                      <span className="text-zinc-600">0</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <form className="card grid gap-2 p-3 sm:grid-cols-6">
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Cari penjelasan, email, link, insight..." className="input sm:col-span-6" />
        <select name="category" defaultValue={sp.category ?? ""} className="input sm:col-span-2">
          <option value="">Semua kategori</option>
          <option value={NONE}>Belum dikategorikan</option>
          {VR_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select name="status" defaultValue={sp.status ?? ""} className="input sm:col-span-2">
          <option value="">Semua status</option>
          {statusKeys.map((k) => (
            <option key={k} value={k}>{VR_STATUSES[k].label}</option>
          ))}
        </select>
        <div className="flex gap-2 sm:col-span-2">
          <input type="date" name="from" defaultValue={from ?? ""} className="input" aria-label="Dari tanggal" />
          <input type="date" name="to" defaultValue={to ?? ""} className="input" aria-label="Sampai tanggal" />
        </div>
        <div className="flex justify-end gap-2 sm:col-span-6">
          <Link href="/video-review" className="btn-ghost">Reset</Link>
          <button className="btn-primary">Filter</button>
        </div>
      </form>

      <div className="text-xs text-zinc-500">
        {listRes.count ?? rows.length} kasus{(listRes.count ?? 0) > rows.length ? ` (menampilkan ${rows.length} terbaru)` : ""}
      </div>

      {rows.length === 0 ? (
        <div className="card p-8 text-center text-sm text-zinc-400">Belum ada kasus di filter ini.</div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-zinc-500">#{r.id}</span>
                <span className="text-xs text-zinc-400">{fmtDay(r.report_date)}</span>
                <VrStatusBadge status={r.status} />
                {canWrite ? (
                  <VrCategorySelect id={r.id} category={r.category} />
                ) : (
                  <span className="badge bg-zinc-800 text-zinc-300 ring-zinc-700">{r.category ?? "Belum dikategorikan"}</span>
                )}
                <Link href={`/video-review/${r.id}`} className="ml-auto text-xs text-orange-400 hover:underline">
                  Detail →
                </Link>
              </div>
              <Link href={`/video-review/${r.id}`} className="mt-2 block font-medium hover:underline">
                {r.explanation}
              </Link>
              {r.links.length > 0 && (
                <div className="mt-2">
                  <VrLinks links={r.links} max={4} />
                </div>
              )}
              <dl className="mt-2 grid gap-1 text-xs sm:grid-cols-[110px_1fr]">
                {r.resolution && (
                  <>
                    <dt className="text-zinc-500">Penyelesaian</dt>
                    <dd className="whitespace-pre-wrap text-zinc-300">{r.resolution}</dd>
                  </>
                )}
                {r.insight && (
                  <>
                    <dt className="text-zinc-500">Insight</dt>
                    <dd className="line-clamp-2 whitespace-pre-wrap text-zinc-400">{r.insight}</dd>
                  </>
                )}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
