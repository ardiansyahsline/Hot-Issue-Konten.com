/**
 * Karakter AI buatan user: 12 pertanyaan pembentuk karakter, penurunan tipe MBTI,
 * dan prompt kepribadian yang dikirim ke AI (mesin utama: Claude Haiku).
 */
import { groupVoices, registerCustom, typeInfo, type Prop } from "./aiPersona";
import { roleOf, trainPromptLines, type Training } from "./trainAi";

export type CharAvatar = { kind: "chibi"; hair: number; skin: string; hc: string; prop: Prop } | { kind: "image"; data: string };
export type CharProfile = {
  answers: Record<string, string | string[]>;
  label?: string;
  role?: string;
  style?: string;
  catchphrase?: string;
  rules?: string[];
  /** 2 = hasil "Train your AI" (kuis kepribadian + peran + training); kosong = karakter versi lama (12 pertanyaan) */
  version?: 2;
  quiz?: Record<string, number>;
  roleId?: string;
  roleName?: string;
  training?: Training;
  call?: string;
  emoji?: string;
  /** SOP / cara berpikir hasil training (bisa diedit user) */
  sop?: string;
};
export type CustomChar = { id: string; name: string; mbti: string; avatar: CharAvatar; profile: CharProfile; created_at?: string };
export type MemoryKind = "knowledge" | "example" | "correction";
export type MemoryItem = { id: number; character_id: string; kind: MemoryKind; title: string | null; content: string; created_at: string };

export const CHAR_PREFIX = "char:";
export const isCharModel = (m: string | null | undefined) => !!m && m.startsWith(CHAR_PREFIX);

type Q = { id: string; q: (name: string) => string; options: { v: string; label: string; mbti?: string }[]; other?: boolean; multi?: boolean; free?: boolean; hint?: string };

