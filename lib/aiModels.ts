// Daftar model AI: sembunyikan yang tidak cocok untuk chat, pilih yang terbaik, dan beri nama hero ML
export const SMART = "smart"; // pilihan "otomatis": aplikasi memilih model terbaik yang tersedia

/** model yang bukan untuk chat (suara, filter, embedding, khusus bahasa Arab, dll.) */
const HIDE = /whisper|orpheus|tts|speech|audio|transcri|prompt-guard|safeguard|llama-guard|allam|embed|rerank|moderation|dall-?e|imagen|veo|flux|sdxl|stable-diffusion|image-gen|text-to-image|playai|distil/i;

/** model yang bisa membaca gambar */
const VISION = /gemini|gemma-?[34]|vision|[-_/]vl\b|-vl-|llava|pixtral|llama-4|maverick|scout|gpt-4o|gpt-4\.1|gpt-5|claude|kimi-k2\.5|kimi-k3|glm-4\.?\dv|qwen.*vl|muse/i;

/** urutan model terbaik untuk chat biasa (yang pertama tersedia dipakai) */
const BEST_TEXT = [/claude[^/]*(opus|sonnet)/i, /claude/i, /gemini[^/]*flash(?!-lite)/i, /kimi/i, /deepseek(?!.*r1)/i, /gpt-oss-120b/i, /qwen3/i, /llama-3\.3-70b/i, /grok/i, /gemini/i, /mistral-(large|medium)/i, /gpt-oss-20b/i, /llama/i];
/** urutan model terbaik untuk membaca gambar */
const BEST_VISION = [/claude[^/]*(opus|sonnet)/i, /gemini[^/]*flash(?!-lite)/i, /gemini/i, /claude/i, /gemma-?[34]/i, /llama-4/i];

export const isChatModel = (id: string) => !!id && !HIDE.test(id);
export const isVisionModel = (id: string) => VISION.test(id);

function pick(models: string[], order: RegExp[], filter: (m: string) => boolean = () => true) {
  const list = models.filter((m) => isChatModel(m) && filter(m));
  for (const re of order) {
    const hit = list.filter((m) => re.test(m)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
    if (hit) return hit;
  }
  return null;
}
export const pickTextModel = (models: string[]) => pick(models, BEST_TEXT);
export const pickVisionModel = (models: string[]) => pick(models, BEST_VISION, isVisionModel) ?? models.find((m) => isChatModel(m) && isVisionModel(m)) ?? null;

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
