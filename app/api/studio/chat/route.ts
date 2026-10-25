import { NextResponse, type NextRequest } from "next/server";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { studioGuard, type StudioCtx } from "@/lib/studio/access.server";
import { aiConfig, aiHeaders, healthMap, healthRank, isDeadModel, listCatalog, loadHealth, markHealth } from "@/lib/ai.server";
import { heavyModelFrom, isChatModel, isVisionModel, providerOf, rankTextModels, setVisionCatalog } from "@/lib/aiModels";
import { personaPrompt } from "@/lib/aiPersona";
import { isAiOwner } from "@/lib/aiOwner";
import {
  DIRECTOR_HERO,
  DIRECTOR_RULES,
  directorCatalog,
  directorSession,
  historyText,
  isSmallEdit,
  mergeRevision,
  needsHeavy,
  parseDirector,
  visibleProse,
  type DirectorAttachment,
  type DirectorMusic,
  type DirectorVoice,
} from "@/lib/studio/director";
import { normalizeTimeline, type Timeline } from "@/lib/studio/timeline";
import { SFX_BUILTIN, type SfxMeta } from "@/lib/studio/sfxMeta";
import { STUDIO_BUCKET, musicSrc, storageSrc } from "@/lib/studio/urls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const HISTORY = 12; // pesan terakhir yang dikirim ke AI
const MAX_INPUT = 8000;
const MAX_ATTACH = 8;
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // gambar ≤ 4 MB dikirim langsung (data URL), lebih besar pakai signed URL
const MAX_TRIES = 4; // maksimal mesin yang dicoba bergantian
const ATTEMPT_MS = 75_000; // tiap mesin diberi maks 75 dtk sampai mulai menjawab
const OPEN_DEADLINE_MS = 170_000; // setelah ini berhenti mencoba mesin baru
const GEN_DEADLINE_MS = 280_000; // jawaban dihentikan di sini supaya sempat disimpan (batas Vercel 300 dtk)
const NEW_TITLE = "Video baru";

type Kind = DirectorAttachment["kind"];
type Attach = { path: string; kind: Kind; name: string };
type Body = { projectId?: string | null; content?: string; attachments?: unknown; timeline?: unknown };
type Row = { role: "user" | "assistant"; content: string | null; attachments: Attach[] | null; error: boolean | null };
type Part = { type: string; text?: string; image_url?: { url: string }; cache_control?: { type: "ephemeral" } };
type Msg = { role: string; content: string | Part[] };
type Db = StudioCtx["supabase"];

const KINDS: Kind[] = ["image", "video", "audio", "logo"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMG_EXT = /\.(png|jpe?g|webp|gif)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|ogg|aac|flac)$/i;

const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

/** error Supabase -> kalimat awam */
function dbText(e: { code?: string; message?: string } | null | undefined, fallback: string): string {
  const code = e?.code ?? "";
  const msg = e?.message ?? "";
  if (code === "42P01" || code === "PGRST205" || /schema cache|does not exist|relation .*studio_/i.test(msg)) return "Jalankan supabase/migration-20-studio.sql dulu di Supabase.";
  if (code === "42501" || /row-level security|permission denied/i.test(msg)) return "Proyek ini bukan milikmu. Buka atau buat proyek sendiri dulu ya.";
  return fallback;
}

/**
 * Chat dengan AI Sutradara Studio (Harley). Jawaban dialirkan sebagai teks (prosa saja — blok ```studio / ```ask ditahan),
 * diselingi bingkai kontrol "\u001e{json}\n": project (selalu pertama), step, meta, ask, plan, error, done.
 */
