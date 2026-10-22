import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, getProfile } from "@/lib/auth";
import { aiConfig, aiHeaders, healthMap, healthRank, listCatalog, loadHealth, markHealth, systemPrompt } from "@/lib/ai.server";
import { buildSiteContext, looksAboutSite } from "@/lib/aiContext.server";
import { SMART, heroName, isChatModel, isVisionModel, providerOf, rankTextModels, rankVisionModels, setVisionCatalog } from "@/lib/aiModels";
import { ATTACH_BUCKET } from "@/lib/attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HISTORY = 40; // pesan terakhir yang dikirim ke AI sebagai konteks
const MAX_INPUT = 20000;
const MAX_IMAGES = 4;
const IMAGE_TURNS = 2; // gambar dari 2 pesan terakhir saja yang ikut dikirim ulang
const MAX_TRIES = 6; // maksimal model yang dicoba bergantian kalau error

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
  if (!cfg.ok) return err(503, "AI belum disetel. Admin perlu melengkapi pengaturan AI di Vercel.");

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

  // 4) daftar calon model: pilihan user dulu, lalu cadangan terbaik.
  //    Katalog OmniRoute berisi juga provider yang BELUM disambungkan, jadi urutannya:
  //    model yang terbukti jalan -> belum pernah dicoba -> yang baru gagal; dan tiap hero/provider cukup dicoba sekali.
  const [catalog, health] = await Promise.all([listCatalog(), loadHealth(supabase)]);
  const models = catalog.ids;
  setVisionCatalog(catalog.vision);
  const chosen = String(body.model ?? "").trim().slice(0, 200) || cfg.model;
  // katalog gagal terbaca (server AI lambat / putus sesaat) -> pakai model yang pernah terbukti jalan, bukan "auto"
  const pool = models.length ? models : [...health.values()].filter((h) => healthRank(h) === 0).map((h) => h.model).filter(isChatModel);
  const ranked = hasImages ? [...(cfg.visionModel ? [cfg.visionModel] : []), ...rankVisionModels(pool)] : rankTextModels(pool);
  const hm = healthMap(ranked, health);
  const byHealth = ranked
    .map((m, i) => ({ m, i, h: (hm.get(m) ?? 1) + (coolingDown(m) ? 3 : 0) }))
    .sort((a, b) => a.h - b.h || a.i - b.i)
    .map((x) => x.m);
  let candidates: string[] = [];
  if (chosen !== SMART && chosen !== "auto" && isChatModel(chosen) && (!models.length || models.includes(chosen)) && (!hasImages || isVisionModel(chosen))) {
    candidates.push(chosen);
  }
  // putaran 1: satu model per hero & per provider (biar 6 percobaan tidak habis di model sejenis)
  const seenHero = new Set(candidates.map((m) => heroName(m)));
  const seenProv = new Set(candidates.map((m) => providerOf(m)));
  for (const m of byHealth) {
    if (candidates.length >= MAX_TRIES) break;
    const hero = heroName(m);
    const prov = providerOf(m);
    const proven = hm.get(m) === 0;
    if (!proven && (seenHero.has(hero) || (prov && seenProv.has(prov)))) continue;
    candidates.push(m);
    seenHero.add(hero);
    if (prov) seenProv.add(prov);
  }
  // putaran 2: isi sisa slot
  for (const m of byHealth) {
    if (candidates.length >= MAX_TRIES) break;
    if (!candidates.includes(m)) candidates.push(m);
  }
  candidates = [...new Set(candidates)].slice(0, MAX_TRIES);
  if (!candidates.length) {
    if (hasImages) {
      const msg = "Hero yang bisa melihat gambar belum ada. Sambungkan Gemini (API key gratis dari aistudio.google.com/apikey) di dashboard server AI → Providers.";
      await supabase.from("ai_messages").insert({ conversation_id: convId, role: "assistant", content: msg, error: true, model: chosen });
      return err(422, msg, convId);
    }
    candidates = ["auto"];
  }

  const lastUserText = content || ([...hist].reverse().find((m) => m.role === "user")?.content ?? "");

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
    await supabase.from("ai_messages").insert({ conversation_id: convId, role: "assistant", content: msg, error: true, model: candidates[0] });
    return err(status, msg, convId);
  };

  // 7) panggil OmniRoute; kalau model error / kosong sebelum menjawab -> coba calon berikutnya
  const upstreamAbort = new AbortController();
  req.signal.addEventListener("abort", () => upstreamAbort.abort());
  const failures: string[] = [];
  let opened: { model: string; events: AsyncGenerator<SseEvent>; first: string } | null = null;
  for (const model of candidates) {
    let upstream: Response | null = null;
    let netErr: unknown = null;
    // koneksi ke server AI kadang putus sesaat -> coba ulang sekali sebelum menyerah
    for (let attempt = 0; attempt < 2 && !upstream; attempt++) {
      try {
        upstream = await fetch(`${cfg.base}/chat/completions`, {
          method: "POST",
          headers: aiHeaders(cfg.key),
          body: JSON.stringify({ model, messages, stream: true }),
          signal: upstreamAbort.signal,
        });
      } catch (e) {
        if (upstreamAbort.signal.aborted) return new Response(null, { status: 499 });
        netErr = e;
        if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
      }
    }
    if (!upstream) {
      // server AI-nya sendiri tidak bisa dihubungi -> percuma coba model lain
      const cause = (netErr as { cause?: { code?: string } })?.cause?.code;
      console.log("[ai] server AI tidak bisa dihubungi:", cause ?? netErr);
      return saveError(
        `Server AI tidak bisa dihubungi${cause ? ` (${cause})` : ""}. Biasanya karena komputer server AI mati / sleep / tidak ada internet, atau jendela server AI tertutup. Cek: buka ${cfg.base}/models dari HP — kalau tidak bisa dibuka, nyalakan lagi server AI-nya.`
      );
    }
    if (!upstream.ok || !upstream.body) {
      let detail = "";
      try {
        const t = await upstream.text();
        detail = (JSON.parse(t)?.error?.message as string) || t;
      } catch {}
      // 401 bisa dari kunci website ATAU dari provider (key provider salah / provider tanpa key).
      // Kalau daftar model barusan bisa dibaca pakai kunci yang sama, berarti kunci website benar -> lanjut hero lain.
      if (upstream.status === 401 && !catalog.ids.length) {
        return saveError("Kunci server AI ditolak. Pastikan kunci di pengaturan Vercel sama dengan kunci di dashboard server AI → API Keys.");
      }
      coolDown(model);
      failures.push(`${model} (${upstream.status}${detail ? `: ${String(detail).slice(0, 80)}` : ""})`);
      await markHealth(supabase, model, false, `${upstream.status} ${String(detail)}`);
      continue;
    }
    // baca sampai potongan jawaban pertama — kalau langsung error / kosong, anggap gagal
    const events = sse(upstream.body);
    let first = "";
    let failed = "";
    // baca dulu ±160 huruf pertama: kalau error / kosong / tiba-tiba pakai huruf Arab-Mandarin dll padahal user tidak -> ganti hero
    for (;;) {
      const { value, done } = await events.next();
      if (done) break;
      if (value.error) {
        failed = value.error;
        break;
      }
      if (value.piece) first += value.piece;
      if (first.length >= 160) break;
    }
    if (first && wrongScript(first, lastUserText)) {
      failed = "menjawab pakai bahasa/huruf asing";
      first = "";
    }
    if (first) {
      opened = { model, events, first };
      await markHealth(supabase, model, true);
      break;
    }
    coolDown(model);
    failures.push(`${model} (${failed ? failed.slice(0, 80) : "jawaban kosong"})`);
    await markHealth(supabase, model, false, failed || "jawaban kosong");
    try {
      await events.return(undefined);
    } catch {}
  }
  if (!opened) {
    console.log("[ai] semua model gagal:", failures.join(" | "));
    return saveError(
      `Semua hero yang dicoba lagi tidak bisa menjawab (biasanya kuota gratis habis, key provider salah, atau provider sedang gangguan). Coba lagi sebentar, atau pilih hero lain.\n\nDicoba:\n${failures.map((f) => `- ${heroName(f.split(" ")[0])}: ${f}`).join("\n")}\n\n${hasImages ? "Untuk gambar butuh provider yang bisa lihat gambar (mis. Gemini) yang lulus Test di dashboard server AI." : "Pastikan minimal satu provider (mis. Groq / Gemini) sudah tersambung & lulus Test di dashboard server AI."}`
    );
  }

  // 8) alirkan ke browser sambil dikumpulkan, lalu simpan jawaban lengkap
  const enc = new TextEncoder();
  const usedModel = opened.model;
  let full = "";
  const { events, first } = opened;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        full += first;
        controller.enqueue(enc.encode(first));
        for await (const ev of events) {
          if (ev.piece) {
            full += ev.piece;
            controller.enqueue(enc.encode(ev.piece));
          }
          if (ev.error) {
            const e = `\n\n⚠️ Jawaban terpotong: ${ev.error}`;
            full += e;
            controller.enqueue(enc.encode(e));
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
      "x-ai-model": encodeURIComponent(usedModel),
      "x-ai-data": useData ? "1" : "0",
      "x-ai-fallback": failures.length ? "1" : "0",
    },
  });
}

