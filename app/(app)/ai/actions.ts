"use server";

import { getCurrentUser } from "@/lib/auth";
import { assertTab } from "@/lib/tabs.server";
import { removeFiles } from "@/lib/attachments.server";

export async function renameConversation(id: string, title: string) {
  const t = title.replace(/\s+/g, " ").trim().slice(0, 120);
  if (!t) return { error: "Judul kosong" };
  const tab = await assertTab("ai");
  if (!tab.ok) return { error: tab.error };
  const { supabase } = await getCurrentUser();
  const { error } = await supabase.from("ai_conversations").update({ title: t }).eq("id", id);
  return error ? { error: error.message } : { ok: true };
}

export async function deleteConversation(id: string) {
  const tab = await assertTab("ai");
  if (!tab.ok) return { error: tab.error };
  const { supabase, user } = await getCurrentUser();
  // gambar yang pernah dikirim ikut dihapus dari Storage
  const { data: msgs } = await supabase.from("ai_messages").select("images").eq("conversation_id", id);
  const paths = (msgs ?? [])
    .flatMap((m) => ((m as { images?: string[] }).images ?? []) as string[])
    .filter((p) => typeof p === "string" && p.startsWith(`${user.id}/ai/`));
  const { error } = await supabase.from("ai_conversations").delete().eq("id", id);
  if (error) return { error: error.message };
  if (paths.length) await removeFiles(supabase, paths);
  return { ok: true };
}
