// Daftar model AI: sembunyikan yang tidak cocok untuk chat, pilih yang terbaik, dan beri nama hero ML
export const SMART = "smart"; // pilihan "otomatis": aplikasi memilih model terbaik yang tersedia

/** model yang bukan untuk chat (suara, filter, embedding, khusus bahasa Arab, dll.) */
const HIDE = /(^|\/)compound(-mini)?$|whisper|orpheus|tts|speech|audio|transcri|prompt-guard|safeguard|llama-guard|allam|embed|rerank|moderation|dall-?e|imagen|veo|flux|sdxl|stable-diffusion|image-gen|text-to-image|playai|distil/i;

/** model yang bisa membaca gambar */
const VISION = /gemini|gemma-?[34]|vision|[-_/]vl\b|-vl-|llava|pixtral|llama-4|maverick|scout|gpt-4o|gpt-4\.1|gpt-5|claude|kimi-k2\.5|kimi-k3|glm-4\.?\dv|qwen.*vl|qwen3\.8|muse/i;

/** urutan model terbaik untuk chat biasa (yang pertama tersedia dipakai) */
const BEST_TEXT = [/claude[^/]*haiku/i, /gemini[^/]*flash(?!-lite)/i, /kimi/i, /deepseek(?!.*r1)/i, /gpt-oss-120b/i, /qwen3/i, /llama-3\.3-70b/i, /grok/i, /gemini/i, /mistral-(large|medium)/i, /gpt-oss-20b/i, /llama/i];
/** urutan model terbaik untuk membaca gambar */
const BEST_VISION = [/claude[^/]*haiku/i, /gemini[^/]*flash(?!-lite)/i, /gemini/i, /qwen3\.8/i, /nemotron.*-vl-|-vl-/i, /gemma-?[34]/i, /llama-4/i];

/** agen coding / akun IDE / login web — bukan untuk chat biasa (sering error kalau dipanggil dari aplikasi lain) */
const AGENT = /(^|[/:])(devin|jules|codex|cursor|kiro|windsurf|cline|trae|zed|copilot|github-copilot|antigravity|agy|cc|claude-code|gemini-cli|qwen-code|grok-build|amp|augment|warp|aider|opencode|iflow|roo|kilo|continue|droid|factory|yuanbao|agnes)[\w.-]*[/:]|agentic|cloud-?agent|omniroute-no-thinking|(^|[/:])no-?think(ing)?[/:]|[\w-]+-(cli|web|cookie|oauth|ide)[/:]/i;

/**
 * Provider yang TIDAK pakai API key resmi: tanpa login (noauth), butuh program CLI di komputer, jembatan agent,
 * atau cookie website (berisiko melanggar aturan provider). Ditulis id + alias pendeknya (daftar resmi server AI).
 * Model dari provider ini selalu gagal / tidak cocok untuk website, jadi tidak pernah dipilih.
 */
const BLOCKED_PROVIDERS = new Set(
  (
    "auto aihorde horde auggie aug chipotle pepper cloudflare-playground cfp codex-app-server cxa devin-cli-agentic dva " +
    "duckduckgo-web ddgw felo-web felo opencode oc theoldllm tllm uncloseai unc veoaifree-web veo-free zcode zc devin-cli dv agy " +
    "gh github xai-oauth xao adapta-web adp-web adobe-firefly firefly blackbox-web bb-web chatgpt-web cgpt-web chatgpt-web-codex cgpt-codex " +
    "claude-web cw conol-web cnl copilot-m365-web m365copilot copilot-web copilot deepseek-web ds-web doubao-web db gemini-business gembiz " +
    "gemini-web gweb grok-web gw hailuo-web huggingchat hyperagent ha inner-ai in-ai kimi-web lmarena lma microsoft-designer-web msdesigner " +
    "muse-spark-web ms-web notion-web nw perplexity-web pplx-web poe-web poe promptql pql qwen-web t3-web t3chat tencent-aistudio-web tasw " +
    "tinycms-web tcw v0-vercel-web venice-web ven yuanbao-web ybw zai-web zw zenmux-free zmf"
  ).split(/\s+/)
);
const blockedProvider = (id: string) => id.includes("/") && BLOCKED_PROVIDERS.has(id.split("/")[0].toLowerCase());