export async function POST(req: NextRequest) {
  const t0 = Date.now();
  const g = await studioGuard();
  if (!g.ok) return g.res;
  const { supabase, user, profile } = g;
  const owner = isAiOwner(user.email);

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return fail(400, "Permintaan tidak valid");
  }
  const content = String(body.content ?? "").replace(/\u001e/g, "").trim().slice(0, MAX_INPUT);
  // lampiran hanya dari folder upload milik sendiri
  const attachments: Attach[] = (Array.isArray(body.attachments) ? body.attachments : [])
    .map((a) => (a && typeof a === "object" ? (a as Record<string, unknown>) : {}))
    .map((a) => ({ path: String(a.path ?? ""), kind: (KINDS.includes(a.kind as Kind) ? a.kind : "image") as Kind, name: String(a.name ?? "").replace(/\s+/g, " ").trim().slice(0, 120) }))
    .filter((a) => a.path.startsWith(`uploads/${user.id}/`) && !a.path.includes("..") && a.path.length <= 400)
    .map((a) => ({ ...a, name: a.name || a.path.split("/").pop() || "lampiran" }))
    .slice(0, MAX_ATTACH);
  if (!content && !attachments.length) return fail(400, "Pesan kosong");

  // 1) proyek: muat (RLS memastikan milik sendiri / admin) atau buat baru
  let project: { id: string; title: string; timeline: unknown };
  const pid = typeof body.projectId === "string" ? body.projectId.trim() : "";
  if (pid) {
    if (!UUID.test(pid)) return fail(404, "Proyek tidak ditemukan");
    const { data, error } = await supabase.from("studio_projects").select("id, title, timeline").eq("id", pid).maybeSingle();
    if (error) return fail(500, dbText(error, "Gagal membuka proyek. Coba lagi sebentar."));
    if (!data) return fail(404, "Proyek tidak ditemukan");
    project = data as typeof project;
  } else {
    const { data, error } = await supabase.from("studio_projects").insert({ title: NEW_TITLE }).select("id, title, timeline").single();
    if (error || !data) return fail(500, dbText(error, "Gagal membuat proyek baru. Coba lagi sebentar."));
    project = data as typeof project;
  }

  // 2) simpan pesan user
  {
    const { error } = await supabase.from("studio_messages").insert({ project_id: project.id, role: "user", content, attachments });
    if (error) return fail(error.code === "42501" ? 403 : 500, dbText(error, "Gagal menyimpan pesan. Coba lagi sebentar."));
  }

  const enc = new TextEncoder();
  const upstreamAbort = new AbortController();
  req.signal.addEventListener("abort", () => upstreamAbort.abort());
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (o: Record<string, unknown>) => {
        try {
          controller.enqueue(enc.encode(`\u001e${JSON.stringify(o)}\n`));
        } catch {}
      };
      const write = (text: string) => {
        if (!text) return;
        try {
          controller.enqueue(enc.encode(text));
        } catch {}
      };
      emit({ t: "project", id: project.id, title: project.title });
      try {
        await pipeline(emit, write);
      } catch (e) {
        console.log("[studio] pipeline error:", e);
        emit({ t: "error", message: "Ada gangguan di server. Coba kirim lagi sebentar ya." });
      } finally {
        emit({ t: "done" });
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
      "x-project-id": project.id,
    },
  });

  async function pipeline(emit: (o: Record<string, unknown>) => void, write: (t: string) => void) {
    const step = (k: "understand" | "plan" | "write" | "check", s: "run" | "done") => emit({ t: "step", k, s });
    const saveAssistant = async (text: string, model: string | null, error = false) => {
      const { error: e } = await supabase.from("studio_messages").insert({ project_id: project.id, role: "assistant", content: text.slice(0, 100_000), persona: DIRECTOR_HERO, model, error });
      if (e) console.log("[studio] gagal simpan jawaban:", e.message);
      await supabase.from("studio_projects").update({ updated_at: new Date().toISOString() }).eq("id", project.id);
    };
    const saveError = async (msg: string, model: string | null = null) => {
      await saveAssistant(msg, model, true);
      emit({ t: "error", message: msg });
    };

    step("understand", "run");
    const cfg = aiConfig();
    if (!cfg.ok) return void (await saveError("AI belum disetel. Minta admin melengkapi pengaturan AI dulu ya."));

    // timeline terbaru: editan user di body (belum tentu sudah tersimpan) atau dari database
    const tlRaw = body.timeline && typeof body.timeline === "object" ? body.timeline : project.timeline && typeof project.timeline === "object" ? project.timeline : null;

    // 3) konteks: riwayat, SFX tambahan, bank suara, musik, katalog model — diambil bersamaan
    const [histRes, sfx, voices, music, catalog, health] = await Promise.all([
      supabase.from("studio_messages").select("role, content, attachments, error").eq("project_id", project.id).order("id", { ascending: false }).limit(HISTORY + 1),
      loadExtraSfx(supabase, usedSfxIds(tlRaw)),
      loadVoices(supabase),
      loadMusic(supabase, user.id),
      listCatalog(),
      loadHealth(supabase),
    ]);
    setVisionCatalog(catalog.vision);

    const current: Timeline | null = tlRaw ? normalizeTimeline(tlRaw, { extraSfx: sfx.allow }) : null;

    // riwayat (tanpa pesan error); pesan user terakhir = pesan ini (dibangun ulang di bawah supaya bisa membawa gambar)
    const rows = ((histRes.data ?? []) as Row[]).reverse().filter((m) => !m.error && (m.content || m.attachments?.length));
    if (rows.length && rows[rows.length - 1].role === "user") rows.pop();
    const prevRows = rows.slice(-(HISTORY - 1));
    const lastAssistant = [...prevRows].reverse().find((m) => m.role === "assistant")?.content ?? "";

    const cardAnswer = /^📌\s*(Jawaban|Lewati)/i.test(content);
    const small = !cardAnswer && isSmallEdit(content, !!current);
    const afterAsk = /```ask/i.test(lastAssistant);
    // mesin berat hanya untuk giliran kreatif (rencana baru / revisi besar / jawaban kartu); sapaan & pertanyaan cara pakai -> mesin cepat
    const creative = needsHeavy(content, { hasTimeline: !!current, afterAsk });
    const notes: string[] = [];
    if (cardAnswer)
      notes.push(
        /^📌\s*Lewati/i.test(content)
          ? "User MELEWATI kartu pertanyaan: langsung buat rencana lengkap pakai asumsi terbaik (sebut asumsinya 1 baris). JANGAN bertanya lagi."
          : "User SUDAH MENJAWAB kartu pertanyaan: langsung buat rencana lengkap sesuai jawabannya. JANGAN bertanya lagi."
      );
    else if (afterAsk) notes.push("Kamu baru saja bertanya. Kalau pesan user ini sudah cukup menjawab, langsung buat rencana — jangan bertanya lagi.");
    if (current && !cardAnswer)
      notes.push("Sudah ada TIMELINE SEKARANG: permintaan perubahan = REVISI (kirim timeline LENGKAP hasil revisi, id adegan lama dipertahankan). Kalau user jelas minta video yang benar-benar baru, buat rencana baru.");
    if (small) notes.push("Ini revisi kecil: ubah hanya bagian yang diminta, sisanya persis sama.");

    // 4) calon mesin: revisi kecil / obrolan -> mesin teks cepat; rencana baru / revisi besar -> mesin berat (hemat kuota harian)
    const isDead = (m: string) => isDeadModel(health.get(m));
    const pool = (catalog.ids.length ? catalog.ids : [...health.values()].filter((h) => healthRank(h) === 0).map((h) => h.model)).filter((m) => isChatModel(m) && !isDead(m));
    const ranked = rankTextModels(pool);
    const hm = healthMap(ranked, health);
    const byHealth = ranked
      .map((m, i) => ({ m, i, h: (hm.get(m) ?? 1) + (coolingDown(m) ? 3 : 0) }))
      .sort((a, b) => a.h - b.h || a.i - b.i)
      .map((x) => x.m);
    let candidates: string[] = [];
    let heavyOn = false;
    if (creative) {
      const heavy = heavyModelFrom(catalog.ids);
      if (heavy && !isDead(heavy) && !coolingDown(heavy) && healthRank(health.get(heavy)) !== 2 && (await heavyQuotaOk(supabase, user.id, owner))) {
        candidates.push(heavy);
        heavyOn = true;
      }
    }
    // putaran 1: satu mesin per provider (biar 4 percobaan tidak habis di provider yang sama-sama gangguan)
    const seenProv = new Set(candidates.map(providerOf));
    for (const m of byHealth) {
      if (candidates.length >= MAX_TRIES) break;
      const prov = providerOf(m);
      if (hm.get(m) !== 0 && prov && seenProv.has(prov)) continue;
      if (!candidates.includes(m)) candidates.push(m);
      if (prov) seenProv.add(prov);
    }
    for (const m of byHealth) {
      if (candidates.length >= MAX_TRIES) break;
      if (!candidates.includes(m)) candidates.push(m);
    }
    candidates = [...new Set(candidates)].slice(0, MAX_TRIES);
    if (!candidates.length) candidates = ["auto"];
    step("understand", "done");

    // 5) susun pesan
    const userName = profile?.full_name || user.email.split("@")[0] || "anggota tim";
    const dAttach: DirectorAttachment[] = attachments.map((a) => ({ kind: a.kind, name: a.name, src: storageSrc(a.path) }));
    const session = directorSession({ name: userName, timeline: current, attachments: dAttach, extraSfx: sfx.list, voices, music, notes });
    const fixed = [DIRECTOR_RULES, directorCatalog(), personaPrompt(DIRECTOR_HERO)].join("\n\n");
    const attachNote = (list: Attach[] | null | undefined) => (list?.length ? `\n[lampiran: ${list.map((a) => `${a.name} (${a.kind})`).join(", ")}]` : "");
    const hist: Msg[] = prevRows.map((m) => ({ role: m.role, content: (m.role === "assistant" ? historyText(m.content ?? "") : (m.content ?? "").slice(0, 3000)) + attachNote(m.attachments) }));
    const turnText = (content || "Ini lampiranku.") + attachNote(attachments);
    // gambar untuk mesin yang bisa melihat (disiapkan sekali, hanya kalau dipakai)
    const imgAttach = attachments.filter((a) => (a.kind === "image" || a.kind === "logo") && IMG_EXT.test(a.path)).slice(0, MAX_IMAGES);
    let imagesP: Promise<string[]> | null = null;
    const images = () => (imagesP ??= Promise.all(imgAttach.map((a) => imageUrl(supabase, a.path))).then((u) => u.filter((x): x is string => !!x)));

    let useCache = (process.env.AI_PROMPT_CACHE ?? "").toLowerCase() !== "off";
    const sys = (text: string, cache: boolean): Msg => ({ role: "system", content: cache ? [{ type: "text", text, cache_control: { type: "ephemeral" } }] : text });
    const build = async (model: string, lite: boolean): Promise<Msg[]> => {
      const vision = imgAttach.length > 0 && model !== "auto" && isVisionModel(model);
      const urls = vision ? await images() : [];
      const turn: Msg = urls.length
        ? { role: "user", content: [{ type: "text", text: turnText }, ...urls.map((url) => ({ type: "image_url", image_url: { url } }))] }
        : { role: "user", content: imgAttach.length ? `${turnText}\n(Kamu tidak bisa melihat isi gambarnya — pakai nama & src-nya saja.)` : turnText };
      const h = lite ? hist.slice(-4) : hist;
      return [sys(fixed, useCache && isClaudeModel(model)), sys(session, false), ...tidy([...h, turn])];
    };

    // 6) panggil server AI; gagal sebelum menjawab -> coba mesin berikutnya
    step("plan", "run");
    const openDeadline = t0 + OPEN_DEADLINE_MS;
    const genDeadline = t0 + GEN_DEADLINE_MS;
    const failures: string[] = [];
    let fatal = "";
    let opened: Opened | null = null;
    const queue = [...candidates];
    let lite = false;
    const deadProv = new Set<string>();
    while (queue.length && !opened && !upstreamAbort.signal.aborted) {
      const model = queue.shift()!;
      if (providerOf(model) && deadProv.has(providerOf(model))) continue;
      const left = openDeadline - Date.now();
      if (left < 5000) break;
      const r = await attempt(model, await build(model, lite), Math.min(ATTEMPT_MS, left));
      if (r.ok) {
        opened = r;
        await markHealth(supabase, model, true);
        break;
      }
      if (r.fatal) {
        fatal = r.fatal;
        break;
      }
      // format cache ditolak -> ulangi mesin yang sama tanpa cache
      if (r.noCache && useCache) {
        useCache = false;
        queue.unshift(model);
        continue;
      }
      // permintaan terlalu besar -> ulangi sekali dengan riwayat ringkas
      if (r.tooBig && !lite) {
        lite = true;
        queue.unshift(model);
        continue;
      }
      failures.push(`${model} (${r.why})`);
      coolDown(model);
      if (providerOf(model) && PROVIDER_DOWN.test(r.why)) deadProv.add(providerOf(model));
      if (r.status !== 413 && r.status !== 429) await markHealth(supabase, model, false, r.why);
    }
    if (upstreamAbort.signal.aborted) return;
    if (fatal) return void (await saveError(fatal));
    if (!opened) {
      console.log("[studio] semua mesin gagal:", failures.join(" | "));
      return void (await saveError(
        owner && failures.length
          ? `Semua mesin AI yang dicoba belum bisa menjawab. Coba lagi sebentar.\n\nDicoba:\n${failures.map((f) => `- ${f}`).join("\n")}`
          : `${DIRECTOR_HERO} lagi kewalahan — server AI sedang sibuk. Coba kirim lagi sebentar ya 🙏`
      ));
    }

    // 7) alirkan prosa (blok rencana/kartu ditahan), lalu baca & simpan hasilnya
    const usedModel = opened.model;
    step("plan", "done");
    emit({ t: "meta", persona: DIRECTOR_HERO, model: usedModel, heavy: heavyOn && usedModel === candidates[0] });
    step("write", "run");
    let full = "";
    let sent = 0;
    const push = (final: boolean) => {
      const vis = visibleProse(full, final);
      if (vis.length > sent) {
        write(vis.slice(sent));
        sent = vis.length;
      }
    };
    let cut = !!opened.cut;
    try {
      full = opened.first.replace(/\u001e/g, "");
      push(false);
      for await (const ev of opened.events) {
        if (ev.piece) {
          full += ev.piece.replace(/\u001e/g, "");
          push(false);
        }
        if (ev.cut) cut = true;
        if (ev.error) {
          cut = true;
          break;
        }
      }
    } catch {
      // dihentikan user / batas waktu / koneksi putus — pakai yang sudah ada
      cut = true;
    } finally {
      opened.release();
    }
    push(true);
    step("write", "done");
    if (!full.trim()) return void (await saveError(`${DIRECTOR_HERO} belum sempat menjawab. Coba kirim lagi ya.`, usedModel));

    step("check", "run");
    let parsed = parseDirector(full, { extraSfx: sfx.allow });
    // jawaban terpotong (koneksi putus / batas panjang jawaban / blok rencana belum ditutup) -> rencana rusak TIDAK diperbaiki
    // & tidak disimpan: hasil "perbaikan" cuma berisi adegan sebelum potongan, saat revisi adegan lama sesudahnya ikut terhapus
    const truncated = cut || parsed.partial;
    // JSON rencana rusak (bloknya lengkap) -> minta mesin memperbaikinya sekali
    if (parsed.broken && !truncated && !upstreamAbort.signal.aborted) {
      const fixedJson = await repairJson(parsed.broken, [usedModel, ...candidates.filter((m) => m !== usedModel && m !== "auto")][0], genDeadline);
      if (fixedJson) {
        const idx = full.lastIndexOf(parsed.broken);
        if (idx >= 0) {
          const before = full.slice(0, idx);
          let after = full.slice(idx + parsed.broken.length);
          if (!after.startsWith("```")) after = `\`\`\`${after}`;
          const opener = before.match(/```[ \t]*[a-z]*[^\n]*\n?$/i);
          full = `${opener && opener.index !== undefined ? before.slice(0, opener.index) : before}\`\`\`studio\n${fixedJson}\n${after}`;
          parsed = parseDirector(full, { extraSfx: sfx.allow });
        }
      }
    }
    let planSent = false;
    if (parsed.timeline) {
      const tl = mergeRevision(current, parsed.timeline, parsed.raw);
      const patch: Record<string, unknown> = { timeline: tl };
      const title = tl.title && tl.title !== NEW_TITLE ? tl.title.slice(0, 120) : "";
      if (project.title === NEW_TITLE && title) patch.title = title;
      const { error } = await supabase.from("studio_projects").update(patch).eq("id", project.id);
      if (error) console.log("[studio] gagal simpan timeline:", error.message);
      emit({ t: "plan", timeline: tl });
      planSent = true;
    }
    if (parsed.choice) emit({ t: "ask", choice: parsed.choice });
    if (parsed.broken && !planSent)
      emit({
        t: "error",
        message: truncated
          ? "Rencananya terpotong waktu ditulis, jadi belum dipakai (timeline tidak diubah). Coba minta lagi ya, mis. \"ulang rencananya\"."
          : "Rencananya rusak waktu ditulis. Coba minta lagi ya, mis. \"ulang rencananya\".",
      });
    else if (cut && !planSent && !parsed.choice) emit({ t: "error", message: "Jawabannya terpotong. Coba kirim lagi ya." });
    else if (!planSent && !parsed.choice && !parsed.prose) emit({ t: "error", message: `${DIRECTOR_HERO} belum sempat menjawab. Coba kirim lagi ya.` });
    await saveAssistant(full, usedModel);
    step("check", "done");
  }

  /** satu percobaan: kirim ke server AI lalu tunggu potongan jawaban pertama */
  async function attempt(model: string, messages: Msg[], ms: number): Promise<({ ok: true } & Opened) | ({ ok: false } & Failed)> {
    const cfg = aiConfig();
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    upstreamAbort.signal.addEventListener("abort", onAbort);
    let timer = setTimeout(() => ac.abort(), ms);
    const release = () => {
      clearTimeout(timer);
      upstreamAbort.signal.removeEventListener("abort", onAbort);
    };
    const failed = (f: Omit<Failed, "model">): { ok: false } & Failed => {
      release();
      ac.abort();
      return { ok: false, model, ...f };
    };
    const cacheSent = messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.cache_control));
    let res: Response | null = null;
    let netErr: unknown = null;
    // koneksi ke server AI kadang putus sesaat -> coba ulang sekali
    for (let a = 0; a < 2 && !res && !ac.signal.aborted; a++) {
      try {
        res = await fetch(`${cfg.base}/chat/completions`, { method: "POST", headers: aiHeaders(cfg.key), body: JSON.stringify({ model, messages, stream: true }), signal: ac.signal });
      } catch (e) {
        netErr = e;
        if (a === 0 && !ac.signal.aborted) await new Promise((r) => setTimeout(r, 1500));
      }
    }
    if (!res) {
      if (ac.signal.aborted) return failed({ why: "terlalu lama, tidak menjawab" });
      const cause = (netErr as { cause?: { code?: string } })?.cause?.code;
      console.log("[studio] server AI tidak bisa dihubungi:", cause ?? netErr);
      return failed({ why: "server AI tidak bisa dihubungi", fatal: "Server AI tidak bisa dihubungi. Biasanya komputer server AI-nya mati / sleep / tidak ada internet. Coba lagi nanti atau kabari admin." });
    }
    if (!res.ok || !res.body) {
      let detail = "";
      try {
        const t = await res.text();
        try {
          detail = String(JSON.parse(t)?.error?.message ?? t);
        } catch {
          detail = t;
        }
      } catch {}
      return failed({
        why: `${res.status}${detail ? `: ${detail.slice(0, 80)}` : ""}`,
        status: res.status,
        tooBig: res.status === 413 || /too large|context length|maximum context|tokens per minute|TPM/i.test(detail),
        noCache: cacheSent && (res.status === 400 || res.status === 422),
      });
    }
    const events = sse(res.body);
    let first = "";
    let why = "";
    let cut = false;
    try {
      for (;;) {
        const { value, done } = await events.next();
        if (done) break;
        if (value.error) {
          why = value.error;
          break;
        }
        if (value.piece) first += value.piece;
        if (value.cut) cut = true;
        if (first.trim().length >= 40) break;
      }
    } catch {
      if (!first) why = ac.signal.aborted ? "terlalu lama, tidak menjawab" : "koneksi terputus";
    }
    if (first && (first.match(FOREIGN)?.length ?? 0) >= 3 && !FOREIGN_RE.test(content)) {
      why = "menjawab pakai huruf asing";
      first = "";
    }
    if (first.trim() && !ac.signal.aborted) {
      // sudah mulai menjawab: batas waktu berikutnya = batas akhir jawaban
      clearTimeout(timer);
      timer = setTimeout(() => ac.abort(), Math.max(1000, t0 + GEN_DEADLINE_MS - Date.now()));
      // error / batas panjang yang sudah terbaca di potongan pertama tetap dihitung terpotong
      return { ok: true, model, events, first, release, cut: cut || !!why };
    }
    try {
      await events.return(undefined);
    } catch {}
    return failed({ why: why || (ac.signal.aborted ? "terlalu lama, tidak menjawab" : "jawaban kosong") });
  }

  /** minta mesin merapikan JSON rencana yang rusak (sekali). null kalau gagal / waktunya tidak cukup */
  async function repairJson(broken: string, model: string | undefined, deadline: number): Promise<string | null> {
    const left = deadline - Date.now();
    if (!model || model === "auto" || left < 15_000) return null;
    const cfg = aiConfig();
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    upstreamAbort.signal.addEventListener("abort", onAbort);
    const timer = setTimeout(() => ac.abort(), Math.min(60_000, left - 5000));
    try {
      const r = await fetch(`${cfg.base}/chat/completions`, {
        method: "POST",
        headers: aiHeaders(cfg.key),
        body: JSON.stringify({
          model,
          stream: false,
          messages: [
            { role: "system", content: "Kamu merapikan JSON yang rusak. Kembalikan JSON valid saja — tanpa penjelasan, tanpa blok kode. Jangan ubah isinya, hanya perbaiki penulisan (koma, kurung, tanda kutip). Jangan membuang adegan atau bagian mana pun." },
            { role: "user", content: `Kembalikan JSON valid saja:\n${broken.slice(0, 60_000)}` },
          ],
        }),
        signal: ac.signal,
      });
      if (!r.ok) return null;
      const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
      const text = String(j.choices?.[0]?.message?.content ?? "");
      const a = text.indexOf("{");
      const b = text.lastIndexOf("}");
      if (a < 0 || b <= a) return null;
      const json = text.slice(a, b + 1);
      const v = JSON.parse(json) as Record<string, unknown>;
      return Array.isArray(v?.scenes) && v.scenes.length ? json : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      upstreamAbort.signal.removeEventListener("abort", onAbort);
    }
  }
}

