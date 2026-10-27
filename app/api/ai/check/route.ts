import { isAiOwner } from "@/lib/aiOwner";
import { NextResponse } from "next/server";
import { assertTab } from "@/lib/tabs.server";
import { getCurrentUser } from "@/lib/auth";
import { aiConfig, aiHeaders, listCatalog, markHealth } from "@/lib/ai.server";
import { heroName, isChatModel, sameHeroVariants, setVisionCatalog } from "@/lib/aiModels";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Result = { hero: string; ok: boolean; tried: number; reason?: string };
let last: { at: number; results: Result[] } | null = null;

/**
 * 🩺 Cek semua hero: tiap hero dites dengan pertanyaan super pendek ke varian terbaiknya (maks 3 varian),
 * hasilnya dicatat di ai_model_health supaya daftar hero & pilihan otomatis hanya memakai yang benar-benar jalan.
 */
export async function POST() {
  const { supabase, user } = await getCurrentUser();
  const gate = await assertTab("ai");
  if (!gate.ok) return gate.res;
  if (!isAiOwner(user.email)) return NextResponse.json({ error: "Khusus pemilik AI." }, { status: 403 });
  const cfg = aiConfig();
  if (!cfg.ok) return NextResponse.json({ error: "Server AI belum disetel." }, { status: 503 });
  // jangan dicek beruntun (hemat kuota gratis) — hasil 3 menit terakhir dipakai ulang
  if (last && Date.now() - last.at < 180_000) return NextResponse.json({ results: last.results, cached: true });

  const catalog = await listCatalog();
  setVisionCatalog(catalog.vision);
  const chat = catalog.ids.filter(isChatModel);
  if (!chat.length) return NextResponse.json({ error: `Daftar model belum terbaca${catalog.error ? ` (${catalog.error})` : ""}.` }, { status: 502 });
  const heroes = [...new Set(chat.map((m) => heroName(m)))];

  const t0 = Date.now();
  const test = async (model: string): Promise<{ ok: boolean; reason?: string; soft?: boolean }> => {
    try {
      const r = await fetch(`${cfg.base}/chat/completions`, {
        method: "POST",
        headers: aiHeaders(cfg.key),
        body: JSON.stringify({ model, stream: false, max_tokens: 64, messages: [{ role: "user", content: "Balas satu kata saja: siap" }] }),
        signal: AbortSignal.timeout(12_000),
      });
      if (r.ok) {
        const j = await r.json().catch(() => null);
        return j?.choices?.length ? { ok: true } : { ok: false, reason: "jawaban kosong" };
      }
      let detail = "";
      try {
        const t = await r.text();
        detail = (JSON.parse(t)?.error?.message as string) || t;
      } catch {}
      // kuota habis itu sementara -> jangan dicap rusak
      return { ok: false, reason: `${r.status}${detail ? `: ${detail.slice(0, 90)}` : ""}`, soft: r.status === 429 };
    } catch (e) {
      return { ok: false, reason: (e as Error)?.name === "TimeoutError" ? "terlalu lama" : "koneksi gagal" };
    }
  };

  const checkHero = async (hero: string): Promise<Result> => {
    const variants = sameHeroVariants(chat, hero).slice(0, 3);
    let reason = "";
    let tried = 0;
    for (const m of variants) {
      if (Date.now() - t0 > 48_000) return { hero, ok: false, tried, reason: reason || "belum sempat dicek" };
      tried++;
      const r = await test(m);
      if (r.ok) {
        await markHealth(supabase, m, true);
        return { hero, ok: true, tried };
      }
      reason = r.reason ?? "gagal";
      if (!r.soft) await markHealth(supabase, m, false, `cek: ${reason}`);
    }
    return { hero, ok: false, tried, reason };
  };

  // 6 hero dicek bersamaan
  const results: Result[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(6, heroes.length) }, async () => {
      while (i < heroes.length) {
        const hero = heroes[i++];
        results.push(await checkHero(hero));
      }
    })
  );
  results.sort((a, b) => Number(b.ok) - Number(a.ok) || a.hero.localeCompare(b.hero));
  last = { at: Date.now(), results };
  return NextResponse.json({ results });
}
