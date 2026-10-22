import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, getProfile } from "@/lib/auth";
import { aiConfig, aiHeaders, listModels, systemPrompt } from "@/lib/ai.server";
import { buildSiteContext, looksAboutSite } from "@/lib/aiContext.server";
import { SMART, isChatModel, isVisionModel, pickTextModel, pickVisionModel } from "@/lib/aiModels";
import { ATTACH_BUCKET } from "@/lib/attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HISTORY = 40; // pesan terakhir yang dikirim ke AI sebagai konteks
const MAX_INPUT = 20000;
const MAX_IMAGES = 4;
const IMAGE_TURNS = 2; // gambar dari 2 pesan terakhir saja yang ikut dikirim ulang

type Body = {
  conversationId?: string | null;
  content?: string;
  model?: string;
  regenerate?: boolean;
  images?: string[];
  data?: "auto" | "off";
};
type Row = { role: "user" | "assistant"; content: string; error: boolean; images: string[] | null; used_data: boolean | null };

const err = (status: number, message: string, convId?: string | null) =>
  NextResponse.json({ error: message }, { status, headers: convId ? { "x-conversation-id": convId } : undefined });

/**
 * Kirim pesan ke AI. Jawaban dialirkan (streaming) sebagai teks biasa.
 * Header: x-conversation-id (id percakapan), x-ai-model (model yang dipakai), x-ai-data ("1" kalau membaca data CS Tracker).
 */
