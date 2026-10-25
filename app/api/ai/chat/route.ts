import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, getProfile } from "@/lib/auth";
import { aiConfig, aiHeaders, healthMap, healthRank, isDeadModel, listCatalog, loadHealth, markHealth, sessionPrompt, systemPrompt } from "@/lib/ai.server";
import { buildSiteContext, looksAboutSite } from "@/lib/aiContext.server";
import { TRADE_INTENT, analysisGuide, buildWebContext, chartSymbol, compactGuide, detectTimeframe, ensureTradePlan, extractUrls, looksNeedWeb, mentionsAsset, planWebSearch, sourcesFooter, webConfig, type WebPlan } from "@/lib/aiWeb.server";
import { personaIntro, personaOf, splitVia, viaMarker, type Group as PGroup } from "@/lib/aiPersona";
import { isAiOwner } from "@/lib/aiOwner";
import { DESIGN_INTENT, DESIGN_RULES } from "@/lib/kontenDesign";
import { MUSIC_INTENT, MUSIC_RULES } from "@/lib/musicCmd";
import { PHOTO_INTENT, PHOTO_OF_ATTACHMENT, VISUAL_COMPLEX, VISUAL_INTENT, visualRules } from "@/lib/visual";
import { photoQuery, searchPhotos, type PhotoResult } from "@/lib/photos.server";
import { CHAR_PREFIX, brainText, customPrompt, isCharModel, registerChar, type CustomChar, type MemoryItem } from "@/lib/customChar";
import { SMART, SMART_HERO, heavyModelFrom, heroName, isChatModel, isVisionModel, providerOf, rankTextModels, rankVisionModels, sameHeroVariants, setVisionCatalog } from "@/lib/aiModels";
import { ATTACH_BUCKET } from "@/lib/attachments";
import { personaPrompt } from "@/lib/aiPersona";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const HISTORY = 40; // pesan terakhir yang dibaca dari database (untuk deteksi lanjutan, gambar, dll.)
const SEND_HISTORY = 16; // pesan terakhir yang benar-benar dikirim ke AI (hemat token)
const HIST_CHARS = 24000; // batas total huruf riwayat yang dikirim
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
  /** folder laptop yang dihubungkan user (dibaca di browser; TIDAK disimpan ke database) */
  folder?: { name?: string; listing?: string; contents?: string } | null;
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
  // info teknis (hero pengganti, daftar error) hanya untuk pemilik (Alif); user lain melihat hero pilihannya saja
  const owner = isAiOwner(user.email);
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
  const hist = ((histRes.data ?? []) as Row[])
    .reverse()
    .filter((m) => !m.error && (m.content || (m.images?.length ?? 0) > 0))
    .map((m) => ({ ...m, content: splitVia(m.content ?? "").content }));
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
  // karakter buatan sendiri ("char:<id>"): kepribadian + otak dari database (hanya milik user ini — RLS)
  let custom: CustomChar | null = null;
  let customMem: MemoryItem[] = [];
  if (isCharModel(chosen)) {
    const id = chosen.slice(CHAR_PREFIX.length);
    const [c, m] = await Promise.all([
      supabase.from("ai_characters").select("id, name, mbti, avatar, profile").eq("id", id).maybeSingle(),
      supabase.from("ai_character_memory").select("id, character_id, kind, title, content, created_at").eq("character_id", id).order("created_at", { ascending: false }).limit(400),
    ]);
    if (c.data) {
      custom = c.data as CustomChar;
      customMem = (m.data ?? []) as MemoryItem[];
      registerChar(custom);
    }
  }
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
  const chosenHero = custom ? custom.name : chosen !== SMART && chosen !== "auto" && !isCharModel(chosen) ? heroName(chosen) : null;
  // mesin tugas berat (Sonnet) bekerja di belakang layar: karakter yang menjawab tetap hero yang semestinya
  let fixedHero: string | null = null;
  const heroOf = (m: string) => chosenHero ?? fixedHero ?? heroName(m);
  // mesin hero pilihan dicoba duluan, KECUALI baru gagal / sudah tidak ada -> langsung pakai mesin yang siap (karakter tetap hero pilihan)
  const chosenOk = chosen !== SMART && chosen !== "auto" && isChatModel(chosen) && (!models.length || models.includes(chosen)) && (!hasImages || isVisionModel(chosen)) && !isDeadModel(health.get(chosen));
  const chosenHealthy = chosenOk && !coolingDown(chosen) && healthRank(health.get(chosen)) !== 2;
  if (chosenHealthy) candidates.push(chosen);
  // karakter buatan sendiri: mesin utamanya Claude Haiku (kalau tersedia & tidak sedang gagal)
  if (custom && !hasImages) {
    const hk = byHealth.find((m) => /haiku/i.test(m) && !coolingDown(m) && healthRank(health.get(m)) !== 2);
    if (hk) candidates.push(hk);
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
  // mesin hero pilihan yang baru gagal tetap dicoba, tapi paling akhir (siapa tahu sudah pulih)
  if (chosenOk && !chosenHealthy && !candidates.includes(chosen)) candidates.splice(Math.min(candidates.length, MAX_TRIES - 1), 0, chosen);
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
  // 🎯 Layla (otomatis): pilih KARAKTER yang cocok dengan jenis pertanyaan, diputar acak (tidak sama dengan jawaban sebelumnya).
  //    Mesin tetap yang terbaik/siap; yang berganti gaya & kepribadian penjawabnya.
  if (!chosenHero && (chosen === SMART || chosen === "auto")) {
    const groups = groupsFor(lastText, hasImages);
    const heroes = [...new Set(pool.filter(isChatModel).map((m) => heroName(m)))];
    const { data: prev } = await supabase.from("ai_messages").select("persona").eq("conversation_id", convId).eq("role", "assistant").order("id", { ascending: false }).limit(2);
    const recent = new Set((prev ?? []).map((r) => r.persona as string).filter(Boolean));
    let fit = heroes.filter((h) => groups.includes(personaOf(h).group));
    if (!fit.length) fit = heroes;
    const fresh = fit.filter((h) => !recent.has(h));
    const pickFrom = fresh.length ? fresh : fit;
    if (pickFrom.length) fixedHero = pickFrom[Math.floor(Math.random() * pickFrom.length)];
  }
  step("understand", "done", { hero: heroOf(candidates[0] === "auto" ? SMART : candidates[0]) });
  // 🎯 mode otomatis: Layla (tuan rumah) yang memilihkan hero penjawab -> ditandai supaya tampil "Layla milihin …"
  const via = !chosenHero && (chosen === SMART || chosen === "auto") ? SMART_HERO : null;

  const lastUserText = content || ([...hist].reverse().find((m) => m.role === "user")?.content ?? "");
  // jawaban kartu pertanyaan (```ask): "📌 Jawaban — …" / "📌 Lewati pertanyaan — …" -> gabung dengan permintaan aslinya
  const cardAnswer = /^📌\s*(Jawaban|Lewati pertanyaan)/i.test(lastText);
  const prevRequest = [...hist].reverse().find((m) => m.role === "user" && m !== lastUser && !/^📌/.test(m.content))?.content ?? "";
  const taskText = cardAnswer ? `${prevRequest}\n${lastText}` : lastText;

  // 5a) VISUAL: desain (HTML/CSS/SVG → PNG) & foto asli dari internet — tanpa model pembuat gambar
  const lastAssistantText = [...hist].reverse().find((m) => m.role === "assistant")?.content ?? "";
  // lanjutan desain: pilih opsi / revisi / pakai foto, atau pesan pendek setelah jawaban berisi desain ("ganti warna jadi biru")
  const designFollow = /```design/.test(lastAssistantText) && (/^(📌 (Pilih desain|Pakai foto)|✏️ Revisi desain)/.test(lastText) || (lastText.length < 240 && !TRADE_INTENT.test(lastText) && !SMALL_TALK.test(lastText.trim()) && DESIGN_EDIT.test(lastText)));
  const visualMode = !hasImages && (designFollow || (VISUAL_INTENT.test(taskText) && !/\b(ppt|pptx|powerpoint|presentasi|slide|deck|report campaign|campaign performance|one.?pager|portfolio|portofolio|laporan)\w*/i.test(taskText)));
  const photoMode = !hasImages && !/^(📌 (Pakai foto|Foto asli)|✏️)/.test(lastText) && PHOTO_INTENT.test(taskText) && !PHOTO_OF_ATTACHMENT.test(lastText);
  const photoQ = photoMode ? photoQuery(cardAnswer ? prevRequest : lastText) : "";
  // dicari bareng langkah lain; tidak pernah error (kunci kosong / gagal -> daftar kosong)
  const photosP: Promise<PhotoResult | null> = photoQ ? searchPhotos(photoQ, 6).catch(() => null) : Promise.resolve(null);

  // 5) data CS Tracker (otomatis kalau pertanyaannya soal isi website / lanjutan dari jawaban yang memakai data)
  const prevAssistant = [...hist].reverse().find((m) => m.role === "assistant");
  // pertanyaan lanjutan ("yang itu siapa PIC-nya?") setelah jawaban yang memakai data -> tetap pakai data
  const followUp = !!prevAssistant?.used_data && lastText.length < 200 && /\b(itu|tadi|tersebut|yang mana|siapa|berapa|kenapa|kapan|detail|lanjut|lainnya|yang lain|nomor|#\d+)\b|\w+nya\b/i.test(lastText);
  // folder laptop: daftar file (+ isi file kalau diminta) dari browser user — hanya untuk giliran ini, tidak disimpan
  const folder =
    body.folder && typeof body.folder.listing === "string"
      ? { name: String(body.folder.name ?? "folder").slice(0, 120), listing: body.folder.listing.slice(0, 160_000), contents: String(body.folder.contents ?? "").slice(0, 140_000) }
      : null;
  const aboutSiteToo = /\b(cs tracker|hot issue|video review|catatan (&|dan) saran)\b/i.test(taskText);
  // laporan / PPT soal tim atau periode kerja (tanpa folder) -> butuh data CS Tracker juga
  const teamReport = !folder && /\b(laporan|report|ppt|presentasi|slide|rekap)\w*/i.test(taskText) && /\b(tim|team|performa|kinerja|cs|harian|mingguan|bulanan|minggu|bulan)\b/i.test(taskText);
  const useData = body.data !== "off" && (looksAboutSite(taskText) || followUp || teamReport || (cardAnswer && !!prevAssistant?.used_data)) && (!folder || aboutSiteToo);
  // 5b) internet (Tavily): AI cepat "mikir dulu" perlu browsing atau tidak + kata kuncinya (pakai konteks percakapan),
  //     lalu website mencari & membaca halamannya. Jalan bareng dengan pengambilan data CS Tracker.
  const webOn = webConfig().ok && body.web !== "off" && (!folder || /\b(internet|browsing|cari di web|google|berita|terbaru)\b/i.test(lastText));
  // hemat 1 panggilan AI "perencana": sapaan / terima kasih, dan pertanyaan data internal yang jelas tidak butuh internet
  const smallTalk = !hasImages && lastText.length <= 40 && SMALL_TALK.test(lastText.trim());
  // kata waktu ("minggu ini", "terbaru") pada pertanyaan data internal bukan alasan browsing
  const needPlanner = !smallTalk && !(useData && !looksNeedWeb(taskText.replace(/\b(hari ini|kemarin|minggu ini|bulan ini|saat ini|terbaru|terkini|terupdate)\b/gi, " ")) && !extractUrls(lastText).length);
  // pertanyaan pasar (harga/kondisi suatu aset) -> data harga live wajib diambil walaupun bukan permintaan trade plan
  const assetAsk = !hasImages && !folder && mentionsAsset(lastText);
  const textRank = rankTextModels(pool);
  const textHm = healthMap(textRank, health);
  const planners = textRank.filter((m) => textHm.get(m) === 0 && !coolingDown(m) && !isVisionOnlyRisk(m));
  const noWeb: { context: string; lite?: string; sources: { title: string; url: string }[]; chart?: string | null; live?: boolean } = { context: "", sources: [] };
  // permintaan analisa / trade plan: tanya pendekatan dulu (S/R, chart pattern, lengkap) — kecuali ini jawaban dari kotak pertanyaan
  const answered = /^📌\s*(Analisa|Detail lengkap)/i.test(lastText);
  // kartu pendekatan TIDAK muncul kalau permintaannya sudah jelas (timeframe + cara/tujuan disebut) atau aset ini sudah ditanya barusan
  const alreadyClear = !!detectTimeframe(lastText) && /\b(support|resist\w*|s\/r|pattern|pola|lengkap|scalp\w*|swing|intraday|entry|sl|tp\d?|trade ?plan|investasi)\b/i.test(lastText);
  const askedBefore = (sym: string) => hist.slice(-8).some((m) => m.role === "user" && m.content.startsWith(`📌 Analisa ${sym.replace(/^[A-Z_]+:/, "")}`));
  const wantsAsk = (plan: WebPlan | null) => {
    const sym = plan ? chartSymbol(plan) : null;
    return !!sym && !answered && !hasImages && TRADE_INTENT.test(lastText) && !alreadyClear && !askedBefore(sym);
  };
  let askFor: WebPlan | null = null;
  const cleanHist = hist.filter((m) => m.content).map((m) => ({ role: m.role, content: m.content.replace(/\[\[ask:[\s\S]*?\]\]/g, "") }));
  if (useData) step("data", "run");
  if (webOn) step("decide", "run");
  // Internet dimatikan (atau kunci Tavily belum ada) tapi user minta analisa / trade plan:
  // data harga, candle & derivatif tetap diambil (gratis, tanpa kredit Tavily) — hanya pencarian artikel yang dilewati
  const marketOnly = !webOn && !hasImages && !folder ? ensureTradePlan(null, lastText, hist.filter((m) => m.content).map((m) => ({ role: m.role, content: m.content })), assetAsk) : null;
  const [context, web] = await Promise.all([
    useData
      ? buildSiteContext(supabase)
          .catch(() => "")
          .finally(() => step("data", "done"))
      : Promise.resolve(""),
    webOn && !needPlanner && !assetAsk
      ? Promise.resolve(noWeb).finally(() => step("decide", "skip"))
      : webOn
      ? planWebSearch({
          base: cfg.base,
          headers: aiHeaders(cfg.key),
          models: [...new Set([...planners, ...candidates.filter((m) => m !== "auto")])],
          history: cleanHist,
          question: lastText,
        })
          .then((p) => {
            // analisa / trade plan suatu aset selalu pakai data harga & chart (kecuali sedang membahas gambar yang dikirim)
            const plan = hasImages ? p : ensureTradePlan(p, lastText, cleanHist, assetAsk);
            step("decide", plan ? "done" : "skip");
            if (wantsAsk(plan)) {
              askFor = plan;
              return noWeb;
            }
            return plan ? buildWebContext(plan, (k, st, extra) => step(k, st, extra)) : noWeb;
          })
          .catch(() => noWeb)
      : marketOnly
        ? (() => {
            const plan = marketOnly;
            if (wantsAsk(plan)) {
              askFor = plan;
              return Promise.resolve(noWeb);
            }
            return buildWebContext(plan, (k, st, extra) => step(k, st, extra), { offline: true }).catch(() => noWeb);
          })()
        : Promise.resolve(noWeb),
  ]);

  // 5c) tanya pendekatan analisa dulu (kotak pilihan di website), tanpa memanggil AI
  if (askFor) {
    const plan = askFor as WebPlan;
    const sym = chartSymbol(plan)!;
    const askHero = heroOf(candidates[0] === "auto" ? SMART : candidates[0]);
    const label = sym.replace(/^[A-Z_]+:/, "");
    const tf = (plan.timeframe ?? detectTimeframe(lastText) ?? "1d").toUpperCase();
    // variasi supaya tidak monoton: kalimat pertanyaan, rekomendasi (sesuai timeframe & kepribadian hero), dan opsi tambahan
    const rnd = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
    const g = personaOf(askHero).group;
    const short = /^(1M|5M|15M|30M|1H)$/.test(tf);
    const rec = short ? rnd(["sr", "sr", "extra"]) : tf === "1W" || /^saham/.test(plan.market) ? rnd(["full", "pattern", "sr"]) : g === "NT" ? rnd(["full", "pattern"]) : g === "SJ" ? rnd(["sr", "full"]) : rnd(["sr", "pattern", "extra"]);
    // tujuan yang paling mungkin dari kalimat user (ditandai di kartu)
    const goal = /\b(berita|news|kabar|sentimen)\b/i.test(lastText)
      ? "berita"
      : /\b(layak|worth|investasi|jangka panjang|prospek|fundamental)\b/i.test(lastText)
        ? "kondisi"
        : /\b(entry|entri|trade ?plan|tp\d?|sl|stop ?loss|beli di|jual di|masuk di|setup|sinyal|signal|long|short)\b/i.test(lastText)
          ? "entry"
          : "kondisi";
    const info = { sym, label, market: plan.market, tf: goal === "kondisi" && /^saham/.test(plan.market) && /layak|investasi|jangka panjang/i.test(lastText) ? "1W" : tf, hero: askHero, rec, goal, v: Math.floor(Math.random() * 3), x: Math.floor(Math.random() * 4) };
    // kalimat pertanyaan ikut kelompok kepribadian hero yang aktif
    const Q: Record<PGroup, string[]> = {
      NT: [`${label}: tujuan & timeframe-nya apa? Biar analisanya tepat sasaran.`, `Sebelum bedah ${label}, tentukan dulu parameternya.`, `${label} — kita main di timeframe mana, dan targetnya apa?`],
      NF: [`Biar pas sama kebutuhanmu, ${label} mau dilihat dari sisi mana dulu?`, `Yuk bedah ${label} bareng — kamu lagi cari apa nih?`, `${label} ya! Ceritain dulu tujuanmu, biar aku sesuaikan.`],
      SJ: [`Untuk ${label}, mohon pilih tujuan, timeframe & pendekatannya dulu.`, `${label} — biar rapi, kita tetapkan dulu tujuan dan timeframe-nya.`, `Sebelum analisa ${label}, cek dulu tiga hal ini ya.`],
      SP: [`${label}? Gas! Mau entry, analisa, atau cek berita?`, `Oke ${label} — scalping, swing, atau investasi nih?`, `Langsung aja: ${label} mau dipakai buat apa?`],
    };
    const q = rnd(Q[g]);
    const text = `${personaIntro(askHero).replace(/[.…]+$/, "")} — ${q}\n\n[[ask:${JSON.stringify(info)}]]`;
    emit({ t: "meta", model: candidates[0] === "auto" ? "" : candidates[0], persona: askHero, data: false, web: false, chart: null, fallback: false, via });
    controller.enqueue(enc.encode(text));
    await supabase.from("ai_messages").insert({ conversation_id: convId, role: "assistant", content: text + (via ? viaMarker(via) : ""), model: candidates[0], persona: askHero });
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
  // Susunan pesan (urut dari yang paling TETAP ke yang paling berubah, supaya bagian depan bisa di-cache provider):
  //   [aturan utama — sama untuk semua user]  [data CS Tracker / folder — sama selama percakapan]
  //   [karakter + tanggal + aturan khusus & hasil browsing giliran ini]  [riwayat chat yang sudah dipangkas]
  // otak karakter buatan sendiri: koreksi + bagian catatan yang paling nyambung dengan pertanyaan
  const brain = custom ? brainText(custom, customMem, 20000, lastText) : "";
  const turnRules: string[] = [];
  // standar desain Konten.com (skill konten-report-designer) untuk semua permintaan desain / laporan / PPT / report
  if (DESIGN_INTENT.test(taskText) && !visualMode) turnRules.push(DESIGN_RULES);
  // desain visual (poster, banner, thumbnail, infografis, diagram, mockup …) -> blok ```design dirender jadi PNG
  if (visualMode) turnRules.push(visualRules());
  const photos = await photosP;
  if (photoMode) turnRules.push(photoRules(photoQ, photos, visualMode));
  // user minta putar / ganti / matikan musik -> AI kirim blok ```music``` yang dijalankan pemutar 🎵
  if (MUSIC_INTENT.test(lastText)) turnRules.push(MUSIC_RULES);
  const folderMsg = folder ? folderPrompt(folder) : "";
  // user minta analisa / trade plan suatu instrumen -> wajib beri angka konkret + blok tradeplan (digambar di chart)
  // tujuan "Berita & sentimen" dari kartu pasar -> rangkum kabar, tanpa trade plan
  const goalNews = answered && /Tujuan Berita/i.test(lastText);
  const tradeIntent = (TRADE_INTENT.test(lastText) || answered) && !goalNews;
  // ===== aturan per mode (hanya dimuat saat dipakai, supaya hemat token) =====
  const marketMode = !!web.chart || !!marketOnly || assetAsk || answered;
  if (marketMode) turnRules.push(marketRules(!!web.live, goalNews));
  const coworkMode = !visualMode && (!!folder || DESIGN_INTENT.test(taskText) || COWORK_INTENT.test(taskText));
  if (coworkMode) turnRules.push(coworkRules(!folder && /\b(ppt|pptx|powerpoint|presentasi|slide|deck)\w*/i.test(taskText)));
  // obrolan ringan / pertanyaan konsep singkat -> jangan pernah pakai kartu
  if (smallTalk || (lastText.length < 160 && CONCEPT_Q.test(lastText.trim()))) turnRules.push("Pesan ini obrolan ringan / pertanyaan konsep: jawab langsung, JANGAN pakai kartu ```ask.");
  if (cardAnswer) turnRules.push(/Lewati/i.test(lastText) ? "USER MELEWATI KARTU PERTANYAAN: langsung kerjakan permintaan sebelumnya pakai asumsi paling masuk akal (sebut asumsinya 1 baris). JANGAN bertanya lagi." : "USER SUDAH MENJAWAB KARTU PERTANYAAN (pesan terakhir): langsung kerjakan permintaan sebelumnya sesuai jawaban itu. JANGAN bertanya lagi.");
  // pendekatan yang dipilih di kotak pertanyaan: "📌 Analisa ETHUSDT · Support & Resistance · TF 4H"
  const approach: "sr" | "pattern" | "full" | "auto" = /Detail lengkap|Lengkap ala analis/i.test(lastText)
    ? "full"
    : /Support\s*&\s*Resistance/i.test(lastText)
      ? "sr"
      : /Chart Pattern/i.test(lastText)
        ? "pattern"
        : "auto";
  const userNote = answered ? (lastText.match(/\(([^)]{2,200})\)/)?.[1] ?? "") : "";
  // 🧠 tugas berat & penting (PPT/laporan, report campaign, analisa lengkap, baca data folder, teks panjang, atau diminta):
  //    + analisa trading / trade plan. Jawaban ditulis mesin Sonnet; Haiku tetap jadi "perencana" (mikir dulu, browsing) + cadangan.
  //    Dibatasi per user per hari. Di halaman Usage pemakaiannya digabung ke baris Haiku.
  const heavyWhy = smallTalk ? null : heavyReason(taskText, { approach, folderData: !!folder?.contents, design: visualMode && VISUAL_COMPLEX.test(designFollow ? `${prevRequest}\n${lastText}` : taskText), trade: tradeIntent && !!web.chart, data: useData, web: web.sources.length > 0 });
  let heavyOn = false;
  if (heavyWhy) {
    const hm = heavyModelFrom(models);
    if (hm && !isDead(hm) && !coolingDown(hm) && healthRank(health.get(hm)) !== 2 && (await heavyQuotaOk(supabase, owner))) {
      if (!chosenHero) fixedHero = heroName(candidates[0] === "auto" ? SMART : candidates[0]);
      candidates = [hm, ...candidates.filter((m) => m !== hm)].slice(0, MAX_TRIES);
      heavyOn = true;
    }
  }
  if (tradeIntent && web.chart) {
    turnRules.push(
      [
        `USER MEMINTA ANALISA / TRADE PLAN untuk ${web.chart}.`,
        "WAJIB beri trade plan dengan ANGKA KONKRET: arah (long/short atau wait & see dengan level pemicunya), entry (boleh area), stop loss, TP1, TP2, timeframe, dan alasan singkat berdasarkan data.",
        "Patokan harga: pakai harga live / candle kalau ada; kalau tidak ada, pakai harga paling baru dari hasil browsing dan sebut tanggalnya ('per 23 Okt'). JANGAN minta user memberikan harga, JANGAN menjawab hanya dengan persentase.",
        "Tutup jawaban dengan blok ```tradeplan berisi JSON (symbol, side, entry, sl, tp[], timeframe) — website menggambarnya di chart. Untuk entry berupa area, isi entry dengan titik tengah area.",
        ...(approach === "full" ? [compactGuide(web.chart, approach, userNote), analysisGuide(web.chart)] : [compactGuide(web.chart, approach, userNote)]),
      ].join("\n")
    );
  }
  // riwayat chat: hanya pesan terakhir, jawaban lama dipangkas (blok deck/tradeplan/sumber lama dibuang) — hemat token
  type Part = { type: string; text?: string; image_url?: { url: string }; cache_control?: { type: "ephemeral" } };
  type Msg = { role: string; content: string | Part[] };
  const histMsgs: Msg[] = [];
  const start = Math.max(0, hist.length - SEND_HISTORY);
  // desain terakhir tetap dikirim utuh (revisi bertahap butuh kodenya), desain lama dipangkas
  const lastDesignAt = hist.map((m) => m.role === "assistant" && /```design/.test(m.content)).lastIndexOf(true);
  for (let i = start; i < hist.length; i++) {
    const m = hist[i];
    const imgs = m.images ?? [];
    const text = compactMsg(m.content, m.role, i >= hist.length - 3, i === lastDesignAt);
    if (m.role === "user" && imgs.length && imageTurns.has(i)) {
      const urls = (await Promise.all(imgs.map(toDataUrl))).filter((u): u is string => !!u);
      histMsgs.push({ role: "user", content: [{ type: "text", text: text || "Tolong jelaskan gambar ini." }, ...urls.map((url) => ({ type: "image_url", image_url: { url } }))] });
    } else {
      histMsgs.push({ role: m.role, content: text + (imgs.length ? `\n[${imgs.length} gambar dilampirkan sebelumnya]` : "") });
    }
  }
  // batas total huruf: buang pesan paling lama (pesan terakhir user selalu ikut); riwayat dimulai dari pesan user
  const lenOf = (m: Msg) => (typeof m.content === "string" ? m.content.length : m.content.reduce((n, p) => n + (p.text?.length ?? 0), 0));
  let histLen = histMsgs.reduce((n, m) => n + lenOf(m), 0);
  while (histMsgs.length > 2 && histLen > HIST_CHARS) histLen -= lenOf(histMsgs.shift()!);
  while (histMsgs.length > 1 && histMsgs[0].role !== "user") histMsgs.shift();
  // versi ringkas untuk model berbatas kecil (Groq gratis dll menolak permintaan terlalu besar: 413).
  // Data harga / candle / instruksi trade plan tetap utuh; yang dipangkas: isi artikel, data CS, folder, riwayat chat lama.
  const histLite = histMsgs.slice(-6);
  while (histLite.length > 1 && histLite[0].role !== "user") histLite.shift();
  const ctxLite = context ? context.slice(0, 4000) + (context.length > 4000 ? "\n… (data diringkas)" : "") : "";
  const folderLite = folder ? folderPrompt({ ...folder, listing: folder.listing.slice(0, 6000), contents: folder.contents.slice(0, 6000) }) : "";
  const brainLite = custom ? brainText(custom, customMem, 6000, lastText) : "";
  const userName = profile?.full_name || "anggota tim";
  const rules = systemPrompt();
  const saveError = async (msg: string) => {
    await supabase.from("ai_messages").insert({ conversation_id: convId, role: "assistant", content: msg, error: true, model: candidates[0] });
    emit({ t: "error", message: msg });
  };

  // 7) panggil OmniRoute; kalau model error / kosong sebelum menjawab -> coba calon berikutnya
  step("write", "run", { plan: tradeIntent && !!web.chart, hero: heroOf(candidates[0]) });
  let lastSwitch = "";
  const failures: string[] = [];
  let opened: { model: string; events: AsyncGenerator<SseEvent>; first: string } | null = null;
  // Batas waktu (Vercel Hobby + Fluid compute: maks 300 detik; di sini dipakai 120):
  // - tiap hero diberi maks 35 detik sampai mulai menjawab
  // - kalau hero pertama belum menjawab dalam 10 detik, hero berikutnya ikut dicoba BERSAMAAN (yang duluan menjawab dipakai)
  // - setelah 75 detik berhenti mencoba, supaya jawaban sempat dialirkan & pesan error jelas masih terkirim
  const OPEN_DEADLINE = t0 + 75_000;
  const ATTEMPT_MS = 35_000;
  // mesin tugas berat mulai menjawab lebih lambat -> cadangan baru ikut balapan setelah 25 detik
  const HEDGE_MS = heavyOn ? 25_000 : 10_000;
  let timedOut = false;
  // kalau key provider bermasalah, model lain dari provider yang sama pasti gagal juga -> lewati.
  // (kuota habis TIDAK dihitung: kuota gratis Gemini dll dihitung per model, model lain bisa masih ada jatah)
  const deadProv = new Set<string>();
  const PROVIDER_DOWN = /authenticat|authorization|invalid api key|api key not valid|missing api key|reconnect|decrypt|unauthori[sz]ed|forbidden/i;
  // Prompt caching (Claude): bagian depan yang sama ditandai cache_control -> dibaca ulang ±10% harga. Kalau server AI
  // menolak format ini, otomatis diulang tanpa cache. AI_PROMPT_CACHE=off mematikan.
  let useCache = (process.env.AI_PROMPT_CACHE ?? "").toLowerCase() !== "off";
  const sys = (text: string, cache: boolean): Msg => ({ role: "system", content: cache ? [{ type: "text", text, cache_control: { type: "ephemeral" } }] : text });
  const build = (model: string, lite: boolean): Msg[] => {
    const cache = useCache && isClaudeModel(model);
    const session = (lite ? [ctxLite, folderLite] : [context, folderMsg]).filter(Boolean).join("\n\n");
    const turn = [
      custom ? customPrompt(custom) : personaPrompt(heroOf(model)),
      sessionPrompt(userName),
      lite ? brainLite : brain,
      ...turnRules,
      lite ? (web.lite ?? web.context.slice(0, 6000)) : web.context,
    ]
      .filter(Boolean)
      .join("\n\n");
    return [sys(rules, cache), ...(session ? [sys(session, cache && session.length > 3000)] : []), sys(turn, false), ...(lite ? histLite : histMsgs)];
  };
  // permintaan besar: Groq gratis membatasi token per menit (413) -> kirim versi ringkas
  const charsOf = (arr: Msg[]) => arr.reduce((n, m) => n + (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content).length), 0);
  const fullChars = charsOf(build(candidates[0], false));
  let forceLite = false;
  let useUsage = true;
  const msgsFor = (model: string) => build(model, forceLite || (providerOf(model) === "groq" && fullChars > 20_000));

  type Res =
    | { ok: true; model: string; events: AsyncGenerator<SseEvent>; first: string }
    | { ok: false; model: string; why: string; status?: number; detail?: string; tooBig?: boolean; noUsage?: boolean; noCache?: boolean; fatal?: string };

  /** satu percobaan: kirim ke server AI lalu baca ±160 huruf pertama (error / kosong / huruf asing = gagal) */
  const attempt = async (model: string, ac: AbortController): Promise<Res> => {
    let upstream: Response | null = null;
    let netErr: unknown = null;
    const cacheSent = useCache && isClaudeModel(model);
    // koneksi ke server AI kadang putus sesaat -> coba ulang sekali
    for (let a = 0; a < 2 && !upstream && !ac.signal.aborted; a++) {
      try {
        upstream = await fetch(`${cfg.base}/chat/completions`, {
          method: "POST",
          headers: aiHeaders(cfg.key),
          // include_usage: jumlah token dicatat untuk halaman Usage (dimatikan otomatis kalau server AI menolaknya)
          body: JSON.stringify({ model, messages: msgsFor(model), stream: true, ...(useUsage ? { stream_options: { include_usage: true } } : {}) }),
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
      const noUsage = useUsage && upstream.status >= 400 && upstream.status < 500 && /stream_options|include_usage/i.test(detail);
      // format cache (system berupa array + cache_control) ditolak -> ulangi sekali tanpa cache
      const noCache = cacheSent && !noUsage && (upstream.status === 400 || upstream.status === 422);
      return { ok: false, model, why: `${upstream.status}${detail ? `: ${String(detail).slice(0, 80)}` : ""}`, status: upstream.status, detail: String(detail), tooBig, noUsage, noCache };
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
      if (owner) step("switch", "done", { from: heroName(model), to: nextHero, hero: chosenHero ?? nextHero });
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
    // server AI menolak permintaan jumlah token -> ulangi tanpa itu
    if (r.noUsage) {
      useUsage = false;
      queue.unshift(r.model);
      if (running.size < 2) startNext();
      continue;
    }
    if (r.noCache && useCache) {
      useCache = false;
      queue.unshift(r.model);
      if (running.size < 2) startNext();
      continue;
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
    const shownHero = heroOf(candidates[0] === "auto" ? SMART : candidates[0]);
    return void (await saveError(
      owner
        ? `${timedOut ? "Server AI lagi lambat — belum ada hero yang sempat menjawab dalam 75 detik. " : ""}Semua hero yang dicoba lagi tidak bisa menjawab (biasanya kuota gratis habis, key provider salah, atau provider sedang gangguan). Coba lagi sebentar, atau pilih hero lain.\n\nDicoba:\n${failures.map((f) => { const i = f.indexOf(" ("); return `- ${heroName(i > 0 ? f.slice(0, i) : f)}: ${i > 0 ? f.slice(i + 2, -1) : "gagal"}`; }).join("\n")}\n\n${hasImages ? "Untuk gambar butuh provider yang bisa lihat gambar (mis. Gemini) yang lulus Test di dashboard server AI." : "Pastikan minimal satu provider (mis. Groq / Gemini) sudah tersambung & lulus Test di dashboard server AI."}`
        : `${shownHero} lagi kewalahan — server AI sedang sibuk. Coba kirim lagi sebentar ya 🙏`
    ));
  }

  // 8) alirkan ke browser sambil dikumpulkan, lalu simpan jawaban lengkap
  const usedModel = opened.model;
  const personaHero = heroOf(usedModel);
  step("write", "done");
  emit({
    t: "meta",
    model: usedModel,
    persona: personaHero,
    data: useData,
    web: web.sources.length > 0,
    chart: web.chart ?? null,
    fallback: failures.length > 0,
    via,
  });
  let full = "";
  let usage: { in?: number; out?: number; cached?: number } = {};
  const { events, first } = opened;
  try {
    full += first;
    controller.enqueue(enc.encode(first));
    for await (const ev of events) {
      if (ev.usage) usage = ev.usage;
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
    if (usage.cached) console.log(`[ai] cache: ${usage.cached}/${usage.in} token input dibaca dari cache (${usedModel})`);
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
      const row: Record<string, unknown> = {
        conversation_id: convId,
        role: "assistant",
        content: full.slice(0, 100000) + (via ? viaMarker(via) : ""),
        model: usedModel,
        used_data: useData,
        persona: personaHero,
        ...(custom ? { character_id: custom.id } : {}),
        ...(usage.in !== undefined ? { tokens_in: usage.in, tokens_out: usage.out ?? 0 } : {}),
      };
      // kolom baru belum ada (migration-18 / -16 / -14 belum dijalankan) -> simpan tanpa kolom itu
      for (let i = 0; i < 6; i++) {
        const { error } = await supabase.from("ai_messages").insert(row);
        if (!error) break;
        if (/tokens_(in|out)/.test(error.message) && "tokens_in" in row) {
          delete row.tokens_in;
          delete row.tokens_out;
        } else if (/persona/.test(error.message) && "persona" in row) delete row.persona;
        else if (/used_data/.test(error.message) && "used_data" in row) delete row.used_data;
        else if (/character_id/.test(error.message) && "character_id" in row) delete row.character_id;
        else break;
      }
    }
    await supabase.from("ai_conversations").update({ updated_at: new Date().toISOString(), model: usedModel }).eq("id", convId);
  }
  }
}

type SseEvent = { piece?: string; error?: string; usage?: { in?: number; out?: number; cached?: number } };

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
          const u = j.usage ?? j.x_groq?.usage;
          if (u && (u.prompt_tokens !== undefined || u.input_tokens !== undefined))
            yield {
              usage: {
                in: Number(u.prompt_tokens ?? u.input_tokens) || 0,
                out: Number(u.completion_tokens ?? u.output_tokens) || 0,
                cached: Number(u.prompt_tokens_details?.cached_tokens ?? u.cache_read_input_tokens) || 0,
              },
            };
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
/**
 * Layla otomatis: kelompok kepribadian yang paling cocok untuk jenis pertanyaan.
 * NT = Si Analis, NF = Si Diplomat, SJ = Si Penjaga, SP = Si Penjelajah.
 */
function groupsFor(text: string, hasImages: boolean): PGroup[] {
  const t = text.toLowerCase();
  if (/(analis|analisa|trading|trade plan|saham|crypto|kripto|forex|xau|btc|eth|chart|grafik|data|excel|csv|rumus|hitung|angka|statistik|kode|coding|script|bug|logika|bandingkan|strategi|riset|ppt|presentasi|report|laporan performa)/.test(t) || hasImages) return ["NT"];
  if (/(curhat|sedih|capek|stres|semangat|motivasi|galau|caption|kreatif|ide konten|puisi|cerita|story|nama brand|tagline|hook|kata-kata|ucapan|minta maaf|hibur)/.test(t)) return ["NF"];
  if (/(hot issue|issue|video review|banding|sop|checklist|prosedur|aturan|laporan|rekap|rangkum|jadwal|payout|withdraw|clipper|balasan cs|template|tiket|komplain)/.test(t)) return ["SJ"];
  if (/(cepat|singkat|gimana cara|cara |tips|terjemah|translate|langsung|praktis|rekomendasi|saran|apa itu|jelasin singkat)/.test(t)) return ["SP"];
  return ["NT", "NF", "SJ", "SP"];
}

/** alasan sebuah pertanyaan dianggap "tugas berat & penting" (null = tugas biasa, pakai mesin hemat) */
function heavyReason(text: string, o: { approach: string; folderData: boolean; design: boolean; trade: boolean; data: boolean; web: boolean }): string | null {
  if (/\b(pakai sonnet|mode berat|mode teliti|analisa mendalam|riset mendalam|penting banget|super teliti)\b/i.test(text)) return "diminta";
  if (/\b(ppt|pptx|powerpoint|presentasi|slide|deck|report campaign|one.?pager|portfolio|portofolio)\w*/i.test(text)) return "ppt/report";
  if (/\b(buat|bikin|buatin|bikinin|susun|susunin)\w*\s+(\w+\s+){0,3}laporan/i.test(text)) return "laporan";
  if (o.approach === "full") return "analisa lengkap";
  // desain visual kompleks (infografis, alur, diagram, mockup, A4) -> mesin berat; poster/thumbnail biasa tetap mesin hemat
  if (o.design) return "desain kompleks";
  if (o.trade) return "analisa trading";
  if (o.folderData) return "data folder";
  if (text.length > 4000) return "teks panjang";
  // pertanyaan sulit / butuh analisa (skor >= 2). Obrolan ringan & pertanyaan sederhana tetap di mesin hemat.
  if (text.length < 25) return null;
  let score = 0;
  if (HARD_TASK.test(text)) score += 2;
  if (THINK_WORDS.test(text)) score += 1;
  if ((o.data || o.web) && AGGREGATE.test(text)) score += 1;
  if (text.length > 1200) score += 1;
  if ((text.match(/\?/g)?.length ?? 0) >= 3 || (text.match(/^\s*(\d+[.)]|[-*•])\s/gm)?.length ?? 0) >= 3) score += 1;
  if (/```|\b(function|const|select .* from|def |class )\b/i.test(text)) score += 1;
  return score >= 2 ? "analisa/sulit" : null;
}

