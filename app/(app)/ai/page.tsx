import { getCurrentUser, getProfile } from "@/lib/auth";
import { aiConfig } from "@/lib/ai.server";
import AiChat, { type AiConv, type AiMsg } from "@/components/ai/AiChat";
import { isAiOwner } from "@/lib/aiOwner";

export const metadata = { title: "AI · CS Tracker" };

export default async function AiPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  const [{ supabase, user }, profile] = await Promise.all([getCurrentUser(), getProfile()]);
  const loadMsgs = async () => {
    if (!c) return { data: [] };
    const p0 = await supabase.from("ai_messages").select("id, role, content, model, error, created_at, images, used_data, persona, character_id").eq("conversation_id", c).order("id");
    if (!p0.error) return p0;
    const p = await supabase.from("ai_messages").select("id, role, content, model, error, created_at, images, used_data, persona").eq("conversation_id", c).order("id");
    if (!p.error) return p;
    const r = await supabase.from("ai_messages").select("id, role, content, model, error, created_at, images, used_data").eq("conversation_id", c).order("id");
    // migration-14 belum dijalankan -> tanpa kolom gambar
    return r.error ? await supabase.from("ai_messages").select("id, role, content, model, error, created_at").eq("conversation_id", c).order("id") : r;
  };
  const [{ data: convs, error }, msgsRes] = await Promise.all([
    supabase.from("ai_conversations").select("id, title, model, updated_at").order("updated_at", { ascending: false }).limit(300),
    loadMsgs(),
  ]);
  const cfg = aiConfig();
  return (
    <AiChat
      meId={user.id}
      firstName={(profile?.full_name ?? "").split(" ")[0] || "kamu"}
      initialConvs={(convs ?? []) as AiConv[]}
      initialId={c && (convs ?? []).some((x) => x.id === c) ? c : null}
      initialMsgs={(msgsRes.data ?? []) as AiMsg[]}
      setupError={
        error
          ? /ai_conversations/.test(error.message)
            ? "Tab AI belum aktif — admin perlu menjalankan supabase/migration-13-ai-chat.sql."
            : error.message
          : !cfg.ok
            ? "AI belum disambungkan — admin perlu melengkapi pengaturan AI (alamat & kunci server AI) di Vercel lalu Redeploy."
            : null
      }
      defaultModel={cfg.model}
      owner={isAiOwner(user.email)}
    />
  );
}
