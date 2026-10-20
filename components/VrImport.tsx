"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { parseCsv } from "@/lib/csv";
import { VR_STATUSES, sheetToReviews, type VrImportRow } from "@/lib/videoReview";
import { importReviews, type ImportResult } from "@/app/(app)/video-review/actions";
import { VrLinks, VrStatusBadge } from "./VrBits";

export default function VrImport() {
  const [rows, setRows] = useState<VrImportRow[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [parseErr, setParseErr] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult>(undefined);
  const [pending, start] = useTransition();

  async function onFile(f: File | undefined) {
    setResult(undefined);
    setParseErr(null);
    setRows(null);
    if (!f) return;
    setFileName(f.name);
    const text = await f.text();
    const { reviews, error } = sheetToReviews(parseCsv(text));
    if (error) setParseErr(error);
    else if (!reviews.length) setParseErr("Tidak ada kasus yang terbaca di file ini.");
    else setRows(reviews);
  }

  const counts = rows
    ? Object.keys(VR_STATUSES).map((k) => [k, rows.filter((r) => r.status === k).length] as const)
    : [];
  const noDate = rows?.filter((r) => !r.report_date).length ?? 0;

  return (
    <div className="space-y-5">
      <div className="card space-y-3 p-5 text-sm text-zinc-300">
        <h2 className="font-semibold text-zinc-100">Cara ambil file dari Google Sheet</h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Buka sheet <b>Video Review WA</b>, pastikan tab <b>Video Review</b> yang aktif.</li>
          <li>Klik <b>File → Download → Comma-separated values (.csv)</b>.</li>
          <li>Pilih file .csv itu di bawah, cek preview, lalu klik <b>Import</b>.</li>
        </ol>
        <p className="text-xs text-zinc-500">
          Baris lanjutan (yang cuma berisi link/email tambahan) otomatis digabung ke kasus di atasnya. Kolom rekap di kanan
          (Kategori, Jumlah Kasus, Rangkuman) diabaikan. Kategori per kasus dikosongkan dulu karena di sheet tidak ada per baris —
          isi lewat dropdown di daftar Video Review. Status dibaca dari teks kolom Penyelesaian (teks aslinya tetap disimpan).
          Import ulang file yang sama aman: kasus yang sudah ada dilewati.
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => onFile(e.target.files?.[0])}
          className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-800 file:px-3 file:py-2 file:text-zinc-200 hover:file:bg-zinc-700"
        />
        {parseErr && <p className="text-sm text-red-400">{parseErr}</p>}
      </div>

      {rows && (
        <div className="card space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-semibold">{rows.length} kasus terbaca dari {fileName}</div>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-zinc-400">
                {counts.map(([k, n]) => (
                  <span key={k}>
                    {VR_STATUSES[k as keyof typeof VR_STATUSES].label}: <b className="text-zinc-200">{n}</b>
                  </span>
                ))}
                <span>· Link/email: <b className="text-zinc-200">{rows.reduce((a, r) => a + r.links.length, 0)}</b></span>
                {noDate > 0 && <span className="text-amber-300">· {noDate} tanpa tanggal (pakai tanggal hari ini)</span>}
              </div>
            </div>
            <button
              disabled={pending || !!result?.ok}
              onClick={() => start(async () => setResult(await importReviews(JSON.stringify(rows))))}
              className="btn-primary"
            >
              {pending ? "Mengimport..." : `Import ${rows.length} kasus`}
            </button>
          </div>

          {result && (
            <p className={`text-sm ${result.error ? "text-red-400" : "text-emerald-400"}`}>
              {result.error ?? result.ok}{" "}
              {result.ok && <Link href="/video-review" className="underline">Lihat daftar →</Link>}
            </p>
          )}

          <div className="max-h-[60vh] overflow-auto rounded-lg border border-zinc-800">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-zinc-900 text-zinc-500">
                <tr>
                  <th className="p-2 font-medium">Baris</th>
                  <th className="p-2 font-medium">Tanggal</th>
                  <th className="p-2 font-medium">Penjelasan</th>
                  <th className="p-2 font-medium">Email/link</th>
                  <th className="p-2 font-medium">Penyelesaian</th>
                  <th className="p-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800 align-top">
                {rows.map((r) => (
                  <tr key={r.source_row}>
                    <td className="p-2 text-zinc-500">{r.source_row}</td>
                    <td className="whitespace-nowrap p-2">{r.report_date ?? "-"}</td>
                    <td className="p-2">{r.explanation}</td>
                    <td className="max-w-xs p-2"><VrLinks links={r.links} max={3} /></td>
                    <td className="p-2 text-zinc-400">{r.resolution ?? "-"}</td>
                    <td className="p-2"><VrStatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
