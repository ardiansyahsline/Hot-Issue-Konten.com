"use client";

import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import { parseCsv } from "@/lib/csv";
import { DEFAULT_SHEET_URL, VR_STATUSES, sheetToReviews, type VrImportRow } from "@/lib/videoReview";
import { importReviews, syncFromSheet, type ImportResult } from "@/app/(app)/video-review/actions";
import { VrLinks, VrStatusBadge } from "./VrBits";

function Result({ r }: { r: ImportResult }) {
  if (!r) return null;
  return (
    <p className={`text-sm ${r.error ? "text-red-400" : "text-emerald-400"}`}>
      {r.error ?? r.ok} {r.ok && <Link href="/video-review" className="underline">Lihat daftar →</Link>}
    </p>
  );
}

export default function VrImport() {
  const [syncState, syncAction, syncing] = useActionState(syncFromSheet, undefined);
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
    const { reviews, error } = sheetToReviews(parseCsv(await f.text()));
    if (error) setParseErr(error);
    else if (!reviews.length) setParseErr("Tidak ada kasus yang terbaca di file ini.");
    else setRows(reviews);
  }

  const counts = rows ? Object.keys(VR_STATUSES).map((k) => [k, rows.filter((r) => r.status === k).length] as const) : [];

  return (
    <div className="space-y-5">
      <form action={syncAction} className="card space-y-3 p-5">
        <h2 className="font-semibold">Cara 1 — Ambil langsung dari link Google Sheet</h2>
        <p className="text-sm text-zinc-400">
          Server membaca sheet langsung dari link. Kasus baru ditambahkan, kasus lama diperbarui kalau Penyelesaian / Insight /
          Argumen berubah di sheet, dan kategori diisi otomatis. Bisa diklik berkali-kali tanpa bikin data dobel.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input name="url" defaultValue={DEFAULT_SHEET_URL} className="input min-w-0 flex-1 font-mono text-xs" aria-label="Link Google Sheet" />
          <button disabled={syncing} className="btn-primary shrink-0">{syncing ? "Mengambil data..." : "Sync sekarang"}</button>
        </div>
        <p className="text-xs text-zinc-500">
          Syarat: di Google Sheet klik <b>Share → General access → Anyone with the link (Viewer)</b>. Kalau sheet harus tetap
          private, pakai Cara 2.
        </p>
        <Result r={syncState} />
      </form>

      <div className="card space-y-3 p-5 text-sm text-zinc-300">
        <h2 className="font-semibold text-zinc-100">Cara 2 — Upload file CSV</h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Buka sheet <b>Video Review WA</b>, tab <b>Video Review</b>.</li>
          <li>Klik <b>File → Download → Comma-separated values (.csv)</b>.</li>
          <li>Pilih file .csv itu di bawah, cek preview, lalu klik <b>Import</b>.</li>
        </ol>
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
          <Result r={result} />
          <div className="max-h-[60vh] overflow-auto rounded-lg border border-zinc-800">
            <table className="m-stack w-full text-left text-xs">
              <thead className="sticky top-0 bg-zinc-900 text-zinc-500">
                <tr>
                  <th className="p-2 font-medium">Baris</th>
                  <th className="p-2 font-medium">Tanggal</th>
                  <th className="p-2 font-medium">Penjelasan</th>
                  <th className="p-2 font-medium">Kategori (otomatis)</th>
                  <th className="p-2 font-medium">Email/link</th>
                  <th className="p-2 font-medium">Penyelesaian</th>
                  <th className="p-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800 align-top">
                {rows.map((r) => (
                  <tr key={r.source_row}>
                    <td className="p-2 text-zinc-500">Baris {r.source_row}</td>
                    <td data-label="Tanggal" className="whitespace-nowrap p-2">{r.report_date ?? "-"}</td>
                    <td data-label="Penjelasan" className="p-2">{r.explanation}</td>
                    <td data-label="Kategori (otomatis)" className="p-2 text-zinc-400">{r.category}</td>
                    <td data-label="Email/link" className="max-w-xs p-2"><VrLinks links={r.links} max={3} /></td>
                    <td data-label="Penyelesaian" className="p-2 text-zinc-400">{r.resolution ?? "-"}</td>
                    <td data-label="Status" className="p-2"><VrStatusBadge status={r.status} /></td>
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
