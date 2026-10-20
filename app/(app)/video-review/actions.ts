"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser, getProfile, requireAdmin } from "@/lib/auth";
import { canWriteReviews } from "@/lib/roles";
import {
  VR_CATEGORIES,
  VR_STATUSES,
  parseLinksText,
  type VrImportRow,
  type VrLinkInput,
} from "@/lib/videoReview";

export type VrFormState = { error?: string } | undefined;
export type ImportResult = { ok?: string; error?: string } | undefined;

const NO_ACCESS = "Role kamu tidak punya akses input Video Review.";

async function writer() {
  const [ctx, profile] = await Promise.all([getCurrentUser(), getProfile()]);
  return canWriteReviews(profile?.role) ? ctx : null;
}

const txt = (v: FormDataEntryValue | null) => String(v ?? "").trim() || null;

function parseForm(fd: FormData) {
  const report_date = String(fd.get("report_date") ?? "");
  const explanation = String(fd.get("explanation") ?? "").trim();
  const categoryRaw = String(fd.get("category") ?? "");
  const status = String(fd.get("status") ?? "menunggu");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(report_date)) return { error: "Tanggal report wajib diisi." } as const;
  if (!explanation) return { error: "Penjelasan wajib diisi." } as const;
  if (categoryRaw && !(VR_CATEGORIES as readonly string[]).includes(categoryRaw)) return { error: "Kategori tidak valid." } as const;
  if (!(status in VR_STATUSES)) return { error: "Status tidak valid." } as const;
  return {
    data: {
      report_date,
      explanation,
      category: categoryRaw || null,
      status,
      resolution: txt(fd.get("resolution")),
      insight: txt(fd.get("insight")),
      clipper_argument: txt(fd.get("clipper_argument")),
    },
    links: parseLinksText(String(fd.get("links") ?? "")),
  } as const;
}

export async function createReview(_prev: VrFormState, fd: FormData): Promise<VrFormState> {
  const parsed = parseForm(fd);
  if ("error" in parsed) return { error: parsed.error };
  const w = await writer();
  if (!w) return { error: NO_ACCESS };

  const { data, error } = await w.supabase.from("video_reviews").insert(parsed.data).select("id").single();
  if (error || !data) return { error: `Gagal simpan: ${error?.message}` };
  if (parsed.links.length) {
    const { error: lErr } = await w.supabase
      .from("video_review_links")
      .insert(parsed.links.map((l) => ({ ...l, review_id: data.id })));
    if (lErr) return { error: `Kasus tersimpan (#${data.id}) tapi link gagal: ${lErr.message}` };
  }
  revalidatePath("/video-review");
  redirect(`/video-review/${data.id}`);
}

export async function updateReview(id: number, _prev: VrFormState, fd: FormData): Promise<VrFormState> {
  const parsed = parseForm(fd);
  if ("error" in parsed) return { error: parsed.error };
  const w = await writer();
  if (!w) return { error: NO_ACCESS };

  const { error } = await w.supabase.from("video_reviews").update(parsed.data).eq("id", id);
  if (error) return { error: `Gagal update: ${error.message}` };

  // ganti semua link dengan isi textarea terbaru
  const { error: dErr } = await w.supabase.from("video_review_links").delete().eq("review_id", id);
  if (dErr) return { error: `Gagal update link: ${dErr.message}` };
  if (parsed.links.length) {
    const { error: lErr } = await w.supabase
      .from("video_review_links")
      .insert(parsed.links.map((l) => ({ ...l, review_id: id })));
    if (lErr) return { error: `Gagal simpan link: ${lErr.message}` };
  }
  revalidatePath("/video-review");
  revalidatePath(`/video-review/${id}`);
  redirect(`/video-review/${id}`);
}