/** kata kerja tugas yang butuh penalaran berat */
const HARD_TASK =
  /\b(analisa|analisis|analisi[sz]|analyze|bandingkan|perbandingan|bandingin|evaluasi|evaluate|strategi|rencana kerja|roadmap|akar masalah|root cause|diagnosa|prioritaskan|susun prioritas|insight|proyeksi|forecast|optimasi|optimalkan|audit|review mendalam|kritisi|rancang|desain sistem|debug)\w*/i;
/** sinyal "mikir dulu": alasan, sebab-akibat, langkah demi langkah */
const THINK_WORDS = /\b(kenapa|mengapa|gimana bisa|apa penyebab|penyebab|dampak|pengaruh|kelebihan|kekurangan|pro kontra|step by step|langkah demi langkah|secara detail|detail|mendalam|rekomendasi|solusi terbaik|sebaiknya)\b/i;
/** rangkuman / tren dari data (CS Tracker atau hasil browsing) */
const AGGREGATE = /\b(rangkum|ringkas|rekap|report|tren|trend|terbanyak|paling banyak|pola|minggu ini|bulan ini|per (pic|kategori|minggu)|dibanding|naik|turun|statistik|persen)\w*/i;

/** pesan revisi desain singkat ("ganti warna jadi biru", "judulnya lebih besar", "pakai opsi B") */
const DESIGN_EDIT = /\b(ganti|ubah|jadi(in)?|lebih|warna|teks|tulisan|judul|font|huruf|besar(in)?|kecil(in)?|geser|tambah(in)?|hapus|buang|versi|ukuran|background|latar|logo|foto|gambar|rapi\w*|revisi|opsi|pilih|yang (a|b|c|pertama|kedua|ketiga)|terang|gelap|bold|minimalis|ramai|kontras|9:16|16:9|1:1|4:5|a4)\b/i;

