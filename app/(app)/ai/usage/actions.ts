"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isAiOwner } from "@/lib/aiOwner";
import { PIN_COOKIE, pinToken, usagePin } from "./pin";

export async function unlockUsage(formData: FormData) {
  const { user } = await getCurrentUser();
  if (!isAiOwner(user.email)) redirect("/ai");
  const pin = String(formData.get("pin") ?? "").trim();
  // jeda kecil supaya PIN tidak gampang ditebak beruntun
  await new Promise((r) => setTimeout(r, 700));
  if (pin !== usagePin()) redirect("/ai/usage?salah=1");
  (await cookies()).set(PIN_COOKIE, pinToken(user.id), { httpOnly: true, secure: true, sameSite: "lax", path: "/ai/usage", maxAge: 60 * 60 * 12 });
  redirect("/ai/usage");
}

export async function lockUsage() {
  (await cookies()).delete({ name: PIN_COOKIE, path: "/ai/usage" });
  redirect("/ai");
}
