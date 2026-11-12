/**
 * Halaman Ringkasan akurasi + biaya satu run uji (tampilan murni: data dari props, tanpa hook / query).
 * Dipakai app/(app)/asisten-review/ringkasan/page.tsx dan harness uji UI (data palsu).
 * Angka = review_runs.metrics (review-worker metrik.py, KONTRAK.md §6.2). Tanpa data pribadi: video = id, reviewer = pseudonim.
 */
import Link from "next/link";
import { SARAN_LABEL, SERAH_LABEL, type KodeSerah, type Saran } from "@/lib/asistenReview";
import {
  RUN_STATUS_LABEL,
  TAHAP_LABEL,
  adaMetrik,
  angka,
  bandingVersi,
  ciTeks,
  detik,
  namaRun,
  nilaiPersen,
  persenTeks,
  rp,
  usd,
  type MetrikLengkap,
  type Pasangan,
  type PersenCi,
  type RunRingkas,
} from "./hitung";
import RunPicker from "./RunPicker";
import HapusRun from "./HapusRun";

export type ContohKasus = {
  id: number;
  video_id: string;
  campaign_title: string | null;
  suggestion: Saran | null;
  final_truth: "approve" | "reject" | null;
  official_reason: string | null;
  specific_reason: string | null;
  confidence: number | null;
};
export type PemakaianHarian = { day: string; cost_usd: number; calls: number };

type Props = {
  runs: RunRingkas[];
  run: RunRingkas | null;
  pembanding: RunRingkas | null;
  pasangan: Pasangan | null;
  contoh: ContohKasus[];
  pemakaian: PemakaianHarian[];
  admin: boolean;
  /** pesan error ramah dari server (mis. gagal membaca hasil) */
  peringatan?: string | null;
};

const BASE = "/asisten-review";
const fileUrl = (p: string, unduh = false) => `/api/asisten-review/file?p=${encodeURIComponent(p)}${unduh ? "&unduh=1" : ""}`;

const statusCls = (s: string) =>
  s === "selesai"
    ? "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30"
    : s === "proses"
      ? "bg-sky-500/10 text-sky-300 ring-sky-500/30"
      : s === "berhenti_biaya"
        ? "bg-amber-500/10 text-amber-300 ring-amber-500/30"
        : "bg-red-500/10 text-red-300 ring-red-500/30";

export default function RingkasanView({ runs, run, pembanding, pasangan, contoh, pemakaian, admin, peringatan }: Props) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="section-title">Ringkasan akurasi & biaya</h2>
          <p className="page-sub">Seberapa sering saran AI sama dengan keputusan tim, dan berapa biayanya.</p>
        </div>
        {runs.length > 0 && <RunPicker runs={runs.map((r) => ({ id: r.id, nama: namaRun(r) }))} value={run?.id ?? ""} pembanding={pembanding?.id ?? ""} />}
      </div>

      {peringatan && <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-300">{peringatan}</p>}

      {!run ? (
        <div className="card card-flat p-6 text-center">
          <p className="text-3xl" aria-hidden>
            📊
          </p>
          <p className="mt-2 font-semibold">Belum ada uji akurasi</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-zinc-400">
            Mulai dari menu <Link className="font-semibold text-orange-400 hover:underline" href={`${BASE}/uji`}>Jalankan uji</Link> → “Jalankan uji 50 video”. Angka
            muncul di sini setelah laptop selesai.
          </p>
        </div>
      ) : (
        <>
          <RunHeader run={run} admin={admin} />
          {adaMetrik(run.metrics) ? (
            <Isi m={run.metrics} run={run} contoh={contoh} />
          ) : (
            <div className="card card-flat p-5 text-sm text-zinc-400">
              {run.status === "proses"
                ? `Uji masih berjalan (${angka(run.done)} dari ${angka(run.sample_size)} video). Angka akurasi muncul setelah selesai.`
                : "Run ini belum punya angka ringkasan. Klik “Lanjutkan” di menu Jalankan uji supaya laptop menyelesaikannya."}
            </div>
          )}
          {pembanding && run && <BandingVersi lama={pembanding} baru={run} pasangan={pasangan} />}
        </>
      )}

      {runs.length > 0 && <TabelVersi runs={runs} aktif={run?.id ?? null} />}
      {pemakaian.length > 0 && <Pemakaian rows={pemakaian} />}
    </div>
  );
}

