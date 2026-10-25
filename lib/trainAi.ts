/**
 * "Train your AI": kuis kepribadian (4 dimensi MBTI) → hasil tipe → pilih peran → pertanyaan training per peran.
 * Jawaban training diubah jadi SOP / cara berpikir yang dikirim ke AI (lihat customPrompt di customChar.ts).
 * Isi kuis, profil 16 tipe & paket training per peran ada di trainAiData.ts (hasil riset, bisa diedit tanpa ubah logika).
 */
import { GENERIC_ROLE, QUIZ, ROLES, TYPE_PROFILES } from "./trainAiData";

export type Letter = "E" | "I" | "S" | "N" | "T" | "F" | "J" | "P";
export type DimKey = "EI" | "SN" | "TF" | "JP";
export type QuizOption = { label: string; letter: Letter; w: number };
export type QuizQ = { id: string; q: string; options: QuizOption[] };
export type QuizDim = { dim: DimKey; title: string; measures: string; letters: { letter: Letter; name: string; desc: string }[]; questions: QuizQ[] };
export type TypeProfile = { type: string; headline: string; desc: string; strengths: string[]; watchouts: string[]; aiStyle: string; fitRoles: string[] };
export type RoleOpt = { label: string; instr: string };
export type RoleQ = { id: string; topic: string; q: string; multi: boolean; hint?: string; options: RoleOpt[] };
export type TrainRole = { id: string; name: string; icon: string; desc: string; mission: string; principles: string[]; kpis: string[]; frameworks: string[]; questions: RoleQ[]; sources: { title: string; url: string }[] };

/** jawaban training: pilihan (label) per pertanyaan + isian "Lainnya" */
export type Training = { picks: Record<string, string[]>; other: Record<string, string> };

export { QUIZ, ROLES, TYPE_PROFILES, GENERIC_ROLE };
export const DIMS: DimKey[] = ["EI", "SN", "TF", "JP"];
export const QUIZ_QS = QUIZ.flatMap((d) => d.questions.map((q) => ({ ...q, dim: d.dim, dimTitle: d.title })));
export const CUSTOM_ROLE = "custom";

export const roleOf = (id: string | undefined, customName = ""): TrainRole | null => {
  if (!id) return null;
  if (id === CUSTOM_ROLE) return { ...GENERIC_ROLE, name: customName.trim() || GENERIC_ROLE.name };
  return ROLES.find((r) => r.id === id) ?? null;
};
export const typeProfile = (t: string): TypeProfile | undefined => TYPE_PROFILES.find((p) => p.type === t);

export type DimScore = { dim: DimKey; a: Letter; b: Letter; pa: number; win: Letter; answered: number };

/** hitung tipe dari jawaban kuis (indeks pilihan per pertanyaan). Seri → ikut jawaban pertama di dimensi itu. */
export function scoreQuiz(ans: Record<string, number>): { type: string; dims: DimScore[]; complete: boolean } {
  const dims = QUIZ.map((d): DimScore => {
    const [a, b] = [d.letters[0].letter, d.letters[1].letter];
    let sa = 0,
      sb = 0,
      first: Letter | null = null,
      answered = 0;
    for (const q of d.questions) {
      const o = q.options[ans[q.id]];
      if (!o) continue;
      answered++;
      first ??= o.letter;
      if (o.letter === a) sa += o.w || 1;
      else sb += o.w || 1;
    }
    const total = sa + sb;
    const win: Letter = sa === sb ? (first ?? a) : sa > sb ? a : b;
    return { dim: d.dim, a, b, pa: total ? Math.round((sa / total) * 100) : 50, win, answered };
  });
  return { type: dims.map((d) => d.win).join(""), dims, complete: QUIZ_QS.every((q) => ans[q.id] !== undefined) };
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const TOPIC_TITLE: Record<string, string> = {
  tujuan: "TUJUAN & UKURAN SUKSES",
  keputusan: "CARA MENGAMBIL KEPUTUSAN",
  prioritas: "SAAT HARUS MEMILIH PRIORITAS",
  mindset: "MINDSET & NILAI KERJA",
  concern: "WAJIB SELALU DIWASPADAI",
  komunikasi: "GAYA KOMUNIKASI & FORMAT JAWABAN",
  kualitas: "CEK KUALITAS SEBELUM MENYERAHKAN",
  larangan: "LARANGAN",
  situasi: "SITUASI SULIT",
  alat: "DATA & ALAT YANG DIPAKAI",
};

/** SOP dari jawaban training (instruksi tiap pilihan, dikelompokkan per topik) — bisa diedit user sebelum disimpan */
export function compileSop(role: TrainRole, t: Training): string {
  const groups = new Map<string, string[]>();
  for (const q of role.questions) {
    const picked = t.picks[q.id] ?? [];
    const lines = q.options.filter((o) => picked.includes(o.label)).map((o) => clean(o.instr));
    const other = clean(t.other[q.id] ?? "");
    if (other) lines.push(`(dari pelatihmu) ${other}`);
    if (!lines.length) continue;
    const key = TOPIC_TITLE[q.topic] ?? q.topic.toUpperCase();
    groups.set(key, [...(groups.get(key) ?? []), ...lines]);
  }
  return [...groups.entries()].map(([k, lines]) => `${k}:\n${lines.map((l) => `- ${l}`).join("\n")}`).join("\n\n");
}

/** potongan prompt peran & SOP untuk karakter hasil Train your AI */
export function trainPromptLines(roleId: string | undefined, customName: string | undefined, sop: string | undefined): string[] {
  const role = roleOf(roleId, customName ?? "");
  if (!role) return [];
  return [
    `PERAN YANG DILATIHKAN: ${role.name} — ${role.mission}`,
    role.principles.length ? `PRINSIP KERJA PERAN INI (dari riset praktik terbaik):\n${role.principles.map((p) => `- ${clean(p)}`).join("\n")}` : "",
    role.frameworks.length ? `FRAMEWORK YANG KAMU KUASAI (pakai kalau relevan): ${role.frameworks.map(clean).join("; ")}.` : "",
    role.kpis.length ? `UKURAN SUKSES: ${role.kpis.map(clean).join("; ")}.` : "",
    sop?.trim() ? `CARA BERPIKIR & SOP DARI PELATIHMU (WAJIB diikuti — lebih penting dari kebiasaan umum; kalau bertentangan dengan gaya kepribadian, ikuti SOP ini):\n${sop.trim()}` : "",
  ].filter(Boolean);
}
