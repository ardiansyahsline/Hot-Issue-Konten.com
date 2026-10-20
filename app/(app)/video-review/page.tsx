import Link from "next/link";
import { getCurrentUser, getProfile } from "@/lib/auth";
import { canWriteReviews } from "@/lib/roles";
import { VR_CATEGORIES, VR_STATUSES, buildRangkuman, type VrStatus, type VrSummaryRow } from "@/lib/videoReview";
import type { VideoReviewRow } from "@/lib/types";
import { cleanSearch, fmtDay } from "@/lib/utils";
import { VrLinks, VrStatusBadge } from "@/components/VrBits";
import VrCategorySelect from "@/components/VrCategorySelect";
import { AutoCategorizeButton, CategoryNote } from "@/components/VrRekapTools";

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

  // semua kasus di rentang tanggal (untuk rekap & rangkuman), diambil per 1000 baris
  async function fetchSummaryRows() {
    const out: VrSummaryRow[] = [];
    for (let page = 0; page < 50; page++) {
      let sq = supabase
        .from("video_reviews")
        .select("category, status, resolution, report_date")
        .order("id")
        .range(page * 1000, page * 1000 + 999);
      if (from) sq = sq.gte("report_date", from);
      if (to) sq = sq.lte("report_date", to);
      const { data } = await sq;
      out.push(...((data ?? []) as VrSummaryRow[]));
      if (!data || data.length < 1000) break;
    }
    return out;
  }

  const [listRes, summary, notesRes] = await Promise.all([
    query,
    fetchSummaryRows(),
    supabase.from("video_review_category_notes").select("category, note"),
  ]);
  const rows = (listRes.data ?? []) as VideoReviewRow[];
  const notes = new Map((notesRes.data ?? []).map((n) => [n.category as string, n.note as string]));

  // susun rekap per kategori
  const statusKeys = Object.keys(VR_STATUSES) as VrStatus[];
  const cats = [...VR_CATEGORIES.map((c) => c as string | null), null];
  for (const s of summary) if (s.category && !cats.includes(s.category)) cats.splice(cats.length - 1, 0, s.category);
  const rekap = cats
    .map((c) => {
      const items = summary.filter((s) => s.category === c);
      const byStatus = Object.fromEntries(statusKeys.map((k) => [k, items.filter((i) => i.status === k).length])) as Record<VrStatus, number>;
      return { category: c, byStatus, total: items.length, rangkuman: buildRangkuman(items) };
    })
    .filter((r) => r.total > 0 || r.category !== null)
    .sort((a, b) => b.total - a.total);
  const grand = summary.length;
  const uncategorized = summary.filter((s) => !s.category).length;

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

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Rekap & rangkuman per kategori</h2>
          <div className="flex flex-wrap items-center gap-3">
            {canWrite && uncategorized > 0 && <AutoCategorizeButton count={uncategorized} />}
            <span className="text-xs text-zinc-500">
              {from || to ? `${from ? fmtDay(from) : "awal"} – ${to ? fmtDay(to) : "sekarang"}` : "Semua tanggal"} · total {grand} kasus
            </span>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {rekap.map((r) => (
            <div key={r.category ?? NONE} className={`card space-y-2 p-4 ${r.total === 0 ? "opacity-50" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <Link href={filterHref({ category: r.category ?? NONE, status: undefined })} className="font-medium hover:underline">
                  {r.category ?? <span className="text-amber-300">Belum dikategorikan</span>}
                </Link>
                <span className="text-2xl font-semibold leading-none">{r.total}</span>
              </div>
              {r.total > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {statusKeys
                    .filter((k) => r.byStatus[k] > 0)
                    .map((k) => (
                      <Link
                        key={k}
                        href={filterHref({ category: r.category ?? NONE, status: k })}
                        className={`badge ${VR_STATUSES[k].cls} hover:brightness-125`}
                      >
                        {VR_STATUSES[k].label} {r.byStatus[k]}
                      </Link>
                    ))}
                </div>
              )}
              {r.rangkuman && <p className="text-xs leading-relaxed text-zinc-400">{r.rangkuman}</p>}
              {r.category && (
                <CategoryNote category={r.category} note={notes.get(r.category) ?? ""} canWrite={canWrite} />
              )}
            </div>
          ))}
        </div>
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
