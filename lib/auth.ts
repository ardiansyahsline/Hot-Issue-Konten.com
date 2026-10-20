import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { EMAIL_HEADER, UID_HEADER } from "@/lib/authHeaders";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import { canEditReviews, canWriteIssues, canWriteReviews } from "@/lib/roles";

/** User yang login (id + email). Di-cache per request supaya tidak dipanggil berkali-kali. */
export const getCurrentUser = cache(async () => {
  const [supabase, h] = await Promise.all([createClient(), headers()]);
  // middleware sudah memverifikasi login di request ini -> tidak perlu cek ulang ke Supabase
  const uid = h.get(UID_HEADER);
  if (uid) return { supabase, user: { id: uid, email: decodeURIComponent(h.get(EMAIL_HEADER) ?? "") } };
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
export async function requireWriter(kind: "issues" | "reviews" | "reviews-edit", fallback = "/") {
  const profile = await getProfile();
  const ok =
    kind === "issues" ? canWriteIssues(profile?.role) : kind === "reviews" ? canWriteReviews(profile?.role) : canEditReviews(profile?.role);
  if (!ok) redirect(fallback);
  return profile;
}
