"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { REACTION_COLUMN, isEmoji, type ReactionTarget } from "@/lib/reactions";

/** Kasih / tarik reaksi emoji. Klik emoji yang sama lagi = batal. */
export async function toggleReaction(target: ReactionTarget, emoji: string, page?: string): Promise<{ on?: boolean; error?: string }> {
  if (!(target.kind in REACTION_COLUMN) || !Number.isInteger(target.id)) return { error: "Target tidak valid" };
  if (!isEmoji(emoji)) return { error: "Emoji tidak valid" };
  const col = REACTION_COLUMN[target.kind];
  const { supabase, user } = await getCurrentUser();
  const { data: existing } = await supabase
    .from("reactions")
    .select("id")
    .eq("user_id", user.id)
    .eq("emoji", emoji)
    .eq(col, target.id)
    .limit(1);
  let on: boolean;
  if (existing?.length) {
    const { error } = await supabase.from("reactions").delete().eq("id", existing[0].id);
    if (error) return { error: error.message };
    on = false;
  } else {
    const { error } = await supabase.from("reactions").insert({ emoji, [col]: target.id });
    if (error && !/duplicate/i.test(error.message)) return { error: error.message };
    on = true;
  }
  if (page && page.startsWith("/") && !page.startsWith("//")) revalidatePath(page);
  return { on };
}
