import { requireAdmin } from "@/lib/auth";
import type { Profile } from "@/lib/types";
import { fmtDate } from "@/lib/utils";
import { ROLES, isRole } from "@/lib/roles";
import { STUDIO_MAX, studioErrorText } from "@/lib/studio/access.server";
import { CreateUserForm, DeleteUserButton, ResetPasswordForm, RoleSelect } from "./AdminForms";
import StudioAccess, { type StudioCandidate, type StudioLogItem, type StudioMember } from "./StudioAccess";
import TabAccess, { type TabUser } from "./TabAccess";
import { normalizeBlocked, normalizeGranted, tabErrorText } from "@/lib/tabs";

type AccessRow = { user_id: string; granted_by: string | null; granted_at: string };
type LogRow = { id: number; user_id: string | null; user_name: string | null; action: "grant" | "revoke"; by_id: string | null; by_name: string | null; at: string };

export default async function AdminPage() {
  const { supabase, user } = await requireAdmin();
  const [{ data }, acc, logs, tabRes] = await Promise.all([
    supabase.from("profiles").select("*").order("created_at"),
    supabase.from("studio_access").select("user_id, granted_by, granted_at").order("granted_at"),
    supabase.from("studio_access_log").select("id, user_id, user_name, action, by_id, by_name, at").order("at", { ascending: false }).limit(20),
    // kolom granted (tab khusus, migration-23) belum ada -> ambil blocked saja
    supabase
      .from("user_tab_blocks")
      .select("user_id, blocked, granted")
      .then(async (r) =>
        r.error && (r.error.code === "42703" || r.error.code === "PGRST204") && /granted/i.test(r.error.message ?? "")
          ? { ...(await supabase.from("user_tab_blocks").select("user_id, blocked")), noGranted: true }
          : { ...r, noGranted: false }
      ),
  ]);
  const profiles = (data ?? []) as Profile[];
  const hasServiceKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

  // Akses Studio: siapa saja yang boleh, kandidat (non-admin yang belum punya), dan log terakhir
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const nameOf = (id: string | null) => {
    const p = id ? byId.get(id) : undefined;
    return p?.full_name?.trim() || p?.email || "User dihapus";
  };
  const members: StudioMember[] = ((acc.data ?? []) as AccessRow[]).map((r) => ({
    id: r.user_id,
    name: nameOf(r.user_id),
    email: byId.get(r.user_id)?.email ?? null,
    since: fmtDate(r.granted_at),
    by: r.granted_by ? nameOf(r.granted_by) : null,
    admin: byId.get(r.user_id)?.role === "admin",
  }));
  const granted = new Set(members.map((m) => m.id));
  const candidates: StudioCandidate[] = profiles
    .filter((p) => p.role !== "admin" && !granted.has(p.id))
    .map((p) => ({ id: p.id, name: p.full_name?.trim() || p.email || "Tanpa nama", email: p.email }));
  const studioLog: StudioLogItem[] = ((logs.data ?? []) as LogRow[]).map((l) => ({
    id: l.id,
    action: l.action,
    user: l.user_name || nameOf(l.user_id),
    by: l.by_name || nameOf(l.by_id),
    at: fmtDate(l.at),
  }));
  const studioSetup = acc.error ? studioErrorText(acc.error, "Data akses Studio gagal dimuat. Coba muat ulang halaman.") : null;

  // Akses tab per user: tidak ada baris = semua tab boleh; admin selalu semua tab
  const tabRows = (tabRes.data ?? []) as { user_id: string; blocked: unknown; granted?: unknown }[];
  const tabBlocks = new Map(tabRows.map((r) => [r.user_id, normalizeBlocked(r.blocked)]));
  const tabGranted = new Map(tabRows.map((r) => [r.user_id, normalizeGranted(r.granted)]));
  const tabUsers: TabUser[] = profiles.map((p) => ({
    id: p.id,
    name: p.full_name?.trim() || p.email || "Tanpa nama",
    email: p.email,
    role: p.role,
    admin: p.role === "admin",
    self: p.id === user.id,
    blocked: p.role === "admin" ? [] : (tabBlocks.get(p.id) ?? []),
    granted: p.role === "admin" ? [] : (tabGranted.get(p.id) ?? []),
  }));
  // tab khusus (Asisten Review) butuh kolom granted dari migration-23
  const optInSetup = !tabRes.error && tabRes.noGranted ? "Jalankan supabase/migration-23-asisten-review.sql dulu untuk membuka tab khusus." : null;
  const tabSetup = tabRes.error ? tabErrorText(tabRes.error, "Data akses tab gagal dimuat. Coba muat ulang halaman.") : null;

  return (
    <div className="space-y-5">
      <h1 className="page-title">Admin — kelola akun</h1>

      {!hasServiceKey && (
        <div className="card border-amber-800 p-4 text-sm text-amber-300">
          SUPABASE_SERVICE_ROLE_KEY belum di-set di Vercel, jadi buat/hapus akun dari sini belum bisa.
          Tambahkan di Vercel → Settings → Environment Variables lalu redeploy.
        </div>
      )}

      <CreateUserForm />

      <div className="card p-4 text-xs text-zinc-400">
        <div className="mb-2 font-semibold text-zinc-300">Hak akses tiap role</div>
        <ul className="grid gap-1 sm:grid-cols-2">
          {Object.values(ROLES).map((r) => (
            <li key={r.label}>
              <span className={`font-medium ${r.cls}`}>{r.label}</span> — {r.desc}
            </li>
          ))}
        </ul>
      </div>

      <div className="card overflow-x-auto">
        <table className="m-stack m-kv w-full text-sm">
          <thead className="text-left text-xs text-zinc-500">
            <tr className="border-b border-zinc-800">
              <th className="p-3 font-medium">Nama</th>
              <th className="p-3 font-medium">Email</th>
              <th className="p-3 font-medium">Role</th>
              <th className="p-3 font-medium">Dibuat</th>
              <th className="p-3 font-medium">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {profiles.map((p) => {
              const self = p.id === user.id;
              return (
                <tr key={p.id}>
                  <td className="p-3 font-semibold sm:font-normal">{p.full_name}{self && <span className="ml-1 text-xs font-normal text-zinc-500">(kamu)</span>}</td>
                  <td data-label="Email" className="p-3 text-zinc-400"><span className="break-all">{p.email}</span></td>
                  <td data-label="Role" className="p-3">
                    {self ? (
                      <span className="text-orange-400">{isRole(p.role) ? ROLES[p.role].label : p.role}</span>
                    ) : (
                      <RoleSelect userId={p.id} role={p.role} />
                    )}
                  </td>
                  <td data-label="Dibuat" className="p-3 text-zinc-400"><span>{fmtDate(p.created_at)}</span></td>
                  <td data-label="Aksi" className="p-3">
                    <div className="flex flex-wrap items-center justify-end gap-2 sm:justify-start">
                      <ResetPasswordForm userId={p.id} />
                      {!self && <DeleteUserButton userId={p.id} email={p.email ?? ""} />}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <TabAccess users={tabUsers} setup={tabSetup} optInSetup={optInSetup} />

      <StudioAccess members={members} candidates={candidates} log={studioLog} max={STUDIO_MAX} setup={studioSetup} />
    </div>
  );
}
