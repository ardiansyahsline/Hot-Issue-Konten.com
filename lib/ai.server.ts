import "server-only";

/** Pengaturan AI (server AI yang formatnya sama dengan OpenAI) */
export function aiConfig() {
  const base = (process.env.OMNIROUTE_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const key = (process.env.OMNIROUTE_API_KEY ?? "").trim();
  return {
    ok: !!base,
    // boleh diisi https://ai.domain.com atau https://ai.domain.com/v1
    base: base ? (/\/v1$/.test(base) ? base : `${base}/v1`) : "",
    key,
    /** kosong / "smart" = aplikasi memilih model terbaik yang tersedia */
    model: (process.env.AI_DEFAULT_MODEL ?? "smart").trim() || "smart",
    visionModel: (process.env.AI_VISION_MODEL ?? "").trim(),
  };
}

export function aiHeaders(key: string): Record<string, string> {
  return { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) };
}

let modelCache: { at: number; ids: string[]; vision: string[] } | null = null;
let failCache: { at: number; error: string } | null = null;

async function fetchIds(url: string, key: string): Promise<{ ids: string[] | null; error: string }> {
  try {
    // server AI di laptop/rumah lewat terowongan bisa lambat -> beri waktu lebih lama
    const r = await fetch(url, { headers: aiHeaders(key), signal: AbortSignal.timeout(25000), cache: "no-store" });
    if (!r.ok) return { ids: null, error: `HTTP ${r.status}` };
    const j = await r.json();
    return { ids: ((j?.data ?? []) as { id?: string }[]).map((m) => String(m.id ?? "")).filter(Boolean), error: "" };
  } catch (e) {
    const err = e as { name?: string; cause?: { code?: string }; message?: string };
    return { ids: null, error: err?.name === "TimeoutError" ? "timeout 25 detik" : err?.cause?.code || err?.message || "gagal" };
  }
}

/** Katalog model dari server AI (disimpan 10 menit di memori server): satu id per model + daftar yang bisa lihat gambar */
export async function listCatalog(): Promise<{ ids: string[]; vision: string[]; error?: string }> {
  const cfg = aiConfig();
  if (!cfg.ok) return { ids: [], vision: [] };
  if (modelCache && Date.now() - modelCache.at < 600000) return modelCache;
  // baru gagal < 1 menit lalu -> jangan bikin user nunggu lagi
  if (failCache && Date.now() - failCache.at < 60000) return modelCache ?? { ids: [], vision: [], error: failCache.error };
  // ?prefix=alias = satu id per model (tanpa dobel), ?kind=chat = hanya model chat,
  // ?configuredOnly=true = hanya provider yang sudah disambungkan (versi baru). Kalau tidak didukung -> daftar biasa.
  const Q = "prefix=alias&kind=chat";
  let configured = true;
  let res = await fetchIds(`${cfg.base}/models?${Q}&configuredOnly=true`, cfg.key);
  if (!res.ids || !res.ids.length) {
    configured = false;
    const all = await fetchIds(`${cfg.base}/models?${Q}`, cfg.key);
    res = all.ids && all.ids.length ? all : { ids: res.ids, error: all.error || res.error };
  }
  if (!res.ids || !res.ids.length) {
    const plain = await fetchIds(`${cfg.base}/models`, cfg.key);
    if (plain.ids && plain.ids.length) res = plain;
    else res = { ids: res.ids, error: res.error || plain.error };
  }
  if (!res.ids || !res.ids.length) {
    failCache = { at: Date.now(), error: res.error || "daftar kosong" };
    console.log("[ai] katalog model gagal:", failCache.error);
    return modelCache ?? { ids: [], vision: [], error: failCache.error };
  }
  failCache = null;
  const vision = (await fetchIds(`${cfg.base}/models?${Q}&capability=vision${configured ? "&configuredOnly=true" : ""}`, cfg.key)).ids ?? [];
  modelCache = { at: Date.now(), ids: [...new Set(res.ids)].sort((a, b) => a.localeCompare(b)), vision };
  return modelCache;
}

export async function listModels(): Promise<string[]> {
  return (await listCatalog()).ids;
}

export type Health = { model: string; ok_at: string | null; fail_at: string | null; fail_count: number; last_error: string | null };

type DB = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** catatan model yang pernah berhasil / gagal (migration-15). Kalau tabel belum ada -> kosong. */
export async function loadHealth(db: DB): Promise<Map<string, Health>> {
  try {
    const { data, error } = await db.from("ai_model_health").select("model, ok_at, fail_at, fail_count, last_error").limit(2000);
    if (error) return new Map();
    return new Map(((data ?? []) as Health[]).map((h) => [h.model, h]));
  } catch {
    return new Map();
  }
}

export async function markHealth(db: DB, model: string, ok: boolean, errText?: string) {
  if (!model || model === "auto") return;
  const now = new Date().toISOString();
  try {
    if (ok) await db.from("ai_model_health").upsert({ model, ok_at: now, fail_count: 0, updated_at: now }, { onConflict: "model" });
    else {
      const { data } = await db.from("ai_model_health").select("fail_count").eq("model", model).maybeSingle();
      await db
        .from("ai_model_health")
        .upsert({ model, fail_at: now, fail_count: (data?.fail_count ?? 0) + 1, last_error: (errText ?? "").slice(0, 300), updated_at: now }, { onConflict: "model" });
    }
  } catch {
    // tabel belum ada -> abaikan
  }
}

