"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser, requireAdmin } from "@/lib/auth";
import { getTabAccess, tabDenied } from "@/lib/tabs.server";
import { canEditReviews, canWriteReviews } from "@/lib/roles";
import { parseCsv } from "@/lib/csv";
import {
  VR_CATEGORIES,
  VR_STATUSES,
  categorize,
  combineNotes,
  parseLinksText,
  sheetBaseKey,
  sheetCsvUrl,
  sheetToReviews,
  statusFromSheet,
  type VrImportRow,
  type VrLinkInput,
} from "@/lib/videoReview";

export type VrFormState = { error?: string } | undefined;
export type ImportResult = { ok?: string; error?: string } | undefined;

const NO_ACCESS = "Role kamu tidak punya akses untuk ini di Video Review.";

/**
 * Context Supabase kalau tab Video Review terbuka + role boleh; kalau tidak = teks alasannya.
 * `closed: "redirect"` = aksi tanpa pesan (ganti status): tab ditutup -> pindah ke tab yang boleh (halaman basi ikut tertutup).
 */
async function gate(can: (role: string | null | undefined) => boolean, closed: "error" | "redirect" = "error") {
  const [ctx, access] = await Promise.all([getCurrentUser(), getTabAccess()]);
  const no = tabDenied(access, "video_review", { redirect: closed === "redirect" });
  if (no) return no;
  return can(access.profile?.role) ? ctx : NO_ACCESS;
}

/** Boleh input / import (role penulis) */
const writer = () => gate(canWriteReviews);
/** Boleh edit kasus yang sudah ada (writer + Discord Moderator) */
const editor = (closed?: "error" | "redirect") => gate(canEditReviews, closed);

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
      category: categoryRaw || categorize(explanation),
      status,
      resolution: txt(fd.get("resolution")),
      notes: txt(fd.get("notes")),
    },
    links: parseLinksText(String(fd.get("links") ?? "")),
  } as const;
}

export async function createReview(_prev: VrFormState, fd: FormData): Promise<VrFormState> {
  const parsed = parseForm(fd);
  if ("error" in parsed) return { error: parsed.error };
  const w = await writer();
  if (typeof w === "string") return { error: w };

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
  const w = await editor();
  if (typeof w === "string") return { error: w };

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
  const w = await editor();
  if (typeof w === "string") return { error: w };
  const { error } = await w.supabase.from("video_reviews").update({ category: category || null }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/video-review");
  revalidatePath(`/video-review/${id}`);
  return {};
}

export async function setReviewStatus(id: number, status: string) {
  if (!(status in VR_STATUSES)) return;
  const w = await editor("redirect");
  if (typeof w === "string") return;
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

type Writer = Exclude<Awaited<ReturnType<typeof writer>>, string>;

/** Kunci per baris sheet (sama dengan migration-03): s2:md5(tanggal|penjelasan|link pertama)[:urutan] */
function sheetKeys(rows: VrImportRow[]) {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = sheetBaseKey(r);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return "s2:" + createHash("md5").update(base).digest("hex") + (n > 1 ? `:${n}` : "");
  });
}

async function inBatches<T>(items: T[], size: number, fn: (batch: T[]) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await fn(items.slice(i, i + size));
}

/**
 * Masukkan baris hasil baca sheet:
 * - kasus baru -> ditambahkan (kategori otomatis dari Penjelasan)
 * - kasus yang sudah ada -> Penyelesaian / Insight / Argumen / status diperbarui kalau di sheet berubah,
 *   kategori diisi otomatis kalau masih kosong, link baru ditambahkan.
 */