/** 12 pertanyaan (urut). Pertanyaan 5–8 menentukan huruf MBTI. */
export const QUESTIONS: Q[] = [
  {
    id: "role",
    q: (n) => `Peran utama ${n}?`,
    options: [
      { v: "Asisten CS clipper — jawab & rapikan balasan ke clipper", label: "Asisten CS clipper" },
      { v: "Analis saham / crypto / forex", label: "Analis saham / crypto / forex" },
      { v: "Penulis konten & caption", label: "Penulis konten & caption" },
      { v: "Editor video — rencana edit, hook, teks overlay, subtitle", label: "Editor video (rencana edit & subtitle)" },
      { v: "Teman ngobrol & motivator", label: "Teman ngobrol & motivator" },
    ],
    other: true,
  },
  {
    id: "call",
    q: (n) => `Cara ${n} memanggil user?`,
    options: [
      { v: "bro / sis (santai)", label: "bro / sis (santai)" },
      { v: "kak (sopan & akrab)", label: "kak (sopan & akrab)" },
      { v: "langsung nama user", label: "langsung nama" },
      { v: "Bapak / Ibu (formal)", label: "Bapak / Ibu (formal)" },
    ],
    other: true,
  },
  {
    id: "energy",
    q: () => "Energi saat ngobrol?",
    options: [
      { v: "kalem & tenang", label: "Kalem & tenang" },
      { v: "ceria & heboh", label: "Ceria & heboh" },
      { v: "tegas & to the point", label: "Tegas & to the point" },
      { v: "hangat & sabar", label: "Hangat & sabar" },
    ],
    other: true,
  },
  {
    id: "panic",
    q: (n) => `Kalau user lagi panik / marah, ${n} akan…`,
    options: [
      { v: "menenangkan dulu, baru kasih solusi", label: "Tenangkan dulu, baru kasih solusi" },
      { v: "langsung kasih langkah praktis", label: "Langsung kasih langkah praktis" },
      { v: "pakai humor biar suasana cair", label: "Pakai humor biar suasana cair" },
      { v: "validasi perasaannya, lalu kasih checklist", label: "Validasi perasaannya, lalu checklist" },
    ],
    other: true,
  },
  {
    id: "tf",
    q: (n) => `Kalau harus memutuskan sesuatu, ${n} lebih…`,
    options: [
      { v: "data & logika", label: "Pakai data & logika", mbti: "T" },
      { v: "perasaan & nilai orang", label: "Pakai perasaan & nilai orang", mbti: "F" },
    ],
  },
  {
    id: "ns",
    q: () => "Fokus penjelasannya?",
    options: [
      { v: "gambaran besar, ide & kemungkinan", label: "Gambaran besar, ide & kemungkinan", mbti: "N" },
      { v: "fakta konkret & langkah praktis", label: "Fakta konkret & langkah praktis", mbti: "S" },
    ],
  },
  {
    id: "jp",
    q: () => "Gaya kerjanya?",
    options: [
      { v: "rapi, terencana, suka checklist", label: "Rapi, terencana, suka checklist", mbti: "J" },
      { v: "fleksibel, spontan, cepat adaptasi", label: "Fleksibel, spontan, cepat adaptasi", mbti: "P" },
    ],
  },
  {
    id: "ei",
    q: (n) => `Saat ngobrol, ${n}…`,
    options: [
      { v: "aktif, suka nanya balik & banyak interaksi", label: "Aktif, suka nanya balik & banyak interaksi", mbti: "E" },
      { v: "ringkas, bicara seperlunya", label: "Ringkas, bicara seperlunya", mbti: "I" },
    ],
  },
  {
    id: "length",
    q: () => "Panjang jawaban default?",
    options: [
      { v: "super singkat (1–3 kalimat)", label: "Super singkat (1–3 kalimat)" },
      { v: "ringkas + tabel poin penting", label: "Ringkas + tabel poin penting" },
      { v: "detail & lengkap", label: "Detail & lengkap" },
    ],
  },
  {
    id: "emoji",
    q: () => "Emoji & gaya bahasa?",
    options: [
      { v: "banyak emoji, bahasa gaul yang sopan", label: "Banyak emoji, bahasa gaul sopan" },
      { v: "sedikit emoji, bahasa santai", label: "Sedikit emoji, santai" },
      { v: "tanpa emoji, bahasa baku", label: "Tanpa emoji, bahasa baku" },
    ],
  },
  {
    id: "catchphrase",
    q: (n) => `Kata andalan / ciri khas ${n}?`,
    options: [
      { v: "Siap laksanakan!", label: "“Siap laksanakan!”" },
      { v: "Gas pol!", label: "“Gas pol!”" },
      { v: "Tenang, kita beresin bareng 🤍", label: "“Tenang, kita beresin bareng 🤍”" },
      { v: "Data dulu, baru keputusan.", label: "“Data dulu, baru keputusan.”" },
    ],
    other: true,
    hint: "Boleh tulis sendiri di kolom Lainnya.",
  },
  {
    id: "rules",
    q: (n) => `Hal yang TIDAK boleh dilakukan ${n}? (boleh pilih lebih dari satu)`,
    options: [
      { v: "menjanjikan untung / payout / hasil pasti", label: "Menjanjikan untung / payout" },
      { v: "keluar dari topik pekerjaan", label: "Keluar dari topik kerjaan" },
      { v: "memakai kata kasar", label: "Memakai kata kasar" },
      { v: "menyebut angka penting tanpa sumber", label: "Angka penting tanpa sumber" },
    ],
    other: true,
    multi: true,
  },
];

/** tipe MBTI dari jawaban pertanyaan 5–8 (default INFJ kalau kosong) */
export function deriveMbti(answers: Record<string, string | string[]>): string {
  const pick = (id: string, a: string, b: string) => {
    const q = QUESTIONS.find((x) => x.id === id)!;
    const o = q.options.find((x) => x.v === answers[id]);
    return o?.mbti ?? a ?? b;
  };
  return `${pick("ei", "I", "E")}${pick("ns", "N", "S")}${pick("tf", "F", "T")}${pick("jp", "J", "P")}`;
}

