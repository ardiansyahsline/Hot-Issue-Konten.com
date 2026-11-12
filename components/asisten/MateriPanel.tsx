"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AR_BUCKET, type MateriKind, type ReviewCampaign, type ReviewMaterial } from "@/lib/asistenReview";
import { catatUploadMateri, cobaUnduhMateri, hapusMateri } from "@/app/(app)/asisten-review/materi/actions";
import {
  ACCEPT,
  JENIS_LABEL,
  JENIS_MATERI,
  MAKS_MB,
  STATUS_CAMPAIGN,
  STATUS_MATERI,
  cekFile,
  mimeFile,
  namaStorage,
  tebakJenis,
  ukuran,
} from "./materiAturan";

/**
 * Halaman Materi referensi: per campaign — status unduhan otomatis Google Drive, daftar file (lagu / poster / trailer),
 * upload manual langsung ke bucket privat (sesi user, RLS) lalu dicatat server action, hapus upload manual,
 * "Coba unduh lagi" (job materi untuk laptop). Perubahan dari laptop (status sidik jari) tampil sendiri lewat realtime.
 */

export type MateriItem = {
  campaign: Pick<ReviewCampaign, "campaign_id" | "title" | "brand" | "campaign_status" | "materi_status" | "materi_message" | "materi_checked_at"> & {
    /** false = campaign belum pernah diproses laptop (dibuka lewat ?c=) */
    dikenal: boolean;
  };
  materi: ReviewMaterial[];
  /** ada job "materi" antri / proses untuk campaign ini */
  jobAktif: boolean;
  /** jumlah poin brief yang butuh materi (wajib pakai materi) — info saja */
  poinMateri?: number;
};

const fileUrl = (p: string) => `/api/asisten-review/file?p=${encodeURIComponent(p)}`;
const tgl = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }).format(new Date(iso)) : null;