async function importRows(w: Writer, input: VrImportRow[]): Promise<ImportResult> {
  const rows = input
    .filter((r) => r && typeof r.explanation === "string" && r.explanation.trim())
    .map((r) => ({
      ...r,
      explanation: r.explanation.trim(),
      insight: r.insight?.trim() || null,
      clipper_argument: r.clipper_argument?.trim() || null,
      // aturan sama dengan sheetToReviews: Penyelesaian "belum ada respons" + Insight ada isi -> status dari Insight
      status: statusFromSheet(r.resolution ?? null, r.insight ?? null),
      notes: combineNotes(r.insight ?? null, r.clipper_argument ?? null),
      report_date: /^\d{4}-\d{2}-\d{2}$/.test(r.report_date ?? "") ? r.report_date : null,
      links: (Array.isArray(r.links) ? r.links : []).filter(
        (l: VrLinkInput) => l && ["email", "url", "other"].includes(l.kind) && String(l.value).trim()
      ),
    }));
  const keys = sheetKeys(rows);
  const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

  // ambil kasus yang sudah ada
  type Existing = {
    id: number;
    source_key: string;
    category: string | null;
    status: string;
    resolution: string | null;
    insight: string | null;
    clipper_argument: string | null;
    notes: string | null;
  };
  const existing = new Map<string, Existing>();
  let fetchErr: string | null = null;
  await inBatches(keys, 100, async (batch) => {
    const { data, error } = await w.supabase
      .from("video_reviews")
      .select("id, source_key, category, status, resolution, insight, clipper_argument, notes")
      .in("source_key", batch);
    if (error) fetchErr = error.message;
    for (const e of (data ?? []) as Existing[]) existing.set(e.source_key, e);
  });
  if (fetchErr) return { error: `Gagal cek data lama: ${fetchErr}` };

  const existingLinks = new Map<number, Set<string>>();
  const ids = [...existing.values()].map((e) => e.id);
  await inBatches(ids, 200, async (batch) => {
    const { data } = await w.supabase.from("video_review_links").select("review_id, normalized").in("review_id", batch);
    for (const l of data ?? []) {
      if (!existingLinks.has(l.review_id)) existingLinks.set(l.review_id, new Set());
      existingLinks.get(l.review_id)!.add(l.normalized);
    }
  });

  // 1) kasus baru
  const fresh = rows.map((r, i) => ({ r, key: keys[i] })).filter((x) => !existing.has(x.key));
  let inserted = 0;
  let linkCount = 0;
  for (let i = 0; i < fresh.length; i += 200) {
    const chunk = fresh.slice(i, i + 200);
    const { data, error } = await w.supabase
      .from("video_reviews")
      .upsert(
        chunk.map(({ r, key }) => ({
          report_date: r.report_date ?? today,
          explanation: r.explanation,
          category: r.category && (VR_CATEGORIES as readonly string[]).includes(r.category) ? r.category : categorize(r.explanation),
          status: r.status,
          resolution: r.resolution || null,
          insight: r.insight || null,
          clipper_argument: r.clipper_argument || null,
          notes: r.notes,
          source_key: key,
        })),
        { onConflict: "source_key", ignoreDuplicates: true }
      )
      .select("id, source_key");
    if (error) return { error: `Gagal tambah kasus: ${error.message}` };
    const idByKey = new Map((data ?? []).map((d) => [d.source_key as string, d.id as number]));
    inserted += idByKey.size;
    const linkRows = chunk.flatMap(({ r, key }) => {
      const id = idByKey.get(key);
      return id ? r.links.map((l) => ({ review_id: id, kind: l.kind, value: l.value })) : [];
    });
    if (linkRows.length) {
      const { error: lErr } = await w.supabase.from("video_review_links").insert(linkRows);
      if (lErr) return { error: `Kasus masuk tapi link gagal: ${lErr.message}` };
      linkCount += linkRows.length;
    }
  }

  // 2) kasus lama yang berubah di sheet
  let updated = 0;
  const updates: { id: number; patch: Record<string, string>; newLinks: VrLinkInput[] }[] = [];
  rows.forEach((r, i) => {
    const e = existing.get(keys[i]);
    if (!e) return;
    const patch: Record<string, string> = {};
    if (r.resolution && r.resolution !== e.resolution) {
      patch.resolution = r.resolution;
      patch.status = r.status;
    }
    const insightChanged = !!r.insight && r.insight !== e.insight;
    const argChanged = !!r.clipper_argument && r.clipper_argument !== e.clipper_argument;
    if (insightChanged) patch.insight = r.insight!;
    if (argChanged) patch.clipper_argument = r.clipper_argument!;
    // Catatan ikut diperbarui hanya kalau Insight/Argumen di sheet berubah (atau Catatan masih kosong)
    if ((insightChanged || argChanged || !e.notes) && r.notes && r.notes !== e.notes) patch.notes = r.notes;
    // masih "menunggu" tapi Insight sudah berisi penyelesaian -> status ikut Insight
    if ((insightChanged || e.status === "menunggu") && r.status !== "menunggu" && r.status !== e.status && !patch.status)
      patch.status = r.status;
    if (!e.category) patch.category = categorize(r.explanation);
    const have = existingLinks.get(e.id) ?? new Set<string>();
    const newLinks = r.links.filter((l) => !have.has(l.value.trim().toLowerCase()));
    if (Object.keys(patch).length || newLinks.length) updates.push({ id: e.id, patch, newLinks });
  });
  let updErr: string | null = null;
  await inBatches(updates, 10, async (batch) => {
    await Promise.all(
      batch.map(async (u) => {
        if (Object.keys(u.patch).length) {
          const { error } = await w.supabase.from("video_reviews").update(u.patch).eq("id", u.id);
          if (error) updErr = error.message;
        }
        if (u.newLinks.length) {
          const { error } = await w.supabase
            .from("video_review_links")
            .insert(u.newLinks.map((l) => ({ review_id: u.id, kind: l.kind, value: l.value })));
          if (error) updErr = error.message;
          else linkCount += u.newLinks.length;
        }
      })
    );
  });
  updated = updates.length;
  if (updErr) return { error: `Sebagian update gagal: ${updErr}` };

  revalidatePath("/video-review");
  const unchanged = rows.length - inserted - updated;
  return {
    ok:
      `${inserted} kasus baru, ${updated} kasus diperbarui, ${Math.max(0, unchanged)} tidak berubah` +
      (linkCount ? ` (${linkCount} email/link ditambahkan).` : "."),
  };
}