/** sapaan / terima kasih (bukan "iya"/"oke" — itu bisa jawaban atas pertanyaan AI) — tidak perlu perencana internet atau mesin berat */
const SMALL_TALK =
  /^(hai+|halo+|hallo|helo|hi+|hey|hei|pagi|siang|sore|malam|selamat (pagi|siang|sore|malam)|makasih|makasi|terima ?kasih|thanks?|thx|tq|mantap\w*|keren|nice|wkwk\w*|haha\w*|hehe\w*)([\s,!.]+(ya|kak|bro|sis|min|banget|deh|nih|semua|banyak|hehe|wkwk))*[\s!.]*$/i;

/** pertanyaan konsep / definisi yang cukup dijawab langsung */
const CONCEPT_Q = /^(apa (itu|bedanya|perbedaan|beda|arti|artinya|maksud|maksudnya|sih)|bedanya|perbedaan|definisi|pengertian|arti (dari|kata)|jelasin|jelaskan|kenapa|mengapa|gimana cara|bagaimana cara|cara)\b/i;

/** model Claude (mendukung prompt caching lewat cache_control) */
const isClaudeModel = (m: string) => /claude|anthropic|haiku|sonnet|opus|^anth\//i.test(m);

/**
 * Rapikan satu pesan riwayat sebelum dikirim ulang ke AI.
 * 3 pesan terakhir dikirim utuh; yang lebih lama: buang daftar sumber, blok data besar (deck/tradeplan/fileplan…), lalu dipotong.
 */
