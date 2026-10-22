"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";

export type AkunState = { error?: string; ok?: string } | undefined;

export async function updateName(_prev: AkunState, formData: FormData): Promise<AkunState> {
  const full_name = String(formData.get("full_name") ?? "").trim();
  if (!full_name) return { error: "Nama tidak boleh kosong." };
  const { supabase, user } = await getCurrentUser();
  const { error } = await supabase.from("profiles").update({ full_name }).eq("id", user.id);
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: "Nama disimpan." };
}

export async function updatePassword(_prev: AkunState, formData: FormData): Promise<AkunState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password.length < 8) return { error: "Password minimal 8 karakter." };
  if (password !== confirm) return { error: "Konfirmasi password tidak sama." };
  const { supabase } = await getCurrentUser();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  return { ok: "Password berhasil diganti." };
}

/** Simpan / hapus foto profil (file sudah di-upload ke bucket "avatar" dari browser) */
export async function setAvatar(url: string | null): Promise<AkunState> {
  const { supabase, user } = await getCurrentUser();
  const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/avatar/${user.id}/`;
  if (url !== null && !url.startsWith(base)) return { error: "Foto tidak valid." };
  const { data: old } = await supabase.from("profiles").select("avatar_url").eq("id", user.id).maybeSingle();
  const { error } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", user.id);
  if (error) return { error: /avatar_url/.test(error.message) ? "Foto profil belum aktif (migration-09 belum dijalankan)." : error.message };
  // file lama dibuang supaya storage tidak penuh
  const oldUrl = old?.avatar_url as string | null | undefined;
  if (oldUrl && oldUrl !== url && oldUrl.startsWith(base)) {
    await supabase.storage.from("avatar").remove([oldUrl.slice(oldUrl.indexOf(`${user.id}/`))]);
  }
  revalidatePath("/", "layout");
  return { ok: url ? "Foto profil disimpan." : "Foto profil dihapus." };
}