/** Import dari file CSV yang di-upload (sudah diparse di browser) */
export async function importReviews(json: string): Promise<ImportResult> {
  const w = await writer();
  if (typeof w === "string") return { error: w };
  let rows: VrImportRow[];
  try {
    rows = JSON.parse(json);
    if (!Array.isArray(rows)) throw new Error();
  } catch {
    return { error: "Data import tidak valid." };
  }
  return importRows(w, rows);
}

/** Ambil langsung dari link Google Sheet (sheet harus bisa dibuka "siapa saja yang punya link") */
export async function syncFromSheet(_prev: ImportResult, fd: FormData): Promise<ImportResult> {
  const w = await writer();
  if (typeof w === "string") return { error: w };
  const url = sheetCsvUrl(String(fd.get("url") ?? ""));
  if (!url) return { error: "Link Google Sheet tidak valid." };

  let text: string;
  try {
    const res = await fetch(url, { redirect: "follow", cache: "no-store" });
    const type = res.headers.get("content-type") ?? "";
    text = await res.text();
    if (!res.ok || type.includes("text/html") || text.trimStart().startsWith("<")) {
      return {
        error:
          "Sheet tidak bisa dibaca server. Di Google Sheet klik Share → General access → \"Anyone with the link\" (Viewer), " +
          "atau pakai cara upload file CSV di bawah.",
      };
    }
  } catch (e) {
    return { error: `Gagal mengambil sheet: ${(e as Error).message}` };
  }

  const { reviews, error } = sheetToReviews(parseCsv(text));
  if (error) return { error };
  if (!reviews.length) return { error: "Tidak ada kasus yang terbaca dari sheet." };
  const res = await importRows(w, reviews);
  return res?.ok ? { ok: `Sync selesai: ${reviews.length} kasus terbaca. ${res.ok}` } : res;
}

/** Isi kategori otomatis untuk semua kasus yang kategorinya masih kosong */
export async function autoCategorize(): Promise<ImportResult> {
  const w = await writer();
  if (typeof w === "string") return { error: w };
  let total = 0;
  for (let round = 0; round < 20; round++) {
    const { data, error } = await w.supabase.from("video_reviews").select("id, explanation").is("category", null).limit(1000);
    if (error) return { error: error.message };
    if (!data?.length) break;
    const byCat = new Map<string, number[]>();
    for (const r of data) {
      const c = categorize(r.explanation);
      byCat.set(c, [...(byCat.get(c) ?? []), r.id]);
    }
    for (const [category, ids] of byCat) {
      const { error: uErr } = await w.supabase.from("video_reviews").update({ category }).in("id", ids);
      if (uErr) return { error: uErr.message };
    }
    total += data.length;
    if (data.length < 1000) break;
  }
  revalidatePath("/video-review");
  return { ok: `${total} kasus dikategorikan otomatis.` };
}

/** Simpan catatan rangkuman manual untuk satu kategori */
export async function saveCategoryNote(category: string, note: string): Promise<ImportResult> {
  const w = await writer();
  if (typeof w === "string") return { error: w };
  const { error } = await w.supabase
    .from("video_review_category_notes")
    .upsert({ category, note: note.trim() }, { onConflict: "category" });
  if (error) return { error: error.message };
  revalidatePath("/video-review");
  return { ok: "Disimpan" };
}

/** Simpan kasus baru dari tab "Input kasus" (tetap di halaman, form dikosongkan) */
export async function createReviewInline(_prev: { error?: string; ok?: string } | undefined, fd: FormData): Promise<{ error?: string; ok?: string }> {
  const parsed = parseForm(fd);
  if ("error" in parsed) return { error: parsed.error };
  const w = await writer();
  if (typeof w === "string") return { error: w };
  const { data, error } = await w.supabase.from("video_reviews").insert(parsed.data).select("id").single();
  if (error || !data) return { error: `Gagal simpan: ${error?.message}` };
  if (parsed.links.length) {
    const { error: lErr } = await w.supabase
      .from("video_review_links")
      .insert(parsed.links.map((l) => ({ ...l, review_id: data.id })));
    if (lErr) return { error: `Kasus tersimpan (#${data.id}) tapi link gagal: ${lErr.message}` };
  }
  revalidatePath("/video-review");
  return { ok: `Kasus #${data.id} tersimpan (kategori: ${parsed.data.category}).` };
}

/** Edit langsung di baris tabel (tanpa pindah halaman) */
export async function updateReviewInline(id: number, _prev: { error?: string; ok?: string } | undefined, fd: FormData): Promise<{ error?: string; ok?: string }> {
  const parsed = parseForm(fd);
  if ("error" in parsed) return { error: parsed.error };
  const w = await editor();
  if (typeof w === "string") return { error: w };
  const { error } = await w.supabase.from("video_reviews").update(parsed.data).eq("id", id);
  if (error) return { error: `Gagal update: ${error.message}` };
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
  return { ok: "Tersimpan" };
}