function compactMsg(text: string, role: string, recent: boolean, keepDesign = false): string {
  let t = text.replace(/\[\[ask:[\s\S]*?\]\]/g, "(menanyakan pendekatan analisa)").replace(/\n*\[\[chart:[^\]]*\]\]/g, "");
  if (!keepDesign) t = t.replace(/```design[ \t]*([^\n]*)\n[\s\S]*?(```|$)/g, (_, h: string) => `(desain "${h.trim()}" sudah dikirim sebelumnya)`);
  if (recent || keepDesign) return t;
  t = t
    .replace(/\n+---\n🌐 \*\*Sumber:\*\*[\s\S]*$/, "")
    .replace(/```(deck|report|tradeplan|fileplan|music|srt|ask|photos)\b[\s\S]*?(```|$)/g, (_, k: string) => `(blok ${k} sudah dikirim sebelumnya)`);
  const max = role === "user" ? 3000 : 1500;
  return t.length > max ? `${t.slice(0, max)} …(dipotong)` : t;
}

/** batas pemakaian mesin tugas berat per user per hari (AI_HEAVY_DAILY_LIMIT, default 15; pemilik tidak dibatasi) */
async function heavyQuotaOk(supabase: Awaited<ReturnType<typeof getCurrentUser>>["supabase"], owner: boolean) {
  if (owner) return true;
  const limit = Number(process.env.AI_HEAVY_DAILY_LIMIT ?? 15);
  if (!Number.isFinite(limit) || limit <= 0) return limit !== 0;
  const wib = new Date(Date.now() + 7 * 3600_000);
  const start = new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate()) - 7 * 3600_000).toISOString();
  const { count, error } = await supabase.from("ai_messages").select("id", { count: "exact", head: true }).eq("role", "assistant").ilike("model", "%sonnet%").not("content", "ilike", "%```ask%").gte("created_at", start);
  return error ? true : (count ?? 0) < limit;
}

