import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, getProfile } from "@/lib/auth";
import { aiConfig, aiHeaders, healthMap, healthRank, isDeadModel, listCatalog, loadHealth, markHealth, systemPrompt } from "@/lib/ai.server";
import { buildSiteContext, looksAboutSite } from "@/lib/aiContext.server";
import { TRADE_INTENT, analysisGuide, buildWebContext, chartSymbol, compactGuide, detectTimeframe, ensureTradePlan, planWebSearch, sourcesFooter, webConfig, type WebPlan } from "@/lib/aiWeb.server";
import { personaIntro } from "@/lib/aiPersona";
import { SMART, heroName, isChatModel, isVisionModel, providerOf, rankTextModels, rankVisionModels, sameHeroVariants, setVisionCatalog } from "@/lib/aiModels";
import { ATTACH_BUCKET } from "@/lib/attachments";
import { personaPrompt } from "@/lib/aiPersona";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
  web?: "auto" | "off";
};
type Row = { role: "user" | "assistant"; content: string; error: boolean; images: string[] | null; used_data: boolean | null };

const err = (status: number, message: string, convId?: string | null) =>
  NextResponse.json({ error: message }, { status, headers: convId ? { "x-conversation-id": convId } : undefined });

/**
 * Kirim pesan ke AI. Jawaban dialirkan (streaming) sebagai teks biasa, diselingi bingkai kontrol "\u001e{json}\n":
 * {t:"step"} langkah proses (tampilan "lagi mikir"), {t:"meta"} hero/model yang dipakai, {t:"error"} pesan gagal.
 * Header: x-conversation-id.
 */
