"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser, getProfile, requireAdmin } from "@/lib/auth";
import { canWriteIssues } from "@/lib/roles";
import { CATEGORIES, PRIORITIES, STATUSES } from "@/lib/constants";
import { isContactType, normalizeContact, type ContactType } from "@/lib/contacts";
import { attachmentPaths, parseAttachments, removeFiles, saveAttachments } from "@/lib/attachments.server";

export type FormState = { error?: string } | undefined;

type ContactInput = { type: ContactType; value: string };

function parseIssue(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const category = String(formData.get("category") ?? "Lainnya");
  const status = String(formData.get("status") ?? "open");
  const priority = String(formData.get("priority") ?? "medium");
  const campaign = String(formData.get("campaign") ?? "").trim() || null;
  const pic_id = String(formData.get("pic_id") ?? "") || null;
  const is_hot = formData.get("is_hot") === "on";

  if (!title) return { error: "Judul wajib diisi." } as const;
  if (!(CATEGORIES as readonly string[]).includes(category)) return { error: "Kategori tidak valid." } as const;
  if (!(status in STATUSES)) return { error: "Status tidak valid." } as const;
  if (!(priority in PRIORITIES)) return { error: "Prioritas tidak valid." } as const;

  return { data: { title, description, category, status, priority, campaign, pic_id, is_hot } } as const;
}

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
    const value = String(c?.value ?? "").trim();
    if (!isContactType(type) || !value) continue;
    const key = `${type}:${normalizeContact(type, value)}`;
    if (!normalizeContact(type, value) || seen.has(key)) continue;
    seen.add(key);
    out.push({ type, value });
  }
  return out;
}

const NO_ACCESS = "Role kamu hanya bisa melihat (read-only). Minta admin ubah role kalau perlu input.";

/** Context Supabase kalau user boleh input/edit Hot Issues, null kalau tidak */
async function writer() {
  const [ctx, profile] = await Promise.all([getCurrentUser(), getProfile()]);
  return canWriteIssues(profile?.role) ? { ...ctx, isAdmin: profile?.role === "admin" } : null;
}

export async function createIssue(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseIssue(formData);
  if ("error" in parsed) return { error: parsed.error };
  const contacts = parseContacts(formData);

  const w = await writer();
  if (!w) return { error: NO_ACCESS };
  const { supabase } = w;
  // selain admin: PIC otomatis = yang input (dropdown PIC hanya untuk admin)
  const payload = w.isAdmin ? parsed.data : { ...parsed.data, pic_id: w.user.id };
  const { data, error } = await supabase.from("issues").insert(payload).select("id").single();
  if (error || !data) return { error: `Gagal simpan issue: ${error?.message}` };

  if (contacts.length) {
    const { error: cErr } = await supabase
      .from("issue_contacts")
      .insert(contacts.map((c) => ({ ...c, issue_id: data.id })));
    if (cErr) return { error: `Issue tersimpan (#${data.id}) tapi kontak gagal: ${cErr.message}` };
  }

  const aErr = await saveAttachments(supabase, parseAttachments(formData, w.user.id), { kind: "issue", id: data.id });
  if (aErr) return { error: `Issue tersimpan (#${data.id}) tapi lampiran gagal: ${aErr}` };

  revalidatePath("/");
  redirect(`/issues/${data.id}`);
}

