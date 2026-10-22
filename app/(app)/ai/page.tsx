import { getCurrentUser, getProfile } from "@/lib/auth";
import { aiConfig } from "@/lib/ai.server";
import AiChat, { type AiConv, type AiMsg } from "@/components/ai/AiChat";

export const metadata = { title: "AI · CS Tracker" };

export default async function AiPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  const [{ supabase }, profile] = await Promise.all([getCurrentUser(), getProfile()]);
  const [{ data: convs, error }, msgsRes] = await Promise.all([
    supabase.from("ai_conversations").select("id, title, model, updated_at").order("updated_at", { ascending: false }).limit(300),
    c
      ? supabase.from("ai_messages").select("id, role, content, model, error, created_at").eq("conversation_id", c).order("id")
      : Promise.resolve({ data: [] }),
  ]);
  const cfg = aiConfig();
  return (
    <AiChat
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
            ? "AI belum disambungkan — admin perlu mengisi OMNIROUTE_BASE_URL dan OMNIROUTE_API_KEY di Vercel lalu Redeploy."
            : null
      }
      defaultModel={cfg.model}
    />
  );
}
