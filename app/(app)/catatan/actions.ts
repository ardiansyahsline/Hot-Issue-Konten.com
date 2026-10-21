"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser, getProfile } from "@/lib/auth";
import { isSgCategory, isSgStatus } from "@/lib/suggestions";
import { attachmentPaths, parseAttachments, removeFiles, saveAttachments } from "@/lib/attachments.server";

export type SgState = { error?: string; ok?: string } | undefined;

function parse(fd: FormData) {
  const category = fd.get("category");
  const title = String(fd.get("title") ?? "").trim();
  const body = String(fd.get("body") ?? "").trim() || null;
  if (!isSgCategory(category)) return { error: "Pilih kategori dulu." } as const;
  if (!title) return { error: "Judul wajib diisi." } as const;
  return { data: { category, title, body } } as const;
}

export async function createSuggestion(_prev: SgState, fd: FormData): Promise<SgState> {
  const parsed = parse(fd);
  if ("error" in parsed) return { error: parsed.error };
  const [{ supabase, user }, profile] = await Promise.all([getCurrentUser(), getProfile()]);
  // pencatat = user login; hanya admin yang boleh mencatatkan atas nama orang lain
  const author = profile?.role === "admin" ? String(fd.get("created_by") ?? "") || user.id : user.id;
  const { data, error } = await supabase
    .from("suggestions")
    .insert({ ...parsed.data, created_by: author })
    .select("id")
    .single();
  if (error || !data) return { error: `Gagal simpan: ${error?.message}` };
  const aErr = await saveAttachments(supabase, parseAttachments(fd, user.id), { kind: "suggestion", id: data.id });
  if (aErr) return { error: `Catatan tersimpan tapi lampiran gagal: ${aErr}` };
  revalidatePath("/catatan");
  redirect(`/catatan/${data.id}`);
}

export async function updateSuggestion(id: number, _prev: SgState, fd: FormData): Promise<SgState> {
  const parsed = parse(fd);
  if ("error" in parsed) return { error: parsed.error };
  const [{ supabase, user }, profile] = await Promise.all([getCurrentUser(), getProfile()]);
  const patch: Record<string, unknown> = { ...parsed.data };
  if (profile?.role === "admin" && fd.get("created_by")) patch.created_by = String(fd.get("created_by"));
  const { data, error } = await supabase.from("suggestions").update(patch).eq("id", id).select("id");
  if (error) return { error: `Gagal update: ${error.message}` };
  if (!data?.length) return { error: "Kamu hanya bisa mengedit catatan milik sendiri." };
  const aErr = await saveAttachments(supabase, parseAttachments(fd, user.id), { kind: "suggestion", id });
  if (aErr) return { error: `Perubahan tersimpan tapi lampiran gagal: ${aErr}` };
  revalidatePath("/catatan");
  revalidatePath(`/catatan/${id}`);
  redirect(`/catatan/${id}`);
}

/** Ubah progress (Baru / In Progress / Done / Rejected) + alasan — khusus admin */
export async function setProgress(id: number, _prev: SgState, fd: FormData): Promise<SgState> {
  const status = fd.get("status");
  const reason = String(fd.get("status_reason") ?? "").trim() || null;
  if (!isSgStatus(status)) return { error: "Status tidak valid." };
  if (status === "rejected" && !reason) return { error: "Isi alasan kenapa saran ini di-reject." };
  const [{ supabase }, profile] = await Promise.all([getCurrentUser(), getProfile()]);
  if (profile?.role !== "admin") return { error: "Hanya admin yang bisa mengubah progress." };
  const { error } = await supabase.from("suggestions").update({ status, status_reason: reason }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/catatan");
  revalidatePath(`/catatan/${id}`);
  return { ok: "Progress disimpan." };
}

export async function addComment(id: number, fd: FormData) {
  const { supabase, user } = await getCurrentUser();
  const files = parseAttachments(fd, user.id);
  const body = String(fd.get("body") ?? "").trim() || (files.length ? "📎 Lampiran bukti" : "");
  if (!body) return;
  const { data: c } = await supabase.from("suggestion_comments").insert({ suggestion_id: id, body }).select("id").single();
  if (c && files.length) await saveAttachments(supabase, files, { kind: "suggestion_comment", id: c.id });
  revalidatePath(`/catatan/${id}`);
  revalidatePath("/catatan");
}

export async function deleteComment(id: number, commentId: number) {
  const { supabase } = await getCurrentUser();
  const paths = await attachmentPaths(supabase, [{ column: "suggestion_comment_id", ids: [commentId] }]);
  const { data } = await supabase.from("suggestion_comments").delete().eq("id", commentId).select("id");
  if (data?.length) await removeFiles(supabase, paths);
  revalidatePath(`/catatan/${id}`);
}

export async function deleteSuggestion(id: number) {
  const { supabase } = await getCurrentUser();
  const { data: cs } = await supabase.from("suggestion_comments").select("id").eq("suggestion_id", id);
  const paths = await attachmentPaths(supabase, [
    { column: "suggestion_id", ids: [id] },
    { column: "suggestion_comment_id", ids: (cs ?? []).map((c) => c.id as number) },
  ]);
  const { data } = await supabase.from("suggestions").delete().eq("id", id).select("id");
  if (data?.length) await removeFiles(supabase, paths);
  revalidatePath("/catatan");
  redirect("/catatan");
}