/** format blok ```deck (PowerPoint gaya Konten.com) — dipakai mode Cowork dengan / tanpa folder */
const DECK_SPEC = [
  'Format: {"title":"Laporan Divisi …","subtitle":"…","period":"Oktober 2026","label":"LAPORAN DIVISI CS","slides":[ … ]}. Jenis slide:',
  '   {"type":"cover","title":"…","subtitle":"…"}',
  '   {"type":"section","title":"Divisi CS","subtitle":"…"}  (pembatas per divisi / bagian)',
  '   {"type":"kpi","title":"…","kpis":[{"label":"Total Views","value":"19,8 jt","note":"+12% vs bulan lalu","tone":"green"}, … maks 6],"bullets":["…"],"source":"nama-file.xlsx"}',
  '   {"type":"chart","title":"…","chart":{"kind":"bar|barh|line|pie|doughnut","labels":["Sen","Sel"],"series":[{"name":"Tiket","values":[12,18]}]},"kpis":[maks 3 angka pendamping],"source":"…"}',
  '   {"type":"table","title":"…","table":{"columns":["Agent","Tiket","CSAT"],"rows":[["Alif","120","4,8"]]},"source":"…"}  (maks 12 baris)',
  '   {"type":"bullets","title":"Kesimpulan & Rekomendasi","bullets":["…"]}',
  "   tone: green = angka utama/positif, orange = 1 angka sorotan per slide, red = negatif/masalah, neutral = biasa. Tiap slide data WAJIB punya \"source\" (nama file asal, atau \"CS Tracker\" untuk data website).",
];