/** cut = jawaban berhenti karena batas panjang (finish_reason "length") — sisanya tidak ikut terkirim */
type SseEvent = { piece?: string; error?: string; cut?: boolean };
type Opened = { model: string; events: AsyncGenerator<SseEvent>; first: string; release: () => void; cut?: boolean };
type Failed = { model: string; why: string; status?: number; tooBig?: boolean; noCache?: boolean; fatal?: string };

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
          if (/^(length|max_tokens)$/.test(String(j.choices?.[0]?.finish_reason ?? ""))) yield { cut: true };
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

/** gabungkan pesan berurutan dengan peran sama & pastikan riwayat dimulai dari user (beberapa provider menolak selain itu) */
function tidy(list: Msg[]): Msg[] {
  const out: Msg[] = [];
  for (const m of list) {
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role) {
      const text = (c: Msg["content"]) => (typeof c === "string" ? c : c.map((p) => p.text ?? "").join("\n"));
      out[out.length - 1] =
        typeof m.content === "string" && typeof prev.content === "string"
          ? { role: m.role, content: `${prev.content}\n\n${m.content}` }
          : { role: m.role, content: [{ type: "text", text: `${text(prev.content)}\n\n${text(m.content)}` }, ...(Array.isArray(m.content) ? m.content.filter((p) => p.type !== "text") : [])] };
    } else out.push(m);
  }
  while (out.length > 1 && out[0].role !== "user") out.shift();
  return out;
}

