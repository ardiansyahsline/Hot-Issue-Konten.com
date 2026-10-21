"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { TARGET_COLUMN, type AttachTarget } from "@/lib/attachments";
import { parseAttachments, removeFiles, saveAttachments } from "@/lib/attachments.server";

export type AttachState = { ok?: string; error?: string } | undefined;

const safePath = (p: string) => (p.startsWith("/") && !p.startsWith("//") ? p : "/");

/** "+ Tambah" lampiran di halaman detail */
export async function addAttachments(target: AttachTarget, page: string, _prev: AttachState, fd: FormData): Promise<AttachState> {
  if (!(target.kind in TARGET_COLUMN) || !Number.isInteger(target.id)) return { error: "Tujuan lampiran tidak valid." };
  const { supabase, user } = await getCurrentUser();
  const items = parseAttachments(fd, user.id);
  if (!items.length) return { error: "Pilih minimal satu file dulu." };
  const err = await saveAttachments(supabase, items, target);
  if (err) {
    await removeFiles(supabase, items.map((i) => i.path));
    return { error: /row-level security/i.test(err) ? "Kamu tidak punya akses menambah lampiran di sini." : `Gagal simpan lampiran: ${err}` };
  }
  revalidatePath(safePath(page));
  return { ok: `${items.length} lampiran ditambahkan.` };
}

/** Hapus satu lampiran (pengunggah / admin) */
export async function deleteAttachment(id: number, page: string): Promise<AttachState> {
  const { supabase } = await getCurrentUser();
  const { data, error } = await supabase.from("attachments").delete().eq("id", id).select("path");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Hanya pengunggah atau admin yang bisa menghapus lampiran ini." };
  await removeFiles(supabase, data.map((d) => d.path as string));
  revalidatePath(safePath(page));
  return { ok: "Lampiran dihapus." };
}
