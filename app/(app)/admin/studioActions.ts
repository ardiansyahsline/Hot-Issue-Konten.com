"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { STUDIO_MAX, studioErrorText } from "@/lib/studio/access.server";

export type StudioState = { error?: string; ok?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Admin = Awaited<ReturnType<typeof requireAdmin>>;
type Target = { id: string; full_name: string | null; email: string | null; role: string };

const nameOf = (p: { full_name?: string | null; email?: string | null } | null | undefined, fallback = "User") =>
  p?.full_name?.trim() || p?.email || fallback;

/** catat ke log (gagal mencatat tidak membatalkan perubahan akses) */
async function writeLog({ supabase, user, profile }: Admin, target: { id: string; name: string }, action: "grant" | "revoke") {
  const { error } = await supabase.from("studio_access_log").insert({
    user_id: target.id,
    user_name: target.name,
    action,
    by_id: user.id,
    by_name: nameOf(profile, user.email || "Admin"),
  });
  if (error) console.error("studio_access_log:", error.message);
}

function refresh() {
  revalidatePath("/admin");
  // menu Studio di header ikut diperbarui
  revalidatePath("/", "layout");
}

export async function grantStudioAccess(userId: string): Promise<StudioState> {
  const admin = await requireAdmin();
  const { supabase, user } = admin;
  if (typeof userId !== "string" || !UUID.test(userId)) return { error: "Pilih user dulu." };

  // validasi di server: target ada & bukan admin, kuota dihitung ulang (trigger DB juga menjaga)
  const [t, c, own] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, role").eq("id", userId).maybeSingle(),
    supabase.from("studio_access").select("user_id", { count: "exact", head: true }),
    supabase.from("studio_access").select("user_id").eq("user_id", userId).maybeSingle(),
  ]);
  if (t.error) return { error: studioErrorText(t.error) };
  const target = t.data as Target | null;
  if (!target) return { error: "User tidak ditemukan. Muat ulang halaman." };
  if (target.role === "admin") return { error: "Admin sudah otomatis punya akses Studio." };
  if (c.error) return { error: studioErrorText(c.error) };
  const name = nameOf(target);
  if (own.data) {
    refresh();
    return { ok: `${name} sudah punya akses.` };
  }
  if ((c.count ?? 0) >= STUDIO_MAX) return { error: `Akses Studio sudah penuh (maksimal ${STUDIO_MAX} orang). Cabut salah satu dulu.` };

  const { error } = await supabase.from("studio_access").insert({ user_id: userId, granted_by: user.id });
  if (error) return { error: studioErrorText(error) };
  await writeLog(admin, { id: userId, name }, "grant");
  refresh();
  return { ok: `${name} sekarang bisa memakai Studio.` };
}

export async function revokeStudioAccess(userId: string): Promise<StudioState> {
  const admin = await requireAdmin();
  const { supabase } = admin;
  if (typeof userId !== "string" || !UUID.test(userId)) return { error: "User tidak valid." };

  const { data: p } = await supabase.from("profiles").select("full_name, email").eq("id", userId).maybeSingle();
  const name = nameOf(p, "User dihapus");
  const { data, error } = await supabase.from("studio_access").delete().eq("user_id", userId).select("user_id");
  if (error) return { error: studioErrorText(error) };
  refresh();
  if (!data?.length) return { ok: `Akses ${name} sudah dicabut sebelumnya.` };
  await writeLog(admin, { id: userId, name }, "revoke");
  return { ok: `Akses Studio ${name} dicabut.` };
}