/**
 * gambar lampiran untuk mesin yang bisa melihat: ≤ 4 MB dikirim langsung (data URL), lebih besar pakai signed URL 1 jam.
 * Ukuran dicek dulu lewat info file — file besar (bucket boleh sampai 200 MB) tidak diunduh ke memori.
 */
async function imageUrl(db: Db, p: string): Promise<string | null> {
  const bucket = db.storage.from(STUDIO_BUCKET);
  try {
    const { data: info } = await bucket.info(p);
    const size = Number(info?.size ?? info?.metadata?.size);
    const { data } = Number.isFinite(size) && size <= MAX_IMAGE_BYTES ? await bucket.download(p) : { data: null };
    if (data && data.size <= MAX_IMAGE_BYTES) {
      const type = data.type && data.type.startsWith("image/") && data.type !== "image/svg+xml" ? data.type : /\.png$/i.test(p) ? "image/png" : /\.webp$/i.test(p) ? "image/webp" : /\.gif$/i.test(p) ? "image/gif" : "image/jpeg";
      return `data:${type};base64,${Buffer.from(await data.arrayBuffer()).toString("base64")}`;
    }
  } catch {}
  try {
    const { data } = await bucket.createSignedUrl(p, 3600);
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

const SFX_LIMIT = 500; // sama dengan /api/studio/catalog: 500 SFX tambahan tertua (urut created_at)
const SFX_ID = /^[a-z0-9][a-z0-9-]{1,60}$/; // sama dengan cek kolom studio_sfx.id
const SFX_BUILTIN_IDS = new Set(SFX_BUILTIN.map((s) => s.id));

/** id SFX yang dipakai timeline mentah (editan user / database) — dicari di studio_sfx supaya tidak ikut terbuang saat dinormalisasi */
function usedSfxIds(raw: unknown): string[] {
  const ids = new Set<string>();
  const scenes = raw && typeof raw === "object" ? (raw as { scenes?: unknown }).scenes : null;
  for (const s of Array.isArray(scenes) ? scenes : []) {
    const cues = s && typeof s === "object" ? (s as { sfx?: unknown }).sfx : null;
    for (const c of Array.isArray(cues) ? cues : []) {
      const id = c && typeof c === "object" ? (c as { id?: unknown }).id : c;
      if (typeof id === "string" && SFX_ID.test(id.trim())) ids.add(id.trim());
    }
  }
  return [...ids].slice(0, 100);
}

/**
 * SFX tambahan (Freesound CC0 / Sonniss lokal) dari tabel studio_sfx. Tabel belum ada -> kosong.
 * list = 500 tertua (urutan & batas sama dengan katalog editor) — sumber daftar SFX TAMBAHAN di prompt.
 * allow = list + SFX tambahan yang sudah dipakai timeline sekarang — id yang boleh lolos normalisasi (timeline user & jawaban AI).
 * Baca gagal -> id yang sudah dipakai tetap masuk allow (placeholder kalau tidak bisa dicek), supaya cue Freesound/Sonniss
 * tidak hilang permanen saat revisi disimpan. Yang dibuang cuma id karangan AI yang memang tidak ada.
 */
async function loadExtraSfx(db: Db, used: string[]): Promise<{ list: SfxMeta[]; allow: SfxMeta[] }> {
  const cols = "id, path, cat, tags, dur, lufs, tp, hit, peak, use_for";
  // placeholder sama seperti keepMeta di planUtils: hanya untuk cek id & loudness saat normalisasi, tidak ikut tersimpan
  const keep = (have: Set<string>) =>
    used.filter((id) => !SFX_BUILTIN_IDS.has(id) && !have.has(id)).map((id): SfxMeta => ({ id, file: "", cat: "ui", tags: [], dur: 1, lufs: -20, tp: -3, hit: 0, peak: 0, use: "" }));
  try {
    const [all, usedRes] = await Promise.all([
      db.from("studio_sfx").select(cols).order("created_at", { ascending: true }).limit(SFX_LIMIT),
      used.length ? db.from("studio_sfx").select(cols).in("id", used) : null,
    ]);
    const list = !all.error && all.data ? sfxRows(all.data) : [];
    const have = new Set(list.map((s) => s.id));
    const more = usedRes && !usedRes.error && usedRes.data ? sfxRows(usedRes.data).filter((s) => !have.has(s.id)) : [];
    for (const s of more) have.add(s.id);
    // cek id yang dipakai gagal -> pertahankan semuanya (tidak bisa dibedakan mana yang benar-benar sudah dihapus)
    if (usedRes && (usedRes.error || !usedRes.data)) more.push(...keep(have));
    return { list, allow: more.length ? [...list, ...more] : list };
  } catch {
    return { list: [], allow: keep(new Set()) };
  }
}

/** baris studio_sfx -> SfxMeta */
function sfxRows(data: unknown): SfxMeta[] {
  return (data as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    file: String(r.path ?? ""),
    cat: String(r.cat ?? "ui"),
    tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
    dur: Number(r.dur) || 1,
    lufs: Number(r.lufs) || -20,
    tp: Number(r.tp) || -3,
    hit: Number(r.hit) || 0,
    peak: Number(r.peak) || 0,
    use: String(r.use_for ?? ""),
    src: storageSrc(String(r.path ?? "")),
  }));
}