const H = 3600 * 1000;
/** 0 = terbukti jalan, 1 = belum pernah dicoba, 2 = baru gagal */
/**
 * Status tiap model, ikut memperhitungkan provider-nya: kalau model lain dari provider yang sama
 * pernah jalan -> dianggap siap dicoba duluan; kalau provider itu baru gagal semua -> taruh belakang.
 */
export function healthMap(models: string[], health: Map<string, Health>): Map<string, 0 | 1 | 2> {
  const prov = (m: string) => (m.includes("/") ? m.split("/")[0].toLowerCase() : "");
  const provOk = new Set<string>();
  const provFail = new Set<string>();
  for (const [m, h] of health) {
    const r = healthRank(h);
    if (r === 0) provOk.add(prov(m));
    // satu model "tidak ditemukan" bukan berarti providernya rusak — hanya error kunci/izin yang menular ke model lain
    if (r === 2 && /authenticat|authorization|api key|unauthori|forbidden|decrypt|reconnect|401|403/i.test(h.last_error ?? "")) provFail.add(prov(m));
  }
  const out = new Map<string, 0 | 1 | 2>();
  for (const m of models) {
    let r = healthRank(health.get(m));
    // provider lain yang jalan TIDAK membuat model ini dianggap siap (katalog NVIDIA dll berisi model yang tidak aktif
    // untuk akun kita) — hanya error kunci/izin provider yang menular ke model lain dari provider itu.
    if (r === 1 && prov(m) && provFail.has(prov(m)) && !provOk.has(prov(m))) r = 2;
    out.set(m, r);
  }
  return out;
}

export function healthRank(h: Health | undefined): 0 | 1 | 2 {
  if (!h) return 1;
  const ok = h.ok_at ? Date.parse(h.ok_at) : 0;
  const fail = h.fail_at ? Date.parse(h.fail_at) : 0;
  if (fail > ok && Date.now() - fail < 24 * H) return 2; // gagal dalam 24 jam terakhir -> dicoba paling akhir
  if (ok > fail && Date.now() - ok < 7 * 24 * H) return 0;
  return 1;
}

export function systemPrompt(name: string) {
  const today = new Intl.DateTimeFormat("id-ID", { dateStyle: "full", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date());
  const extra = (process.env.AI_SYSTEM_PROMPT ?? "").trim();
  return [
    `Kamu adalah asisten AI di CS Tracker, aplikasi internal tim Konten.com (platform clipper/kreator). Kamu sedang ngobrol dengan ${name}.`,
    "BAHASA: Selalu jawab dalam Bahasa Indonesia yang santai tapi sopan. Hanya pakai bahasa lain kalau user menulis dalam bahasa itu atau memintanya secara eksplisit. Jangan pernah menjawab dalam bahasa Arab, Mandarin, atau bahasa lain tanpa diminta.",
    "Jawab jelas dan ringkas; pakai daftar, tabel, atau blok kode kalau membantu.",
    "Kalau tidak tahu atau tidak yakin, bilang terus terang — jangan mengarang fakta, angka, harga, atau link.",
    "GAMBAR: kalau user mengirim gambar/screenshot, jelaskan hanya apa yang benar-benar terlihat di gambar.",
    "TRADING: kalau diminta analisa chart/trading, susun: (1) timeframe & aset kalau terlihat, (2) tren & struktur market, (3) support/resistance & level penting yang terlihat, (4) pola candlestick/chart & indikator yang tampak, (5) skenario bullish dan bearish beserta level konfirmasi/invalidasi, (6) catatan manajemen risiko. Jangan menebak harga yang tidak terlihat. Kamu tidak punya data harga real-time. Akhiri dengan pengingat singkat bahwa ini analisa edukasi, bukan saran finansial.",
    "INTERNET: website ini bisa otomatis browsing untukmu. Kalau ada blok 'HASIL BROWSING INTERNET', itu hasil pencarian yang barusan dilakukan — pakai, sebut sumbernya [1], [2], dan jangan pernah bilang kamu tidak bisa browsing. Kalau blok itu tidak ada dan pertanyaannya butuh data terbaru, jawab dari pengetahuanmu tapi bilang datanya mungkin sudah tidak terbaru, dan sarankan nyalakan tombol 🌐 Internet.",
    "INVESTASI/SAHAM/CRYPTO: jangan menolak. Berikan analisa yang berguna seperti analis: bandingkan fundamental, valuasi, prospek sektor, katalis & risiko; boleh menyebut saham/aset yang menurutmu menarik beserta alasan dan skenarionya (bukan janji untung). Pakai data dari hasil browsing kalau ada, jangan mengarang angka. Tutup dengan pengingat singkat bahwa ini analisa edukasi, bukan saran keuangan, dan keputusan tetap di user.",
    `Sekarang: ${today} (WIB).`,
    extra,
  ]
    .filter(Boolean)
    .join("\n");
}
