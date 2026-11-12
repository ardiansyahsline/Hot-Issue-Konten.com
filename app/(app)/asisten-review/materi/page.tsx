import { arErrorText, type CampaignMateriStatus, type ReviewMaterial } from "@/lib/asistenReview";
import { requireAsisten } from "@/lib/asistenReview.server";
import { CAMPAIGN_RE } from "@/lib/asistenReviewStorage.server";
import { cleanSearch } from "@/lib/utils";
import BelumSiap from "@/components/asisten/BelumSiap";
import type { MateriItem } from "@/components/asisten/MateriPanel";
import MateriView, { FILTER_MATERI } from "@/components/asisten/MateriView";

export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;
const satu = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const PER_HAL = 20;
const missing = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || /schema cache|does not exist/i.test(e.message ?? ""));

type CampaignRow = MateriItem["campaign"] & { brief_points: { kategori?: string; wajib?: boolean }[] | null };

export default async function MateriPage({ searchParams }: { searchParams: SP }) {
  const ctx = await requireAsisten();
  if (!ctx.ready) return <BelumSiap />;
  const sp = await searchParams;
  const sb = ctx.supabase;
  const q = cleanSearch(satu(sp.q));
  const status = FILTER_MATERI.some((f) => f.id && f.id === satu(sp.status)) ? (satu(sp.status) as CampaignMateriStatus) : "";
  const c = CAMPAIGN_RE.test(satu(sp.c)) ? satu(sp.c) : "";
  const hal = Math.max(1, Math.min(500, parseInt(satu(sp.hal), 10) || 1));

  let query = sb
    .from("review_campaigns")
    .select("campaign_id, title, brand, campaign_status, materi_status, materi_message, materi_checked_at, brief_points", { count: "exact" })
    .order("last_seen_at", { ascending: false })
    .range((hal - 1) * PER_HAL, hal * PER_HAL - 1);
  if (c) query = query.eq("campaign_id", c);
  else {
    if (status) query = query.eq("materi_status", status);
    if (q) query = query.or(["title", "brand", "campaign_id"].map((k) => `${k}.ilike."*${q}*"`).join(","));
  }
  const [res, semua] = await Promise.all([query, sb.from("review_campaigns").select("materi_status").limit(5000)]);
  if (missing(res.error)) return <BelumSiap />;
  const peringatan = res.error ? arErrorText(res.error, "Daftar campaign gagal dibaca. Muat ulang halaman.") : null;

  const rows = ((res.data ?? []) as CampaignRow[]).map((r) => ({ ...r, dikenal: true }));
  // ?c=<id> untuk campaign yang belum pernah diproses laptop → tetap bisa upload materi lebih dulu
  if (c && !rows.length && !res.error)
    rows.push({ campaign_id: c, title: null, brand: null, campaign_status: null, materi_status: "belum_dicek", materi_message: null, materi_checked_at: null, brief_points: [], dikenal: false });

  const ids = rows.map((r) => r.campaign_id);
  const [matRes, jobRes] = await Promise.all([
    ids.length
      ? sb
          .from("review_materials")
          .select("id, campaign_id, kind, source, status, storage_path, file_name, mime, size_bytes, duration_sec, message, created_at")
          .in("campaign_id", ids)
          .order("created_at", { ascending: true })
          .limit(1000)
      : Promise.resolve({ data: [] as ReviewMaterial[], error: null }),
    ids.length
      ? sb.from("review_jobs").select("params").eq("kind", "materi").in("status", ["antri", "proses"]).limit(200)
      : Promise.resolve({ data: [] as { params: Record<string, unknown> }[], error: null }),
  ]);
  const mats = (matRes.data ?? []) as ReviewMaterial[];
  const aktif = new Set(((jobRes.data ?? []) as { params: Record<string, unknown> }[]).map((j) => String(j.params?.campaign_id ?? "")));
  const items: MateriItem[] = rows.map(({ brief_points, ...camp }) => ({
    campaign: camp,
    materi: mats.filter((m) => m.campaign_id === camp.campaign_id),
    jobAktif: aktif.has(camp.campaign_id) || camp.materi_status === "proses",
    poinMateri: (Array.isArray(brief_points) ? brief_points : []).filter((p) => p?.wajib && /material_wajib|footage_wajib/.test(String(p?.kategori ?? ""))).length,
  }));

  const hitung: Record<string, number> = {};
  for (const r of (semua.data ?? []) as { materi_status: string }[]) hitung[r.materi_status] = (hitung[r.materi_status] ?? 0) + 1;

  return (
    <MateriView
      items={items}
      q={q}
      status={status}
      c={c}
      hal={hal}
      total={res.count ?? rows.length}
      perHal={PER_HAL}
      hitung={hitung}
      peringatan={peringatan ?? (matRes.error ? arErrorText(matRes.error, "Daftar file gagal dibaca. Muat ulang halaman.") : null)}
    />
  );
}
