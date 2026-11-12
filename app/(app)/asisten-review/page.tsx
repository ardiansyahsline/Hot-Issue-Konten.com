import { arErrorText } from "@/lib/asistenReview";
import { requireAsisten } from "@/lib/asistenReview.server";
import BelumSiap from "@/components/asisten/BelumSiap";
import type { Opsi } from "@/components/asisten/hasil/HasilFilter";
import HasilHalaman, { type FilterHasil } from "@/components/asisten/hasil/HasilHalaman";
import { KARTU_COLS, type KartuRow } from "@/components/asisten/hasil/HasilKartu";
import { loadArStatus } from "@/components/asisten/status.server";

export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;
const satu = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? "").trim();

const PER = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KODE = /^[A-Za-z0-9_-]{1,64}$/;
const missing = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || /relation .* does not exist|schema cache/i.test(e.message ?? ""));
const tgl = (iso: string) => new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso));

/**
 * Halaman utama tab Asisten Review: daftar hasil AI per video (terbaru dulu) + filter + paginasi.
 * Filter dari alamat: ?run=<uuid>|manual &campaign= &reviewer= &saran=approve|reject|cek_manusia &yakin=90|70|rendah
 * &cocok=ya|tidak|kosong &hal=N. Nilai tidak dikenal diabaikan (bukan error).
 */
export default async function HasilPage({ searchParams }: { searchParams: SP }) {
  const ctx = await requireAsisten();
  if (!ctx.ready) return <BelumSiap />;
  const sp = await searchParams;
  const sb = ctx.supabase;

  const f: FilterHasil = {
    run: satu(sp.run) === "manual" ? "manual" : UUID.test(satu(sp.run)) ? satu(sp.run).toLowerCase() : "",
    campaign: KODE.test(satu(sp.campaign)) ? satu(sp.campaign) : "",
    reviewer: KODE.test(satu(sp.reviewer)) ? satu(sp.reviewer) : "",
    saran: ["approve", "reject", "cek_manusia"].includes(satu(sp.saran)) ? satu(sp.saran) : "",
    yakin: ["90", "70", "rendah"].includes(satu(sp.yakin)) ? satu(sp.yakin) : "",
    cocok: ["ya", "tidak", "kosong"].includes(satu(sp.cocok)) ? satu(sp.cocok) : "",
  };
  const hal = Math.min(10_000, Math.max(1, Math.floor(Number(satu(sp.hal)) || 1)));

  let q = sb.from("review_results").select(KARTU_COLS, { count: "exact" });
  if (f.run === "manual") q = q.is("run_id", null);
  else if (f.run) q = q.eq("run_id", f.run);
  if (f.campaign) q = q.eq("campaign_id", f.campaign);
  if (f.reviewer) q = q.eq("reviewer", f.reviewer);
  if (f.saran) q = q.eq("suggestion", f.saran);
  if (f.yakin === "90") q = q.gte("confidence", 90);
  else if (f.yakin === "70") q = q.gte("confidence", 70);
  else if (f.yakin === "rendah") q = q.lt("confidence", 70);
  if (f.cocok === "ya") q = q.eq("match", true);
  else if (f.cocok === "tidak") q = q.eq("match", false);
  else if (f.cocok === "kosong") q = q.is("match", null);
  q = q.order("created_at", { ascending: false }).order("id", { ascending: false }).range((hal - 1) * PER, hal * PER - 1);

  // reviewer untuk pilihan filter: pseudonim unik (dalam run yang dipilih kalau ada)
  let rq = sb.from("review_results").select("reviewer").not("reviewer", "is", null).order("reviewer").limit(3000);
  if (f.run === "manual") rq = rq.is("run_id", null);
  else if (f.run) rq = rq.eq("run_id", f.run);

  const [res, runsRes, campRes, revRes, status] = await Promise.all([
    q,
    sb.from("review_runs").select("id, label, sample_size, rubric_version, created_at").order("created_at", { ascending: false }).limit(30),
    sb.from("review_campaigns").select("campaign_id, title, brand").order("last_seen_at", { ascending: false }).limit(300),
    rq,
    loadArStatus(ctx),
  ]);
  if (missing(res.error)) return <BelumSiap />;
  const rows = (res.data ?? []) as unknown as KartuRow[];
  const total = res.count ?? rows.length;
  const pages = Math.max(1, Math.ceil(total / PER));

  // umpan balik untuk kartu di halaman ini (milikku + jumlah tim)
  const ids = rows.map((r) => r.id);
  const fb = ids.length ? await sb.from("review_feedback").select("result_id, user_id, agree, note").in("result_id", ids) : { data: [], error: null };
  const mine = new Map<number, { agree: boolean; note: string | null }>();
  const counts = new Map<number, { setuju: number; tidak: number }>();
  for (const x of (fb.data ?? []) as { result_id: number; user_id: string; agree: boolean; note: string | null }[]) {
    const c = counts.get(x.result_id) ?? { setuju: 0, tidak: 0 };
    if (x.agree) c.setuju += 1;
    else c.tidak += 1;
    counts.set(x.result_id, c);
    if (x.user_id === ctx.user.id) mine.set(x.result_id, { agree: x.agree, note: x.note });
  }

  const runs: Opsi[] = [
    ...((runsRes.data ?? []) as { id: string; label: string | null; sample_size: number; rubric_version: string | null; created_at: string }[]).map((r) => ({
      value: r.id,
      label: `${r.label || `Uji ${r.sample_size} video`} · ${tgl(r.created_at)}${r.rubric_version ? ` · ${r.rubric_version}` : ""}`,
    })),
    { value: "manual", label: "Cek video manual" },
  ];
  const campaigns: Opsi[] = ((campRes.data ?? []) as { campaign_id: string; title: string | null; brand: string | null }[]).map((c) => ({
    value: c.campaign_id,
    label: `${c.title || c.campaign_id}${c.brand ? ` (${c.brand})` : ""}`.slice(0, 80),
  }));
  // campaign yang dipilih lewat alamat tapi belum ada di daftar tetap muncul
  if (f.campaign && !campaigns.some((c) => c.value === f.campaign)) campaigns.unshift({ value: f.campaign, label: `Campaign ${f.campaign}` });
  const reviewers: Opsi[] = [...new Set(((revRes.data ?? []) as { reviewer: string | null }[]).map((r) => r.reviewer).filter((x): x is string => !!x))].map((r) => ({ value: r, label: r }));
  if (f.reviewer && !reviewers.some((r) => r.value === f.reviewer)) reviewers.unshift({ value: f.reviewer, label: f.reviewer });

  return (
    <HasilHalaman
      status={status}
      runs={runs}
      campaigns={campaigns}
      reviewers={reviewers}
      rows={rows}
      mine={mine}
      counts={counts}
      total={total}
      hal={hal}
      pages={pages}
      f={f}
      galat={res.error ? arErrorText(res.error, "Daftar hasil gagal dibaca. Muat ulang halaman.") : null}
    />
  );
}