export default function MateriPanel({ items }: { items: MateriItem[] }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // status dari laptop (sidik jari / unduh Drive) → muat ulang data halaman (dijeda supaya tidak beruntun)
  useEffect(() => {
    let sb: ReturnType<typeof createClient> | null = null;
    let ch: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null;
    try {
      sb = createClient();
      const segar = () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => router.refresh(), 1200);
      };
      ch = sb
        .channel(`ar-materi-${Math.random().toString(36).slice(2, 9)}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "review_materials" }, segar)
        .on("postgres_changes", { event: "*", schema: "public", table: "review_jobs", filter: "kind=eq.materi" }, segar)
        .subscribe();
    } catch {
      /* realtime tidak tersedia → tombol muat ulang manual tetap ada */
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
      try {
        if (sb && ch) sb.removeChannel(ch);
      } catch {
        /* abaikan */
      }
    };
  }, [router]);

  return (
    <ul className="space-y-3">
      {items.map((it) => (
        <li key={it.campaign.campaign_id}>
          <MateriCampaign item={it} />
        </li>
      ))}
    </ul>
  );
}

function MateriCampaign({ item }: { item: MateriItem }) {
  const { campaign: c, materi, jobAktif } = item;
  const router = useRouter();
  const [pesan, setPesan] = useState<{ teks: string; ok: boolean } | null>(null);
  const [pending, start] = useTransition();
  const st = STATUS_CAMPAIGN[c.materi_status] ?? STATUS_CAMPAIGN.belum_dicek;
  const siap = materi.filter((m) => m.status === "siap");
  const hitung = (k: MateriKind) => siap.filter((m) => m.kind === k).length;

  const unduhLagi = () =>
    start(async () => {
      const r = await cobaUnduhMateri(c.campaign_id);
      setPesan(r.error ? { teks: r.error, ok: false } : { teks: r.pesan ?? "Masuk antrian.", ok: true });
      router.refresh();
    });

  return (
    <section className="card card-flat p-4 sm:p-5" aria-label={`Materi ${c.title ?? c.campaign_id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-display break-words text-[15px] font-bold">{c.title || `Campaign ${c.campaign_id}`}</h3>
          <p className="mt-0.5 break-words text-xs text-zinc-500">
            {c.brand && <span>{c.brand} · </span>}ID {c.campaign_id}
            {c.campaign_status && <span> · {c.campaign_status}</span>}
          </p>
        </div>
        <span className={`badge ${st.cls}`}>{jobAktif ? "Sedang dicoba di laptop…" : st.label}</span>
      </div>

      {!c.dikenal && (
        <p className="mt-2 text-xs text-amber-400">Campaign ini belum pernah diproses laptop. Materi yang diupload tetap dipakai saat videonya dicek.</p>
      )}
      {c.materi_message && <p className="mt-2 break-words text-[13px] text-zinc-400">{c.materi_message}</p>}
      <p className="mt-1 text-xs text-zinc-500">
        Siap: 🎵 {hitung("lagu")} lagu · 🖼️ {hitung("poster")} poster · 🎬 {hitung("trailer")} trailer
        {c.materi_checked_at && ` · dicek ${tgl(c.materi_checked_at)}`}
        {!!item.poinMateri && ` · ${item.poinMateri} poin brief wajib pakai materi`}
      </p>

      {materi.length > 0 && (
        <ul className="mt-3 divide-y divide-zinc-800 rounded-xl border border-zinc-800">
          {materi.map((m) => (
            <BarisMateri key={m.id} m={m} onPesan={setPesan} />
          ))}
        </ul>
      )}

      <Unggah campaignId={c.campaign_id} onPesan={setPesan} />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-ghost px-3 py-2 text-xs" onClick={unduhLagi} disabled={pending || jobAktif}>
          {jobAktif ? "⏳ Menunggu laptop" : pending ? "Mengantrikan…" : "🔄 Coba unduh lagi dari Google Drive"}
        </button>
        {pesan && (
          <span role={pesan.ok ? "status" : "alert"} className={`text-xs ${pesan.ok ? "text-emerald-400" : "text-red-400"}`}>
            {pesan.teks}
          </span>
        )}
      </div>
    </section>
  );
}

function BarisMateri({ m, onPesan }: { m: ReviewMaterial; onPesan: (p: { teks: string; ok: boolean }) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const j = JENIS_LABEL[m.kind] ?? JENIS_LABEL.lainnya;
  const s = STATUS_MATERI[m.status] ?? STATUS_MATERI.antri_sidik;
  const hapus = () => {
    if (!window.confirm(`Hapus "${m.file_name ?? "file ini"}"?`)) return;
    start(async () => {
      const r = await hapusMateri(m.id);
      onPesan(r.error ? { teks: r.error, ok: false } : { teks: "File dihapus.", ok: true });
      router.refresh();
    });
  };
  return (
    <li className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 ${pending ? "opacity-50" : ""}`}>
      <span className="text-lg" aria-hidden>
        {j.ikon}
      </span>
      <div className="min-w-0 flex-1 basis-40">
        <p className="truncate text-[13px] font-medium" title={m.file_name ?? undefined}>
          {m.file_name || m.storage_path.split("/").pop()}
        </p>
        <p className="text-[11px] text-zinc-500">
          {j.label} · {m.source === "gdrive" ? "otomatis (Google Drive)" : "upload manual"}
          {m.size_bytes ? ` · ${ukuran(m.size_bytes)}` : ""}
          {m.duration_sec ? ` · ${Math.round(m.duration_sec)} dtk` : ""}
        </p>
        {m.message && <p className="break-words text-[11px] text-amber-400">{m.message}</p>}
      </div>
      <span className={`badge ${s.cls}`}>{s.label}</span>
      <span className="flex gap-1.5">
        <a className="btn-ghost px-2.5 py-1.5 text-xs" href={fileUrl(m.storage_path)} target="_blank" rel="noopener noreferrer">
          Buka
        </a>
        {m.source === "manual" && (
          <button type="button" className="btn-danger px-2.5 py-1.5 text-xs" onClick={hapus} disabled={pending} aria-label={`Hapus ${m.file_name ?? "file"}`}>
            Hapus
          </button>
        )}
      </span>
    </li>
  );
}

function Unggah({ campaignId, onPesan }: { campaignId: string; onPesan: (p: { teks: string; ok: boolean }) => void }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<MateriKind>("lagu");
  const [sibuk, setSibuk] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const id = `up-${campaignId}`;

  const pilih = (f: File | null) => {
    setFile(f);
    setErr(null);
    if (f) {
      const k = tebakJenis(mimeFile(f.name, f.type));
      setKind(k);
      setErr(cekFile(f, k));
    }
  };

  const kirim = async () => {
    if (!file) return;
    const salah = cekFile(file, kind);
    if (salah) return setErr(salah);
    setSibuk(true);
    setErr(null);
    const mime = mimeFile(file.name, file.type);
    const path = `materi/${campaignId}/manual/${namaStorage(file.name, Date.now(), mime)}`;
    try {
      const sb = createClient();
      const { error } = await sb.storage.from(AR_BUCKET).upload(path, file, { contentType: mime, upsert: false, cacheControl: "3600" });
      if (error) {
        const m = error.message ?? "";
        setErr(
          /row-level security|unauthorized|403/i.test(m)
            ? "Akunmu belum diberi akses Asisten Review."
            : /bucket not found/i.test(m)
              ? "Penyimpanan belum siap. Jalankan migration-23 dulu."
              : /exceed|too large|413/i.test(m)
                ? `File terlalu besar (maks ${MAKS_MB} MB).`
                : /mime|type/i.test(m)
                  ? "Tipe file tidak diizinkan."
                  : "Upload gagal. Cek koneksi lalu coba lagi."
        );
        return;
      }
      const r = await catatUploadMateri({ campaign_id: campaignId, kind, storage_path: path, file_name: file.name, mime, size_bytes: file.size });
      if (r.error) {
        setErr(r.error);
        return;
      }
      onPesan({ teks: r.pesan ?? "Tersimpan.", ok: true });
      setFile(null);
      if (input.current) input.current.value = "";
      router.refresh();
    } catch {
      setErr("Upload gagal. Cek koneksi lalu coba lagi.");
    } finally {
      setSibuk(false);
    }
  };

  return (
    <details className="group mt-3 rounded-xl border border-dashed border-zinc-700 px-3 py-2.5">
      <summary className="cursor-pointer select-none text-[13px] font-semibold text-orange-400">＋ Upload manual (lagu / poster / potongan trailer)</summary>
      <div className="mt-3 grid gap-2.5 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <label className="min-w-0" htmlFor={id}>
          <span className="label">File (maks {MAKS_MB} MB)</span>
          <input
            id={id}
            ref={input}
            type="file"
            accept={ACCEPT}
            className="block w-full min-w-0 text-[13px] text-zinc-400 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-800 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-zinc-200"
            onChange={(e) => pilih(e.target.files?.[0] ?? null)}
            disabled={sibuk}
          />
        </label>
        <label className="min-w-0">
          <span className="label">Jenis</span>
          <select
            className="input py-2"
            value={kind}
            onChange={(e) => {
              const k = e.target.value as MateriKind;
              setKind(k);
              setErr(file ? cekFile(file, k) : null);
            }}
            disabled={sibuk}
          >
            {JENIS_MATERI.map((j) => (
              <option key={j.id} value={j.id}>
                {j.ikon} {j.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn-primary px-4 py-2" onClick={kirim} disabled={!file || sibuk || !!err}>
          {sibuk ? "Mengunggah…" : "Upload"}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-zinc-500">
        {JENIS_LABEL[kind].ket}. Lagu cukup potongan 30–60 detik bagian yang dipakai. File disimpan privat, hanya untuk mencocokkan video.
      </p>
      {err && (
        <p role="alert" className="mt-1.5 text-xs text-red-400">
          {err}
        </p>
      )}
    </details>
  );
}
