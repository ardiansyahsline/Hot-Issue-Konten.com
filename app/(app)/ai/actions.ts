"use server";

import { getCurrentUser } from "@/lib/auth";

export async function renameConversation(id: string, title: string) {
  const t = title.replace(/\s+/g, " ").trim().slice(0, 120);
  if (!t) return { error: "Judul kosong" };
  const { supabase } = await getCurrentUser();
  const { error } = await supabase.from("ai_conversations").update({ title: t }).eq("id", id);
  return error ? { error: error.message } : { ok: true };
}

export async function deleteConversation(id: string) {
  const { supabase } = await getCurrentUser();
  const { error } = await supabase.from("ai_conversations").delete().eq("id", id);
  return error ? { error: error.message } : { ok: true };
}
