import "server-only";
import { researchContext, type ResearchHit, type ResearchOut, type ResearchPlan } from "./research";

/**
 * Riset web untuk sutradara Studio lewat Tavily (kunci TAVILY_API_KEY — sama dengan riset di tab ✨ AI, tanpa layanan baru).
 * Hemat kredit: maks 1 search + 1 extract (≤2 halaman) per giliran. Batas waktu total ±13 dtk. Tidak pernah melempar error:
 * kunci kosong / gagal / habis waktu → hasil kosong + alasan (route lanjut tanpa riset).
 */
export const RESEARCH_MS = 13_000;
const SEARCH_MS = 10_000;
const EXTRACT_MS = 10_000;
/** situs yang isinya dangkal / tidak bisa dibaca (sama semangatnya dengan LOW_QUALITY di lib/aiWeb.server.ts) */
const SKIP_SITES = ["pinterest.com", "quora.com", "brainly.co.id", "scribd.com", "slideshare.net"];

export type ResearchResult = ResearchOut & {
  /** off = kunci kosong, fail = error / habis waktu, empty = tidak ada hasil yang cocok, ok = ada sumber */
  status: "off" | "fail" | "empty" | "ok";
  ms: number;
};

type Fetch = typeof fetch;

export async function runResearch(
  plan: ResearchPlan,
  opts: { key?: string; base?: string; fetchImpl?: Fetch; signal?: AbortSignal; ms?: number } = {}
): Promise<ResearchResult> {
  const t0 = Date.now();
  const key = (opts.key ?? process.env.TAVILY_API_KEY ?? "").trim();
  const empty = (status: ResearchResult["status"]): ResearchResult => ({ context: "", lite: "", sources: [], status, ms: Date.now() - t0 });
  if (!key) return empty("off");
  const base = (opts.base ?? process.env.TAVILY_BASE_URL ?? "https://api.tavily.com").trim().replace(/\/+$/, "");
  const doFetch = opts.fetchImpl ?? fetch;
  // satu pembatal untuk semua: batas waktu total + user menutup chat
  const ac = new AbortController();
  const stop = () => ac.abort();
  const timer = setTimeout(stop, opts.ms ?? RESEARCH_MS);
  opts.signal?.addEventListener("abort", stop);
  let failed = false;
  const call = async (path: "search" | "extract", body: unknown, ms: number): Promise<Record<string, unknown> | null> => {
    const own = new AbortController();
    const kill = () => own.abort();
    const t = setTimeout(kill, ms);
    ac.signal.addEventListener("abort", kill);
    try {
      const r = await doFetch(`${base}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
        signal: own.signal,
        cache: "no-store",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as unknown;
      return j && typeof j === "object" ? (j as Record<string, unknown>) : null;
    } catch (e) {
      failed = true;
      console.log(`[studio] riset ${path} gagal:`, (e as Error)?.message ?? e);
      return null;
    } finally {
      clearTimeout(t);
      ac.signal.removeEventListener("abort", kill);
    }
  };
  // berhenti tepat di batas waktu walau fetch tidak menghiraukan signal
  const until = <T,>(p: Promise<T>, fallback: T): Promise<T> =>
    Promise.race([p, new Promise<T>((res) => (ac.signal.aborted ? res(fallback) : ac.signal.addEventListener("abort", () => res(fallback), { once: true })))]);
  try {
    const arr = (v: unknown) => (Array.isArray(v) ? v : []) as Record<string, unknown>[];
    const [read, found] = await Promise.all([
      plan.urls.length ? until(call("extract", { urls: plan.urls.slice(0, 2), extract_depth: "basic", format: "text" }, EXTRACT_MS), null) : Promise.resolve(null),
      plan.query
        ? until(
            call(
              "search",
              { query: plan.query, search_depth: "basic", max_results: 6, topic: "general", include_raw_content: true, exclude_domains: SKIP_SITES },
              SEARCH_MS
            ),
            null
          )
        : Promise.resolve(null),
    ]);
    const hits: ResearchHit[] = [
      // halaman yang diminta langsung (link user / situs resmi) dulu
      ...arr(read?.results).map((r) => ({ url: String(r.url ?? ""), title: "", content: String(r.raw_content ?? "") })),
      ...arr(found?.results).map((r) => ({
        url: String(r.url ?? ""),
        title: String(r.title ?? ""),
        // isi halaman lengkap kalau ada (biaya kredit sama), kalau tidak potongan ringkasnya
        content: String(r.raw_content || r.content || ""),
        date: typeof r.published_date === "string" ? r.published_date : undefined,
      })),
    ].filter((h) => !SKIP_SITES.some((d) => h.url.includes(d)));
    if (ac.signal.aborted && !hits.length) return empty("fail");
    const out = researchContext(plan, hits);
    if (!out.sources.length) return empty(failed || ac.signal.aborted ? "fail" : "empty");
    return { ...out, status: "ok", ms: Date.now() - t0 };
  } catch {
    return empty("fail");
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", stop);
  }
}
