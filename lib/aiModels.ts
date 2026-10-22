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

/** agen coding / akun IDE / login web — bukan untuk chat biasa (sering error kalau dipanggil dari aplikasi lain) */
const AGENT = /(^|[/:])(devin|jules|codex|cursor|kiro|windsurf|cline|trae|zed|copilot|github-copilot|antigravity|claude-code|gemini-cli|qwen-code|grok-build|amp|augment|warp|aider|opencode|iflow|roo|kilo|continue|droid|factory|yuanbao|agnes)[\w.-]*[/:]|agentic|cloud-?agent|[\w-]+-(cli|web|cookie|oauth|ide)[/:]/i;

export const isChatModel = (id: string) => !!id && !HIDE.test(id) && !AGENT.test(id);
export const isVisionModel = (id: string) => VISION.test(id);

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
  [/claude/i, "Paling pintar: nulis, analisa, lihat gambar (berbayar)"],
  [/compound/i, "Bisa cari info di internet & hitung-hitungan"],
  [/grok/i, "Gaya santai, penalaran"],
  [/nemotron|nvidia/i, "Konteks panjang, penalaran"],
  [/command|cohere/i, "Ringkas dokumen & tanya-jawab"],
  [/phi-?\d/i, "Kecil & cepat"],
  [/gpt-|o\d-|openai/i, "Serba bisa ala ChatGPT"],
  [/^auto$/i, "OmniRoute yang milih sendiri — hasil bisa beda-beda"],
];

/** keterangan singkat: hero ini jago apa */
export function heroDesc(id: string | null | undefined): string {
  if (!id || id === SMART) return "Paling umum — otomatis pilih yang terbaik; pindah ke yang bisa lihat gambar kalau ada gambar";
  for (const [re, d] of DESC) if (re.test(id)) return d;
  return isVisionModel(id) ? "Bisa lihat gambar" : "Model teks umum";
}