/** bank suara yang sudah siap dipakai */
async function loadVoices(db: Db): Promise<DirectorVoice[]> {
  try {
    const { data, error } = await db.from("studio_voices").select("id, name, style").eq("status", "siap").order("created_at", { ascending: false }).limit(20);
    if (error || !data) return [];
    return (data as { id: string; name: string; style: string | null }[]).map((v) => ({ id: v.id, name: v.name, style: v.style }));
  } catch {
    return [];
  }
}

/** musik bebas hak cipta: file di assets/audio/music + upload user di uploads/<uid>/music */
async function loadMusic(db: Db, uid: string): Promise<DirectorMusic[]> {
  const out: DirectorMusic[] = [];
  try {
    const files = await readdir(path.join(process.cwd(), "assets", "audio", "music"));
    for (const f of files) if (AUDIO_EXT.test(f) && /^[\w.-]+$/.test(f)) out.push({ name: f, src: musicSrc(f) });
  } catch {}
  try {
    const dir = `uploads/${uid}/music`;
    const { data } = await db.storage.from(STUDIO_BUCKET).list(dir, { limit: 30, sortBy: { column: "created_at", order: "desc" } });
    for (const f of data ?? []) if (f.name && AUDIO_EXT.test(f.name)) out.push({ name: f.name, src: storageSrc(`${dir}/${f.name}`) });
  } catch {}
  return out.slice(0, 40);
}

