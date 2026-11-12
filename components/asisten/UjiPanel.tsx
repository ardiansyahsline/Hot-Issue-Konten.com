"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ETA_RE, JOB_STATUS_LABEL, rupiah } from "@/lib/asistenReview";
import { antrikanUji, batalkanJob, lanjutkanRun, ulangRun } from "@/app/(app)/asisten-review/uji/actions";
import { StatusLaptopView } from "./StatusLaptop";
import TempelVideo from "./TempelVideo";
import { RUN_STATUS_LABEL, latestWorker, teksHasilJob, workerOnline, type ArStatus, type JobLite, type RunLite } from "./statusTypes";
import { useArStatus } from "./useArStatus";

/** perkiraan kasar untuk tombol (angka nyata ada di Ringkasan sesudah uji) — KONTRAK §5.5: ±$0,0013/video, ±40 dtk/video */
const PER_VIDEO_USD = 0.0013;
const PER_VIDEO_DTK = 40;

const jamText = (dtk: number) => (dtk < 3600 ? `±${Math.max(1, Math.round(dtk / 60))} menit` : `±${(dtk / 3600).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jam`);
const waktu = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }).format(new Date(iso)) : "-";

/** pesan job → teks tanpa akhiran ETA + sisa detik (dihitung mundur dari updated_at) */
function eta(job: JobLite, tick: number): { text: string; left: number | null } {
  const msg = job.message ?? "";
  const m = ETA_RE.exec(msg);
  if (!m || job.status !== "proses") return { text: msg.replace(ETA_RE, "").trim(), left: null };
  const sec = Number(m[1]) * (m[2] === "mnt" ? 60 : 1);
  const since = Math.max(0, (tick - Date.parse(job.updated_at)) / 1000);
  return { text: msg.slice(0, m.index).trim(), left: Math.max(0, Math.round(sec - since)) };
}
const sisaText = (s: number) => (s <= 5 ? "hampir selesai" : s < 90 ? `sisa ±${Math.ceil(s / 5) * 5} dtk` : `sisa ±${Math.round(s / 60)} mnt`);

const STATUS_CLS: Record<string, string> = {
  antri: "bg-sky-500/10 text-sky-300 ring-sky-500/30",
  proses: "bg-violet-500/10 text-violet-300 ring-violet-500/30",
  selesai: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30",
  gagal: "bg-red-500/10 text-red-300 ring-red-500/30",
  batal: "bg-zinc-800 text-zinc-400 ring-zinc-700",
  berhenti_biaya: "bg-amber-500/10 text-amber-300 ring-amber-500/30",
};

