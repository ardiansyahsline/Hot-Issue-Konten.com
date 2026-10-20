"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isRole } from "@/lib/roles";

export type AdminState = { error?: string; ok?: string } | undefined;

export async function createUser(_prev: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const full_name = String(formData.get("full_name") ?? "").trim();
  const roleRaw = formData.get("role");
  const role = isRole(roleRaw) ? roleRaw : "user";

  if (!email || !full_name) return { error: "Nama dan email wajib diisi." };
  if (password.length < 8) return { error: "Password minimal 8 karakter." };

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
    app_metadata: { role },
  });
  if (error) return { error: `Gagal buat akun: ${error.message}` };

  revalidatePath("/admin");
  return { ok: `Akun ${email} berhasil dibuat. Kirim email + password ke agent.` };
}

export async function setRole(userId: string, role: string): Promise<AdminState> {
  const { user } = await requireAdmin();
  if (!isRole(role)) return { error: "Role tidak valid" };
  if (userId === user.id) return { error: "Tidak bisa ubah role sendiri" };
  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update({ role }).eq("id", userId);
  if (error) return { error: error.message };
  await admin.auth.admin.updateUserById(userId, { app_metadata: { role } });
  revalidatePath("/admin");
  return { ok: "Role disimpan" };
}

export async function resetPassword(userId: string, _prev: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return { error: "Min. 8 karakter" };
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) return { error: error.message };
  return { ok: "Password diganti" };
}

export async function deleteUser(userId: string) {
  const { user } = await requireAdmin();
  if (userId === user.id) return;
  const admin = createAdminClient();
  await admin.auth.admin.deleteUser(userId);
  revalidatePath("/admin");
}