const val = (a: CharProfile["answers"], id: string) => {
  const v = a[id];
  return Array.isArray(v) ? v.filter(Boolean).join("; ") : (v ?? "");
};

/** ringkasan otomatis dari jawaban (bisa diedit user sebelum disimpan) */
export function summarize(name: string, answers: CharProfile["answers"], mbti: string): Required<Pick<CharProfile, "label" | "role" | "style" | "catchphrase" | "rules">> {
  const t = typeInfo(mbti);
  const rules = (Array.isArray(answers.rules) ? answers.rules : answers.rules ? [answers.rules] : []).filter(Boolean);
  return {
    label: t.label,
    role: val(answers, "role") || "Asisten serba bisa",
    style: [
      val(answers, "call") && `Panggil user: ${val(answers, "call")}`,
      val(answers, "energy") && `energi ${val(answers, "energy")}`,
      val(answers, "panic") && `saat user panik: ${val(answers, "panic")}`,
      val(answers, "length") && `jawaban ${val(answers, "length")}`,
      val(answers, "emoji"),
    ]
      .filter(Boolean)
      .join(", "),
    catchphrase: val(answers, "catchphrase"),
    rules,
  };
}

/** daftarkan karakter ke registry tampilan (avatar, tipe, kalimat) */
export function registerChar(c: CustomChar) {
  const t = typeInfo(c.mbti);
  registerCustom(c.name, {
    type: c.mbti,
    hair: c.avatar.kind === "chibi" ? c.avatar.hair : 1,
    skin: c.avatar.kind === "chibi" ? c.avatar.skin : "#f5c9a8",
    hc: c.avatar.kind === "chibi" ? c.avatar.hc : "#3b2a1e",
    prop: c.avatar.kind === "chibi" ? c.avatar.prop : "orb",
    img: c.avatar.kind === "image" ? c.avatar.data : undefined,
    label: c.profile.label || t.label,
    say: c.profile.catchphrase || t.say,
    style: c.profile.style || t.style,
    role: c.profile.version === 2 && roleOf(c.profile.roleId, c.profile.roleName) ? `Dilatih: ${roleOf(c.profile.roleId, c.profile.roleName)!.name}` : "Buatanmu",
    sifat: charSifat(c),
  });
}

/** sifat karakter buatan user dari jawaban wizard-nya (energi, gaya kerja, cara memutuskan) */
function charSifat(c: CustomChar): string[] | undefined {
  // hasil Train your AI: sifat tipe kepribadian + peran yang dilatihkan
  if (c.profile.version === 2) {
    const r = roleOf(c.profile.roleId, c.profile.roleName);
    return [...typeInfo(c.mbti).sifat.slice(0, 2), ...(r ? [`peran ${r.name}`] : [])];
  }
  const a = c.profile.answers ?? {};
  const parts = (id: string) => val(a, id).split(/,|&|;/).map((x) => x.trim().toLowerCase()).filter((x) => x && x.length <= 24);
  const tf = val(a, "tf") ? (/data|logika/i.test(val(a, "tf")) ? "berbasis data" : "peka perasaan") : "";
  const out = [...new Set([...parts("energy").slice(0, 2), ...parts("jp").slice(0, 2), tf].filter(Boolean))].slice(0, 5);
  return out.length >= 2 ? out : undefined;
}

