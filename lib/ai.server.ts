import "server-only";

/** Pengaturan AI (OmniRoute atau server lain yang formatnya sama dengan OpenAI) */
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

let modelCache: { at: number; ids: string[] } | null = null;

/** Daftar model dari OmniRoute (disimpan 10 menit di memori server) */
export async function listModels(): Promise<string[]> {
  const cfg = aiConfig();
  if (!cfg.ok) return [];
  if (modelCache && Date.now() - modelCache.at < 600000) return modelCache.ids;
  try {
    const r = await fetch(`${cfg.base}/models`, { headers: aiHeaders(cfg.key), signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    const ids = ((j?.data ?? []) as { id?: string }[]).map((m) => String(m.id ?? "")).filter(Boolean);
    modelCache = { at: Date.now(), ids: [...new Set(ids)].sort((a, b) => a.localeCompare(b)) };
  } catch {
    return modelCache?.ids ?? [];
  }
  return modelCache.ids;
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
    `Sekarang: ${today} (WIB).`,
    extra,
  ]
    .filter(Boolean)
    .join("\n");
}
