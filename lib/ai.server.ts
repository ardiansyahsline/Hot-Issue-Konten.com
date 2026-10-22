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
    model: (process.env.AI_DEFAULT_MODEL ?? "auto").trim() || "auto",
  };
}

export function aiHeaders(key: string): Record<string, string> {
  return { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) };
}

export function systemPrompt(name: string) {
  const today = new Intl.DateTimeFormat("id-ID", { dateStyle: "full", timeZone: "Asia/Jakarta" }).format(new Date());
  const extra = (process.env.AI_SYSTEM_PROMPT ?? "").trim();
  return [
    `Kamu adalah asisten AI di CS Tracker, aplikasi internal tim Konten.com. Kamu sedang ngobrol dengan ${name}.`,
    "Jawab dengan bahasa yang dipakai user (default: Bahasa Indonesia santai tapi sopan). Jawab jelas dan ringkas; pakai daftar, tabel, atau blok kode kalau membantu.",
    "Kalau tidak tahu atau tidak yakin, bilang terus terang — jangan mengarang fakta, angka, atau link.",
    `Hari ini ${today} (WIB).`,
    extra,
  ]
    .filter(Boolean)
    .join("\n");
}
