/**
 * Prompt karakter untuk AI. Karakter hasil "Train your AI" (profile.version 2) memakai kepribadian dari kuis +
 * peran, prinsip riset & SOP dari training; karakter versi lama tetap memakai customPrompt().
 * Dipisah dari customChar.ts supaya data training (besar) tidak ikut termuat di halaman chat.
 */
import { groupVoices, typeInfo } from "./aiPersona";
import { customPrompt, type CustomChar } from "./customChar";
import { trainPromptLines } from "./trainAi";

export const charPrompt = (c: CustomChar) => (c.profile.version === 2 ? trainedPrompt(c) : customPrompt(c));

/** prompt karakter hasil "Train your AI": kepribadian dari kuis + peran & SOP dari training */
export function trainedPrompt(c: CustomChar): string {
  const p = c.profile;
  const t = typeInfo(c.mbti);
  const v = groupVoices(c.mbti);
  const rules = p.rules?.filter(Boolean) ?? [];
  const editor = p.roleId === "video_editor";
  return [
    `KARAKTER KAMU: kamu adalah "${c.name}" — AI yang dilatih sendiri oleh user, kepribadian ${c.mbti} (${p.label || t.label}; ${t.traits.join(", ")}).`,
    `GAYA KEPRIBADIAN: ${t.style}`,
    p.style ? `GAYA BICARA KE USER (pilihan pelatihmu — kalau bertentangan dengan gaya kepribadian di atas, misalnya soal sapaan atau emoji, ikuti yang ini): ${p.style}.` : "",
    ...trainPromptLines(p.roleId, p.roleName, p.sop, p.role),
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

