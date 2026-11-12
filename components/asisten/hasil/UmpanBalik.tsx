"use client";

import { useId, useState, useTransition } from "react";
import { hapusUmpanBalik, simpanUmpanBalik } from "@/app/(app)/asisten-review/hasil/actions";

export type FeedbackMine = { agree: boolean; note: string | null } | null;

/**
 * Tombol "Setuju / Tidak setuju + catatan" untuk reviewer atas saran AI (umpan balik rubrik).
 * Setuju = langsung tersimpan (catatan boleh ditambah); Tidak setuju = wajib tulis alasan singkat.
 * `counts` = jumlah setuju / tidak dari seluruh tim (sudah termasuk punyaku saat dimuat).
 */
export default function UmpanBalik({
  resultId,
  mine,
  counts,
  compact = false,
}: {
  resultId: number;
  mine: FeedbackMine;
  counts?: { setuju: number; tidak: number };
  compact?: boolean;
}) {
  const [saved, setSaved] = useState<FeedbackMine>(mine);
  const [draft, setDraft] = useState<{ agree: boolean; note: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const noteId = useId();

  // jumlah tim tanpa punyaku (dari data awal) + punyaku sekarang
  const base = {
    setuju: Math.max(0, (counts?.setuju ?? 0) - (mine?.agree === true ? 1 : 0)),
    tidak: Math.max(0, (counts?.tidak ?? 0) - (mine?.agree === false ? 1 : 0)),
  };
  const total = { setuju: base.setuju + (saved?.agree === true ? 1 : 0), tidak: base.tidak + (saved?.agree === false ? 1 : 0) };

  const kirim = (agree: boolean, note: string) =>
    start(async () => {
      setMsg(null);
      let r: Awaited<ReturnType<typeof simpanUmpanBalik>>;
      try {
        r = await simpanUmpanBalik(resultId, agree, note);
      } catch {
        r = { error: "Gagal terhubung. Coba lagi." };
      }
      if (r.ok) {
        setSaved({ agree, note: note.trim() || null });
        setDraft(null);
        setMsg({ ok: true, text: "✓ Tersimpan" });
      } else setMsg({ ok: false, text: r.error ?? "Gagal menyimpan." });
    });

  const hapus = () =>
    start(async () => {
      setMsg(null);
      let r: Awaited<ReturnType<typeof hapusUmpanBalik>>;
      try {
        r = await hapusUmpanBalik(resultId);
      } catch {
        r = { error: "Gagal terhubung. Coba lagi." };
      }
      if (r.ok) {
        setSaved(null);
        setDraft(null);
        setMsg({ ok: true, text: "Umpan balik dihapus" });
      } else setMsg({ ok: false, text: r.error ?? "Gagal menghapus." });
    });

  const pilih = (agree: boolean) => {
    if (pending) return;
    // Setuju tanpa catatan langsung tersimpan; Tidak setuju buka kotak catatan dulu
    if (agree && !draft) kirim(true, saved?.agree === true ? (saved.note ?? "") : "");
    else setDraft({ agree, note: saved?.agree === agree ? (saved.note ?? "") : (draft?.note ?? "") });
  };

  const btn = (agree: boolean) => {
    const on = draft ? draft.agree === agree : saved?.agree === agree;
    const tone = agree
      ? on
        ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
        : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-emerald-500/40"
      : on
        ? "border-red-500/50 bg-red-500/15 text-red-300"
        : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-red-500/40";
    return (
      <button
        type="button"
        aria-pressed={on}
        aria-disabled={pending || undefined}
        onClick={() => pilih(agree)}
        className={`inline-flex min-h-9 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition active:scale-[0.97] ${tone} ${pending ? "opacity-60" : ""}`}
      >
        <span aria-hidden>{agree ? "👍" : "👎"}</span>
        {agree ? "Setuju" : "Tidak setuju"}
      </button>
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {!compact && <span className="text-xs font-semibold text-zinc-400">Saran AI ini tepat?</span>}
        {btn(true)}
        {btn(false)}
        {(total.setuju > 0 || total.tidak > 0) && (
          <span className="text-[11px] text-zinc-500" title="Umpan balik seluruh tim">
            Tim: {total.setuju} setuju · {total.tidak} tidak
          </span>
        )}
        {msg && (
          <span role={msg.ok ? "status" : "alert"} className={`text-[11px] font-medium ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>
            {msg.text}
          </span>
        )}
      </div>

      {saved && !draft && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
          <span className="min-w-0 break-words">
            Kamu: <b className={saved.agree ? "text-emerald-400" : "text-red-400"}>{saved.agree ? "Setuju" : "Tidak setuju"}</b>
            {saved.note ? ` — “${saved.note}”` : ""}
          </span>
          <button type="button" className="font-semibold text-orange-400 hover:underline" onClick={() => setDraft({ agree: saved.agree, note: saved.note ?? "" })}>
            {saved.note ? "Ubah catatan" : "Tambah catatan"}
          </button>
          <button type="button" className="font-semibold text-zinc-500 hover:text-red-400 hover:underline" onClick={hapus} aria-disabled={pending || undefined}>
            Hapus
          </button>
        </div>
      )}

      {draft && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!pending) kirim(draft.agree, draft.note);
          }}
        >
          <label htmlFor={noteId} className="block text-xs text-zinc-400">
            {draft.agree ? "Catatan (boleh kosong)" : "Kenapa tidak setuju? (wajib, singkat)"}
          </label>
          <textarea
            id={noteId}
            className="input min-h-[72px] resize-y"
            maxLength={1000}
            value={draft.note}
            autoFocus
            placeholder={draft.agree ? "Mis. bukti AI sudah tepat" : "Mis. CTA ada di detik 0:12, AI tidak melihat"}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className="btn-primary px-3 py-1.5 text-xs" aria-disabled={pending || undefined}>
              {pending ? "Menyimpan…" : "Simpan"}
            </button>
            <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setDraft(null)}>
              Batal
            </button>
            <span className="text-[11px] text-zinc-500">{draft.note.length}/1000</span>
          </div>
        </form>
      )}
    </div>
  );
}
