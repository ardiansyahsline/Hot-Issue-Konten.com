"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { assertTab, requireTab } from "@/lib/tabs.server";
import { isContactType, normalizeContact, type ContactType } from "@/lib/contacts";
import { attachmentPaths, parseAttachments, removeFiles, saveAttachments } from "@/lib/attachments.server";
import { notifyNewReport } from "@/lib/notify.server";

export type ReportState = { error?: string; ok?: string; at?: number } | undefined;

type ContactInput = { type: ContactType; value: string };

function parseContacts(formData: FormData): ContactInput[] {
  let raw: unknown = [];
  try {
    raw = JSON.parse(String(formData.get("contacts") ?? "[]"));
  } catch {
    raw = [];
  }
  const seen = new Set<string>();
  const out: ContactInput[] = [];
  for (const c of Array.isArray(raw) ? raw : []) {
    const type = String(c?.type ?? "");
    const value = String(c?.value ?? "").trim().slice(0, 200);
    if (!isContactType(type) || !value) continue;
    const norm = normalizeContact(type, value);
    if (!norm || seen.has(`${type}:${norm}`)) continue;
    seen.add(`${type}:${norm}`);
    out.push({ type, value });
    if (out.length >= 10) break;
  }
  return out;
}

async function originFromRequest() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  return host ? `${h.get("x-forwarded-proto") ?? "https"}://${host}` : "";
}

/**
 * Simpan satu laporan clipper ke topik (issue) yang sudah ada.
 * Kontak yang sudah tercatat di topik ini dilewati (tetap dihitung sebagai laporan).
 */
async function saveReport(issueId: number, formData: FormData, noteField = "note") {
  const tab = await assertTab("dashboard");
  if (!tab.ok) return { error: tab.error } as const;
  const { supabase, user } = await getCurrentUser();
  const contacts = parseContacts(formData);
  const files = parseAttachments(formData, user.id);
  const note = String(formData.get(noteField) ?? "").trim().slice(0, 4000);
  if (!note && !contacts.length && !files.length) return { error: "Isi minimal kontak, keterangan, atau bukti." } as const;

  const { data: issue } = await supabase.from("issues").select("id").eq("id", issueId).maybeSingle();
  if (!issue) return { error: "Topik tidak ditemukan." } as const;

  const { data: rep, error } = await supabase.from("issue_reports").insert({ issue_id: issueId, note }).select("id").single();
  if (error || !rep) {
    return {
      error: /issue_reports/.test(error?.message ?? "")
        ? "Fitur laporan belum aktif — jalankan supabase/migration-11-laporan-topik.sql dulu."
        : `Gagal simpan laporan: ${error?.message}`,
    } as const;
  }

  let skipped = 0;
  if (contacts.length) {
    const { data: existing } = await supabase.from("issue_contacts").select("type, normalized_value").eq("issue_id", issueId);
    const have = new Set((existing ?? []).map((e) => `${e.type}:${e.normalized_value}`));
    const fresh = contacts.filter((c) => !have.has(`${c.type}:${normalizeContact(c.type, c.value)}`));
    skipped = contacts.length - fresh.length;
    if (fresh.length) {
      const { error: cErr } = await supabase
        .from("issue_contacts")
        .insert(fresh.map((c) => ({ ...c, issue_id: issueId, report_id: rep.id })));
      if (cErr) return { error: `Laporan tersimpan tapi kontak gagal: ${cErr.message}`, id: rep.id as number } as const;
    }
  }
  const aErr = await saveAttachments(supabase, files, { kind: "issue_report", id: rep.id });
  if (aErr) return { error: `Laporan tersimpan tapi bukti gagal: ${aErr}`, id: rep.id as number } as const;

  const origin = await originFromRequest();
  const reportId = rep.id as number;
  after(() => notifyNewReport(reportId, user.id, origin).catch((e) => console.log("[notif] error", e)));

  revalidatePath(`/issues/${issueId}`);
  revalidatePath("/");
  return { id: reportId, skipped } as const;
}

/** Form "+ Tambah laporan" di halaman detail issue */
export async function addReport(issueId: number, _prev: ReportState, formData: FormData): Promise<ReportState> {
  const r = await saveReport(issueId, formData);
  if ("error" in r) return { error: r.error, at: Date.now() };
  return {
    ok: r.skipped ? `Laporan tersimpan. ${r.skipped} kontak sudah tercatat di topik ini, jadi tidak dobel.` : "Laporan tersimpan 🔥",
    at: Date.now(),
  };
}

/** Dari form "+ Issue Baru": isi form dijadikan laporan di topik yang sudah ada (anti dobel topik) */
export async function addAsReport(issueId: number, formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const desc = String(formData.get("description") ?? "").trim();
  formData.set("note", [desc || title].filter(Boolean).join("\n").slice(0, 4000));
  const r = await saveReport(issueId, formData);
  if ("error" in r && !("id" in r)) redirect(`/issues/${issueId}?lapor_error=${encodeURIComponent(r.error)}#laporan`);
  redirect(`/issues/${issueId}?lapor=ok#laporan`);
}

export async function deleteReport(issueId: number, reportId: number) {
  // tab ditutup -> pindah ke tab yang boleh (bukan diam saja di halaman basi)
  await requireTab("dashboard");
  const { supabase } = await getCurrentUser();
  const paths = await attachmentPaths(supabase, [{ column: "issue_report_id", ids: [reportId] }]);
  const { data } = await supabase.from("issue_reports").delete().eq("id", reportId).select("id");
  if (data?.length) await removeFiles(supabase, paths);
  revalidatePath(`/issues/${issueId}`);
  revalidatePath("/");
}

export type SimilarIssue = { id: number; title: string; category: string; status: string; report_count: number; score: number };

const STOP = new Set(
  "yang dan di ke dari untuk ada tidak bisa sudah belum masih dengan atau ini itu juga karena saat kalau jadi pada oleh mau minta tolong clipper banyak kak min the".split(" ")
);
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));

/** Topik aktif yang judulnya mirip — dipakai di form Issue Baru supaya tidak dobel */
export async function findSimilarIssues(title: string): Promise<SimilarIssue[]> {
  const q = [...new Set(words(String(title ?? "").slice(0, 200)))];
  if (q.length === 0) return [];
  if (!(await assertTab("dashboard")).ok) return [];
  const { supabase } = await getCurrentUser();
  const { data } = await supabase
    .from("issue_list")
    .select("id, title, description, category, status, report_count")
    .neq("status", "resolved")
    .order("updated_at", { ascending: false })
    .limit(400);
  const out: SimilarIssue[] = [];
  for (const i of data ?? []) {
    const t = new Set(words(`${i.title} ${i.title} ${i.description ?? ""}`));
    const tt = new Set(words(i.title));
    // kata yang sama (atau awalan sama, mis. "withdraw" ~ "withdrawal")
    const hit = q.filter((w) => t.has(w) || [...t].some((x) => x.length > 4 && w.length > 4 && (x.startsWith(w.slice(0, 5)) || w.startsWith(x.slice(0, 5)))));
    const inTitle = q.filter((w) => tt.has(w)).length;
    const score = (hit.length + inTitle) / (q.length + Math.min(tt.size, 6));
    if (hit.length >= Math.min(2, q.length) && score >= 0.3) {
      out.push({ id: i.id, title: i.title, category: i.category, status: i.status, report_count: i.report_count ?? 1, score });
    }
  }
  return out.sort((a, b) => b.score - a.score || b.report_count - a.report_count).slice(0, 3);
}
