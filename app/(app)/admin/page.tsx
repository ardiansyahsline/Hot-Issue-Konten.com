import { requireAdmin } from "@/lib/auth";
import type { Profile } from "@/lib/types";
import { fmtDate } from "@/lib/utils";
import { ROLES, isRole } from "@/lib/roles";
import { CreateUserForm, DeleteUserButton, ResetPasswordForm, RoleSelect } from "./AdminForms";

export default async function AdminPage() {
  const { supabase, user } = await requireAdmin();
  const { data } = await supabase.from("profiles").select("*").order("created_at");
  const profiles = (data ?? []) as Profile[];
  const hasServiceKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Admin — kelola akun</h1>

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
        <table className="w-full text-sm">
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
                  <td className="p-3">{p.full_name}{self && <span className="ml-1 text-xs text-zinc-500">(kamu)</span>}</td>
                  <td className="p-3 text-zinc-400">{p.email}</td>
                  <td className="p-3">
                    {self ? (
                      <span className="text-orange-400">{isRole(p.role) ? ROLES[p.role].label : p.role}</span>
                    ) : (
                      <RoleSelect userId={p.id} role={p.role} />
                    )}
                  </td>
                  <td className="p-3 text-zinc-400">{fmtDate(p.created_at)}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap items-center gap-2">
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
    </div>
  );
}