export async function POST(req: NextRequest) {
  const t0 = Date.now();
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
  // gambar ikut dikirim hanya kalau pesan TERAKHIR membawa gambar, atau pesan terakhir jelas membahas gambar sebelumnya
  // ("chart tadi", "gambar itu", "lihat lagi screenshotnya"). Pertanyaan baru tanpa gambar -> hero teks biasa (mis. Alucard).
  const lastIdx = userIdx[userIdx.length - 1];
  const lastHasImg = lastIdx !== undefined && (hist[lastIdx].images?.length ?? 0) > 0;
  const refersToImage = /\b(gambar|foto|chart|grafik|screenshot|ss|tangkapan layar|image|picture|candle|lihat lagi|di atas)\w*\b/i.test(hist[lastIdx]?.content ?? "");
  const imageTurns = new Set(
    lastHasImg ? [lastIdx] : refersToImage ? userIdx.filter((i) => (hist[i].images?.length ?? 0) > 0).slice(-IMAGE_TURNS) : []
  );
  const hasImages = imageTurns.size > 0;

  // ===== mulai streaming: langkah proses (untuk tampilan "lagi mikir") + jawaban =====
  // Format: teks jawaban biasa, diselingi bingkai kontrol "\u001e{json}\n" (langkah, info model, error).
  const enc = new TextEncoder();
  const upstreamAbort = new AbortController();
  req.signal.addEventListener("abort", () => upstreamAbort.abort());
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (obj: Record<string, unknown>) => {
        try {
          controller.enqueue(enc.encode(`\u001e${JSON.stringify(obj)}\n`));
        } catch {}
      };
      const step = (k: string, s: "run" | "done" | "skip", extra: Record<string, unknown> = {}) => emit({ t: "step", k, s, ...extra });
      try {
        await pipeline(controller, emit, step);
      } catch (e) {
        console.log("[ai] pipeline error:", e);
        emit({ t: "error", message: "Terjadi kesalahan di server AI. Coba lagi sebentar." });
      } finally {
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

  async function pipeline(
    controller: ReadableStreamDefaultController<Uint8Array>,
    emit: (o: Record<string, unknown>) => void,
    step: (k: string, s: "run" | "done" | "skip", extra?: Record<string, unknown>) => void
  ) {
  step("understand", "run");
  // 4) daftar calon model: pilihan user dulu, lalu cadangan terbaik.
  //    Katalog OmniRoute berisi juga provider yang BELUM disambungkan, jadi urutannya:
  //    model yang terbukti jalan -> belum pernah dicoba -> yang baru gagal; dan tiap hero/provider cukup dicoba sekali.
  const [catalog, health] = await Promise.all([listCatalog(), loadHealth(supabase)]);
  const models = catalog.ids;
  setVisionCatalog(catalog.vision);
  const chosen = String(body.model ?? "").trim().slice(0, 200) || cfg.model;
  // katalog gagal terbaca (server AI lambat / putus sesaat) -> pakai model yang pernah terbukti jalan, bukan "auto"
  // model yang dipastikan sudah tidak ada (404 "does not exist", 410 "end of life") dilewati 3 hari
  const isDead = (m: string) => isDeadModel(health.get(m));
  const pool = (models.length ? models : [...health.values()].filter((h) => healthRank(h) === 0).map((h) => h.model).filter(isChatModel)).filter((m) => !isDead(m));
  const ranked = hasImages ? [...(cfg.visionModel ? [cfg.visionModel] : []), ...rankVisionModels(pool)] : rankTextModels(pool);
  const hm = healthMap(ranked, health);
  const byHealth = ranked
    .map((m, i) => ({ m, i, h: (hm.get(m) ?? 1) + (coolingDown(m) ? 3 : 0) }))
    .sort((a, b) => a.h - b.h || a.i - b.i)
    .map((x) => x.m);
  let candidates: string[] = [];
  // hero pilihan user: karakternya dipertahankan walaupun mesinnya dialihkan
  const chosenHero = chosen !== SMART && chosen !== "auto" ? heroName(chosen) : null;
  if (chosen !== SMART && chosen !== "auto" && isChatModel(chosen) && (!models.length || models.includes(chosen)) && (!hasImages || isVisionModel(chosen))) {
    candidates.push(chosen);
  }
  // varian lain dari hero yang sama dicoba dulu (mis. DeepSeek versi lain) sebelum pindah ke hero lain
  if (chosenHero) {
    const same = sameHeroVariants(byHealth, chosenHero)
      .filter((m) => m !== chosen && !coolingDown(m))
      .slice(0, 2);
    candidates.push(...same);
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
      emit({ t: "error", message: msg });
      return;
    }
    candidates = ["auto"];
  }
  step("understand", "done", { hero: chosenHero ?? heroName(candidates[0] === "auto" ? SMART : candidates[0]) });

  const lastUserText = content || ([...hist].reverse().find((m) => m.role === "user")?.content ?? "");

  // 5) data CS Tracker (otomatis kalau pertanyaannya soal isi website / lanjutan dari jawaban yang memakai data)
  const prevAssistant = [...hist].reverse().find((m) => m.role === "assistant");
  // pertanyaan lanjutan ("yang itu siapa PIC-nya?") setelah jawaban yang memakai data -> tetap pakai data
  const followUp = !!prevAssistant?.used_data && lastText.length < 200 && /\b(itu|tadi|tersebut|yang mana|siapa|berapa|kenapa|kapan|detail|lanjut|lainnya|yang lain|nomor|#\d+)\b|\w+nya\b/i.test(lastText);
  const useData = body.data !== "off" && (looksAboutSite(lastText) || followUp);
  // 5b) internet (Tavily): AI cepat "mikir dulu" perlu browsing atau tidak + kata kuncinya (pakai konteks percakapan),
  //     lalu website mencari & membaca halamannya. Jalan bareng dengan pengambilan data CS Tracker.
  const webOn = webConfig().ok && body.web !== "off";
  const textRank = rankTextModels(pool);
  const textHm = healthMap(textRank, health);
  const planners = textRank.filter((m) => textHm.get(m) === 0 && !coolingDown(m) && !isVisionOnlyRisk(m));
  const noWeb: { context: string; lite?: string; sources: { title: string; url: string }[]; chart?: string | null } = { context: "", sources: [] };
  // permintaan analisa / trade plan: tanya pendekatan dulu (S/R, chart pattern, lengkap) — kecuali ini jawaban dari kotak pertanyaan
  const answered = /^📌\s*(Analisa|Detail lengkap)/i.test(lastText);
  let askFor: WebPlan | null = null;
  const cleanHist = hist.filter((m) => m.content).map((m) => ({ role: m.role, content: m.content.replace(/\[\[ask:[\s\S]*?\]\]/g, "") }));
  if (useData) step("data", "run");
  if (webOn) step("decide", "run");
  const [context, web] = await Promise.all([
    useData
      ? buildSiteContext(supabase)
          .catch(() => "")
          .finally(() => step("data", "done"))
      : Promise.resolve(""),
    webOn
      ? planWebSearch({
          base: cfg.base,
          headers: aiHeaders(cfg.key),
          models: [...new Set([...planners, ...candidates.filter((m) => m !== "auto")])],
          history: cleanHist,
          question: lastText,
        })
          .then((p) => {
            // analisa / trade plan suatu aset selalu pakai data harga & chart (kecuali sedang membahas gambar yang dikirim)
            const plan = hasImages ? p : ensureTradePlan(p, lastText, cleanHist);
            step("decide", plan ? "done" : "skip");
            if (plan && !answered && !hasImages && TRADE_INTENT.test(lastText) && chartSymbol(plan)) {
              askFor = plan;
              return noWeb;
            }
            return plan ? buildWebContext(plan, (k, st, extra) => step(k, st, extra)) : noWeb;
          })
          .catch(() => noWeb)
      : Promise.resolve(noWeb),
  ]);

  // 5c) tanya pendekatan analisa dulu (kotak pilihan di website), tanpa memanggil AI
  if (askFor) {
    const plan = askFor as WebPlan;
    const sym = chartSymbol(plan)!;
    const askHero = chosenHero ?? heroName(candidates[0] === "auto" ? SMART : candidates[0]);
    const label = sym.replace(/^[A-Z_]+:/, "");
    const info = { sym, label, market: plan.market, tf: (plan.timeframe ?? detectTimeframe(lastText) ?? "1d").toUpperCase(), hero: askHero };
    const text = `${personaIntro(askHero).replace(/[.…]+$/, "")} — ${label} mau dianalisa pakai pendekatan apa?\n\n[[ask:${JSON.stringify(info)}]]`;
    emit({ t: "meta", model: candidates[0] === "auto" ? "" : candidates[0], persona: askHero, data: false, web: false, chart: null, fallback: false });
    controller.enqueue(enc.encode(text));
    await supabase.from("ai_messages").insert({ conversation_id: convId, role: "assistant", content: text, model: candidates[0], persona: askHero });
    await supabase.from("ai_conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);
    return;
  }

  // 6) gambar -> data URL
  const toDataUrl = async (path: string) => {
    const { data } = await supabase.storage.from(ATTACH_BUCKET).download(path);
    if (!data) return null;
    const buf = Buffer.from(await data.arrayBuffer());
    return `data:${data.type || "image/jpeg"};base64,${buf.toString("base64")}`;
  };
  const messages: { role: string; content: string | { type: string; text?: string; image_url?: { url: string } }[] }[] = [
    { role: "system", content: systemPrompt(profile?.full_name || "anggota tim") },
    // [1] = kepribadian hero yang sedang menjawab (diisi ulang tiap ganti hero)
    { role: "system", content: "" },
  ];
  if (context) messages.push({ role: "system", content: context });
  if (web.context) messages.push({ role: "system", content: web.context });
  // user minta analisa / trade plan suatu instrumen -> wajib beri angka konkret + blok tradeplan (digambar di chart)
  const tradeIntent = TRADE_INTENT.test(lastText) || answered;
  // pendekatan yang dipilih di kotak pertanyaan: "📌 Analisa ETHUSDT · Support & Resistance · TF 4H"
  const approach: "sr" | "pattern" | "full" | "auto" = /Detail lengkap|Lengkap ala analis/i.test(lastText)
    ? "full"
    : /Support\s*&\s*Resistance/i.test(lastText)
      ? "sr"
      : /Chart Pattern/i.test(lastText)
        ? "pattern"
        : "auto";
  const userNote = answered ? (lastText.match(/\(([^)]{2,200})\)/)?.[1] ?? "") : "";
  if (tradeIntent && web.chart) {
    messages.push({
      role: "system",
      content: [
        `USER MEMINTA ANALISA / TRADE PLAN untuk ${web.chart}.`,
        "WAJIB beri trade plan dengan ANGKA KONKRET: arah (long/short atau wait & see dengan level pemicunya), entry (boleh area), stop loss, TP1, TP2, timeframe, dan alasan singkat berdasarkan data.",
        "Patokan harga: pakai harga live / candle kalau ada; kalau tidak ada, pakai harga paling baru dari hasil browsing dan sebut tanggalnya ('per 23 Okt'). JANGAN minta user memberikan harga, JANGAN menjawab hanya dengan persentase.",
        "Tutup jawaban dengan blok ```tradeplan berisi JSON (symbol, side, entry, sl, tp[], timeframe) — website menggambarnya di chart. Untuk entry berupa area, isi entry dengan titik tengah area.",
        ...(approach === "full" ? [compactGuide(web.chart, approach, userNote), analysisGuide(web.chart)] : [compactGuide(web.chart, approach, userNote)]),
      ].join("\n"),
    });
  }
  // versi ringkas untuk model berbatas kecil (Groq gratis dll menolak permintaan terlalu besar: 413).
  // Data harga / candle / instruksi trade plan tetap utuh; yang dipangkas: isi artikel, data CS, riwayat chat lama.
  const liteOf = (src: typeof messages): typeof messages => {
    const out = src.map((m) => {
      if (m.role !== "system" || typeof m.content !== "string") return m;
      if (context && m.content === context) return { ...m, content: context.slice(0, 4000) + (context.length > 4000 ? "\n… (data diringkas)" : "") };
      if (web.context && m.content === web.context) return { ...m, content: web.lite ?? web.context.slice(0, 6000) };
      return m;
    });
    const firstHist = out.findIndex((m) => m.role !== "system");
    if (firstHist > 0 && out.length - firstHist > 6) out.splice(firstHist, out.length - firstHist - 6);
    return out;
  };
  for (const [i, m] of hist.entries()) {
    const imgs = m.images ?? [];
    if (m.role === "user" && imgs.length && imageTurns.has(i)) {
      const urls = (await Promise.all(imgs.map(toDataUrl))).filter((u): u is string => !!u);
      messages.push({
        role: "user",
        content: [{ type: "text", text: m.content || "Tolong jelaskan gambar ini." }, ...urls.map((url) => ({ type: "image_url", image_url: { url } }))],
      });
    } else {
      messages.push({ role: m.role, content: m.content.replace(/\[\[ask:[\s\S]*?\]\]/g, "(menanyakan pendekatan analisa)") + (imgs.length ? `\n[${imgs.length} gambar dilampirkan sebelumnya]` : "") });
    }
  }

  const saveError = async (msg: string) => {
    await supabase.from("ai_messages").insert({ conversation_id: convId, role: "assistant", content: msg, error: true, model: candidates[0] });
    emit({ t: "error", message: msg });
  };

  // 7) panggil OmniRoute; kalau model error / kosong sebelum menjawab -> coba calon berikutnya
  step("write", "run", { plan: tradeIntent && !!web.chart, hero: chosenHero ?? heroName(candidates[0]) });
  let lastSwitch = "";
  const failures: string[] = [];
  let opened: { model: string; events: AsyncGenerator<SseEvent>; first: string } | null = null;
  // Batas waktu (Vercel Hobby + Fluid compute: maks 300 detik; di sini dipakai 120):
  // - tiap hero diberi maks 35 detik sampai mulai menjawab
  // - kalau hero pertama belum menjawab dalam 10 detik, hero berikutnya ikut dicoba BERSAMAAN (yang duluan menjawab dipakai)
  // - setelah 75 detik berhenti mencoba, supaya jawaban sempat dialirkan & pesan error jelas masih terkirim
  const OPEN_DEADLINE = t0 + 75_000;
  const ATTEMPT_MS = 35_000;
  const HEDGE_MS = 10_000;
  let timedOut = false;
  // kalau key provider bermasalah, model lain dari provider yang sama pasti gagal juga -> lewati.
  // (kuota habis TIDAK dihitung: kuota gratis Gemini dll dihitung per model, model lain bisa masih ada jatah)
  const deadProv = new Set<string>();
  const PROVIDER_DOWN = /authenticat|authorization|invalid api key|api key not valid|missing api key|reconnect|decrypt|unauthori[sz]ed|forbidden/i;
  // permintaan besar: Groq gratis membatasi token per menit (413) -> kirim versi ringkas
  const charsOf = (arr: typeof messages) => arr.reduce((n, m) => n + (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content).length), 0);
  const fullChars = charsOf(messages);
  let forceLite = false;
  const liteMessages = liteOf(messages);
  const msgsFor = (model: string) => {
    const useLite = forceLite || (providerOf(model) === "groq" && fullChars > 20_000);
    const arr = [...(useLite ? liteMessages : messages)];
    arr[1] = { role: "system", content: personaPrompt(chosenHero ?? heroName(model)) };
    return arr;
  };

  type Res =
    | { ok: true; model: string; events: AsyncGenerator<SseEvent>; first: string }
    | { ok: false; model: string; why: string; status?: number; detail?: string; tooBig?: boolean; fatal?: string };

  /** satu percobaan: kirim ke server AI lalu baca ±160 huruf pertama (error / kosong / huruf asing = gagal) */
  const attempt = async (model: string, ac: AbortController): Promise<Res> => {
    let upstream: Response | null = null;
    let netErr: unknown = null;
    // koneksi ke server AI kadang putus sesaat -> coba ulang sekali
    for (let a = 0; a < 2 && !upstream && !ac.signal.aborted; a++) {
      try {
        upstream = await fetch(`${cfg.base}/chat/completions`, {
          method: "POST",
          headers: aiHeaders(cfg.key),
          body: JSON.stringify({ model, messages: msgsFor(model), stream: true }),
          signal: ac.signal,
        });
      } catch (e) {
        netErr = e;
        if (a === 0 && !ac.signal.aborted) await new Promise((r) => setTimeout(r, 1500));
      }
    }
    if (!upstream) {
      if (ac.signal.aborted) return { ok: false, model, why: "terlalu lama, tidak menjawab" };
      const cause = (netErr as { cause?: { code?: string } })?.cause?.code;
      console.log("[ai] server AI tidak bisa dihubungi:", cause ?? netErr);
      return {
        ok: false,
        model,
        why: "server AI tidak bisa dihubungi",
        fatal: `Server AI tidak bisa dihubungi${cause ? ` (${cause})` : ""}. Biasanya karena komputer server AI mati / sleep / tidak ada internet, atau server AI-nya belum dinyalakan. Cek: buka ${cfg.base}/models dari HP — kalau tidak bisa dibuka, nyalakan lagi server AI-nya.`,
      };
    }
    if (!upstream.ok || !upstream.body) {
      let detail = "";
      try {
        const t = await upstream.text();
        detail = (JSON.parse(t)?.error?.message as string) || t;
      } catch {}
      // 401 bisa dari kunci website ATAU dari provider. Kalau daftar model barusan terbaca, kunci website benar -> lanjut hero lain.
      if (upstream.status === 401 && !catalog.ids.length) {
        return { ok: false, model, why: "401", fatal: "Kunci server AI ditolak. Pastikan kunci di pengaturan Vercel sama dengan kunci di dashboard server AI → API Keys." };
      }
      const tooBig = upstream.status === 413 || /too large|context length|maximum context|tokens per minute|TPM/i.test(detail);
      return { ok: false, model, why: `${upstream.status}${detail ? `: ${String(detail).slice(0, 80)}` : ""}`, status: upstream.status, detail: String(detail), tooBig };
    }
    const events = sse(upstream.body);
    let first = "";
    let failed = "";
    try {
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
    } catch {
      if (!first) failed = ac.signal.aborted ? "terlalu lama, tidak menjawab" : "koneksi terputus";
    }
    if (first && wrongScript(first, lastUserText)) {
      failed = "menjawab pakai bahasa/huruf asing";
      first = "";
    }
    if (first && !ac.signal.aborted) return { ok: true, model, events, first };
    try {
      await events.return(undefined);
    } catch {}
    return { ok: false, model, why: failed || (ac.signal.aborted ? "terlalu lama, tidak menjawab" : "jawaban kosong") };
  };

  type Run = { model: string; ac: AbortController; timer: ReturnType<typeof setTimeout>; started: number; onAbort: () => void; p: Promise<{ key: number; r: Res }> };
  const queue = [...candidates];
  const running = new Map<number, Run>();
  let seq = 0;
  let fatal = "";
  const stop = (key: number, abort: boolean, keepListener = false) => {
    const run = running.get(key);
    if (!run) return;
    running.delete(key);
    clearTimeout(run.timer);
    if (!keepListener) upstreamAbort.signal.removeEventListener("abort", run.onAbort);
    if (abort) {
      run.ac.abort();
      // kalau ternyata sempat terbuka, tutup alirannya
      run.p
        .then(({ r }) => {
          if (r.ok) r.events.return(undefined).catch(() => {});
        })
        .catch(() => {});
    }
  };
  const startNext = (): boolean => {
    while (queue.length) {
      const model = queue.shift()!;
      if (providerOf(model) && deadProv.has(providerOf(model))) continue;
      const left = OPEN_DEADLINE - Date.now();
      if (left < 3000) {
        timedOut = true;
        return false;
      }
      const ac = new AbortController();
      const onAbort = () => ac.abort();
      upstreamAbort.signal.addEventListener("abort", onAbort);
      const timer = setTimeout(() => ac.abort(), Math.min(ATTEMPT_MS, left));
      const key = ++seq;
      running.set(key, { model, ac, timer, started: Date.now(), onAbort, p: attempt(model, ac).then((r) => ({ key, r })) });
      return true;
    }
    return false;
  };
  const giveUp = (model: string, why: string) => {
    coolDown(model);
    failures.push(`${model} (${why})`);
    // kasih tahu tampilan: mesin ini gagal, dibantu hero berikutnya
    const next = [...running.values()][0]?.model ?? queue.find((m) => !deadProv.has(providerOf(m)));
    const nextHero = next ? heroName(next) : "";
    if (nextHero && nextHero !== lastSwitch) {
      lastSwitch = nextHero;
      step("switch", "done", { from: heroName(model), to: nextHero, hero: chosenHero ?? nextHero });
    }
    if (providerOf(model) && PROVIDER_DOWN.test(why)) deadProv.add(providerOf(model));
  };

  startNext();
  while (running.size) {
    const runs = [...running.values()];
    const oldest = Math.min(...runs.map((x) => x.started));
    let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
    const canHedge = running.size < 2 && queue.length > 0 && OPEN_DEADLINE - Date.now() > 8000;
    const hedge = canHedge ? new Promise<"hedge">((res) => (hedgeTimer = setTimeout(() => res("hedge"), Math.max(0, HEDGE_MS - (Date.now() - oldest))))) : null;
    const out = await Promise.race<{ key: number; r: Res } | "hedge">(hedge ? [...runs.map((x) => x.p), hedge] : runs.map((x) => x.p));
    if (hedgeTimer) clearTimeout(hedgeTimer);
    if (upstreamAbort.signal.aborted) {
      for (const k of [...running.keys()]) stop(k, true);
      return;
    }
    // hero pertama lambat -> hero berikutnya ikut dicoba bersamaan
    if (out === "hedge") {
      startNext();
      continue;
    }
    const { key, r } = out;
    if (!running.has(key)) continue;
    // pemenang tetap ikut berhenti kalau user menekan Stop
    stop(key, false, r.ok);
    if (r.ok) {
      opened = r;
      for (const k of [...running.keys()]) stop(k, true);
      await markHealth(supabase, r.model, true);
      break;
    }
    if (r.fatal) {
      fatal = r.fatal;
      for (const k of [...running.keys()]) stop(k, true);
      break;
    }
    // terlalu besar -> ulangi model yang sama dengan konteks ringkas (sekali)
    if (r.tooBig && !forceLite) {
      forceLite = true;
      queue.unshift(r.model);
      if (running.size < 2) startNext();
      continue;
    }
    giveUp(r.model, r.why);
    // terlalu besar / kuota habis itu sementara -> jangan dicap rusak (model yang sudah tidak ada otomatis ditandai dead:)
    if (r.status !== 413 && r.status !== 429) await markHealth(supabase, r.model, false, r.why);
    // ganti yang gagal dengan hero berikutnya (maks 2 berjalan bersamaan)
    if (running.size === 0) startNext();
    else if (running.size < 2 && Date.now() - Math.min(...[...running.values()].map((x) => x.started)) >= HEDGE_MS) startNext();
  }
  if (!opened && Date.now() >= OPEN_DEADLINE - 3000) timedOut = true;
  if (fatal) return void (await saveError(fatal));
  if (!opened) {
    console.log("[ai] semua model gagal:", failures.join(" | "));
    return void (await saveError(
      `${timedOut ? "Server AI lagi lambat — belum ada hero yang sempat menjawab dalam 75 detik. " : ""}Semua hero yang dicoba lagi tidak bisa menjawab (biasanya kuota gratis habis, key provider salah, atau provider sedang gangguan). Coba lagi sebentar, atau pilih hero lain.\n\nDicoba:\n${failures.map((f) => { const i = f.indexOf(" ("); return `- ${heroName(i > 0 ? f.slice(0, i) : f)}: ${i > 0 ? f.slice(i + 2, -1) : "gagal"}`; }).join("\n")}\n\n${hasImages ? "Untuk gambar butuh provider yang bisa lihat gambar (mis. Gemini) yang lulus Test di dashboard server AI." : "Pastikan minimal satu provider (mis. Groq / Gemini) sudah tersambung & lulus Test di dashboard server AI."}`
    ));
  }

  // 8) alirkan ke browser sambil dikumpulkan, lalu simpan jawaban lengkap
  const usedModel = opened.model;
  const personaHero = chosenHero ?? heroName(usedModel);
  step("write", "done");
  emit({
    t: "meta",
    model: usedModel,
    persona: personaHero,
    data: useData,
    web: web.sources.length > 0,
    chart: web.chart ?? null,
    fallback: failures.length > 0,
  });
  let full = "";
  const { events, first } = opened;
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
    // chart live (TradingView) ditandai di akhir jawaban supaya tetap tampil saat riwayat dibuka lagi
    const foot = sourcesFooter(web.sources) + (web.chart ? `\n\n[[chart:${web.chart}]]` : "");
    if (foot && full.trim()) {
      full += foot;
      controller.enqueue(enc.encode(foot));
    }
  } catch {
    // dihentikan user / koneksi putus — simpan yang sudah ada
  } finally {
    if (full.trim()) {
      const row = { conversation_id: convId, role: "assistant", content: full.slice(0, 100000), model: usedModel, used_data: useData, persona: personaHero };
      let { error } = await supabase.from("ai_messages").insert(row);
      // kolom baru belum ada (migration-16 / -14 belum dijalankan) -> simpan tanpa kolom itu
      if (error && /persona/.test(error.message)) {
        const { persona: _p, ...noPersona } = row;
        ({ error } = await supabase.from("ai_messages").insert(noPersona));
        if (error && /used_data/.test(error.message)) {
          const { used_data: _u, ...old } = noPersona;
          await supabase.from("ai_messages").insert(old);
        }
      } else if (error && /used_data/.test(error.message)) {
        const { used_data: _u, ...old } = row;
        await supabase.from("ai_messages").insert(old);
      }
    }
    await supabase.from("ai_conversations").update({ updated_at: new Date().toISOString(), model: usedModel }).eq("id", convId);
  }
  }
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

/** model penerjemah gambar saja tidak cocok jadi perencana pencarian */
const isVisionOnlyRisk = (m: string) => /(^|\/)(llava|pixtral)|-vl-|vision/i.test(m);