// ---------------------------------------------------------------- kepala run
function RunHeader({ run, admin }: { run: RunRingkas; admin: boolean }) {
  const sp = run.sample_params ?? {};
  const rentang = typeof sp.tanggal_awal === "string" && typeof sp.tanggal_akhir === "string" ? `${sp.tanggal_awal} s/d ${sp.tanggal_akhir}` : null;
  const tgl = new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
  return (
    <section className="card card-flat p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display break-words text-base font-bold">{run.label?.trim() || `Uji ${run.sample_size} video`}</h3>
            <span className={`badge ${statusCls(run.status)}`}>{RUN_STATUS_LABEL[run.status] ?? run.status}</span>
          </div>
          <p className="mt-1 break-words text-xs text-zinc-500">
            Rubrik <b className="text-zinc-300">{run.rubric_version ?? "?"}</b>
            {run.rubric_hash && <span className="font-mono"> #{run.rubric_hash.slice(0, 8)}</span>} · {run.model ?? "model ?"}
            {run.effort && ` (${run.effort})`} · {tgl.format(new Date(run.started_at || run.created_at))}
            {rentang && ` · keputusan ${rentang}`}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {angka(run.done)} dari {angka(run.sample_size)} video diproses · biaya {usd(Number(run.cost_usd))} ({rp(Number(run.cost_usd) * 18000)})
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {run.report_path ? (
            <>
              <a className="btn-primary px-3 py-2 text-xs" href={fileUrl(run.report_path)} target="_blank" rel="noopener noreferrer">
                📄 Buka laporan
              </a>
              <a className="btn-ghost px-3 py-2 text-xs" href={fileUrl(run.report_path, true)}>
                ⬇️ Unduh
              </a>
            </>
          ) : (
            <span className="text-xs text-zinc-500">{run.status === "proses" ? "Laporan dibuat setelah selesai" : "Laporan belum ada"}</span>
          )}
          {admin && run.status !== "proses" && <HapusRun runId={run.id} nama={run.label?.trim() || `uji ${run.sample_size} video`} />}
        </div>
      </div>
      {run.status === "proses" && run.sample_size > 0 && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-800" role="progressbar" aria-valuenow={run.done} aria-valuemax={run.sample_size}>
          <div className="h-full rounded-full bg-orange-500" style={{ width: `${Math.min(100, (run.done / run.sample_size) * 100)}%` }} />
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- isi metrik
function Isi({ m, run, contoh }: { m: MetrikLengkap; run: RunRingkas; contoh: ContohKasus[] }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        <AngkaBesar
          judul="Setuju dengan reviewer"
          p={m.setuju_reviewer}
          ket={`dari ${angka(m.setuju_reviewer.n)} video yang diputuskan AI sendiri`}
        />
        <AngkaBesar
          judul="Setuju dengan hasil akhir"
          p={m.setuju_akhir}
          ket="hasil akhir = keputusan reviewer, atau hasil banding kalau keputusan dibatalkan"
        />
        <AngkaBesar judul="Diserahkan ke manusia" nilai={m.persen_cek_manusia} ket={`AI ragu → “${SARAN_LABEL.cek_manusia}”`} netral />
        <AngkaBesar
          judul="Benar tanpa bantuan manusia"
          p={m.akurasi_tanpa_cek_manusia}
          ket={`dari ${angka(m.n_dinilai)} video yang bisa dinilai (yang diserahkan dihitung belum benar)`}
        />
      </div>

      <Hitungan m={m} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Matriks m={m} />
        <Serah m={m} />
      </div>

      <PerAlasan m={m} />

      <div className="grid gap-4 lg:grid-cols-2">
        <PerCampaign m={m} />
        <PerReviewer m={m} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Biaya m={m} />
        <Waktu m={m} />
      </div>

      <Contoh contoh={contoh} m={m} />
      <p className="text-xs text-zinc-500">
        Run {run.id.slice(0, 8)} · angka dihitung laptop dari {angka(m.n_diproses)} video. Video yang tidak bisa diakses dan alasan reject di luar video
        (followers, link bio, duplikat) tidak dihitung salah — AI memang tidak bisa melihatnya.
      </p>
    </>
  );
}

function AngkaBesar({ judul, p, nilai, ket, netral }: { judul: string; p?: PersenCi; nilai?: number | null; ket: string; netral?: boolean }) {
  const v = p ? nilaiPersen(p) : nilai ?? null;
  const ci = p ? ciTeks(p) : null;
  const warna = netral || v == null ? "text-zinc-100" : v >= 85 ? "text-emerald-400" : v >= 70 ? "text-amber-400" : "text-red-400";
  return (
    <div className="card card-flat min-w-0 p-3.5 sm:p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{judul}</p>
      <p className={`font-display mt-1 text-[28px] font-bold leading-none sm:text-[32px] ${warna}`}>{persenTeks(v)}</p>
      {p && p.n > 0 && (
        <p className="mt-1 text-xs text-zinc-400">
          {angka(p.benar)} dari {angka(p.n)}
          {ci && <span className="text-zinc-500"> · {ci}</span>}
        </p>
      )}
      <p className="mt-1.5 text-xs leading-snug text-zinc-500">{ket}</p>
    </div>
  );
}

function Hitungan({ m }: { m: MetrikLengkap }) {
  const items: [string, number | undefined][] = [
    ["Sampel", m.n_sampel],
    ["Diproses", m.n_diproses],
    ["Bisa dinilai", m.n_dinilai],
    ["Tidak bisa diakses", m.n_tidak_bisa_diakses],
    ["Gagal / berhenti", m.n_gagal],
    ["Alasan di luar video", m.n_di_luar_video],
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {items
        .filter(([, v]) => v != null)
        .map(([k, v]) => (
          <div key={k} className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2">
            <dt className="text-[11px] text-zinc-500">{k}</dt>
            <dd className="font-display text-lg font-bold">{angka(v)}</dd>
          </div>
        ))}
    </dl>
  );
}

function Kotak({ judul, sub, children }: { judul: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="card card-flat min-w-0 p-4 sm:p-5">
      <h3 className="font-display text-[15px] font-bold">{judul}</h3>
      {sub && <p className="mt-0.5 text-xs text-zinc-500">{sub}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** tabel geser sendiri di HP (halaman tidak ikut melebar) */
function Tabel({ children, label, lebar = 320 }: { children: React.ReactNode; label: string; lebar?: number }) {
  return (
    <>
      <div className="-mx-1 overflow-x-auto px-1" role="region" aria-label={label} tabIndex={0}>
        <table className="w-full text-left text-[13px]" style={{ minWidth: lebar }}>
          {children}
        </table>
      </div>
      {lebar > 360 && <p className="mt-1 text-[11px] text-zinc-500 sm:hidden">Geser tabel ke samping untuk kolom lain →</p>}
    </>
  );
}
const th = "border-b border-zinc-800 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500";
const td = "border-b border-zinc-800/70 px-2 py-1.5 align-top";

function Matriks({ m }: { m: MetrikLengkap }) {
  const g = (t: "approve" | "reject", s: Saran) => m.matriks?.[t]?.[s] ?? 0;
  const kalimat: { teks: string; n: number; bahaya?: boolean; benar?: boolean }[] = [
    { teks: "AI bilang approve, memang seharusnya approve", n: g("approve", "approve"), benar: true },
    { teks: "AI bilang reject, memang seharusnya reject", n: g("reject", "reject"), benar: true },
    { teks: "AI bilang approve padahal seharusnya reject", n: g("reject", "approve"), bahaya: true },
    { teks: "AI bilang reject padahal seharusnya approve", n: g("approve", "reject") },
    { teks: "AI menyerahkan ke manusia (seharusnya approve)", n: g("approve", "cek_manusia") },
    { teks: "AI menyerahkan ke manusia (seharusnya reject)", n: g("reject", "cek_manusia") },
  ];
  const sel = (t: "approve" | "reject", s: Saran) => {
    const n = g(t, s);
    const cls = s === "cek_manusia" ? "" : s === t ? "text-emerald-400" : t === "reject" && s === "approve" ? "font-bold text-red-400" : "text-amber-400";
    return <td className={`${td} text-right tabular-nums ${cls}`}>{angka(n)}</td>;
  };
  return (
    <Kotak judul="Tabel salah-benar" sub="Hanya video yang bisa dinilai. Baris = hasil akhir yang benar, kolom = saran AI.">
      <Tabel label="Tabel salah-benar">
        <thead>
          <tr>
            <th className={th}>Seharusnya</th>
            <th className={`${th} text-right`}>AI approve</th>
            <th className={`${th} text-right`}>AI reject</th>
            <th className={`${th} text-right`}>Ke manusia</th>
          </tr>
        </thead>
        <tbody>
          {(["approve", "reject"] as const).map((t) => (
            <tr key={t}>
              <th scope="row" className={`${td} font-semibold`}>
                {SARAN_LABEL[t]}
              </th>
              {sel(t, "approve")}
              {sel(t, "reject")}
              {sel(t, "cek_manusia")}
            </tr>
          ))}
        </tbody>
      </Tabel>
      <ul className="mt-3 space-y-1 text-[13px]">
        {kalimat.map((k) => (
          <li key={k.teks} className="flex items-start justify-between gap-3">
            <span className={k.bahaya ? "font-semibold text-red-400" : "text-zinc-300"}>
              <span aria-hidden>{k.benar ? "✅ " : k.bahaya ? "⛔ " : "• "}</span>
              {k.teks}
            </span>
            <b className="tabular-nums">{angka(k.n)}</b>
          </li>
        ))}
      </ul>
      {m.presisi_reject && nilaiPersen(m.presisi_reject) != null && (
        <p className="mt-2 text-xs text-zinc-500">
          Kalau AI bilang reject, {persenTeks(nilaiPersen(m.presisi_reject))} memang reject. Video yang seharusnya reject dan tertangkap AI:{" "}
          {persenTeks(nilaiPersen(m.recall_reject))}.
        </p>
      )}
    </Kotak>
  );
}

/** batang satu warna (satu seri → tanpa legenda; angka selalu tertulis) */
function Batang({ rows, satuan }: { rows: { label: string; v: number; teks: string }[]; satuan: string }) {
  const max = Math.max(1, ...rows.map((r) => r.v));
  return (
    <ul className="space-y-2" aria-label={satuan}>
      {rows.map((r) => (
        <li key={r.label} title={`${r.label}: ${r.teks}`}>
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 break-words text-zinc-300">{r.label}</span>
            <b className="shrink-0 tabular-nums">{r.teks}</b>
          </div>
          <div className="mt-1 h-2 rounded-full bg-zinc-800">
            <div className="h-2 rounded-full bg-orange-500" style={{ width: `${Math.max(2, (r.v / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Serah({ m }: { m: MetrikLengkap }) {
  const rows = Object.entries(m.serah ?? {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => ({ label: SERAH_LABEL[k as KodeSerah] ?? k, v: n, teks: `${angka(n)} video` }));
  return (
    <Kotak judul="Kenapa diserahkan ke manusia" sub={`${persenTeks(m.persen_cek_manusia)} video yang bisa dinilai. Satu video bisa punya lebih dari satu alasan.`}>
      {rows.length ? <Batang rows={rows} satuan="Alasan diserahkan ke manusia" /> : <p className="text-sm text-zinc-500">Tidak ada yang diserahkan.</p>}
      {m.banding && m.banding.n > 0 && (
        <p className="mt-3 rounded-xl bg-zinc-800/50 px-3 py-2 text-xs text-zinc-400">
          Banding: {angka(m.banding.n)} video, {angka(m.banding.dibatalkan)} keputusannya dibatalkan. Dari yang dibatalkan, saran AI sama dengan hasil banding{" "}
          {angka(m.banding.ai_benar_saat_dibatalkan)} kali.
        </p>
      )}
    </Kotak>
  );
}

function PerAlasan({ m }: { m: MetrikLengkap }) {
  const rows = [...(m.per_alasan ?? [])].sort((a, b) => b.n - a.n);
  if (!rows.length) return null;
  return (
    <Kotak judul="Per alasan reject" sub="Video yang di-reject reviewer, dikelompokkan menurut alasan resminya.">
      <Tabel label="Per alasan reject" lebar={480}>
        <thead>
          <tr>
            <th className={th}>Alasan reviewer</th>
            <th className={`${th} text-right`}>Video</th>
            <th className={`${th} text-right`}>AI reject</th>
            <th className={`${th} text-right`}>Alasan sama</th>
            <th className={`${th} text-right`}>AI approve</th>
            <th className={`${th} text-right`}>Ke manusia</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code + r.label}>
              <td className={td}>
                <span className="break-words">{r.label}</span>
                {r.di_luar_video && <span className="badge ml-1.5 bg-zinc-800 text-zinc-400 ring-zinc-700">di luar jangkauan AI</span>}
              </td>
              <td className={`${td} text-right tabular-nums`}>{angka(r.n)}</td>
              <td className={`${td} text-right tabular-nums`}>{angka(r.ai_reject)}</td>
              <td className={`${td} text-right tabular-nums`}>{angka(r.ai_reject_alasan_sama)}</td>
              <td className={`${td} text-right tabular-nums ${r.ai_approve && !r.di_luar_video ? "text-red-400" : ""}`}>{angka(r.ai_approve)}</td>
              <td className={`${td} text-right tabular-nums`}>{angka(r.ai_cek)}</td>
            </tr>
          ))}
        </tbody>
      </Tabel>
    </Kotak>
  );
}

function PerCampaign({ m }: { m: MetrikLengkap }) {
  const rows = [...(m.per_campaign ?? [])].sort((a, b) => b.n - a.n);
  if (!rows.length) return null;
  const baris = (r: (typeof rows)[number]) => (
    <tr key={r.campaign_id}>
      <td className={td}>
        <span className="line-clamp-2 break-words">{r.title || `Campaign ${r.campaign_id}`}</span>
      </td>
      <td className={`${td} text-right tabular-nums`}>{angka(r.n)}</td>
      <td className={`${td} text-right tabular-nums text-emerald-400`}>{angka(r.benar)}</td>
      <td className={`${td} text-right tabular-nums ${r.salah ? "text-red-400" : ""}`}>{angka(r.salah)}</td>
      <td className={`${td} text-right tabular-nums`}>{angka(r.cek)}</td>
      <td className={`${td} text-right font-semibold tabular-nums`}>{persenTeks(r.akurasi)}</td>
    </tr>
  );
  const kepala = (
    <thead>
      <tr>
        <th className={th}>Campaign</th>
        <th className={`${th} text-right`}>Video</th>
        <th className={`${th} text-right`}>Benar</th>
        <th className={`${th} text-right`}>Salah</th>
        <th className={`${th} text-right`}>Manusia</th>
        <th className={`${th} text-right`}>Akurasi</th>
      </tr>
    </thead>
  );
  return (
    <Kotak judul="Per campaign" sub="Akurasi = benar ÷ (benar + salah), tanpa yang diserahkan ke manusia.">
      <Tabel label="Per campaign" lebar={420}>
        {kepala}
        <tbody>{rows.slice(0, 10).map(baris)}</tbody>
      </Tabel>
      {rows.length > 10 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-semibold text-orange-400">Lihat {rows.length - 10} campaign lain</summary>
          <Tabel label="Campaign lain" lebar={420}>
            {kepala}
            <tbody>{rows.slice(10).map(baris)}</tbody>
          </Tabel>
        </details>
      )}
    </Kotak>
  );
}

function PerReviewer({ m }: { m: MetrikLengkap }) {
  const rows = [...(m.per_reviewer ?? [])].sort((a, b) => b.n - a.n);
  if (!rows.length) return null;
  return (
    <Kotak judul="Per reviewer" sub="Nama reviewer disamarkan (R-xxxxxx). Setuju = saran AI sama dengan keputusan reviewer itu.">
      <Tabel label="Per reviewer">
        <thead>
          <tr>
            <th className={th}>Reviewer</th>
            <th className={`${th} text-right`}>Video</th>
            <th className={`${th} text-right`}>Setuju</th>
            <th className={`${th} text-right`}>%</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 15).map((r) => (
            <tr key={r.reviewer}>
              <td className={`${td} font-mono text-xs`}>{r.reviewer}</td>
              <td className={`${td} text-right tabular-nums`}>{angka(r.n)}</td>
              <td className={`${td} text-right tabular-nums`}>{angka(r.setuju)}</td>
              <td className={`${td} text-right font-semibold tabular-nums`}>{persenTeks(r.persen)}</td>
            </tr>
          ))}
        </tbody>
      </Tabel>
      {rows.length > 15 && <p className="mt-2 text-xs text-zinc-500">+{rows.length - 15} reviewer lain (lihat laporan lengkap).</p>}
    </Kotak>
  );
}

function Biaya({ m }: { m: MetrikLengkap }) {
  const b = m.biaya;
  if (!b) return null;
  const vph = b.video_per_hari || 2000;
  const tok = b.token ?? { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  return (
    <Kotak judul="Biaya AI" sub={`Kurs Rp ${angka(b.kurs || 18000)} per US$. Perkiraan memakai ±${angka(vph)} video per hari.`}>
      <div className="grid grid-cols-3 gap-2">
        {[
          ["Per video", rp(b.per_video_idr)],
          ["Per hari", rp(b.per_hari_idr)],
          ["Per bulan", rp(b.per_bulan_idr)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-2.5 py-2">
            <p className="text-[11px] text-zinc-500">{k}</p>
            <p className="font-display text-base font-bold sm:text-lg">{v}</p>
          </div>
        ))}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
        <dt className="text-zinc-500">Total uji ini</dt>
        <dd className="text-right tabular-nums">
          {usd(b.total_usd)} ({rp(b.total_usd * (b.kurs || 18000))})
        </dd>
        <dt className="text-zinc-500">Per video (US$)</dt>
        <dd className="text-right tabular-nums">{usd(b.per_video_usd)}</dd>
        <dt className="text-zinc-500">Token masuk / keluar</dt>
        <dd className="text-right tabular-nums">
          {angka(tok.input)} / {angka(tok.output)}
        </dd>
        <dt className="text-zinc-500">Token dari cache</dt>
        <dd className="text-right tabular-nums">
          {angka(tok.cache_read)}
          {b.cache_hit_persen != null && ` (${persenTeks(b.cache_hit_persen)})`}
        </dd>
      </dl>
    </Kotak>
  );
}

function Waktu({ m }: { m: MetrikLengkap }) {
  const w = m.waktu;
  if (!w) return null;
  const tahap = Object.entries(w.per_tahap ?? {})
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ label: TAHAP_LABEL[k] ?? k, v, teks: detik(v) }));
  return (
    <Kotak judul="Waktu proses per video" sub="Di laptop (unduh, analisis gambar/suara, penilaian AI).">
      <div className="grid grid-cols-3 gap-2">
        {[
          ["Rata-rata", detik(w.rata_detik)],
          ["Tengah", detik(w.median_detik)],
          ["90% di bawah", detik(w.p90_detik)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-2.5 py-2">
            <p className="text-[11px] text-zinc-500">{k}</p>
            <p className="font-display text-base font-bold sm:text-lg">{v}</p>
          </div>
        ))}
      </div>
      {tahap.length > 0 && (
        <div className="mt-3">
          <Batang rows={tahap} satuan="Rata-rata waktu per tahap" />
        </div>
      )}
    </Kotak>
  );
}

function Contoh({ contoh, m }: { contoh: ContohKasus[]; m: MetrikLengkap }) {
  const salahIds = new Set(m.contoh?.salah ?? []);
  const kel = [
    { judul: "Contoh saran yang salah", ikon: "⛔", rows: contoh.filter((c) => salahIds.has(c.id)) },
    { judul: "Contoh saran yang benar", ikon: "✅", rows: contoh.filter((c) => !salahIds.has(c.id)) },
  ].filter((k) => k.rows.length);
  if (!kel.length) return null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {kel.map((k) => (
        <Kotak key={k.judul} judul={`${k.ikon} ${k.judul}`} sub="Klik untuk melihat checklist & bukti lengkap.">
          <ul className="space-y-2">
            {k.rows.map((c) => (
              <li key={c.id}>
                <Link href={`${BASE}/hasil/${c.id}`} className="block rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2 transition hover:border-zinc-600">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                    <b>Video #{c.video_id}</b>
                    <span className="min-w-0 truncate text-zinc-500" title={c.campaign_title ?? undefined}>
                      {c.campaign_title ?? "Campaign ?"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    AI: <b className="text-zinc-200">{c.suggestion ? SARAN_LABEL[c.suggestion] : "–"}</b>
                    {c.confidence != null && ` (${c.confidence})`} · hasil akhir: <b className="text-zinc-200">{c.final_truth ? SARAN_LABEL[c.final_truth] : "–"}</b>
                  </p>
                  {(c.specific_reason || c.official_reason) && <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{c.specific_reason || c.official_reason}</p>}
                </Link>
              </li>
            ))}
          </ul>
        </Kotak>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- banding versi rubrik
function BandingVersi({ lama, baru, pasangan }: { lama: RunRingkas; baru: RunRingkas; pasangan: Pasangan | null }) {
  if (!adaMetrik(lama.metrics) || !adaMetrik(baru.metrics))
    return (
      <Kotak judul="Banding dua run">
        <p className="text-sm text-zinc-500">Salah satu run belum punya angka ringkasan.</p>
      </Kotak>
    );
  const rows = bandingVersi(lama.metrics, baru.metrics);
  return (
    <Kotak
      judul="Banding rubrik"
      sub={`Lama: ${lama.rubric_version ?? "?"} (${namaRun(lama)}) → baru: ${baru.rubric_version ?? "?"} (${namaRun(baru)})`}
    >
      <Tabel label="Banding rubrik">
        <thead>
          <tr>
            <th className={th}>Angka</th>
            <th className={`${th} text-right`}>Lama</th>
            <th className={`${th} text-right`}>Baru</th>
            <th className={`${th} text-right`}>Selisih</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td className={td}>{r.label}</td>
              <td className={`${td} text-right tabular-nums`}>{persenTeks(r.lama)}</td>
              <td className={`${td} text-right tabular-nums`}>{persenTeks(r.baru)}</td>
              <td className={`${td} whitespace-nowrap text-right font-semibold tabular-nums ${r.membaik == null ? "text-zinc-500" : r.membaik ? "text-emerald-400" : "text-red-400"}`}>
                {/* panah = arah angka, warna = lebih baik (hijau) / lebih buruk (merah) */}
                {r.selisih == null ? "–" : `${r.selisih > 0 ? "▲ +" : r.selisih < 0 ? "▼ " : ""}${persenTeks(r.selisih).replace("%", "")} poin`}
              </td>
            </tr>
          ))}
        </tbody>
      </Tabel>
      {pasangan && pasangan.dibanding > 0 && (
        <p className="mt-3 text-[13px] text-zinc-400">
          Video yang sama di kedua run: <b className="text-zinc-200">{angka(pasangan.dibanding)}</b> · jadi benar{" "}
          <b className="text-emerald-400">{angka(pasangan.jadi_benar)}</b> · jadi salah <b className="text-red-400">{angka(pasangan.jadi_salah)}</b> · tetap benar{" "}
          {angka(pasangan.sama_benar)} · tetap salah {angka(pasangan.sama_salah)}
          {pasangan.lain > 0 && ` · lainnya (ke manusia) ${angka(pasangan.lain)}`}
        </p>
      )}
    </Kotak>
  );
}

function TabelVersi({ runs, aktif }: { runs: RunRingkas[]; aktif: string | null }) {
  return (
    <Kotak judul="Semua run per versi rubrik" sub="Ulangi uji setelah rubrik diperbaiki, lalu bandingkan di sini.">
      <Tabel label="Semua run" lebar={480}>
        <thead>
          <tr>
            <th className={th}>Rubrik</th>
            <th className={th}>Run</th>
            <th className={`${th} text-right`}>Video</th>
            <th className={`${th} text-right`}>Setuju akhir</th>
            <th className={`${th} text-right`}>Ke manusia</th>
            <th className={`${th} text-right`}>Rp/video</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const m = adaMetrik(r.metrics) ? r.metrics : null;
            return (
              <tr key={r.id} className={r.id === aktif ? "bg-orange-500/10" : ""}>
                <td className={`${td} whitespace-nowrap font-semibold`}>
                  {r.rubric_version ?? "?"}
                  {r.rubric_hash && <span className="ml-1 font-mono text-[11px] font-normal text-zinc-500">#{r.rubric_hash.slice(0, 6)}</span>}
                </td>
                <td className={td}>
                  <Link href={`${BASE}/ringkasan?run=${r.id}`} className="font-medium text-orange-400 hover:underline">
                    {r.label?.trim() || `uji ${r.sample_size} video`}
                  </Link>
                  <span className="block text-[11px] text-zinc-500">{RUN_STATUS_LABEL[r.status] ?? r.status}</span>
                </td>
                <td className={`${td} text-right tabular-nums`}>
                  {angka(r.done)}/{angka(r.sample_size)}
                </td>
                <td className={`${td} text-right tabular-nums`}>{persenTeks(m ? nilaiPersen(m.setuju_akhir) : null)}</td>
                <td className={`${td} text-right tabular-nums`}>{persenTeks(m?.persen_cek_manusia)}</td>
                <td className={`${td} text-right tabular-nums`}>{m?.biaya ? rp(m.biaya.per_video_idr) : "–"}</td>
              </tr>
            );
          })}
        </tbody>
      </Tabel>
    </Kotak>
  );
}

function Pemakaian({ rows }: { rows: PemakaianHarian[] }) {
  const total = rows.reduce((s, r) => s + Number(r.cost_usd || 0), 0);
  return (
    <Kotak judul="Pemakaian AI per hari (WIB)" sub={`${rows.length} hari terakhir · total ${usd(total)} (${rp(total * 18000)}). Batas harian diatur di laptop (REVIEW_DAILY_BUDGET_USD).`}>
      <Batang
        rows={rows.map((r) => ({
          label: new Intl.DateTimeFormat("id-ID", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${r.day}T00:00:00Z`)),
          v: Number(r.cost_usd || 0),
          teks: `${usd(Number(r.cost_usd || 0))} · ${angka(r.calls)} panggilan`,
        }))}
        satuan="Biaya AI per hari"
      />
    </Kotak>
  );
}