/** permintaan bikin file / dokumen / laporan (mode Cowork tanpa folder pun tetap dapat aturan kerja) */
const COWORK_INTENT =
  /\b(bikin|buat|buatin|bikinin|susun|susunin|tulis|tuliskan|rapikan|rapihin|siapin|siapkan)\w*\s+(\w+\s+){0,3}(laporan|report|ppt|presentasi|slide|deck|dokumen|file|excel|tabel|surat|proposal|rangkuman|notulen|sop|template|rencana|jadwal|checklist)\b/i;

/** aturan mode Cowork (tugas / bikin file) */
function coworkRules(deckSpec: boolean) {
  return [
    "MODE COWORK (tugas / bikin file). Alur: pahami tujuan → kartu ```ask kalau perlu → rencana singkat → kerjakan → cek ulang → serahkan.",
    "- Info penting belum ada (periode, sumber data, untuk siapa, format/jumlah slide) dan salah tebak bikin kerja ulang → kirim kartu ```ask DULU, jangan langsung bikin file panjang. Sudah jelas / user sudah jawab kartu → langsung kerjakan.",
    "- Hasil SIAP PAKAI pakai fitur website: blok ```deck untuk PPT, ```report untuk report campaign, ```fileplan untuk rapikan file, ```design untuk poster/gambar/infografis, tabel/teks rapi untuk dokumen. Jangan menceritakan proses panjang.",
    "- Sebelum menyerahkan, cek ulang: angka cocok dengan data, tidak ada placeholder (…, XX, [isi]), jumlah slide/poin sesuai permintaan, JSON valid.",
    "- Buka dengan 1–2 kalimat ringkasan hasil (gaya karaktermu); tutup dengan TEPAT 1 saran langkah berikutnya.",
    "- Laporan/PPT dari data CS Tracker: semua angka dari blok DATA CS TRACKER (sebut periodenya). Data tidak ada → bilang, jangan mengarang.",
    ...(deckSpec ? ["", "FORMAT PPT — tutup jawaban dengan SATU blok ```deck berisi JSON (website mengubahnya jadi PowerPoint bergaya Konten.com):", ...DECK_SPEC] : []),
  ].join("\n");
}

