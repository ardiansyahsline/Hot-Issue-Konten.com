/**
 * Penilaian satu giliran chat sutradara Studio (dipakai route /api/studio/chat & uji unit — aman di server & browser):
 * contoh bawaan vs proyek nyata, revisi kecil, mesin berat, subjek baru, catatan giliran, dan rencana riset web.
 */
import { isSmallEdit, needsHeavy } from "./director";
import { isStarterTimeline, timelineAbout } from "./directorStarter";
import { planResearch, wantsNewSubject, type ResearchPlan } from "./research";
import type { Timeline } from "./timeline";

export type TurnInput = {
  /** pesan user giliran ini */
  content: string;
  /** timeline sekarang (sudah dinormalisasi) */
  current: Timeline | null;
  /** jawaban sutradara terakhir di riwayat (kartu ```ask → pesan ini kemungkinan jawabannya) */
  lastAssistant?: string;
  /** brief asli (pesan user terakhir sebelum kartu 📌) kalau pesan ini jawaban kartu */
  brief?: string;
};

export type TurnKind = {
  /** timeline masih contoh bawaan (dinilai seperti belum ada timeline) */
  starter: boolean;
  /** ada timeline sungguhan (bukan contoh bawaan) */
  planned: boolean;
  /** judul + konsep + tujuan timeline sekarang */
  about: string;
  cardAnswer: boolean;
  afterAsk: boolean;
  small: boolean;
  /** giliran kreatif → mesin berat */
  creative: boolean;
  /** proyek sudah punya rencana, tapi user minta video untuk subjek lain */
  newSubject: boolean;
  /** aturan khusus giliran ini untuk sutradara */
  notes: string[];
  research: ResearchPlan | null;
};

export function turnKind(i: TurnInput): TurnKind {
  const content = String(i.content ?? "");
  const current = i.current;
  // contoh bawaan yang belum diubah ("mulai dari contoh rencana") → isinya contoh, bukan subjek user: dinilai seperti belum ada
  // timeline (brief apa pun = rencana baru, bukan "revisi kecil" contoh CS Tracker)
  const starter = isStarterTimeline(current);
  const planned = !!current && !starter;
  // subjek timeline sekarang — pembanding "video untuk subjek lain"
  const about = planned ? timelineAbout(current) : "";
  const cardAnswer = /^📌\s*(Jawaban|Lewati)/i.test(content);
  const brief = cardAnswer ? String(i.brief ?? "") : "";
  const small = !cardAnswer && isSmallEdit(content, planned);
  const afterAsk = /```ask/i.test(String(i.lastAssistant ?? ""));
  // mesin berat hanya untuk giliran kreatif (rencana baru / revisi besar / jawaban kartu); sapaan & pertanyaan cara pakai -> mesin cepat
  const creative = needsHeavy(content, { hasTimeline: planned, afterAsk });
  // mis. proyek teaser CS Tracker → "Promo Konten.com buat clipper" (jawaban kartu → subjek dari brief aslinya)
  const newSubject = planned && wantsNewSubject(cardAnswer ? brief : content, about);

  const notes: string[] = [];
  if (cardAnswer)
    notes.push(
      /^📌\s*Lewati/i.test(content)
        ? "User MELEWATI kartu pertanyaan: langsung buat rencana lengkap pakai asumsi terbaik (sebut asumsinya 1 baris). JANGAN bertanya lagi."
        : "User SUDAH MENJAWAB kartu pertanyaan: langsung buat rencana lengkap sesuai jawabannya. JANGAN bertanya lagi."
    );
  else if (afterAsk) notes.push("Kamu baru saja bertanya. Kalau pesan user ini sudah cukup menjawab, langsung buat rencana — jangan bertanya lagi.");
  if (current && !cardAnswer)
    notes.push(
      starter
        ? "TIMELINE SEKARANG masih CONTOH BAWAAN: brief / subjek dari user = RENCANA BARU dari nol untuk subjek itu (judul, konsep, teks, VO, brand & layout baru). Revisi hanya kalau user jelas mengubah contohnya sendiri."
        : newSubject
          ? 'Pesan ini minta video untuk SUBJEK LAIN (beda dengan judul / konsep TIMELINE SEKARANG): buat RENCANA BARU dari nol untuk subjek itu (judul, konsep, teks, VO, brand & layout baru; id s1, s2, …; adegan premium "teaser" lama tidak dibawa). Jangan menyalin isi timeline lama. Kalau ternyata user hanya merevisi timeline sekarang → revisi biasa.'
          : "Sudah ada TIMELINE SEKARANG: permintaan perubahan pada subjek yang sama = REVISI (kirim timeline LENGKAP hasil revisi, id adegan lama dipertahankan). Kalau user minta video untuk SUBJEK lain (beda dengan judul/konsep timeline sekarang) atau jelas minta video baru → rencana baru dari nol untuk subjek itu."
    );
  if (small) notes.push("Ini revisi kecil: ubah hanya bagian yang diminta, sisanya persis sama.");

  // riset web singkat: subjek baru / user minta riset / ada link (revisi kecil & obrolan tidak)
  const research = planResearch({ text: content, brief, hasTimeline: planned, starter, small, creative, about });
  return { starter, planned, about, cardAnswer, afterAsk, small, creative, newSubject, notes, research };
}