type SseEvent = { piece?: string; error?: string };

/** baca aliran SSE format OpenAI -> potongan teks / error */
async function* sse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const dec = new TextDecoder();
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
        if (!data || data === "[DONE]") continue;
        try {
          const j = JSON.parse(data);
          const piece: string = j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.message?.content ?? "";
          if (piece) yield { piece };
          if (j.error) yield { error: String(j.error.message ?? j.error) };
        } catch {
          // baris bukan JSON — abaikan
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {}
    try {
      await body.cancel();
    } catch {}
  }
}

// model yang barusan error diistirahatkan 15 menit (dicoba paling akhir)
const cooldown = new Map<string, number>();
const coolDown = (m: string) => cooldown.set(m, Date.now() + 15 * 60 * 1000);
const coolingDown = (m: string) => (cooldown.get(m) ?? 0) > Date.now();

/** huruf non-Latin yang sering "nyasar" (Arab, Mandarin/Jepang/Korea, Thai, Hindi, Kiril) */
const FOREIGN = /[\u0600-\u06FF\u0750-\u077F\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF\u0E00-\u0E7F\u0900-\u097F\u0400-\u04FF]/g;
/** jawaban memakai huruf asing (≥3 huruf) padahal pesan user tidak memakainya */
function wrongScript(answer: string, userText: string) {
  const hits = answer.match(FOREIGN)?.length ?? 0;
  if (hits < 3) return false;
  return (userText.match(FOREIGN)?.length ?? 0) === 0;
}
