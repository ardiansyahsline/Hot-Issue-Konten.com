"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { CONTACT_TYPES, normalizeContact, type ContactType } from "@/lib/contacts";
import { createClient } from "@/lib/supabase/client";
import AttachmentPicker from "@/components/attach/AttachmentPicker";
import { EmojiInsertButton } from "@/components/emoji/EmojiPicker";
import type { ReportState } from "@/app/(app)/issues/reportActions";

type Row = { key: number; type: ContactType; value: string };
type Lookup = { count: number; open: number; norm: string; here: boolean } | null;

/** Tombol "+ Tambah laporan" + form laporan clipper (kontak, keterangan, bukti) */
export default function ReportForm({
  action,
  meId,
  issueId,
  next,
  topicKeys,
  startOpen = false,
}: {
  action: (prev: ReportState, fd: FormData) => Promise<ReportState>;
  meId: string;
  issueId: number;
  next: number;
  /** kontak yang sudah ada di topik ini ("type:normalized") */
  topicKeys: string[];
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const [state, formAction, pending] = useActionState(action, undefined);
  const [rows, setRows] = useState<Row[]>([{ key: 0, type: "phone", value: "" }]);
  const [lookups, setLookups] = useState<Record<number, Lookup>>({});
  const [flash, setFlash] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) {
      setRows([{ key: Date.now(), type: "phone", value: "" }]);
      setLookups({});
      setOpen(false);
      setFlash(state.ok);
      const t = setTimeout(() => setFlash(null), 6000);
      return () => clearTimeout(t);
    }
  }, [state]);

  const update = (key: number, patch: Partial<Row>) => {
    setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));
    setLookups((l) => ({ ...l, [key]: null }));
  };

  async function check(row: Row) {
    const norm = normalizeContact(row.type, row.value);
    if (!norm) return;
    const here = topicKeys.includes(`${row.type}:${norm}`);
    const { data } = await createClient()
      .from("contact_stats")
      .select("issue_count, open_issue_count")
      .eq("type", row.type)
      .eq("normalized_value", norm)
      .maybeSingle();
    const count = (data?.issue_count ?? 0) - (here ? 1 : 0);
    setLookups((l) => ({ ...l, [row.key]: here || count > 0 ? { count, open: data?.open_issue_count ?? 0, norm, here } : null }));
  }

  const contactsJson = JSON.stringify(rows.filter((r) => r.value.trim()).map(({ type, value }) => ({ type, value })));

  if (!open) {
    return (
      <div className="space-y-2">
        {flash && <p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-400">{flash}</p>}
        <button type="button" onClick={() => setOpen(true)} className="btn-primary">
          + Tambah laporan
        </button>
      </div>
    );
  }

  return (
    <form ref={formRef} action={formAction} className="space-y-3 rounded-2xl border border-orange-500/30 bg-orange-500/5 p-4">
      <input type="hidden" name="contacts" value={contactsJson} />
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-bold uppercase tracking-wider text-orange-400">Laporan baru (#{next})</div>
        <span className="text-[11.5px] text-zinc-500">Kasus yang sama dari clipper lain</span>
      </div>

      <div className="space-y-2">
        <div className="label">Kontak clipper</div>
        {rows.map((row) => {
          const lk = lookups[row.key];
          return (
            <div key={row.key} className="space-y-1">
              <div className="flex gap-2">
                <select
                  value={row.type}
                  onChange={(e) => update(row.key, { type: e.target.value as ContactType })}
                  className="input w-36 shrink-0"
                  aria-label="Tipe kontak"
                >
                  {Object.entries(CONTACT_TYPES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>
                <input
                  value={row.value}
                  onChange={(e) => update(row.key, { value: e.target.value })}
                  onBlur={() => check(row)}
                  placeholder={CONTACT_TYPES[row.type].placeholder}
                  className="input"
                  aria-label="Nilai kontak"
                />
                <button
                  type="button"
                  onClick={() => setRows((r) => (r.length > 1 ? r.filter((x) => x.key !== row.key) : [{ ...r[0], value: "" }]))}
                  className="btn-ghost px-3"
                  aria-label="Hapus kontak"
                >
                  ✕
                </button>
              </div>
              {lk?.here && <p className="text-xs text-amber-300">Kontak ini sudah tercatat di topik ini — laporannya tetap dihitung, kontaknya tidak dobel.</p>}
              {lk && !lk.here && lk.count > 0 && (
                <p className="text-xs text-amber-300">
                  ⚠ Kontak ini juga ada di {lk.count} issue lain ({lk.open} masih aktif).{" "}
                  <Link href={`/contacts?type=${row.type}&q=${encodeURIComponent(lk.norm)}`} target="_blank" className="underline">
                    Lihat
                  </Link>
                </p>
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => setRows((r) => [...r, { key: Math.max(...r.map((x) => x.key)) + 1, type: "instagram", value: "" }])}
          className="text-[12.5px] font-semibold text-orange-400 hover:underline"
        >
          + kontak lain
        </button>
      </div>

      <div>
        <label className="label" htmlFor={`note-${issueId}`}>
          Keterangan
        </label>
        <div className="relative">
          <textarea
            id={`note-${issueId}`}
            name="note"
            rows={3}
            maxLength={4000}
            placeholder="Apa kata clipper ini, di channel mana, ada bedanya dengan laporan lain?"
            className="input pr-12"
          />
          <span className="absolute bottom-2 right-2">
            <EmojiInsertButton field="note" className="h-8 w-8" />
          </span>
        </div>
      </div>

      <div>
        <div className="label">Bukti (screenshot / dokumen)</div>
        <AttachmentPicker userId={meId} compact clearOnReset />
      </div>

      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost">
          Batal
        </button>
        <button disabled={pending} className="btn-primary">
          {pending ? "Menyimpan…" : "Simpan laporan"}
        </button>
      </div>
    </form>
  );
}