/** hasil cari foto asli untuk giliran ini (foto Unsplash/Pexels boleh masuk desain, foto web umum tidak) */
function photoRules(q: string, r: PhotoResult | null, design: boolean) {
  const items = r?.items ?? [];
  const block = `\`\`\`photos\n{"query":${JSON.stringify(q)},"count":${Math.max(4, items.length || 6)}}\n\`\`\``;
  if (!items.length)
    return [
      `FOTO ASLI untuk "${q}" TIDAK TERSEDIA saat ini (${r?.note ?? "sumber foto gagal"}). JANGAN menolak dan jangan bilang tidak bisa.`,
      design
        ? "- Buat desainnya dengan ILUSTRASI SVG buatan sendiri sebagai pengganti foto, dan bilang jujur 1 kalimat: gambarnya ilustrasi, bukan foto asli."
        : "- Gambar ILUSTRASI SVG yang rapi lewat SATU blok ```design 1:1 (bukan 2–3 opsi), dan bilang jujur di awal: ini ilustrasi buatanku, bukan foto asli — foto asli belum ketemu.",
    ].join("\n");
  const src = r!.source === "web" ? "pencarian gambar web" : r!.source === "unsplash" ? "Unsplash" : "Pexels";
  const stock = items.filter((p) => p.provider !== "web");
  return [
    `HASIL CARI FOTO ASLI (query "${q}", sumber ${src}, ${items.length} foto). Website menampilkannya sebagai grid lengkap dengan kredit & lisensi kalau kamu menulis blok ini PERSIS:`,
    block,
    "- Bilang jujur 1 kalimat: ini foto asli dari internet (sebut sumbernya), bukan dibuat AI." + (r!.source === "web" ? " Ingatkan: foto web umum, cek hak cipta sebelum dipakai untuk konten/promosi." : " Boleh dipakai gratis, tetap cantumkan kredit fotografer."),
    "- Jangan menulis ulang daftar link fotonya (sudah ada di grid). Boleh tawarkan: pakai salah satu di desain" + (stock.length ? "" : " (hanya untuk foto Unsplash/Pexels)") + ".",
    ...(design
      ? stock.length
        ? [
            "- User juga minta DESAIN pakai foto: masukkan foto ini sebagai <img> (object-fit:cover) + lapisan gradasi supaya teks terbaca, dan kredit kecil di pojok. Foto yang boleh dipakai:",
            ...stock.slice(0, 3).map((p, i) => `  ${i + 1}. ${p.full} — kredit: "Foto: ${p.author} / ${p.provider === "unsplash" ? "Unsplash" : "Pexels"}"`),
          ]
        : ["- User juga minta DESAIN pakai foto, tapi foto yang ada hanya dari web umum (hak cipta belum jelas) → JANGAN masukkan ke desain. Pakai ilustrasi SVG di desain, tampilkan grid fotonya terpisah, dan bilang 1 kalimat alasannya."]
      : []),
  ].join("\n");
}

