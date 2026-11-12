/**
 * Kartu ramah kalau Asisten Review belum siap dipakai (migration-23 belum dijalankan / tabel gagal dibaca).
 * Server component polos (tanpa hook) — dipakai halaman Ringkasan & Materi.
 */
export default function BelumSiap({ pesan, judul = "Asisten Review belum siap" }: { pesan?: string; judul?: string }) {
  return (
    <div className="card card-flat p-5 sm:p-6" role="status">
      <p className="text-2xl" aria-hidden>
        🛠️
      </p>
      <h2 className="section-title mt-2">{judul}</h2>
      <p className="mt-1.5 text-sm text-zinc-400">
        {pesan ?? "Jalankan supabase/migration-23-asisten-review.sql dulu di Supabase (SQL Editor), lalu muat ulang halaman ini."}
      </p>
    </div>
  );
}

/** kartu kosong biasa (belum ada data) */
export function Kosong({ ikon = "📭", judul, children }: { ikon?: string; judul: string; children?: React.ReactNode }) {
  return (
    <div className="card card-flat p-6 text-center">
      <p className="text-3xl" aria-hidden>
        {ikon}
      </p>
      <p className="mt-2 font-semibold">{judul}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-zinc-400">{children}</div>}
    </div>
  );
}