export default function UjiPanel({ initial, admin }: { initial: ArStatus; admin: boolean }) {
  const { data, tick, refresh } = useArStatus(initial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [konfirm500, setKonfirm500] = useState(false);

  const online = workerOnline(latestWorker(data.workers), tick);
  const ujiAktif = data.jobs.find((j) => j.kind === "uji" && (j.status === "antri" || j.status === "proses")) ?? null;
  const aktif = data.jobs.filter((j) => j.status === "proses" || j.status === "antri");
  const runOf = new Map(data.runs.map((r) => [r.id, r]));

  const jalan = (fn: () => Promise<{ ok?: true; error?: string }>, okText: string) =>
    start(async () => {
      setMsg(null);
      let r: { ok?: true; error?: string };
      try {
        r = await fn();
      } catch {
        r = { error: "Gagal terhubung. Coba lagi." };
      }
      setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error ?? "Gagal." });
      refresh();
    });

  const ujiBtn = (n: 50 | 500) => (
    <button
      type="button"
      className={`${n === 50 ? "btn-primary" : "btn-ghost"} ${pending || ujiAktif ? "cursor-not-allowed opacity-50" : ""}`}
      aria-disabled={pending || !!ujiAktif || undefined}
      onClick={() => {
        if (pending || ujiAktif) return;
        if (n === 500 && !konfirm500) return setKonfirm500(true);
        setKonfirm500(false);
        jalan(() => antrikanUji(n), `Uji ${n} video diantrikan.${online ? "" : " Laptop mati — dikerjakan saat menyala."}`);
      }}
    >
      ▶️ Jalankan uji {n} video
    </button>
  );

  return (
    <div className="space-y-4 sm:space-y-5">
      <StatusLaptopView data={data} tick={tick} />

      <section className="card space-y-3 p-4 sm:p-5" aria-labelledby="uji-judul">
        <div>
          <h2 id="uji-judul" className="section-title">
            Uji akurasi
          </h2>
          <p className="mt-0.5 text-xs text-zinc-400">
            Laptop mengambil sampel keputusan lama dari database Konten.com (seimbang approve / reject, beberapa campaign &amp; reviewer), lalu AI menilai
            dan hasilnya dibandingkan dengan keputusan reviewer + hasil banding. Mulai dari 50 dulu; 500 untuk laporan resmi.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {ujiBtn(50)}
          {ujiBtn(500)}
        </div>
        <p className="text-[11px] text-zinc-500">
          Perkiraan: 50 video ≈ {rupiah(50 * PER_VIDEO_USD)} · {jamText(50 * PER_VIDEO_DTK)}; 500 video ≈ {rupiah(500 * PER_VIDEO_USD)} ·{" "}
          {jamText(500 * PER_VIDEO_DTK)}. Angka nyata muncul di Ringkasan.
        </p>
        {konfirm500 && !ujiAktif && (
          <div role="alertdialog" aria-label="Konfirmasi uji 500 video" className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
            <p>
              Uji 500 video makan waktu {jamText(500 * PER_VIDEO_DTK)} dan ±{rupiah(500 * PER_VIDEO_USD)}. Laptop berhenti sendiri kalau batas biaya harian
              tercapai (bisa dilanjutkan besok). Lanjut?
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={() => {
                  setKonfirm500(false);
                  jalan(() => antrikanUji(500), `Uji 500 video diantrikan.${online ? "" : " Laptop mati — dikerjakan saat menyala."}`);
                }}>
                Ya, jalankan 500
              </button>
              <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setKonfirm500(false)}>
                Batal
              </button>
            </div>
          </div>
        )}
        {ujiAktif && <p className="text-xs text-zinc-400">Tombol uji aktif lagi sesudah uji yang {ujiAktif.status === "antri" ? "menunggu" : "berjalan"} selesai / dibatalkan.</p>}
        {msg && (
          <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>
            {msg.text}
          </p>
        )}

        {aktif.length > 0 && (
          <ul className="space-y-2" aria-label="Pekerjaan berjalan">
            {aktif.map((j) => (
              <JobCard key={j.id} job={j} tick={tick} run={j.run_id ? runOf.get(j.run_id) : undefined} canCancel={j.mine || admin} pending={pending}
                onCancel={() => jalan(() => batalkanJob(j.id), "Pekerjaan dibatalkan.")} />
            ))}
          </ul>
        )}
      </section>

      <TempelVideo onQueued={refresh} hasil={data.hasil} jobs={data.jobs.filter((j) => j.kind === "video")} online={online} />

      <RunList runs={data.runs} pending={pending || !!ujiAktif} busy={!!ujiAktif}
        onLanjut={(id) => jalan(() => lanjutkanRun(id), "Run diantrikan untuk dilanjutkan.")}
        onUlang={(id) => jalan(() => ulangRun(id), "Ulang dengan rubrik terbaru diantrikan.")} />

      <JobHistory jobs={data.jobs.filter((j) => j.status !== "proses" && j.status !== "antri")} hasil={data.hasil} />
    </div>
  );
}

