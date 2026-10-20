import Link from "next/link";
import { getCurrentUser, getProfile } from "@/lib/auth";
import { canWriteReviews } from "@/lib/roles";
import {
  VR_CATEGORIES,
  VR_STATUSES,
  buildRangkuman,
  ddmmyy,
  type VrStatus,
  type VrSummaryRow,
} from "@/lib/videoReview";
import type { VideoReviewRow } from "@/lib/types";
import { cleanSearch } from "@/lib/utils";
import { VrLinks, VrStatusBadge } from "@/components/VrBits";
import VrCategorySelect from "@/components/VrCategorySelect";
import VrStatusSelect from "@/components/VrStatusSelect";
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
  const sort = sp.sort === "asc" ? "asc" : "desc";

  let query = supabase
    .from("video_review_list")
    .select("*", { count: "exact" })
    .order("report_date", { ascending: sort === "asc" })
    .order("id", { ascending: sort === "asc" })
    .limit(500);
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

  // ---- rekap per kategori (seperti kolom Kategori / Jumlah Kasus / Rangkuman di sheet)
  const statusKeys = Object.keys(VR_STATUSES) as VrStatus[];
  const cats: (string | null)[] = [...VR_CATEGORIES];
  for (const s of summary) if (s.category && !cats.includes(s.category)) cats.push(s.category);
  if (summary.some((s) => !s.category)) cats.push(null);
  const rekap = cats.map((c) => {
    const items = summary.filter((s) => s.category === c);
    const byStatus = Object.fromEntries(statusKeys.map((k) => [k, items.filter((i) => i.status === k).length])) as Record<
      VrStatus,
      number
    >;
    return { category: c, byStatus, total: items.length, rangkuman: buildRangkuman(items) };
  });
  const grand = summary.length;
  const uncategorized = summary.filter((s) => !s.category).length;
  const allDates = summary.map((s) => s.report_date).sort();
  const totalByStatus = Object.fromEntries(statusKeys.map((k) => [k, summary.filter((s) => s.status === k).length])) as Record<
    VrStatus,
    number
  >;

  const filterHref = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { q: sp.q, from: sp.from, to: sp.to, category: sp.category, status: sp.status, sort: sp.sort, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return `/video-review${s ? `?${s}` : ""}`;
  };
  const activeCat = sp.category === NONE ? null : sp.category;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Video Review</h1>
          <p className="page-sub">Log kasus review video dari WA / Discord — format sama dengan sheet “Video Review WA”.</p>
        </div>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <Link href="/video-review/import" className="btn-ghost">↻ Sync / Import Sheet</Link>
            <Link href="/video-review/new" className="btn-primary">+ Kasus baru</Link>
          </div>
        )}
      </div>

      {listRes.error && (
        <div className="card border-red-500/40 p-4 text-sm text-red-300">
          Gagal ambil data: {listRes.error.message}. Pastikan file migration sudah dijalankan di Supabase.
        </div>
      )}

      {/* ---------------- REKAP: Kategori | Jumlah Kasus | Rangkuman ---------------- */}
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 px-5 py-4">
          <div>
            <h2 className="text-base font-bold tracking-tight">Rekap per kategori</h2>
            <p className="text-xs text-zinc-500">
              Dihitung otomatis dari data{from || to ? ` · ${from ? ddmmyy(from) : "awal"} – ${to ? ddmmyy(to) : "sekarang"}` : ""}. Klik kategori untuk filter tabel.
            </p>
          </div>
          {canWrite && uncategorized > 0 && <AutoCategorizeButton count={uncategorized} />}
        </div>
        <div className="overflow-x-auto">
          <table className="sheet min-w-[860px]">
            <thead>
              <tr>
                <th className="w-[260px]">Kategori</th>
                <th className="w-[110px] text-right">Jumlah Kasus</th>
                <th className="w-[230px]">Status</th>
                <th>Rangkuman</th>
              </tr>
            </thead>
            <tbody>
              {rekap.map((r) => (
                <tr key={r.category ?? NONE} className={r.total === 0 ? "opacity-50" : ""}>
                  <td className="font-semibold">
                    <Link
                      href={filterHref({ category: r.category ?? NONE, status: undefined })}
                      className={`hover:text-orange-400 ${activeCat === r.category && sp.category ? "text-orange-400" : ""}`}
                    >
                      {r.category ?? <span className="text-amber-300">Belum dikategorikan</span>}
                    </Link>
                  </td>
                  <td className="text-right text-base font-bold tabular-nums">{r.total}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {statusKeys
                        .filter((k) => r.byStatus[k] > 0)
                        .map((k) => (
                          <Link key={k} href={filterHref({ category: r.category ?? NONE, status: k })} className={`badge ${VR_STATUSES[k].cls}`}>
                            {VR_STATUSES[k].label} {r.byStatus[k]}
                          </Link>
                        ))}
                    </div>
                  </td>
                  <td className="space-y-1.5 text-zinc-300">
                    {r.rangkuman ? <p className="leading-relaxed">{r.rangkuman}</p> : <p className="text-zinc-500">Belum ada kasus.</p>}
                    {r.category && (r.total > 0 || notes.get(r.category)) && (
                      <CategoryNote category={r.category} note={notes.get(r.category) ?? ""} canWrite={canWrite} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-zinc-800/50 font-bold">
                <td className="border-r border-zinc-800 px-3 py-3 uppercase tracking-wider">Total</td>
                <td className="border-r border-zinc-800 px-3 py-3 text-right text-base tabular-nums">{grand}</td>
                <td className="border-r border-zinc-800 px-3 py-3">
                  <div className="flex flex-wrap gap-1">
                    {statusKeys
                      .filter((k) => totalByStatus[k] > 0)
                      .map((k) => (
                        <span key={k} className={`badge ${VR_STATUSES[k].cls}`}>{VR_STATUSES[k].label} {totalByStatus[k]}</span>
                      ))}
                  </div>
                </td>
                <td className="px-3 py-3 font-medium text-zinc-400">
                  {grand ? `Total baris kasus ${ddmmyy(allDates[0])} – ${ddmmyy(allDates[allDates.length - 1])}` : "-"}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* ---------------- TABEL KASUS (kolom sama dengan sheet) ---------------- */}
      <section className="card overflow-hidden">
        <form className="flex flex-wrap items-center gap-2 border-b border-zinc-800/80 p-4">
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Cari penjelasan, email, link, insight…" className="input w-full" />
          <select name="category" defaultValue={sp.category ?? ""} className="input w-auto">
            <option value="">Semua kategori</option>
            <option value={NONE}>Belum dikategorikan</option>
            {VR_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select name="status" defaultValue={sp.status ?? ""} className="input w-auto">
            <option value="">Semua status</option>
            {statusKeys.map((k) => (
              <option key={k} value={k}>{VR_STATUSES[k].label}</option>
            ))}
          </select>
          <input type="date" name="from" defaultValue={from ?? ""} className="input w-auto" aria-label="Dari tanggal" />
          <input type="date" name="to" defaultValue={to ?? ""} className="input w-auto" aria-label="Sampai tanggal" />
          <select name="sort" defaultValue={sort} className="input w-auto" aria-label="Urutan">
            <option value="desc">Terbaru dulu</option>
            <option value="asc">Terlama dulu (urutan sheet)</option>
          </select>
          <div className="ml-auto flex gap-2">
            <Link href="/video-review" className="btn-ghost">Reset</Link>
            <button className="btn-primary">Terapkan</button>
          </div>
        </form>

        <div className="flex items-center justify-between px-4 py-2.5 text-xs text-zinc-500">
          <span>
            {listRes.count ?? rows.length} kasus
            {(listRes.count ?? 0) > rows.length ? ` · menampilkan ${rows.length}` : ""}
          </span>
          {canWrite && <span>Kategori & status bisa diubah langsung di tabel</span>}
        </div>

        {rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-zinc-400">Belum ada kasus di filter ini.</div>
        ) : (
          <div className="max-h-[75vh] overflow-auto border-t border-zinc-800/80">
            <table className="sheet min-w-[1572px] table-fixed">
              <thead>
                <tr>
                  <th className="w-[52px] text-right">No</th>
                  <th className="w-[100px]" title="Tanggal Report">Tgl Report</th>
                  <th className="w-[220px]">Penjelasan</th>
                  <th className="w-[230px]">Email/link</th>
                  <th className="w-[200px]">Penyelesaian</th>
                  <th className="w-[240px]">Insight</th>
                  <th className="w-[200px]">Argumen clipper</th>
                  <th className="w-[210px]">Kategori</th>
                  <th className="w-[120px]">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id}>
                    <td className="text-right tabular-nums text-zinc-500">
                      <Link href={`/video-review/${r.id}`} className="hover:text-orange-400" title={`Buka kasus #${r.id}`}>
                        {sort === "asc" ? i + 1 : rows.length - i}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap tabular-nums">{ddmmyy(r.report_date)}</td>
                    <td className="font-medium">
                      <Link href={`/video-review/${r.id}`} className="hover:text-orange-400">{r.explanation}</Link>
                    </td>
                    <td>{r.links.length ? <VrLinks links={r.links} /> : <span className="text-zinc-600">-</span>}</td>
                    <td className="whitespace-pre-wrap text-zinc-300">{r.resolution ?? <span className="text-zinc-600">-</span>}</td>
                    <td className="whitespace-pre-wrap text-zinc-400">{r.insight ?? ""}</td>
                    <td className="whitespace-pre-wrap text-zinc-400">{r.clipper_argument ?? ""}</td>
                    <td>
                      {canWrite ? (
                        <VrCategorySelect id={r.id} category={r.category} />
                      ) : (
                        <span className="text-zinc-300">{r.category ?? "-"}</span>
                      )}
                    </td>
                    <td>{canWrite ? <VrStatusSelect id={r.id} status={r.status} /> : <VrStatusBadge status={r.status} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
