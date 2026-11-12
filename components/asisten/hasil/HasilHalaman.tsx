import Link from "next/link";
import { Kosong } from "@/components/asisten/BelumSiap";
import StatusLaptop from "@/components/asisten/StatusLaptop";
import type { ArStatus } from "@/components/asisten/statusTypes";
import HasilFilter, { type Opsi } from "./HasilFilter";
import HasilKartu, { type KartuRow } from "./HasilKartu";
import LiveBaru from "./LiveBaru";
import type { FeedbackMine } from "./UmpanBalik";

export type FilterHasil = { run: string; campaign: string; reviewer: string; saran: string; yakin: string; cocok: string };

/** Isi halaman Hasil (tanpa ambil data → bisa diuji di harness): status laptop, filter, daftar kartu, paginasi */
export default function HasilHalaman({
  status,
  runs,
  campaigns,
  reviewers,
  rows,
  mine,
  counts,
  total,
  hal,
  pages,
  f,
  galat,
}: {
  status: ArStatus;
  runs: Opsi[];
  campaigns: Opsi[];
  reviewers: Opsi[];
  rows: KartuRow[];
  mine: Map<number, NonNullable<FeedbackMine>>;
  counts: Map<number, { setuju: number; tidak: number }>;
  total: number;
  hal: number;
  pages: number;
  f: FilterHasil;
  /** pesan awam kalau daftar gagal dibaca */
  galat: string | null;
}) {
  const link = (n: number) => {
    const p = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]);
    if (n > 1) p.set("hal", String(n));
    return `/asisten-review${p.size ? `?${p}` : ""}`;
  };
  const adaFilter = Object.values(f).some(Boolean);

  return (
    <div className="space-y-4">
      <StatusLaptop initial={status} />
      <HasilFilter runs={runs} campaigns={campaigns} reviewers={reviewers} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-zinc-400">
          {total ? (
            <>
              <b className="font-semibold text-zinc-200">{total.toLocaleString("id-ID")}</b> hasil{adaFilter ? " (sesuai filter)" : ""} · halaman {Math.min(hal, pages)} dari {pages}
            </>
          ) : null}
        </p>
        {hal === 1 && <LiveBaru />}
      </div>

      {galat && <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">{galat}</p>}

      {!galat && !rows.length ? (
        adaFilter || hal > 1 ? (
          <Kosong judul="Tidak ada hasil yang cocok">
            Coba ubah filter, atau{" "}
            <Link href="/asisten-review" className="font-semibold text-orange-400 hover:underline">
              tampilkan semua
            </Link>
            .
          </Kosong>
        ) : (
          <Kosong ikon="🤖" judul="Belum ada hasil">
            Jalankan uji 50 video atau cek video tertentu di{" "}
            <Link href="/asisten-review/uji" className="font-semibold text-orange-400 hover:underline">
              Jalankan uji
            </Link>
            . Hasil muncul di sini sesudah laptop selesai memproses.
          </Kosong>
        )
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <HasilKartu key={r.id} r={r} mine={mine.get(r.id) ?? null} counts={counts.get(r.id) ?? { setuju: 0, tidak: 0 }} />
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav aria-label="Halaman" className="flex items-center justify-center gap-2">
          {hal > 1 ? (
            <Link href={link(hal - 1)} className="btn-ghost px-3 py-1.5 text-sm" rel="prev">
              ← Sebelumnya
            </Link>
          ) : (
            <span className="btn-ghost cursor-not-allowed px-3 py-1.5 text-sm opacity-40" aria-disabled>
              ← Sebelumnya
            </span>
          )}
          <span className="text-sm text-zinc-400">
            {Math.min(hal, pages)} / {pages}
          </span>
          {hal < pages ? (
            <Link href={link(hal + 1)} className="btn-ghost px-3 py-1.5 text-sm" rel="next">
              Berikutnya →
            </Link>
          ) : (
            <span className="btn-ghost cursor-not-allowed px-3 py-1.5 text-sm opacity-40" aria-disabled>
              Berikutnya →
            </span>
          )}
        </nav>
      )}
    </div>
  );
}
