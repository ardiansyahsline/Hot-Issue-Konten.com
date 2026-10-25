"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { VR_CATEGORIES, VR_STATUSES, ddmmyy } from "@/lib/videoReview";
import type { VideoReviewRow } from "@/lib/types";
import { updateReviewInline } from "@/app/(app)/video-review/actions";
import { VrLinks, VrNotes, VrStatusBadge } from "./VrBits";
import VrCategorySelect from "./VrCategorySelect";
import VrStatusSelect from "./VrStatusSelect";

const Empty = () => <span className="text-zinc-600">—</span>;

function EditRow({ r, onDone }: { r: VideoReviewRow; onDone: () => void }) {
  const [state, action, pending] = useActionState(updateReviewInline.bind(null, r.id), undefined);
  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);

  return (
    <tr>
      <td colSpan={99} className="p-2.5">
        <form action={action} className="rounded-2xl border-2 border-orange-400/70 bg-orange-500/5 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="text-[13px] font-semibold">Edit kasus #{r.id}</span>
            <div className="flex items-center gap-2">
              {state?.error && <span className="text-xs text-red-400">{state.error}</span>}
              <button type="button" onClick={onDone} className="btn-ghost px-3 py-1.5 text-xs">Batal</button>
              <button disabled={pending} className="btn-primary px-3 py-1.5 text-xs">{pending ? "Menyimpan…" : "Simpan"}</button>
            </div>
          </div>
          <div className="grid gap-2.5 md:grid-cols-[150px_1.4fr_1fr_160px]">
            <input name="report_date" type="date" required defaultValue={r.report_date} className="input" aria-label="Tanggal report" />
            <input name="explanation" required defaultValue={r.explanation} className="input" aria-label="Penjelasan" />
            <select name="category" defaultValue={r.category ?? ""} className="input" aria-label="Kategori">
              <option value="">Otomatis (dari penjelasan)</option>
              {VR_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select name="status" defaultValue={r.status} className="input" aria-label="Status">
              {Object.entries(VR_STATUSES).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
          <div className="mt-2.5 grid gap-2.5 md:grid-cols-4">
            <textarea name="links" rows={3} defaultValue={r.links.map((l) => l.value).join("\n")} placeholder="Email / link, satu per baris" className="input font-mono text-xs" aria-label="Email / link" />
            <textarea name="resolution" rows={3} defaultValue={r.resolution ?? ""} placeholder="Penyelesaian" className="input text-[13px]" aria-label="Penyelesaian" />
            <textarea name="notes" rows={3} defaultValue={r.notes ?? ""} placeholder="Catatan" className="input text-[13px] md:col-span-2" aria-label="Catatan" />
          </div>
        </form>
      </td>
    </tr>
  );
}

function Clamp({ text, className = "" }: { text: string | null; className?: string }) {
  if (!text) return <Empty />;
  return (
    <p className={`line-clamp-3 whitespace-pre-wrap ${className}`} title={text}>
      {text}
    </p>
  );
}

/**
 * compact = tabel "kasus terakhir" di tab Input: tanpa kolom Penjelasan (isinya sama dengan kategori),
 * kategori & status sejajar, plus nama penginput (data gabungan semua anggota).
 */
export default function VrTable({
  rows,
  canWrite,
  numberFrom,
  descending,
  compact = false,
}: {
  rows: VideoReviewRow[];
  canWrite: boolean;
  numberFrom: number;
  descending: boolean;
  compact?: boolean;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const no = (i: number) => (descending ? numberFrom - i : i + 1);

  return (
    <>
      {/* Desktop: semua kolom muat satu layar, tanpa geser ke samping */}
      <table className="hidden w-full table-fixed text-left text-[12.5px] md:table">
        {compact ? (
          <colgroup>
            <col style={{ width: 44 }} />
            <col style={{ width: 96 }} />
            <col style={{ width: "21%" }} />
            <col style={{ width: "20%" }} />
            <col style={{ width: "21%" }} />
            <col style={{ width: "30%" }} />
            <col style={{ width: 60 }} />
          </colgroup>
        ) : (
          <colgroup>
            <col style={{ width: 44 }} />
            <col style={{ width: 74 }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "18%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "27%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: 60 }} />
          </colgroup>
        )}
        <thead>
          <tr className="border-y border-zinc-800/80 bg-zinc-950/40 text-[10.5px] font-bold uppercase tracking-wider text-zinc-500">
            <th className="px-2.5 py-2.5 text-right">No</th>
            <th className="px-2.5 py-2.5">Tgl</th>
            {!compact && <th className="px-2.5 py-2.5">Penjelasan</th>}
            <th className="px-2.5 py-2.5">Email/link</th>
            <th className="px-2.5 py-2.5">Penyelesaian</th>
            <th className="px-2.5 py-2.5">Catatan</th>
            <th className="px-2.5 py-2.5">Kategori · Status</th>
            <th className="px-2.5 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/70">
          {rows.map((r, i) =>
            editing === r.id ? (
              <EditRow key={r.id} r={r} onDone={() => setEditing(null)} />
            ) : (
              <tr key={r.id} className="align-top transition-colors hover:bg-zinc-800/30">
                <td className="px-2.5 py-3 text-right tabular-nums text-zinc-500">
                  <Link href={`/video-review/${r.id}`} className="hover:text-orange-400" title={`Buka kasus #${r.id}`}>{no(i)}</Link>
                </td>
                <td className="whitespace-nowrap px-2.5 py-3 tabular-nums">
                  {ddmmyy(r.report_date)}
                  {compact && r.created_by_name && <span className="block truncate text-[11px] text-zinc-500" title={`Diinput ${r.created_by_name}`}>{r.created_by_name}</span>}
                </td>
                {!compact && (
                  <td className="px-2.5 py-3 font-semibold leading-snug">
                    <Link href={`/video-review/${r.id}`} className="hover:text-orange-400">{r.explanation}</Link>
                  </td>
                )}
                <td className="overflow-hidden px-2.5 py-3">{r.links.length ? <VrLinks links={r.links} max={3} /> : <Empty />}</td>
                <td className="px-2.5 py-3 leading-relaxed text-zinc-300"><Clamp text={r.resolution} /></td>
                <td className="px-2.5 py-3 leading-relaxed text-zinc-400"><VrNotes text={r.notes} clamp /></td>
                <td className={`px-2.5 py-3 ${compact ? "" : "space-y-1.5"}`}>
                  {/* compact: kategori & status sejajar dalam satu baris */}
                  <div className={compact ? "flex flex-wrap items-center gap-2" : "space-y-1.5"}>
                    {canWrite ? (
                      <>
                        <div className={compact ? "min-w-0 flex-1" : ""}>
                          <VrCategorySelect id={r.id} category={r.category} />
                        </div>
                        <div className="shrink-0">
                          <VrStatusSelect id={r.id} status={r.status} />
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="text-zinc-300">{r.category ?? "—"}</div>
                        <VrStatusBadge status={r.status} />
                      </>
                    )}
                  </div>
                </td>
                <td className="px-2 py-3 text-right">
                  {canWrite && (
                    <button
                      onClick={() => setEditing(r.id)}
                      className="rounded-lg border border-orange-500/30 bg-orange-500/10 px-2.5 py-1 text-[12px] font-semibold text-orange-400 transition hover:bg-orange-500/20"
                    >
                      Edit
                    </button>
                  )}
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>

      {/* HP: kartu bertumpuk */}
      <ul className="divide-y divide-zinc-800/70 md:hidden">
        {rows.map((r, i) => (
          <li key={r.id} className="space-y-2 p-4 text-[13px]">
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span>#{no(i)}</span>
              <span>{ddmmyy(r.report_date)}</span>
              <span className="ml-auto"><VrStatusBadge status={r.status} /></span>
            </div>
            {compact ? (
              <Link href={`/video-review/${r.id}`} className="block font-semibold">
                {r.category ?? r.explanation}
                {r.created_by_name && <span className="ml-1.5 text-xs font-normal text-zinc-500">· {r.created_by_name}</span>}
              </Link>
            ) : (
              <>
                <Link href={`/video-review/${r.id}`} className="block font-semibold">{r.explanation}</Link>
                <div className="text-xs text-zinc-400">{r.category ?? "—"}</div>
              </>
            )}
            {r.links.length > 0 && <VrLinks links={r.links} max={2} />}
            {r.resolution && <p className="text-zinc-300">{r.resolution}</p>}
            {r.notes && <div className="text-xs text-zinc-400"><VrNotes text={r.notes} clamp /></div>}
            {canWrite && (
              <Link href={`/video-review/${r.id}/edit`} className="inline-block text-xs font-semibold text-orange-400">Edit</Link>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
