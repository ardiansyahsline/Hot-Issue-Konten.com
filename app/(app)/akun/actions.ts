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
