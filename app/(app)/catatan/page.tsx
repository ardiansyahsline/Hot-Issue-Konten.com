import Link from "next/link";
import { getCurrentUser, getProfile } from "@/lib/auth";
import { SG_CATEGORIES, SG_STATUSES, isSgCategory, isSgStatus, type SgCategory, type SgStatus, type SuggestionRow } from "@/lib/suggestions";
import { cleanSearch, fmtDate, timeAgo } from "@/lib/utils";
import { Avatar, SgCategoryBadge, SgStatusBadge } from "@/components/SgBits";
import SgForm from "@/components/SgForm";
import { createSuggestion } from "./actions";

type SP = Promise<Record<string, string | undefined>>;

export default async function CatatanPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const [{ supabase, user }, profile] = await Promise.all([getCurrentUser(), getProfile()]);
  const isAdmin = profile?.role === "admin";
  const cat = isSgCategory(sp.kategori) ? sp.kategori : null;
  const status = isSgStatus(sp.status) ? sp.status : null;
  const q = cleanSearch(sp.q ?? "");

  let query = supabase.from("suggestion_list").select("*").order("created_at", { ascending: false }).limit(200);
  if (cat) query = query.eq("category", cat);
  if (status) query = query.eq("status", status);
  if (sp.saya === "1") query = query.eq("created_by", user.id);
  if (q) query = query.or(["title", "body", "status_reason"].map((c) => `${c}.ilike."*${q}*"`).join(","));

  const [listRes, countRes, peopleRes] = await Promise.all([
    query,
    supabase.from("suggestions").select("category, status").limit(5000),
    isAdmin ? supabase.from("profiles").select("id, full_name, email").order("full_name") : Promise.resolve({ data: null }),
  ]);
  const rows = (listRes.data ?? []) as SuggestionRow[];
  const all = (countRes.data ?? []) as { category: SgCategory; status: SgStatus }[];

  const href = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const m = { kategori: sp.kategori, status: sp.status, q: sp.q, saya: sp.saya, ...patch };
    for (const [k, v] of Object.entries(m)) if (v) p.set(k, v);
    const s = p.toString();
    return `/catatan${s ? `?${s}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Catatan & Saran</h1>
        <p className="page-sub">Journal tim: ide fitur, keluhan clipper yang berulang, masukan brief campaign, dan bug. Nama pencatat otomatis dari akun yang login.</p>
      </div>

      {listRes.error && (
        <div className="card border-red-500/40 p-4 text-sm text-red-300">
          Gagal ambil data: {listRes.error.message}. Pastikan <b>migration-04-catatan-saran.sql</b> sudah dijalankan di Supabase.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <section className="space-y-4">
          {/* filter kategori */}
          <div className="flex flex-wrap gap-2">
            <Link
              href={href({ kategori: undefined })}
              className={`rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition ${
                !cat ? "border-orange-500 bg-orange-500/10 text-zinc-100" : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-100"
              }`}
            >
              Semua <span className="ml-1 tabular-nums text-zinc-500">{all.length}</span>
            </Link>
            {(Object.entries(SG_CATEGORIES) as [SgCategory, (typeof SG_CATEGORIES)[SgCategory]][]).map(([k, v]) => (
              <Link
                key={k}
                href={href({ kategori: k })}
                className={`rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition ${
                  cat === k ? "border-orange-500 bg-orange-500/10 text-zinc-100" : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-100"
                }`}
              >
                {v.icon} {v.label} <span className="ml-1 tabular-nums text-zinc-500">{all.filter((a) => a.category === k).length}</span>
              </Link>
            ))}
          </div>

          <form className="flex flex-wrap gap-2">
            {cat && <input type="hidden" name="kategori" value={cat} />}
            <input name="q" defaultValue={sp.q ?? ""} placeholder="Cari catatan…" className="input min-w-[200px] flex-1" />
            <select name="status" defaultValue={status ?? ""} className="input w-auto">
              <option value="">Semua progress</option>
              {(Object.entries(SG_STATUSES) as [SgStatus, (typeof SG_STATUSES)[SgStatus]][]).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 px-1 text-[13px] text-zinc-400">
              <input type="checkbox" name="saya" value="1" defaultChecked={sp.saya === "1"} className="accent-orange-500" />
              Catatan saya
            </label>
            <button className="btn-ghost">Terapkan</button>
          </form>

          {rows.length === 0 ? (
            <div className="card p-10 text-center text-sm text-zinc-400">Belum ada catatan di filter ini.</div>
          ) : (
            <ul className="space-y-3">
              {rows.map((r) => (
                <li key={r.id} className="card card-hover p-5">
                  <div className="flex items-start gap-3">
                    <Avatar name={r.created_by_name} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                        <span className="font-semibold text-zinc-100">{r.created_by_name ?? "-"}</span>
                        <span className="text-zinc-500" title={fmtDate(r.created_at)}>· {timeAgo(r.created_at)}</span>
                        <span className="ml-auto flex flex-wrap gap-1.5">
                          <SgCategoryBadge category={r.category} />
                          <SgStatusBadge status={r.status} />
                        </span>
                      </div>
                      <Link href={`/catatan/${r.id}`} className="mt-2 block text-[15px] font-semibold leading-snug hover:text-orange-400">
                        {r.title}
                      </Link>
                      {r.body && <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap text-[13.5px] leading-6 text-zinc-400">{r.body}</p>}
                      {r.status !== "baru" && r.status_reason && (
                        <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-[13px] leading-6">
                          <span className="font-semibold text-zinc-200">{SG_STATUSES[r.status].label}:</span>{" "}
                          <span className="text-zinc-400">{r.status_reason}</span>
                          {r.status_changed_by_name && <span className="text-zinc-500"> — {r.status_changed_by_name}</span>}
                        </div>
                      )}
                      <Link href={`/catatan/${r.id}`} className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-zinc-500 hover:text-orange-400">
                        💬 {r.comment_count ? `${r.comment_count} tanggapan` : "Beri tanggapan"}
                      </Link>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <div className="card p-5">
            <h2 className="section-title mb-4">Tulis catatan / saran</h2>
            <SgForm
              action={createSuggestion}
              currentUserId={user.id}
              people={isAdmin ? (peopleRes.data ?? []) : undefined}
              compact
            />
          </div>
          <div className="card p-5">
            <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-zinc-500">Progress</h2>
            <ul className="space-y-2">
              {(Object.entries(SG_STATUSES) as [SgStatus, (typeof SG_STATUSES)[SgStatus]][]).map(([k, v]) => (
                <li key={k}>
                  <Link href={href({ status: k })} className="flex items-center justify-between text-[13.5px] text-zinc-300 hover:text-zinc-100">
                    <span className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${v.dot}`} />{v.label}</span>
                    <span className="font-semibold tabular-nums">{all.filter((a) => a.status === k).length}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