export async function POST(req: NextRequest) {
  const cfg = aiConfig();
  if (!cfg.ok) return err(503, "AI belum disetel. Admin perlu mengisi OMNIROUTE_BASE_URL dan OMNIROUTE_API_KEY di Vercel.");

  const [{ supabase, user }, profile] = await Promise.all([getCurrentUser(), getProfile()]);
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return err(400, "Permintaan tidak valid");
  }
  const content = String(body.content ?? "").trim().slice(0, MAX_INPUT);
  const images = (Array.isArray(body.images) ? body.images : [])
    .map(String)
    .filter((p) => p.startsWith(`${user.id}/ai/`) && !p.includes(".."))
    .slice(0, MAX_IMAGES);
  if (!content && !images.length && !body.regenerate) return err(400, "Pesan kosong");

  // 1) percakapan: pakai yang ada (RLS memastikan milik sendiri) atau buat baru
  let convId = body.conversationId || null;
  if (convId) {
    const { data } = await supabase.from("ai_conversations").select("id").eq("id", convId).maybeSingle();
    if (!data) return err(404, "Percakapan tidak ditemukan");
  } else {
    const title = (content || "Gambar").replace(/\s+/g, " ").slice(0, 60);
    const { data, error } = await supabase.from("ai_conversations").insert({ title, model: body.model ?? null }).select("id").single();
    if (error || !data) {
      return err(500, /ai_conversations/.test(error?.message ?? "") ? "Tab AI belum aktif — jalankan supabase/migration-13-ai-chat.sql dulu." : `Gagal membuat percakapan: ${error?.message}`);
    }
    convId = data.id as string;
  }

  // 2) simpan pesan user / ulangi jawaban terakhir
  if (body.regenerate) {
    const { data: last } = await supabase.from("ai_messages").select("id, role").eq("conversation_id", convId).order("id", { ascending: false }).limit(1).maybeSingle();
    if (last?.role === "assistant") await supabase.from("ai_messages").delete().eq("id", last.id);
  } else {
    let { error } = await supabase.from("ai_messages").insert({ conversation_id: convId, role: "user", content, images });
    if (error && /images/.test(error.message)) {
      if (images.length) return err(500, "Kirim gambar belum aktif — admin perlu menjalankan supabase/migration-14-ai-gambar-data.sql.", convId);
      ({ error } = await supabase.from("ai_messages").insert({ conversation_id: convId, role: "user", content }));
    }
    if (error) return err(500, `Gagal simpan pesan: ${error.message}`, convId);
  }

  // 3) riwayat percakapan
  let histRes = await supabase.from("ai_messages").select("role, content, error, images, used_data").eq("conversation_id", convId).order("id", { ascending: false }).limit(HISTORY);
  if (histRes.error) histRes = (await supabase.from("ai_messages").select("role, content, error").eq("conversation_id", convId).order("id", { ascending: false }).limit(HISTORY)) as typeof histRes;
  const hist = ((histRes.data ?? []) as Row[]).reverse().filter((m) => !m.error && (m.content || (m.images?.length ?? 0) > 0));
  const lastUser = [...hist].reverse().find((m) => m.role === "user");
  const lastText = lastUser?.content ?? content;
  // gambar hanya ikut dikirim kalau ada di 3 pesan user terakhir (maks 2 pesan bergambar)
  const userIdx = hist.map((m, i) => (m.role === "user" ? i : -1)).filter((i) => i >= 0).slice(-3);
  const imageTurns = new Set(userIdx.filter((i) => (hist[i].images?.length ?? 0) > 0).slice(-IMAGE_TURNS));
  const hasImages = imageTurns.size > 0;

  // 4) pilih model
  const models = await listModels();
  let model = String(body.model ?? "").trim().slice(0, 200) || cfg.model;
  if (model === SMART || (models.length && !models.includes(model) && model !== "auto")) {
    model = (hasImages && (cfg.visionModel || pickVisionModel(models))) || pickTextModel(models) || "auto";
  }
  if (hasImages && !isVisionModel(model) && model !== "auto") {
    const v = cfg.visionModel || pickVisionModel(models);
    if (!v) {
      const msg = "Model yang bisa membaca gambar belum tersambung. Sambungkan Gemini (API key dari aistudio.google.com/apikey) di dashboard OmniRoute → Providers.";
      await supabase.from("ai_messages").insert({ conversation_id: convId, role: "assistant", content: msg, error: true, model });
      return err(422, msg, convId);
    }
    model = v;
  }
  if (!isChatModel(model)) model = pickTextModel(models) || "auto";

  // 5) data CS Tracker (otomatis kalau pertanyaannya soal isi website / lanjutan dari jawaban yang memakai data)
  const prevAssistant = [...hist].reverse().find((m) => m.role === "assistant");
  // pertanyaan lanjutan ("yang itu siapa PIC-nya?") setelah jawaban yang memakai data -> tetap pakai data
  const followUp = !!prevAssistant?.used_data && lastText.length < 200 && /\b(itu|tadi|tersebut|yang mana|siapa|berapa|kenapa|kapan|detail|lanjut|lainnya|yang lain|nomor|#\d+)\b|\w+nya\b/i.test(lastText);
  const useData = body.data !== "off" && (looksAboutSite(lastText) || followUp);
  const context = useData ? await buildSiteContext(supabase).catch(() => "") : "";

  // 6) gambar -> data URL
  const toDataUrl = async (path: string) => {
    const { data } = await supabase.storage.from(ATTACH_BUCKET).download(path);
    if (!data) return null;
    const buf = Buffer.from(await data.arrayBuffer());
    return `data:${data.type || "image/jpeg"};base64,${buf.toString("base64")}`;
  };
  const messages: { role: string; content: string | { type: string; text?: string; image_url?: { url: string } }[] }[] = [
    { role: "system", content: systemPrompt(profile?.full_name || "anggota tim") },
  ];
  if (context) messages.push({ role: "system", content: context });
  for (const [i, m] of hist.entries()) {
    const imgs = m.images ?? [];
    if (m.role === "user" && imgs.length && imageTurns.has(i)) {
      const urls = (await Promise.all(imgs.map(toDataUrl))).filter((u): u is string => !!u);
      messages.push({
        role: "user",
        content: [{ type: "text", text: m.content || "Tolong jelaskan gambar ini." }, ...urls.map((url) => ({ type: "image_url", image_url: { url } }))],
      });
    } else {
      messages.push({ role: m.role, content: m.content + (imgs.length ? `\n[${imgs.length} gambar dilampirkan sebelumnya]` : "") });
    }
  }

  const saveError = async (msg: string, status = 502) => {
    await supabase.from("ai_messages").insert({ conversation_id: convId, role: "assistant", content: msg, error: true, model });
    return err(status, msg, convId);
  };

  // 7) panggil OmniRoute (format OpenAI, streaming)
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
    return saveError(`Tidak bisa menghubungi server AI (${e instanceof Error ? e.message : "error"}). Cek OMNIROUTE_BASE_URL & VPS-nya nyala.`);
  }
  if (!upstream.ok || !upstream.body) {
    let detail = "";
    try {
      const t = await upstream.text();
      detail = (JSON.parse(t)?.error?.message as string) || t;
    } catch {}
    return saveError(`Server AI menolak (${upstream.status}). ${String(detail).slice(0, 300)}`.trim());
  }

  // 8) alirkan ke browser sambil dikumpulkan, lalu simpan jawaban lengkap
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
              if (j.model && model === "auto") usedModel = String(j.model);
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
          const row = { conversation_id: convId, role: "assistant", content: full.slice(0, 100000), model: usedModel, used_data: useData };
          const { error } = await supabase.from("ai_messages").insert(row);
          if (error && /used_data/.test(error.message)) {
            const { used_data: _u, ...old } = row;
            await supabase.from("ai_messages").insert(old);
          }
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
      "x-ai-model": encodeURIComponent(model),
      "x-ai-data": useData ? "1" : "0",
    },
  });
}
