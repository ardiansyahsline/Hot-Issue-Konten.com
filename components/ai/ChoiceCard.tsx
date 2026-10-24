"use client";

import { CHOICE_SKIP, choiceAnswer, type Choice } from "@/lib/choiceCard";
import PagedAsk from "./PagedAsk";

/**
 * Kartu pertanyaan balik dari AI (blok ```ask): 1–3 pertanyaan, satu per halaman (gaya Claude),
 * pilihan bisa diklik, "Lainnya", dan "Lewati". Jawaban dikirim sebagai pesan "📌 Jawaban — …".
 */
export default function ChoiceCard({ choice, disabled, onSubmit }: { choice: Choice; disabled?: boolean; onSubmit: (text: string) => void }) {
  return (
    <PagedAsk
      title={choice.title}
      questions={choice.questions}
      disabled={disabled}
      skipLabel={choice.skip || "Lewati, langsung kerjain"}
      onSkip={() => onSubmit(CHOICE_SKIP)}
      onDone={(a) => onSubmit(choiceAnswer(choice.questions.map((q, i) => ({ q: q.q, a: a[i] }))))}
    />
  );
}