/** Claude berbayar per pemakaian: yang dipakai hanya Haiku (murah); Sonnet/Opus disembunyikan supaya tagihan tidak bengkak */
const PRICEY = (id: string) => /claude|anthropic/i.test(id) && !/haiku/i.test(id);

/**
 * Mesin "tugas berat" (Claude Sonnet): TIDAK muncul di daftar hero, hanya dipakai otomatis untuk tugas berat & penting.
 * AI_HEAVY_MODEL di Vercel bisa menunjuk model tertentu; AI_HEAVY=off mematikan.
 */
export function heavyModelFrom(ids: string[]): string | null {
  if ((process.env.AI_HEAVY ?? "").toLowerCase() === "off") return null;
  const pinned = (process.env.AI_HEAVY_MODEL ?? "").trim();
  if (pinned) return ids.length && !ids.includes(pinned) ? null : pinned;
  const ver = (id: string) => Number((id.match(/sonnet-(\d+)[-.](\d+)/i) ?? id.match(/sonnet-(\d+)/i))?.slice(1).join(".") ?? 0);
  const list = ids.filter((m) => /claude-sonnet|sonnet-\d/i.test(m) && !/thinking|no-think|devin|cursor|omniroute/i.test(m) && !blockedProvider(m));
  // utamakan Sonnet 5.5 dari koneksi Anthropic resmi (prefix "anth/")
  list.sort((a, b) => Number(/^anth\//.test(b)) - Number(/^anth\//.test(a)) || ver(b) - ver(a));
  return list[0] ?? null;
}
export const isHeavyModel = (id: string | null | undefined) => !!id && /sonnet/i.test(id);

/**
 * Provider yang dipakai website (default: Groq, Gemini, Claude "anth"). Mistral & provider lain dilewati supaya
 * tidak membuang waktu mencoba model yang tidak tersambung. Bisa diubah lewat env AI_PROVIDERS (pisahkan koma).
 */
const ALLOWED = (process.env.AI_PROVIDERS ?? process.env.NEXT_PUBLIC_AI_PROVIDERS ?? "groq,gemini,anth")
  .split(",")
  .map((x) => x.trim().toLowerCase())
  .filter(Boolean);
const allowedProvider = (id: string) => ALLOWED.includes("*") || (id.includes("/") && ALLOWED.includes(id.split("/")[0].toLowerCase()));
export const isChatModel = (id: string) => !!id && !HIDE.test(id) && !AGENT.test(id) && !blockedProvider(id) && !PRICEY(id) && !/mistral/i.test(id) && allowedProvider(id);
let visionSet: Set<string> | null = null;
/** daftar model yang menurut katalog OmniRoute bisa membaca gambar (lebih akurat dari tebakan nama) */
export function setVisionCatalog(ids: string[] | null) {
  visionSet = ids && ids.length ? new Set(ids) : null;
}
export const isVisionModel = (id: string) => (visionSet ? visionSet.has(id) || VISION.test(id) : VISION.test(id));

/** provider dari id model, mis. "groq/openai/gpt-oss-120b" -> "groq" */
export const providerOf = (id: string) => (id.includes("/") ? id.split("/")[0].toLowerCase() : "");

/** semua model yang cocok, diurutkan dari yang terbaik (dipakai untuk cadangan kalau satu error) */
function rank(models: string[], order: RegExp[], filter: (m: string) => boolean = () => true): string[] {
  const list = models.filter((m) => isChatModel(m) && filter(m));
  const out: string[] = [];
  for (const re of order) {
    for (const m of list.filter((x) => re.test(x)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))) if (!out.includes(m)) out.push(m);
  }
  for (const m of list) if (!out.includes(m)) out.push(m);
  return out;
}
export const rankTextModels = (models: string[]) => rank(models, BEST_TEXT);
export const rankVisionModels = (models: string[]) => rank(models, BEST_VISION, isVisionModel);
export const pickTextModel = (models: string[]) => rankTextModels(models)[0] ?? null;
export const pickVisionModel = (models: string[]) => rankVisionModels(models)[0] ?? null;

// ---------- nama hero Mobile Legends ----------
const HERO: [RegExp, string][] = [
  [/gpt-oss-120b/i, "Gord"],
  [/gpt-oss-20b/i, "Harith"],
  [/llama-3\.3-70b/i, "Tigreal"],
  [/llama-3\.1-8b|instant/i, "Saber"],
  [/llama-4/i, "Granger"],
  [/gemini[^/]*flash-lite/i, "Miya"],
  [/gemini[^/]*flash/i, "Lesley"],
  [/gemini[^/]*pro/i, "Pharsa"],
  [/gemma/i, "Nana"],
  [/kimi/i, "Kagura"],
  [/qwen/i, "Zilong"],
  [/minimax/i, "Lunox"],
  [/deepseek/i, "Alucard"],
  [/glm/i, "Valir"],
  [/mistral|mixtral/i, "Chou"],
  [/claude/i, "Yve"],
  [/gpt-|o\d-|openai/i, "Gusion"],
  [/compound/i, "Johnson"],
  [/grok/i, "Hayabusa"],
  [/nemotron|nvidia/i, "Atlas"],
  [/command|cohere/i, "Estes"],
  [/phi-?\d/i, "Harley"],
  [/pixtral/i, "Beatrix"],
  [/^auto$/i, "Fanny"],
];
const POOL = ["Balmond", "Bruno", "Clint", "Eudora", "Franco", "Hayabusa", "Karina", "Lolita", "Minotaur", "Rafaela", "Sun", "Alpha", "Hilda", "Aurora", "Freya", "Selena", "Martis", "Esmeralda", "Ling", "Khufra", "Estes", "Angela", "Kaja", "Yu Zhong"];

export const SMART_HERO = "Layla";

/**
 * Skor varian dalam satu keluarga model: versi lebih baru & ukuran lebih besar = lebih tinggi.
 * Varian khusus/lama (coder, distill, guard, base) ditaruh paling belakang.
 */
export function variantScore(id: string): number {
  const name = (id.split("/").pop() ?? id).toLowerCase();
  const sizes = [...name.matchAll(/(\d+(?:\.\d+)?)b\b/g)].map((m) => Number(m[1]));
  const size = sizes.length ? Math.max(...sizes) : 0;
  const ver = Number(name.replace(/\d+(?:\.\d+)?b\b/g, " ").match(/(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  let score = ver * 100 + Math.min(size, 1000) / 10;
  if (/coder|distill|guard|\bbase\b|instruct-v0|-v0\./.test(name)) score -= 1000;
  if (/(^|-)(lite|mini|nano|tiny|small)(-|$)/.test(name)) score -= 30;
  return score;
}
/** varian lain dari hero yang sama, urut dari yang terbaik */
export const sameHeroVariants = (models: string[], hero: string) =>
  models.filter((m) => heroName(m) === hero).sort((a, b) => variantScore(b) - variantScore(a));

/** nama hero untuk satu model (tanpa jaminan unik) */
export function heroName(id: string | null | undefined): string {
  if (!id) return SMART_HERO;
  if (id === SMART) return SMART_HERO;
  for (const [re, name] of HERO) if (re.test(id)) return name;
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return POOL[h % POOL.length];
}

/** nama hero untuk seluruh daftar — kalau ada yang sama, diberi nomor (Lesley, Lesley 2, …) */
export function heroNames(models: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Map<string, number>();
  for (const id of [...models].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))) {
    const base = heroName(id);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    out.set(id, n === 1 ? base : `${base} ${n}`);
  }
  return out;
}

// ---------- spesialisasi tiap hero (dari karakteristik model aslinya) ----------
const DESC: [RegExp, string][] = [
  [/gpt-oss-120b/i, "Jago mikir logis: matematika, rumus Excel, coding"],
  [/gpt-oss-20b/i, "Versi ringan Gord — logika & coding, lebih cepat"],
  [/llama-3\.3-70b/i, "Serba bisa & stabil: ngobrol, nulis, ringkas teks"],
  [/llama-3\.1-8b|instant/i, "Paling ngebut — cocok buat pertanyaan singkat"],
  [/llama-4/i, "Cepat & bisa lihat gambar"],
  [/gemini[^/]*flash-lite/i, "Lihat gambar versi hemat & cepat"],
  [/gemini[^/]*flash/i, "Jago lihat gambar, screenshot & chart trading; Bahasa Indonesia bagus"],
  [/gemini[^/]*pro/i, "Analisa mendalam & dokumen panjang, bisa lihat gambar"],
  [/gemma/i, "Model open Google, ringan, bisa lihat gambar"],
  [/kimi/i, "Konteks super panjang — nulis panjang & coding"],
  [/qwen/i, "Coding & penalaran, kuat di bahasa Asia"],
  [/minimax/i, "Konteks panjang, kuat buat tugas bertahap"],
  [/deepseek[^/]*r1/i, "Mikir step-by-step — soal sulit, lebih lambat"],
  [/deepseek/i, "Penalaran & coding, jawaban rapi"],
  [/glm/i, "Coding & penalaran"],
  [/pixtral/i, "Mistral yang bisa lihat gambar"],
  [/mistral|mixtral/i, "Nulis cepat & ringkas"],
  [/haiku/i, "Cepat & stabil: nulis, analisa, trade plan, lihat gambar (berbayar, murah)"],
  [/claude/i, "Paling pintar: nulis, analisa, lihat gambar (berbayar)"],
  [/compound/i, "Bisa cari info di internet & hitung-hitungan"],
  [/grok/i, "Gaya santai, penalaran"],
  [/nemotron|nvidia/i, "Konteks panjang, penalaran"],
  [/command|cohere/i, "Ringkas dokumen & tanya-jawab"],
  [/phi-?\d/i, "Kecil & cepat"],
  [/gpt-|o\d-|openai/i, "Serba bisa ala ChatGPT"],
  [/^auto$/i, "Server AI yang milih sendiri — hasil bisa beda-beda"],
];

/** keterangan singkat: hero ini jago apa */
export function heroDesc(id: string | null | undefined): string {
  if (!id || id === SMART) return "Tuan rumah — Layla yang milihin hero paling pas buat bantu kamu (otomatis pindah ke yang bisa lihat gambar kalau ada gambar)";
  for (const [re, d] of DESC) if (re.test(id)) return d;
  return isVisionModel(id) ? "Bisa lihat gambar" : "Model teks umum";
}

// ---------- role hero (sesuai role di Mobile Legends) ----------
const ROLE: Record<string, string> = {
  Layla: "Marksman", Lesley: "Marksman", Miya: "Marksman", Granger: "Marksman", Beatrix: "Marksman", Bruno: "Marksman", Clint: "Marksman",
  Gord: "Mage", Harith: "Mage", Pharsa: "Mage", Nana: "Mage", Kagura: "Mage", Lunox: "Mage", Valir: "Mage", Yve: "Mage", Eudora: "Mage", Aurora: "Mage", Esmeralda: "Mage",
  Tigreal: "Tank", Johnson: "Tank", Atlas: "Tank", Franco: "Tank", Lolita: "Tank", Minotaur: "Tank", Khufra: "Tank",
  Saber: "Assassin", Gusion: "Assassin", Hayabusa: "Assassin", Harley: "Assassin", Fanny: "Assassin", Karina: "Assassin", Selena: "Assassin", Ling: "Assassin",
  Zilong: "Fighter", Alucard: "Fighter", Chou: "Fighter", Balmond: "Fighter", Sun: "Fighter", Alpha: "Fighter", Hilda: "Fighter", Freya: "Fighter", Martis: "Fighter", Kaja: "Fighter", "Yu Zhong": "Fighter",
  Estes: "Support", Rafaela: "Support", Angela: "Support",
};
/** nama dari data user / karakter buatan ("constructor", "toString", …) bukan kunci bawaan objek */
export const heroRole = (hero: string) => {
  const k = hero.replace(/ \d+$/, "");
  return Object.prototype.hasOwnProperty.call(ROLE, k) ? ROLE[k] : "";
};

/** warna avatar tiap hero (huruf depan) */
export function heroColor(hero: string) {
  const c = ["#f97316", "#8b5cf6", "#0ea5e9", "#22c55e", "#ef4444", "#ec4899", "#eab308", "#6366f1", "#14b8a6", "#f43f5e"];
  let h = 0;
  for (const ch of hero) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return hero === SMART_HERO ? "#ea580c" : c[h % c.length];
}