function JobCard({ job, tick, run, canCancel, pending, onCancel }: { job: JobLite; tick: number; run?: RunLite; canCancel: boolean; pending: boolean; onCancel: () => void }) {
  const e = eta(job, tick);
  const pct = Math.round(job.progress * 100);
  return (
    <li className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`badge ${STATUS_CLS[job.status]}`}>{JOB_STATUS_LABEL[job.status]}</span>
        <span className="min-w-0 flex-1 break-words text-sm font-semibold">{job.label}</span>
        {canCancel && (
          <button type="button" className="btn-danger px-2.5 py-1 text-xs" aria-disabled={pending || undefined} onClick={() => !pending && onCancel()}>
            Batalkan
          </button>
        )}
      </div>
      {job.status === "proses" && (
        <div className="mt-2">
          <div className="h-2 overflow-hidden rounded-full bg-zinc-800" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Progres">
            <div className="h-full rounded-full bg-violet-500 transition-[width] duration-500" style={{ width: `${Math.max(2, pct)}%` }} />
          </div>
          <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-zinc-400">
            <span>{pct}%</span>
            {job.total > 0 && (
              <span>
                {job.done} / {job.total} video
              </span>
            )}
            {e.left !== null && <span className="font-semibold text-violet-300">{sisaText(e.left)}</span>}
            {run && run.cost_usd > 0 && <span>biaya {rupiah(run.cost_usd)}</span>}
          </p>
        </div>
      )}
      {e.text && <p className="mt-1 break-words text-xs text-zinc-400">{e.text}</p>}
      {job.status === "antri" && <p className="mt-1 text-xs text-zinc-500">Diantrikan {waktu(job.created_at)} — menunggu laptop.</p>}
    </li>
  );
}

function RunList({ runs, pending, busy, onLanjut, onUlang }: { runs: RunLite[]; pending: boolean; busy: boolean; onLanjut: (id: string) => void; onUlang: (id: string) => void }) {
  if (!runs.length) return null;
  return (
    <section className="card p-4 sm:p-5" aria-labelledby="run-judul">
      <h2 id="run-judul" className="section-title">
        Uji terakhir
      </h2>
      <ul className="mt-3 divide-y divide-zinc-800 rounded-xl border border-zinc-800">
        {runs.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 p-3">
            <div className="min-w-0 flex-1 basis-56">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={`badge ${STATUS_CLS[r.status] ?? STATUS_CLS.batal}`}>{RUN_STATUS_LABEL[r.status] ?? r.status}</span>
                <span className="break-words text-sm font-semibold">{r.label || `Uji ${r.sample_size} video`}</span>
              </div>
              <p className="mt-0.5 text-xs text-zinc-400">
                {waktu(r.created_at)} · {r.done}/{r.sample_size} video · rubrik {r.rubric_version ?? "-"} · {rupiah(r.cost_usd)}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Link href={`/asisten-review/ringkasan?run=${r.id}`} className="btn-ghost px-2.5 py-1 text-xs">
                📊 Ringkasan
              </Link>
              <Link href={`/asisten-review?run=${r.id}`} className="btn-ghost px-2.5 py-1 text-xs">
                📋 Hasil
              </Link>
              {["berhenti_biaya", "gagal", "batal"].includes(r.status) && (
                <button type="button" className="btn-ghost px-2.5 py-1 text-xs" aria-disabled={pending || undefined} title={busy ? "Tunggu uji yang aktif selesai" : undefined} onClick={() => !pending && onLanjut(r.id)}>
                  ⏯️ Lanjutkan
                </button>
              )}
              {r.status !== "proses" && (
                <button type="button" className="btn-ghost px-2.5 py-1 text-xs" aria-disabled={pending || undefined} title="Sampel video yang sama, dinilai dengan rubrik terbaru" onClick={() => !pending && onUlang(r.id)}>
                  🔁 Ulangi (rubrik terbaru)
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function JobHistory({ jobs, hasil }: { jobs: JobLite[]; hasil: ArStatus["hasil"] }) {
  if (!jobs.length) return null;
  return (
    <section className="card p-4 sm:p-5" aria-labelledby="riwayat-judul">
      <h2 id="riwayat-judul" className="section-title">
        Pekerjaan terakhir
      </h2>
      <ul className="mt-3 space-y-1.5">
        {jobs.slice(0, 10).map((j) => {
          const h = hasil[j.id];
          return (
            <li key={j.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className={`badge ${STATUS_CLS[j.status]}`}>{JOB_STATUS_LABEL[j.status]}</span>
              <span className="font-semibold">{j.label}</span>
              <span className="text-zinc-500">{waktu(j.finished_at ?? j.created_at)}</span>
              {j.message && j.status !== "selesai" && <span className="min-w-0 basis-full break-words text-zinc-400 sm:basis-auto">{j.message.replace(ETA_RE, "")}</span>}
              {h && (
                <Link href={`/asisten-review/hasil/${h.id}`} className="font-semibold text-orange-400 hover:underline">
                  {teksHasilJob(h)} →
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