export async function setReviewCategory(id: number, category: string) {
  if (category && !(VR_CATEGORIES as readonly string[]).includes(category)) return { error: "Kategori tidak valid" };
  const w = await writer();
  if (!w) return { error: NO_ACCESS };
  const { error } = await w.supabase.from("video_reviews").update({ category: category || null }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/video-review");
  revalidatePath(`/video-review/${id}`);
  return {};
}

export async function setReviewStatus(id: number, status: string) {
  if (!(status in VR_STATUSES)) return;
  const w = await writer();
  if (!w) return;
  await w.supabase.from("video_reviews").update({ status }).eq("id", id);
  revalidatePath("/video-review");
  revalidatePath(`/video-review/${id}`);
}

export async function deleteReview(id: number) {
  const { supabase } = await requireAdmin();
  await supabase.from("video_reviews").delete().eq("id", id);
  revalidatePath("/video-review");
  redirect("/video-review");
}

function sourceKey(r: VrImportRow) {
  const raw = [r.report_date, r.explanation, r.resolution ?? "", r.links.map((l) => l.value.toLowerCase()).join(" ")]
    .join("|")
    .toLowerCase();
  return "sheet:" + createHash("sha1").update(raw).digest("hex");
}

/** Import hasil parsing sheet. Baris yang sudah pernah di-import (isi sama) otomatis dilewati. */
export async function importReviews(json: string): Promise<ImportResult> {
  const w = await writer();
  if (!w) return { error: NO_ACCESS };

  let rows: VrImportRow[];
  try {
    rows = JSON.parse(json);
    if (!Array.isArray(rows)) throw new Error();
  } catch {
    return { error: "Data import tidak valid." };
  }

  const clean = rows
    .filter((r) => r && typeof r.explanation === "string" && r.explanation.trim())
    .map((r) => ({
      ...r,
      status: r.status in VR_STATUSES ? r.status : "menunggu",
      report_date: /^\d{4}-\d{2}-\d{2}$/.test(r.report_date ?? "") ? r.report_date : null,
      links: (Array.isArray(r.links) ? r.links : []).filter(
        (l: VrLinkInput) => l && ["email", "url", "other"].includes(l.kind) && String(l.value).trim()
      ),
    }));

  // buang baris kembar di file yang sama
  const seenKeys = new Set<string>();
  const unique = clean.filter((r) => {
    const k = sourceKey(r);
    if (seenKeys.has(k)) return false;
    seenKeys.add(k);
    return true;
  });

  let inserted = 0;
  let links = 0;
  const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

  for (let i = 0; i < unique.length; i += 200) {
    const chunk = unique.slice(i, i + 200);
    const payload = chunk.map((r) => ({
      report_date: r.report_date ?? today,
      explanation: r.explanation.trim(),
      category: null as string | null,
      status: r.status,
      resolution: r.resolution || null,
      insight: r.insight || null,
      clipper_argument: r.clipper_argument || null,
      source_key: sourceKey(r),
    }));
    const { data, error } = await w.supabase
      .from("video_reviews")
      .upsert(payload, { onConflict: "source_key", ignoreDuplicates: true })
      .select("id, source_key");
    if (error) return { error: `Gagal import (baris ${i + 1}-${i + chunk.length}): ${error.message}` };

    const idByKey = new Map((data ?? []).map((d) => [d.source_key as string, d.id as number]));
    inserted += idByKey.size;
    const linkRows = chunk.flatMap((r, j) => {
      const id = idByKey.get(payload[j].source_key);
      return id ? r.links.map((l) => ({ review_id: id, kind: l.kind, value: l.value })) : [];
    });
    if (linkRows.length) {
      const { error: lErr } = await w.supabase.from("video_review_links").insert(linkRows);
      if (lErr) return { error: `Kasus masuk tapi link gagal: ${lErr.message}` };
      links += linkRows.length;
    }
  }

  revalidatePath("/video-review");
  const skipped = unique.length - inserted;
  return {
    ok: `${inserted} kasus baru masuk (${links} email/link).${skipped ? ` ${skipped} kasus dilewati karena sudah pernah di-import.` : ""}`,
  };
}