/**
 * Batas pemakaian mesin berat untuk Studio per user per hari (WIB). Env AI_STUDIO_HEAVY_DAILY_LIMIT,
 * kalau kosong ikut AI_HEAVY_DAILY_LIMIT (default 15). Pemilik AI tidak dibatasi. Yang dihitung hanya jawaban berisi rencana
 * (blok ```studio) — obrolan & kartu pertanyaan tidak.
 */
async function heavyQuotaOk(db: Db, uid: string, owner: boolean) {
  if (owner) return true;
  // kosong / tidak diisi = bawaan 15; 0 = hanya pemilik AI
  const limit = Number(process.env.AI_STUDIO_HEAVY_DAILY_LIMIT?.trim() || process.env.AI_HEAVY_DAILY_LIMIT?.trim() || 15);
  if (!Number.isFinite(limit) || limit <= 0) return limit !== 0;
  const wib = new Date(Date.now() + 7 * 3600_000);
  const start = new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate()) - 7 * 3600_000).toISOString();
  try {
    const { count, error } = await db
      .from("studio_messages")
      .select("id, studio_projects!inner(owner)", { count: "exact", head: true })
      .eq("studio_projects.owner", uid)
      .eq("role", "assistant")
      .eq("error", false)
      .ilike("model", "%sonnet%")
      .ilike("content", "%```studio%")
      .gte("created_at", start);
    return error ? true : (count ?? 0) < limit;
  } catch {
    return true;
  }
}

// mesin yang barusan error diistirahatkan 15 menit (dicoba paling akhir)
const cooldown = new Map<string, number>();
const coolDown = (m: string) => cooldown.set(m, Date.now() + 15 * 60 * 1000);
const coolingDown = (m: string) => (cooldown.get(m) ?? 0) > Date.now();

/** kunci provider bermasalah -> mesin lain dari provider itu pasti gagal juga */
const PROVIDER_DOWN = /authenticat|authorization|invalid api key|api key not valid|missing api key|reconnect|decrypt|unauthori[sz]ed|forbidden/i;
/** model Claude (mendukung prompt caching lewat cache_control) */
const isClaudeModel = (m: string) => /claude|anthropic|haiku|sonnet|opus|^anth\//i.test(m);
/** huruf non-Latin yang sering "nyasar" (Arab, Mandarin/Jepang/Korea, Thai, Hindi, Kiril) */
const FOREIGN = /[؀-ۿݐ-ݿ一-鿿぀-ヿ가-힯฀-๿ऀ-ॿЀ-ӿ]/g;
const FOREIGN_RE = new RegExp(FOREIGN.source);