export async function updateIssue(id: number, _prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseIssue(formData);
  if ("error" in parsed) return { error: parsed.error };
  const contacts = parseContacts(formData);

  const w = await writer();
  if (!w) return { error: NO_ACCESS };
  const { supabase } = w;
  // selain admin: PIC tidak diubah lewat form (pakai tombol "Saya yang pegang")
  const { pic_id, ...rest } = parsed.data;
  const { error } = await supabase.from("issues").update(w.isAdmin ? { ...rest, pic_id } : rest).eq("id", id);
  if (error) return { error: `Gagal update: ${error.message}` };

  // Sinkronkan kontak: hapus yang dibuang, tambah yang baru
  const { data: existing } = await supabase
    .from("issue_contacts")
    .select("id, type, normalized_value")
    .eq("issue_id", id);

  const wanted = new Map(contacts.map((c) => [`${c.type}:${normalizeContact(c.type, c.value)}`, c]));
  const have = new Map((existing ?? []).map((e) => [`${e.type}:${e.normalized_value}`, e]));

  const toDelete = (existing ?? []).filter((e) => !wanted.has(`${e.type}:${e.normalized_value}`)).map((e) => e.id);
  const toInsert = contacts.filter((c) => !have.has(`${c.type}:${normalizeContact(c.type, c.value)}`));

  if (toDelete.length) {
    const { error: dErr } = await supabase.from("issue_contacts").delete().in("id", toDelete);
    if (dErr) return { error: `Gagal hapus kontak: ${dErr.message}` };
  }
  if (toInsert.length) {
    const { error: iErr } = await supabase
      .from("issue_contacts")
      .insert(toInsert.map((c) => ({ ...c, issue_id: id })));
    if (iErr) return { error: `Gagal tambah kontak: ${iErr.message}` };
  }

  const aErr = await saveAttachments(supabase, parseAttachments(formData, w.user.id), { kind: "issue", id });
  if (aErr) return { error: `Perubahan tersimpan tapi lampiran gagal: ${aErr}` };

  revalidatePath("/");
  revalidatePath(`/issues/${id}`);
  redirect(`/issues/${id}`);
}

export async function setStatus(id: number, status: string) {
  if (!(status in STATUSES)) return;
  const w = await writer();
  if (!w) return;
  const { supabase } = w;
  await supabase.from("issues").update({ status }).eq("id", id);
  revalidatePath(`/issues/${id}`);
  revalidatePath("/");
}

export async function toggleHot(id: number, isHot: boolean) {
  const w = await writer();
  if (!w) return;
  const { supabase } = w;
  await supabase.from("issues").update({ is_hot: isHot }).eq("id", id);
  revalidatePath(`/issues/${id}`);
  revalidatePath("/");
}

export async function takeIssue(id: number) {
  const w = await writer();
  if (!w) return;
  const { supabase, user } = w;
  await supabase.from("issues").update({ pic_id: user.id }).eq("id", id);
  revalidatePath(`/issues/${id}`);
  revalidatePath("/");
}

export async function addNote(id: number, formData: FormData) {
  const w = await writer();
  if (!w) return;
  const { supabase } = w;
  const files = parseAttachments(formData, w.user.id);
  const body = String(formData.get("body") ?? "").trim() || (files.length ? "📎 Lampiran bukti" : "");
  if (!body) return;
  const { data: note } = await supabase.from("issue_notes").insert({ issue_id: id, body }).select("id").single();
  if (note && files.length) await saveAttachments(supabase, files, { kind: "issue_note", id: note.id });
  // sentuh issue supaya "terakhir update" ikut berubah
  await supabase.from("issues").update({ updated_at: new Date().toISOString() }).eq("id", id);
  revalidatePath(`/issues/${id}`);
  revalidatePath("/");
}

export async function deleteNote(issueId: number, noteId: number) {
  const { supabase } = await getCurrentUser();
  const paths = await attachmentPaths(supabase, [{ column: "issue_note_id", ids: [noteId] }]);
  const { data } = await supabase.from("issue_notes").delete().eq("id", noteId).select("id");
  if (data?.length) await removeFiles(supabase, paths);
  revalidatePath(`/issues/${issueId}`);
}

export async function deleteIssue(id: number) {
  const { supabase } = await requireAdmin();
  const { data: notes } = await supabase.from("issue_notes").select("id").eq("issue_id", id);
  const paths = await attachmentPaths(supabase, [
    { column: "issue_id", ids: [id] },
    { column: "issue_note_id", ids: (notes ?? []).map((n) => n.id as number) },
  ]);
  const { data } = await supabase.from("issues").delete().eq("id", id).select("id");
  if (data?.length) await removeFiles(supabase, paths);
  revalidatePath("/");
  redirect("/");
}
