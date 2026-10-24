/**
 * Kartu pertanyaan balik yang ditulis AI sebagai blok ```ask {json}``` (dipakai di semua mode: data, Cowork, umum).
 * Format: {"title":"…","questions":[{"q":"…","multi":false,"options":[{"label":"…","desc":"…","rec":true}]}],"skip":"…"}
 * Jawaban user dikirim balik sebagai pesan "📌 Jawaban — …" / "📌 Lewati pertanyaan — …" supaya AI langsung kerja.
 */
export type ChoiceOption = { label: string; desc?: string; rec?: boolean };
export type ChoiceQuestion = { q: string; multi?: boolean; options: ChoiceOption[] };
export type Choice = { title?: string; questions: ChoiceQuestion[]; skip?: string };

const DONE = /```ask\s*\n?([\s\S]*?)```/i;
const str = (v: unknown, max: number) => (v === undefined || v === null ? "" : String(v).trim().slice(0, max));

/** pisahkan blok ```ask dari teks jawaban (blok yang belum selesai saat streaming disembunyikan) */
export function splitChoice(text: string): { text: string; choice: Choice | null; partial: boolean } {
  const m = text.match(DONE);
  if (!m) {
    const i = text.search(/```ask\b/i);
    return i >= 0 ? { text: text.slice(0, i).trimEnd(), choice: null, partial: true } : { text, choice: null, partial: false };
  }
  const rest = (text.slice(0, m.index) + text.slice(m.index! + m[0].length)).trim();
  try {
    const j = JSON.parse(m[1].trim()) as Record<string, unknown>;
    const questions = (Array.isArray(j.questions) ? j.questions : [])
      .map((x) => x as Record<string, unknown>)
      .map((x) => {
        const options = (Array.isArray(x.options) ? x.options : [])
          .map((o) => (typeof o === "string" ? { label: o } : (o as Record<string, unknown>)))
          .map((o) => ({ label: str(o.label, 60), desc: str(o.desc, 110) || undefined, rec: !!o.rec }))
          .filter((o) => o.label && !/^lainnya$/i.test(o.label))
          .slice(0, 4);
        // tepat satu "Disarankan" per pertanyaan
        const ri = Math.max(0, options.findIndex((o) => o.rec));
        return { q: str(x.q ?? x.question, 140), multi: !!x.multi, options: options.map((o, i) => ({ ...o, rec: i === ri })) };
      })
      .filter((x) => x.q && x.options.length >= 2)
      .slice(0, 3);
    if (!questions.length) return { text: rest, choice: null, partial: false };
    return { text: rest, choice: { title: str(j.title, 160) || undefined, questions, skip: str(j.skip, 40) || undefined }, partial: false };
  } catch {
    return { text: rest, choice: null, partial: false };
  }
}

/** pesan jawaban kartu (dikenali server: "📌 Jawaban" / "📌 Lewati pertanyaan") */
export const choiceAnswer = (pairs: { q: string; a: string[] }[]) => `📌 Jawaban — ${pairs.map((p) => `${p.q.replace(/[?？]\s*$/, "")}: ${p.a.join(", ")}`).join(" · ")}`;
export const CHOICE_SKIP = "📌 Lewati pertanyaan — langsung kerjakan pakai asumsi terbaik";
