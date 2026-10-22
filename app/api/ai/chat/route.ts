import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, getProfile } from "@/lib/auth";
import { aiConfig, aiHeaders, systemPrompt } from "@/lib/ai.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HISTORY = 40; // pesan terakhir yang dikirim ke AI sebagai konteks
const MAX_INPUT = 20000;

type Body = { conversationId?: string | null; content?: string; model?: string; regenerate?: boolean };

const err = (status: number, message: string, convId?: string | null) =>
  NextResponse.json({ error: message }, { status, headers: convId ? { "x-conversation-id": convId } : undefined });

/**
 * Kirim pesan ke AI. Jawaban dialirkan (streaming) sebagai teks biasa.
 * Header `x-conversation-id` berisi id percakapan (baru dibuat kalau belum ada).
 */
export async function POST(req: NextRequest) {
  const cfg = aiConfig();
  if (!cfg.ok) return err(503, "AI belum disetel. Admin perlu mengisi OMNIROUTE_BASE_URL dan OMNIROUTE_API_KEY di Vercel.");

  const [{ supabase }, profile] = await Promise.all([getCurrentUser(), getProfile()]);
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return err(400, "Permintaan tidak valid");
  }
  const content = String(body.content ?? "").trim().slice(0, MAX_INPUT);
  const model = String(body.model ?? "").trim().slice(0, 200) || cfg.model;
  if (!content && !body.regenerate) return err(400, "Pesan kosong");

  // 1) percakapan: pakai yang ada (RLS memastikan milik sendiri) atau buat baru
  let convId = body.conversationId || null;
  if (convId) {
    const { data } = await supabase.from("ai_conversations").select("id").eq("id", convId).maybeSingle();
    if (!data) return err(404, "Percakapan tidak ditemukan");
  } else {
    const title = content.replace(/\s+/g, " ").slice(0, 60) || "Chat baru";
    const { data, error } = await supabase.from("ai_conversations").insert({ title, model }).select("id").single();
    if (error || !data) {
      return err(500, /ai_conversations/.test(error?.message ?? "") ? "Tab AI belum aktif — jalankan supabase/migration-13-ai-chat.sql dulu." : `Gagal membuat percakapan: ${error?.message}`);
    }
    convId = data.id as string;
  }

  // 2) simpan pesan user / ulangi jawaban terakhir
  if (body.regenerate) {
    const { data: last } = await supabase
      .from("ai_messages")
      .select("id, role")
      .eq("conversation_id", convId)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last?.role === "assistant") await supabase.from("ai_messages").delete().eq("id", last.id);
  } else {
    const { error } = await supabase.from("ai_messages").insert({ conversation_id: convId, role: "user", content });
    if (error) return err(500, `Gagal simpan pesan: ${error.message}`);
  }

  const { data: hist } = await supabase
    .from("ai_messages")
    .select("role, content, error")
    .eq("conversation_id", convId)
    .order("id", { ascending: false })
    .limit(HISTORY);
  const messages = [
    { role: "system", content: systemPrompt(profile?.full_name || "anggota tim") },
    ...((hist ?? []) as { role: string; content: string; error: boolean }[])
      .reverse()
      .filter((m) => !m.error && m.content),
  ].map(({ role, content }) => ({ role, content }));

  // 3) panggil OmniRoute (format OpenAI, streaming)
  const upstreamAbort = new AbortController();
  req.signal.addEventListener("abort", () => upstreamAbort.abort());
  let upstream: Response;
  try {
    upstream = await fetch(`${cfg.base}/chat/completions`, {
      method: "POST",
      headers: aiHeaders(cfg.key),
      body: JSON.stringify({ model, messages, stream: true }),
      signal: upstreamAbort.signal,
    });
  } catch (e) {
    const msg = `Tidak bisa menghubungi server AI (${e instanceof Error ? e.message : "error"}). Cek OMNIROUTE_BASE_URL & VPS-nya nyala.`;
    await supabase.from("ai_messages").insert({ conversation_id: convId, role: "assistant", content: msg, error: true, model });
    return err(502, msg, convId);
  }
  if (!upstream.ok || !upstream.body) {
    let detail = "";
    try {
      const t = await upstream.text();
      detail = (JSON.parse(t)?.error?.message as string) || t;
    } catch {}
    const msg = `Server AI menolak (${upstream.status}). ${String(detail).slice(0, 300)}`.trim();
    await supabase.from("ai_messages").insert({ conversation_id: convId, role: "assistant", content: msg, error: true, model });
    return err(502, msg, convId);
  }

  // 4) alirkan ke browser sambil dikumpulkan, lalu simpan jawaban lengkap
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  let full = "";
  let usedModel = model;
  const reader = upstream.body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let buf = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") continue;
            try {
              const j = JSON.parse(data);
              if (j.model) usedModel = String(j.model);
              const piece: string = j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.message?.content ?? "";
              if (piece) {
                full += piece;
                controller.enqueue(enc.encode(piece));
              }
              if (j.error?.message) {
                const e = `\n\n⚠️ ${j.error.message}`;
                full += e;
                controller.enqueue(enc.encode(e));
              }
            } catch {
              // baris bukan JSON — abaikan
            }
          }
        }
      } catch {
        // dihentikan user / koneksi putus — simpan yang sudah ada
      } finally {
        if (full.trim()) {
          await supabase.from("ai_messages").insert({ conversation_id: convId, role: "assistant", content: full.slice(0, 100000), model: usedModel });
        }
        await supabase.from("ai_conversations").update({ updated_at: new Date().toISOString(), model: usedModel }).eq("id", convId);
        try {
          controller.close();
        } catch {}
      }
    },
    cancel() {
      upstreamAbort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "x-conversation-id": convId!,
    },
  });
}