/** aturan mode pasar (crypto / saham / forex) — live = data harga asli berhasil diambil */
function marketRules(live: boolean, news: boolean) {
  return [
    "MODE PASAR (crypto / saham / forex):",
    live
      ? "- Harga, level & angka HANYA dari blok data di atas (DATA HARGA LIVE / RIWAYAT HARGA / candle / hasil browsing). Sebut sumber & waktu datanya (mis. \"64.210 per 24 Okt 14.05 WIB, sumber [1]\")."
      : "- ⚠️ DATA HARGA LIVE GAGAL / TIDAK DIAMBIL untuk pesan ini. Bilang jujur di awal jawaban bahwa data live tidak tersedia. JANGAN menyebut harga, level, atau persentase dari ingatan. Boleh jelaskan faktor & kerangka yang perlu dicek, lalu sarankan coba lagi / nyalakan 🌐 Internet.",
    "- Kalau tidak ada format kartu ringkas di bawah, susun: 1) Kondisi sekarang 2) Level penting 3) Skenario naik / turun (pemicu & batal) 4) Risiko 5) Yang perlu dipantau. Ringkas, boleh tabel.",
    "- Pisahkan FAKTA (dari data, + sumber) dan OPINI/analisa (tandai \"menurutku\", \"skenario\", \"kemungkinan\").",
    "- Tutup dengan pengingat risiko SATU baris saja. Jangan pernah menjanjikan profit atau kepastian arah.",
    "- Tujuan (entry / analisa / berita), timeframe, atau gaya (scalping / swing / investasi) belum jelas dan kartu pendekatan belum muncul → boleh kirim kartu ```ask berisi pertanyaan itu.",
    ...(news ? ["- TUJUAN USER: BERITA & SENTIMEN — rangkum 3–5 kabar terbaru (tanggal + [sumber]) lalu dampaknya ke harga (naik / turun / netral). Tanpa trade plan dan tanpa blok tradeplan."] : []),
  ].join("\n");
}

/** instruksi + data folder laptop user (rapikan file / baca isi / bikin laporan PPT) */
function folderPrompt(f: { name: string; listing: string; contents: string }) {
  return [
    `FOLDER LAPTOP USER "${f.name}" SEDANG TERHUBUNG. Kamu bisa melihat daftar filenya${f.contents ? " dan isi beberapa file" : ""} di bawah. Kamu TIDAK bisa mengubah file sendiri: kamu menyusun RENCANA, lalu user meninjau & klik "Jalankan" di website (dijalankan di browser user).`,
    "",
    "KALAU USER MINTA MERAPIKAN / MEMINDAH / MENGGANTI NAMA / MENCARI DUPLIKAT / MENGHAPUS FILE:",
    "1. Jelaskan singkat rencananya (tabel ringkas: Folder tujuan | Isi | Jumlah). Jangan bilang sudah dikerjakan.",
    "2. Tutup jawaban dengan SATU blok ```fileplan berisi JSON {\"summary\":\"...\",\"ops\":[...]}. Jenis op:",
    '   {"op":"rule","match":{"ext":["png","jpg"],"name":"regex nama (opsional)","in":"subfolder (opsional)","olderThanDays":30,"newerThanDays":7,"minSize":0,"maxSize":0,"dup":true},"action":"move","to":"Gambar/Screenshot/{yyyy}-{mm}"}',
    '   {"op":"rule","match":{...},"action":"delete"}',
    '   {"op":"renameRule","match":{...},"find":"regex","replace":"teks pengganti; boleh {yyyy} {mm} {dd} {n} {nn} {nnn} {name} {ext}"}',
    '   {"op":"move","from":"path/lama.pdf","to":"Folder/Tujuan/"}  ·  {"op":"rename","from":"path/lama.pdf","to":"nama baru.pdf"}  ·  {"op":"delete","path":"path/file"}',
    "   Semua kolom match opsional; isi hanya yang perlu. Untuk banyak file PAKAI \"rule\" (lebih hemat & mencakup file yang tidak tampil di daftar). \"dup\":true = hanya salinan kembar (bukan aslinya).",
    "   Path relatif terhadap folder ini, pakai '/'. Nama folder tujuan rapi Bahasa Indonesia (mis. Gambar, Dokumen, Video, Musik, Arsip, Installer, Data). {yyyy}/{mm}/{dd} = tanggal ubah file.",
    "3. HAPUS hanya kalau user jelas minta hapus/buang. Kalau user cuma minta rapikan duplikat, PINDAHKAN ke folder \"_Duplikat\". Website akan minta konfirmasi kedua sebelum menghapus.",
    "4. Jangan menyentuh file yang tidak relevan dengan permintaan.",
    "",
    "KALAU USER MINTA RANGKUM / BACA / ANALISA ISI FILE: jawab dari ISI FILE di bawah. Angka total/rata-rata WAJIB diambil dari bagian PROFIL DATA (sudah dihitung website), jangan menghitung ulang dari contoh baris. Kalau data yang diminta tidak ada, bilang tidak ada — JANGAN mengarang.",
    "",
    "KALAU USER MINTA LAPORAN / PPT / PRESENTASI / SLIDE dari data folder:",
    "1. Tulis ringkasan singkat (3–6 poin temuan penting) lalu tutup dengan SATU blok ```deck berisi JSON. Website mengubahnya jadi PowerPoint bergaya laporan Konten.com (latar hitam, angka hijau, aksen oranye). Kalau datanya data campaign Konten.com (views, spent, budget, CPM per campaign), boleh tambah blok ```report per campaign (halaman Campaign Performance PNG).",
    "2. Format blok deck:",
    ...DECK_SPEC,
    "3. Kalau folder berisi subfolder per divisi/bagian, buat section per divisi lalu slide KPI/grafiknya. Urutan: cover → ringkasan eksekutif (kpi) → per divisi → kesimpulan & rekomendasi. Umumnya 6–14 slide.",
    "4. SEMUA ANGKA HARUS dari ISI FILE / PROFIL DATA. Dilarang mengarang angka, persentase perubahan, atau target yang tidak ada di data. Format angka Indonesia (1.234.567 · 12,5% · Rp 2,4 jt).",
    "5. Kalau isi file belum terbaca (tidak ada di bawah), minta user menyebut nama file / subfolder datanya, jangan membuat deck kosong.",
    "",
    "===== DAFTAR FILE =====",
    f.listing,
    f.contents ? `\n===== ISI FILE =====\n${f.contents}` : "",
  ].join("\n");
}

function wrongScript(answer: string, userText: string) {
  const hits = answer.match(FOREIGN)?.length ?? 0;
  if (hits < 3) return false;
  return (userText.match(FOREIGN)?.length ?? 0) === 0;
}

/** model penerjemah gambar saja tidak cocok jadi perencana pencarian */
const isVisionOnlyRisk = (m: string) => /(^|\/)(llava|pixtral)|-vl-|vision/i.test(m);
