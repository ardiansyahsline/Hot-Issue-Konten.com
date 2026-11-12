"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

export type Opsi = { value: string; label: string };

/**
 * Filter daftar hasil (run, campaign, reviewer, saran, keyakinan, cocok, pendapat AI sendiri + keyakinannya).
 * condong=false (migration-24 belum dijalankan) → dua filter pendapat AI tidak ditampilkan. Tanpa JS tetap jalan (form GET + tombol Terapkan);
 * dengan JS: berubah = langsung diterapkan, halaman kembali ke 1.
 */
export default function HasilFilter({ runs, campaigns, reviewers, condong = true }: { runs: Opsi[]; campaigns: Opsi[]; reviewers: Opsi[]; condong?: boolean }) {
  const sp = useSearchParams();
  const path = usePathname();
  const router = useRouter();
  const [pending, start] = useTransition();
  const v = (k: string) => sp.get(k) ?? "";

  const ubah = (k: string, val: string) => {
    const q = new URLSearchParams(sp.toString());
    if (val) q.set(k, val);
    else q.delete(k);
    q.delete("hal");
    start(() => router.push(`${path}${q.size ? `?${q}` : ""}`, { scroll: false }));
  };
  const aktif = ["run", "campaign", "reviewer", "saran", "yakin", "cocok", ...(condong ? ["condong", "yc"] : [])].filter((k) => v(k)).length;

  const sel = (k: string, label: string, opts: Opsi[], semua = "Semua") => (
    <label className="min-w-0">
      <span className="label">{label}</span>
      <select name={k} className="input py-2" value={v(k)} onChange={(e) => ubah(k, e.target.value)}>
        <option value="">{semua}</option>
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <form method="get" action={path} className="card p-3 sm:p-4" aria-label="Filter hasil" aria-busy={pending}>
      <div className={`grid grid-cols-2 gap-2.5 ${condong ? "sm:grid-cols-4" : "sm:grid-cols-3 lg:grid-cols-6"}`}>
        {sel("run", "Uji", runs, "Semua uji")}
        {sel("campaign", "Campaign", campaigns, "Semua campaign")}
        {sel("reviewer", "Reviewer", reviewers, "Semua reviewer")}
        {sel("saran", "Saran akhir AI", [
          { value: "approve", label: "Approve" },
          { value: "reject", label: "Reject" },
          { value: "cek_manusia", label: "Butuh cek manusia" },
        ])}
        {sel("yakin", "Yakin saran", [
          { value: "90", label: "≥ 90%" },
          { value: "70", label: "≥ 70%" },
          { value: "rendah", label: "< 70%" },
        ])}
        {sel("cocok", "Cocok dg keputusan", [
          { value: "ya", label: "✓ Cocok" },
          { value: "tidak", label: "✕ Tidak cocok" },
          { value: "kosong", label: "– Diserahkan / belum ada" },
        ])}
        {condong &&
          sel(
            "condong",
            "Pendapat AI",
            [
              { value: "approve", label: "AI condong approve" },
              { value: "reject", label: "AI condong reject" },
              { value: "benar", label: "✓ Sesuai hasil akhir" },
              { value: "salah_approve", label: "✕ Approve, harusnya reject" },
              { value: "salah_reject", label: "✕ Reject, harusnya approve" },
              { value: "kosong", label: "– Tanpa pendapat" },
            ],
          )}
        {condong &&
          sel("yc", "Yakin pendapat AI", [
            { value: "90", label: "90–100%" },
            { value: "80", label: "80–89%" },
            { value: "70", label: "70–79%" },
            { value: "60", label: "60–69%" },
            { value: "50", label: "50–59%" },
            { value: "bawah50", label: "< 50%" },
          ])}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <noscript>
          <button type="submit" className="btn-ghost px-3 py-1.5 text-xs">
            Terapkan
          </button>
        </noscript>
        {aktif > 0 && (
          <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => start(() => router.push(path, { scroll: false }))}>
            ✕ Hapus {aktif} filter
          </button>
        )}
        {pending && (
          <span role="status" className="text-xs text-zinc-500">
            Memuat…
          </span>
        )}
      </div>
    </form>
  );
}
