"use client";

import Link from "next/link";
import { useId, useMemo, useState, useTransition } from "react";
import { JOB_STATUS_LABEL, SARAN_LABEL, parseVideoRef } from "@/lib/asistenReview";
import { antrikanVideo } from "@/app/(app)/asisten-review/uji/actions";
import type { ArStatus, JobLite } from "./statusTypes";

const MAKS = 20;
const pecah = (t: string) =>
  t
    .split(/[\r\n]+/)
    .flatMap((l) => l.split(/[\s,;]+/))
    .map((l) => l.trim())
    .filter(Boolean);

/**
 * Kotak "Tempel ID / link video" untuk uji manual video tertentu: 1 baris = 1 video (maks 20).
 * Yang dikirim ke server hanya teksnya; server mengubah link → id (tanpa username) sebelum disimpan di antrian.
 */
export default function TempelVideo({
  onQueued,
  hasil,
  jobs,
  online,
}: {
  onQueued: () => void;
  hasil: ArStatus["hasil"];
  jobs: JobLite[];
  online: boolean;
}) {
  const [teks, setTeks] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string; ditolak?: string[] } | null>(null);
  const [pending, start] = useTransition();
  const id = useId();

  // pratinjau langsung: berapa yang dikenali (dicek ulang di server)
  const cek = useMemo(() => {
    const xs = pecah(teks);
    const ok = xs.filter((x) => parseVideoRef(x)).length;
    return { n: xs.length, ok, salah: xs.length - ok };
  }, [teks]);

  const kirim = () =>
    start(async () => {
      setMsg(null);
      let r: Awaited<ReturnType<typeof antrikanVideo>>;
      try {
        r = await antrikanVideo(teks);
      } catch {
        r = { error: "Gagal terhubung. Coba lagi." };
      }
      if (r.ok) {
        setTeks("");
        setMsg({
          ok: true,
          text: `${r.jumlah} video diantrikan.${online ? " Hasil muncul di bawah sesudah laptop selesai." : " Laptop mati — dikerjakan saat menyala."}`,
          ditolak: r.ditolak,
        });
        onQueued();
      } else setMsg({ ok: false, text: r.error ?? "Gagal.", ditolak: r.ditolak });
    });

  const terbaru = jobs.slice(0, 6);

  return (
    <section className="card space-y-3 p-4 sm:p-5" aria-labelledby={`${id}-judul`}>
      <div>
        <h2 id={`${id}-judul`} className="section-title">
          Cek video tertentu
        </h2>
        <p className="mt-0.5 text-xs text-zinc-400">
          Tempel ID video Konten.com atau link TikTok / Instagram / YouTube — satu per baris, maks {MAKS}. Laptop mencarinya di database Konten.com. Link tidak
          disimpan, hanya ID-nya.
        </p>
      </div>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!pending && cek.ok > 0 && cek.n <= MAKS) kirim();
        }}
      >
        <label htmlFor={id} className="sr-only">
          ID atau link video
        </label>
        <textarea
          id={id}
          className="input min-h-[96px] resize-y font-mono text-[13px]"
          value={teks}
          onChange={(e) => setTeks(e.target.value)}
          placeholder={"48213\nhttps://www.tiktok.com/@akun/video/7301234567890123456"}
          spellCheck={false}
          autoComplete="off"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="btn-primary" aria-disabled={pending || cek.ok === 0 || cek.n > MAKS || undefined}>
            {pending ? "Mengantrikan…" : `🔎 Cek ${cek.ok > 0 ? `${cek.ok} ` : ""}video`}
          </button>
          {cek.n > 0 && (
            <span className={`text-xs ${cek.n > MAKS ? "text-red-400" : cek.salah ? "text-amber-400" : "text-zinc-400"}`}>
              {cek.n > MAKS ? `Terlalu banyak: ${cek.n} (maks ${MAKS})` : `${cek.ok} dikenali${cek.salah ? ` · ${cek.salah} tidak dikenali` : ""}`}
            </span>
          )}
        </div>
      </form>
      {msg && (
        <div role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>
          {msg.text}
          {!!msg.ditolak?.length && (
            <p className="mt-1 break-all text-xs text-amber-400">Tidak dikenali (dilewati): {msg.ditolak.join(", ")}</p>
          )}
        </div>
      )}
      {terbaru.length > 0 && (
        <ul className="divide-y divide-zinc-800 rounded-xl border border-zinc-800" aria-label="Cek video terakhir">
          {terbaru.map((j) => {
            const h = hasil[j.id];
            return (
              <li key={j.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-xs">
                <span className="min-w-0 flex-1 break-all font-semibold">{j.label}</span>
                <span className="text-zinc-400">{JOB_STATUS_LABEL[j.status]}</span>
                {j.status === "gagal" && j.message && <span className="basis-full break-words text-red-400">{j.message}</span>}
                {h && (
                  <Link href={`/asisten-review/hasil/${h.id}`} className="font-semibold text-orange-400 hover:underline">
                    {h.pipeline_status !== "ok" ? "Lihat (tidak bisa diakses)" : h.suggestion ? `${SARAN_LABEL[h.suggestion]}${typeof h.confidence === "number" ? ` ${h.confidence}%` : ""}` : "Lihat hasil"} →
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
