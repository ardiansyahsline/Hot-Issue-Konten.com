/**
 * Ringkasan "pendapat AI sendiri" satu run (review_runs.metrics.condong — KONTRAK-CONDONG.md §3), tampilan murni dari props:
 * akurasi pendapat AI di SEMUA video yang punya hasil akhir (+ kisaran Wilson 95%), matriks 2×2, tabel ambang
 * "kalau AI dibiarkan memutuskan sendiri saat yakin ≥ X%", dan kalibrasi (yakin AI vs benar nyata). Bahasa awam.
 */
import Link from "next/link";
import type { CondongMetrics, PersenWilson } from "@/lib/asistenReview";
import { angka, ciTeks, nilaiPersen, persenTeks } from "./hitung";

const th = "border-b border-zinc-800 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500";
const td = "border-b border-zinc-800/70 px-2 py-1.5 align-top";
/** di bawah ini satu baris/rentang dianggap sampel terlalu sedikit */
const SEDIKIT = 10;

function Kotak({ judul, sub, children }: { judul: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="card card-flat min-w-0 p-4 sm:p-5">
      <h3 className="font-display text-[15px] font-bold">{judul}</h3>
      {sub && <p className="mt-0.5 text-xs text-zinc-500">{sub}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

const warnaAkurasi = (v: number | null) => (v == null ? "text-zinc-100" : v >= 85 ? "text-emerald-400" : v >= 70 ? "text-amber-400" : "text-red-400");
const kisaran = (p: PersenWilson | null | undefined) => ciTeks(p ?? null);

/** semua bagian pendapat AI (dipanggil RingkasanView kalau adaCondong) */
export default function CondongView({ c, runId }: { c: CondongMetrics; runId: string }) {
  return (
    <section className="space-y-4" aria-labelledby="judul-condong">
      <div className="min-w-0">
        <h3 id="judul-condong" className="section-title">
          🤖 Kalau AI memutuskan sendiri
        </h3>
        <p className="page-sub">
          Tiap video AI tetap memilih approve atau reject dan bilang seberapa yakin — walau sarannya diserahkan ke manusia. Di sini dicek seberapa sering
          pilihan itu benar.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Akurasi c={c} />
        <Matriks c={c} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Ambang c={c} />
        <Kalibrasi c={c} runId={runId} />
      </div>
    </section>
  );
}

function Akurasi({ c }: { c: CondongMetrics }) {
  const v = nilaiPersen(c.akurasi);
  const ci = kisaran(c.akurasi);
  const pc = c.per_condong ?? {};
  return (
    <Kotak judul="Pendapat AI benar" sub="Dibanding hasil akhir (keputusan reviewer, atau hasil banding kalau keputusannya dibatalkan).">
      <p className={`font-display text-[32px] font-bold leading-none ${warnaAkurasi(v)}`}>{persenTeks(v)}</p>
      <p className="mt-1 text-xs text-zinc-400">
        {angka(c.akurasi.benar)} dari {angka(c.akurasi.n)} video{ci && <span className="text-zinc-500"> · {ci}</span>}
      </p>
      <p className="mt-2 text-[13px] text-zinc-300">
        AI berpendapat di <b>{angka(c.n_ada)}</b> dari {angka(c.n_kebenaran)} video yang punya hasil akhir ({persenTeks(c.cakupan)}).
        {c.n_tanpa > 0 && ` ${angka(c.n_tanpa)} video tanpa pendapat (AI gagal / menolak / data lama) tidak dihitung.`}
      </p>
      {(pc.approve || pc.reject) && (
        <ul className="mt-2 space-y-1 text-[13px]">
          {(["approve", "reject"] as const).map((k) => {
            const p = pc[k];
            if (!p || !p.n) return null;
            return (
              <li key={k} className="flex items-start justify-between gap-3">
                <span className="text-zinc-300">Kalau AI bilang {k === "approve" ? "approve" : "reject"}, benar</span>
                <span className="shrink-0 text-right tabular-nums">
                  <b>{persenTeks(nilaiPersen(p))}</b>{" "}
                  <span className="text-xs text-zinc-500">
                    ({angka(p.benar)}/{angka(p.n)})
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {c.termasuk_di_luar_video && nilaiPersen(c.termasuk_di_luar_video) != null && (
        <p className="mt-2 text-xs text-zinc-500">
          Kalau video yang di-reject karena followers / link bio / duplikat / bot ikut dihitung: {persenTeks(nilaiPersen(c.termasuk_di_luar_video))} (
          {angka(c.termasuk_di_luar_video.n)} video).
        </p>
      )}
      {c.catatan_sampel && <p className="mt-3 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-300">{c.catatan_sampel}</p>}
    </Kotak>
  );
}

function Matriks({ c }: { c: CondongMetrics }) {
  const g = (t: "approve" | "reject", s: "approve" | "reject") => c.matriks?.[t]?.[s] ?? 0;
  const sel = (t: "approve" | "reject", s: "approve" | "reject") => {
    const cls = s === t ? "text-emerald-400" : t === "reject" ? "font-bold text-red-400" : "text-amber-400";
    return <td className={`${td} text-right text-base tabular-nums ${cls}`}>{angka(g(t, s))}</td>;
  };
  return (
    <Kotak judul="Tabel salah-benar pendapat AI" sub="Baris = hasil akhir yang benar, kolom = pendapat AI.">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr>
            <th className={th}>Seharusnya</th>
            <th className={`${th} text-right`}>AI approve</th>
            <th className={`${th} text-right`}>AI reject</th>
          </tr>
        </thead>
        <tbody>
          {(["approve", "reject"] as const).map((t) => (
            <tr key={t}>
              <th scope="row" className={`${td} font-semibold`}>
                {t === "approve" ? "Approve" : "Reject"}
              </th>
              {sel(t, "approve")}
              {sel(t, "reject")}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="mt-3 space-y-1 text-[13px]">
        <li className="flex items-start justify-between gap-3">
          <span className="font-semibold text-red-400">
            <span aria-hidden>⛔ </span>AI approve padahal seharusnya reject
          </span>
          <b className="tabular-nums">{angka(g("reject", "approve"))}</b>
        </li>
        <li className="flex items-start justify-between gap-3">
          <span className="text-zinc-300">
            <span aria-hidden>• </span>AI reject padahal seharusnya approve
          </span>
          <b className="tabular-nums">{angka(g("approve", "reject"))}</b>
        </li>
        <li className="flex items-start justify-between gap-3">
          <span className="text-zinc-300">
            <span aria-hidden>✅ </span>AI benar
          </span>
          <b className="tabular-nums">{angka(g("approve", "approve") + g("reject", "reject"))}</b>
        </li>
      </ul>
    </Kotak>
  );
}

function Ambang({ c }: { c: CondongMetrics }) {
  const rows = [...c.ambang].sort((a, b) => a.min - b.min);
  if (!rows.length) return null;
  // contoh kalimat: batas 80% kalau ada isinya, kalau tidak baris pertama yang berisi
  const contoh = rows.find((r) => r.min === 80 && r.n > 0) ?? rows.find((r) => r.n > 0) ?? null;
  return (
    <Kotak
      judul="Kalau AI dibiarkan memutuskan sendiri saat yakin ≥ X%"
      sub="Video yang keyakinan AI-nya di bawah batas tetap dicek reviewer. Makin tinggi batasnya, makin sedikit video yang ditangani AI tapi biasanya makin jarang salah."
    >
      <table className="w-full table-fixed text-left text-[12px] sm:text-[13px]" aria-label="Tabel ambang keyakinan">
        <colgroup>
          <col className="w-[18%]" />
          <col className="w-[22%]" />
          <col className="w-[26%]" />
          <col className="w-[17%]" />
          <col className="w-[17%]" />
        </colgroup>
        <thead>
          <tr>
            <th className={`${th} px-1.5 normal-case tracking-normal sm:px-2`}>Yakin AI</th>
            <th className={`${th} px-1.5 text-right normal-case tracking-normal sm:px-2`}>Ditangani AI</th>
            <th className={`${th} px-1.5 text-right normal-case tracking-normal sm:px-2`}>Benar</th>
            <th className={`${th} px-1.5 text-right normal-case tracking-normal sm:px-2`} title="AI approve padahal seharusnya reject">
              Salah approve
            </th>
            <th className={`${th} px-1.5 text-right normal-case tracking-normal sm:px-2`} title="AI reject padahal seharusnya approve">
              Salah reject
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const sedikit = r.n < SEDIKIT;
            const ci = r.akurasi.ci95;
            return (
              <tr key={r.min} className={sedikit ? "text-zinc-500" : ""} title={sedikit ? "Sampel terlalu sedikit — angka belum bisa dipegang" : undefined}>
                <th scope="row" className={`${td} whitespace-nowrap px-1.5 font-semibold sm:px-2`}>
                  ≥ {r.min}%
                </th>
                <td className={`${td} px-1.5 text-right tabular-nums sm:px-2`}>
                  <b>{persenTeks(r.ditangani_persen)}</b>
                  <span className="block text-[11px] text-zinc-500">{angka(r.n)} video</span>
                </td>
                <td className={`${td} px-1.5 text-right tabular-nums sm:px-2`}>
                  <b className={sedikit ? "" : warnaAkurasi(nilaiPersen(r.akurasi))}>{persenTeks(nilaiPersen(r.akurasi))}</b>
                  {ci && ci.length === 2 && (
                    <span className="block text-[11px] text-zinc-500">
                      {persenTeks(ci[0]).replace("%", "")}–{persenTeks(ci[1])}
                    </span>
                  )}
                </td>
                <td className={`${td} px-1.5 text-right tabular-nums sm:px-2 ${r.salah_approve > 0 && !sedikit ? "font-bold text-red-400" : ""}`}>{angka(r.salah_approve)}</td>
                <td className={`${td} px-1.5 text-right tabular-nums sm:px-2`}>{angka(r.salah_reject)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-1.5 text-[11px] text-zinc-500">
        Angka kecil di bawah “Benar” = kisaran wajar (95%). Baris abu-abu = kurang dari {SEDIKIT} video, belum bisa dipegang.
      </p>
      {contoh && (
        <p className="mt-3 rounded-xl bg-zinc-800/50 px-3 py-2 text-[13px] text-zinc-300">
          <b>Contoh:</b> kalau AI boleh memutuskan sendiri saat yakin ≥ {contoh.min}%, AI menangani {persenTeks(contoh.ditangani_persen)} video (
          {angka(contoh.n)} dari {angka(c.n_kebenaran)}). Hasilnya benar {persenTeks(nilaiPersen(contoh.akurasi))}
          {kisaran(contoh.akurasi) ? ` (${kisaran(contoh.akurasi)})` : ""}, dengan <b className={contoh.salah_approve ? "text-red-400" : ""}>{angka(contoh.salah_approve)}</b>{" "}
          video di-approve padahal seharusnya reject dan {angka(contoh.salah_reject)} di-reject padahal seharusnya approve. Sisanya tetap dicek reviewer.
          {contoh.n_bertanda > 0 && ` ${angka(contoh.n_bertanda)} di antaranya sekarang masih bertanda “perlu cek manusia” (mis. perlu mengenali artis).`}
        </p>
      )}
    </Kotak>
  );
}

function statusKalibrasi(n: number, selisih: number | null): { teks: string; cls: string } | null {
  if (!n) return null;
  if (n < SEDIKIT) return { teks: "sampel sedikit", cls: "bg-zinc-800 text-zinc-400 ring-zinc-700" };
  if (selisih == null) return null;
  if (selisih < -5) return { teks: "⚠ terlalu pede", cls: "bg-amber-500/10 text-amber-300 ring-amber-500/30" };
  if (selisih > 5) return { teks: "↑ lebih sering benar", cls: "bg-sky-500/10 text-sky-300 ring-sky-500/30" };
  return { teks: "✓ jujur", cls: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30" };
}

function Kalibrasi({ c, runId }: { c: CondongMetrics; runId: string }) {
  const rows = [...c.kalibrasi].sort((a, b) => b.dari - a.dari);
  if (!rows.length) return null;
  return (
    <Kotak judul="Seberapa jujur angka “yakin” AI" sub="Kalau AI bilang yakin sekian persen, berapa yang benar-benar benar? Klik satu baris untuk melihat videonya.">
      <p className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-5 rounded-full bg-sky-500" /> benar nyata
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-0.5 rounded-full bg-zinc-100" /> yakin AI (rata-rata)
        </span>
      </p>
      <ul className="space-y-2.5">
        {rows.map((r) => {
          const benar = nilaiPersen(r.akurasi);
          const st = statusKalibrasi(r.n, r.selisih);
          const sedikit = r.n > 0 && r.n < SEDIKIT;
          const kalimat = !r.n
            ? `Belum ada video dengan yakin ${r.dari}–${r.sampai}%.`
            : `Kalau AI bilang yakin ${r.dari}–${r.sampai}%${r.rata_yakin != null ? ` (rata-rata ${persenTeks(r.rata_yakin)})` : ""}, benarnya ${persenTeks(benar)} (${angka(r.akurasi.benar)} dari ${angka(r.n)} video)${sedikit ? " — sampel terlalu sedikit" : ""}.`;
          const isi = (
            <>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="text-[13px] font-semibold">
                  Yakin {r.dari}–{r.sampai}%
                </span>
                <span className="flex items-center gap-2">
                  {st && <span className={`badge ${st.cls}`}>{st.teks}</span>}
                  <b className="text-[13px] tabular-nums">{r.n ? persenTeks(benar) : "–"}</b>
                </span>
              </div>
              <div className="relative mt-1.5 h-2.5 rounded-full bg-zinc-800" aria-hidden>
                {benar != null && <div className={`h-full rounded-full ${sedikit ? "bg-sky-500/40" : "bg-sky-500"}`} style={{ width: `${Math.max(2, Math.min(100, benar))}%` }} />}
                {r.rata_yakin != null && r.n > 0 && (
                  <div className="absolute -top-1 h-[18px] w-0.5 -translate-x-1/2 rounded-full bg-zinc-100 ring-2 ring-zinc-900" style={{ left: `${Math.min(100, Math.max(0, r.rata_yakin))}%` }} />
                )}
              </div>
              <p className={`mt-1 text-xs ${r.n ? "text-zinc-400" : "text-zinc-500"}`}>{kalimat}</p>
            </>
          );
          return (
            <li key={r.dari} title={kalimat}>
              {r.n ? (
                <Link href={`/asisten-review?run=${runId}&yc=${r.dari >= 90 ? 90 : r.dari}`} className="block rounded-xl px-2 py-1.5 transition hover:bg-zinc-800/60">
                  {isi}
                </Link>
              ) : (
                <div className="px-2 py-1.5">{isi}</div>
              )}
            </li>
          );
        })}
      </ul>
    </Kotak>
  );
}
