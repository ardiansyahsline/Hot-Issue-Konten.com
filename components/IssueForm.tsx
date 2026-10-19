"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { CATEGORIES, HOT_THRESHOLD, PRIORITIES, STATUSES } from "@/lib/constants";
import { CONTACT_TYPES, normalizeContact, type ContactType } from "@/lib/contacts";
import { createClient } from "@/lib/supabase/client";
import type { IssueRow, Profile } from "@/lib/types";
import type { FormState } from "@/app/(app)/issues/actions";

type Row = { key: number; type: ContactType; value: string };
type Lookup = { count: number; count30d: number; open: number; norm: string } | null;

export default function IssueForm({
  action,
  profiles,
  issue,
  defaultPicId,
  issueId,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  profiles: Pick<Profile, "id" | "full_name" | "email">[];
  issue?: IssueRow;
  defaultPicId?: string;
  issueId?: number;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [rows, setRows] = useState<Row[]>(
    issue?.contacts.length
      ? issue.contacts.map((c, i) => ({ key: i, type: c.type, value: c.value }))
      : [{ key: 0, type: "phone", value: "" }]
  );
  const [lookups, setLookups] = useState<Record<number, Lookup>>({});

  const update = (key: number, patch: Partial<Row>) => {
    setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));
    setLookups((l) => ({ ...l, [key]: null }));
  };

  async function check(row: Row) {
    const norm = normalizeContact(row.type, row.value);
    if (!norm) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("contact_stats")
      .select("issue_count, issue_count_30d, open_issue_count")
      .eq("type", row.type)
      .eq("normalized_value", norm)
      .maybeSingle();
    // Saat edit, kontak yang sudah tersimpan di issue ini ikut terhitung — kurangi 1
    const own = issue?.contacts.some((c) => c.type === row.type && c.normalized_value === norm) ? 1 : 0;
    const count = (data?.issue_count ?? 0) - own;
    setLookups((l) => ({
      ...l,
      [row.key]: count > 0
        ? { count, count30d: (data?.issue_count_30d ?? 0) - own, open: data?.open_issue_count ?? 0, norm }
        : null,
    }));
  }

  const contactsJson = JSON.stringify(rows.filter((r) => r.value.trim()).map(({ type, value }) => ({ type, value })));

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="contacts" value={contactsJson} />

      <div className="card space-y-4 p-5">
        <div>
          <label className="label" htmlFor="title">Judul issue *</label>
          <input
            id="title"
            name="title"
            required
            defaultValue={issue?.title}
            placeholder="Contoh: Withdraw pending > 3 hari, clipper komplain di WA & Discord"
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="description">Deskripsi / kronologi</label>
          <textarea
            id="description"
            name="description"
            rows={5}
            defaultValue={issue?.description ?? ""}
            placeholder="Apa yang terjadi, sejak kapan, sudah dijawab apa, butuh eskalasi ke siapa..."
            className="input"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="category">Kategori</label>
            <select id="category" name="category" defaultValue={issue?.category ?? CATEGORIES[0]} className="input">
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="status">Status</label>
            <select id="status" name="status" defaultValue={issue?.status ?? "open"} className="input">
              {Object.entries(STATUSES).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="priority">Prioritas</label>
            <select id="priority" name="priority" defaultValue={issue?.priority ?? "medium"} className="input">
              {Object.entries(PRIORITIES).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="campaign">Campaign / brand</label>
            <input id="campaign" name="campaign" defaultValue={issue?.campaign ?? ""} placeholder="Opsional" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="pic_id">PIC</label>
            <select id="pic_id" name="pic_id" defaultValue={issue ? issue.pic_id ?? "" : defaultPicId ?? ""} className="input">
              <option value="">— Belum ada —</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" name="is_hot" defaultChecked={issue?.is_hot} className="h-4 w-4 accent-red-500" />
            🔥 Tandai HOT manual
          </label>
        </div>
      </div>

      <div className="card space-y-3 p-5">
        <div>
          <h2 className="font-semibold">Kontak clipper</h2>
          <p className="text-xs text-zinc-500">
            Isi salah satu atau beberapa. Kalau kontak yang sama muncul di ≥{HOT_THRESHOLD} issue (30 hari), otomatis jadi HOT.
          </p>
        </div>
        {rows.map((row) => {
          const lk = lookups[row.key];
          return (
            <div key={row.key} className="space-y-1">
              <div className="flex gap-2">
                <select
                  value={row.type}
                  onChange={(e) => update(row.key, { type: e.target.value as ContactType })}
                  className="input w-40 shrink-0"
                  aria-label="Tipe kontak"
                >
                  {Object.entries(CONTACT_TYPES).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
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
              {lk && (
                <p className={`text-xs ${lk.count30d + 1 >= HOT_THRESHOLD ? "text-red-300" : "text-amber-300"}`}>
                  ⚠ Kontak ini sudah ada di {lk.count} issue lain ({lk.open} masih aktif).{" "}
                  <Link
                    href={`/contacts?type=${row.type}&q=${encodeURIComponent(lk.norm)}`}
                    target="_blank"
                    className="underline"
                  >
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
          className="btn-ghost text-xs"
        >
          + Tambah kontak
        </button>
      </div>

      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}

      <div className="flex justify-end gap-2">
        <Link href={issueId ? `/issues/${issueId}` : "/"} className="btn-ghost">Batal</Link>
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Menyimpan..." : issue ? "Simpan perubahan" : "Buat issue"}
        </button>
      </div>
    </form>
  );
}