/** prompt kepribadian karakter buatan user */
export function customPrompt(c: CustomChar): string {
  if (c.profile.version === 2) return trainedPrompt(c);
  const a = c.profile.answers ?? {};
  const t = typeInfo(c.mbti);
  const v = groupVoices(c.mbti);
  const rules = c.profile.rules?.length ? c.profile.rules : [];
  const editor = /editor video/i.test(c.profile.role ?? val(a, "role"));
  return [
    `KARAKTER KAMU: kamu adalah "${c.name}" — karakter AI buatan user, kepribadian ${c.mbti} (${c.profile.label || t.label}; ${t.traits.join(", ")}).`,
    `PERAN: ${c.profile.role || val(a, "role") || "asisten serba bisa"}.`,
    `GAYA BICARA: ${c.profile.style || t.style}`,
    val(a, "tf") || val(a, "ns") || val(a, "jp") || val(a, "ei")
      ? `CARA BERPIKIR: memutuskan dengan ${val(a, "tf") || "-"}; fokus ${val(a, "ns") || "-"}; kerja ${val(a, "jp") || "-"}; saat ngobrol ${val(a, "ei") || "-"}.`
      : "",
    c.profile.catchphrase ? `KATA ANDALAN: "${c.profile.catchphrase}" — pakai sesekali (terutama di pembuka/penutup), jangan di setiap kalimat.` : "",
    rules.length ? `LARANGAN (wajib dipatuhi): ${rules.join("; ")}.` : "",
    `JAWABAN RINGKAS & TABEL: tetap terdengar seperti ${c.name} — ${v.table}`,
    `SAAT ANALISA SAHAM/FOREX/CRYPTO: ${v.analyst}`,
    editor
      ? "KEAHLIAN EDITOR VIDEO: bantu rencana edit — tabel Waktu | Potongan/visual | Teks overlay | Audio, hook 3 detik pertama, saran musik/transisi, caption + hashtag. Kalau user memberi naskah/transkrip, buat subtitle di blok ```srt (format SRT valid) supaya bisa diunduh & diimpor ke CapCut."
      : "",
    "Pertahankan karakter ini di setiap jawaban sampai user minta ganti. Kalau user menyapa / tanya siapa kamu, perkenalkan diri singkat sesuai karakter.",
    "PENTING: karakter hanya mengatur CARA bicara. Aturan utama tetap berlaku: Bahasa Indonesia, jujur, tidak mengarang, sebut sumber, pengingat untuk topik investasi. OTAK KARAKTER (pengetahuan, contoh, koreksi dari user) di bawah adalah rujukan utamamu.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** prompt karakter hasil "Train your AI": kepribadian dari kuis + peran & SOP dari training */
function trainedPrompt(c: CustomChar): string {
  const p = c.profile;
  const t = typeInfo(c.mbti);
  const v = groupVoices(c.mbti);
  const rules = p.rules?.filter(Boolean) ?? [];
  const editor = p.roleId === "video_editor";
  return [
    `KARAKTER KAMU: kamu adalah "${c.name}" — AI yang dilatih sendiri oleh user, kepribadian ${c.mbti} (${p.label || t.label}; ${t.traits.join(", ")}).`,
    `GAYA KEPRIBADIAN: ${t.style}`,
    p.style ? `GAYA BICARA KE USER: ${p.style}.` : "",
    ...trainPromptLines(p.roleId, p.roleName, p.sop),
    p.catchphrase ? `KATA ANDALAN: "${p.catchphrase}" — pakai sesekali (terutama di pembuka/penutup), jangan di setiap kalimat.` : "",
    rules.length ? `LARANGAN (wajib dipatuhi): ${rules.join("; ")}.` : "",
    `JAWABAN RINGKAS & TABEL: tetap terdengar seperti ${c.name} — ${v.table}`,
    `SAAT ANALISA SAHAM/FOREX/CRYPTO: ${v.analyst}`,
    editor ? "Kalau user memberi naskah/transkrip video, buat subtitle di blok ```srt (format SRT valid) supaya bisa diunduh & diimpor ke CapCut." : "",
    "Pertahankan karakter & cara berpikir ini di setiap jawaban sampai user minta ganti. Kalau user menyapa / tanya siapa kamu, perkenalkan diri singkat sesuai karakter & perannya.",
    "PENTING: karakter mengatur CARA berpikir & bicara. Aturan utama tetap berlaku: Bahasa Indonesia, jujur, tidak mengarang, sebut sumber, pengingat untuk topik investasi. OTAK KARAKTER (pengetahuan, contoh, koreksi dari user) di bawah adalah rujukan utamamu.",
  ]
    .filter(Boolean)
    .join("\n");
}

const STOP = new Set("yang dan atau untuk dari dengan pada ini itu ada tidak bisa saya kamu kak bro apa gimana bagaimana kenapa mau juga sudah udah aja kalau kalo jadi lagi buat sama dong deh nya the and for with".split(" "));
const words = (t: string) => [...new Set((t.toLowerCase().match(/[a-z0-9\u00c0-\u024f]{3,}/g) ?? []).filter((w) => !STOP.has(w)))];
const score = (text: string, qw: string[]) => {
  if (!qw.length) return 0;
  const t = text.toLowerCase();
  let s = 0;
  for (const w of qw) if (t.includes(w)) s += w.length > 5 ? 2 : 1;
  return s;
};
/** pecah catatan panjang jadi potongan ±1.500 huruf (per paragraf) supaya yang dikirim hanya bagian yang relevan */
function chunks(text: string, size = 1500): string[] {
  const paras = text.split(/\n{2,}/);
  const out: string[] = [];
  let cur = "";
  for (const p of paras) {
    if ((cur + "\n\n" + p).length > size && cur) {
      out.push(cur);
      cur = "";
    }
    if (p.length > size) {
      for (let i = 0; i < p.length; i += size) out.push(p.slice(i, i + size));
    } else cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * "otak" karakter: koreksi (selalu) + contoh jawab & potongan pengetahuan yang paling nyambung dengan pertanyaan.
 * Dibatasi panjangnya supaya hemat token Haiku (default ±20.000 huruf ≈ 5.000 token).
 */
export function brainText(c: CustomChar, items: MemoryItem[], maxChars = 20000, question = ""): string {
  if (!items.length) return "";
  const qw = words(question);
  const of = (k: MemoryKind) => items.filter((i) => i.kind === k);
  const ranked = (list: MemoryItem[]) =>
    list
      .map((i, n) => ({ i, n, s: score(`${i.title ?? ""} ${i.content}`, qw) }))
      .sort((a, b) => b.s - a.s || a.n - b.n)
      .map((x) => x.i);
  const block = (title: string, list: MemoryItem[], each: number, cap: number) => {
    if (!list.length) return "";
    const lines: string[] = [title];
    let used = title.length;
    for (const [n, i] of list.entries()) {
      const t = `${n + 1}. ${i.title ? `[${i.title}] ` : ""}${i.content.slice(0, each)}`;
      if (used + t.length > cap) break;
      lines.push(t);
      used += t.length;
    }
    return lines.length > 1 ? lines.join("\n") : "";
  };
  const cap = (f: number) => Math.max(800, Math.round(maxChars * f));
  const corrections = block("KOREKSI DARI USER (WAJIB diikuti — lebih penting dari pengetahuan umummu):", ranked(of("correction")), 1200, cap(0.3));
  const examples = block("CONTOH JAWABAN YANG DISUKAI USER (tiru gaya & isinya untuk pertanyaan serupa):", ranked(of("example")).slice(0, 8), 1800, cap(0.3));
  let budget = Math.max(1500, maxChars - corrections.length - examples.length);
  const pieces = of("knowledge")
    .flatMap((i, n) => chunks(i.content).map((t, k) => ({ title: i.title, t, n, k, s: score(`${i.title ?? ""} ${t}`, qw) })))
    .sort((a, b) => b.s - a.s || a.n - b.n || a.k - b.k);
  const know: string[] = [];
  for (const p of pieces) {
    if (budget <= 200) break;
    const t = `- ${p.title ? `${p.title}: ` : ""}${p.t.slice(0, budget)}`;
    know.push(t);
    budget -= t.length;
  }
  return [
    `OTAK KARAKTER ${c.name} (diisi sendiri oleh user — pakai sebagai rujukan utama; kalau tidak ada di sini, jawab dari pengetahuan umum & bilang begitu):`,
    corrections,
    examples,
    know.length ? ["PENGETAHUAN (bagian yang paling relevan):", ...know].join("\n") : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
