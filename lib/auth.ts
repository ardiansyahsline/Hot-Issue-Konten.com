import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import { canWriteIssues, canWriteReviews } from "@/lib/roles";

/** User yang login (id + email). Di-cache per request supaya tidak dipanggil berkali-kali. */
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) redirect("/login");
  const user = { id: claims.sub as string, email: (claims.email as string | undefined) ?? "" };
  return { supabase, user };
});

/** Profile (nama + role). Dipisah supaya halaman bisa mulai query tanpa nunggu profile. */
export const getProfile = cache(async () => {
  const { supabase, user } = await getCurrentUser();
  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  return (data as Profile | null) ?? null;
});

export async function requireAdmin() {
  const [ctx, profile] = await Promise.all([getCurrentUser(), getProfile()]);
  if (profile?.role !== "admin") redirect("/");
  return { ...ctx, profile };
}

/** Lempar balik ke halaman sebelumnya kalau role tidak punya akses tulis */
export async function requireWriter(kind: "issues" | "reviews", fallback = "/") {
  const profile = await getProfile();
  const ok = kind === "issues" ? canWriteIssues(profile?.role) : canWriteReviews(profile?.role);
  if (!ok) redirect(fallback);
  return profile;
}
