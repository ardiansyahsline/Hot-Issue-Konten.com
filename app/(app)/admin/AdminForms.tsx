"use client";

import { useActionState } from "react";
import { createUser, deleteUser, resetPassword, type AdminState } from "./actions";

export function CreateUserForm() {
  const [state, action, pending] = useActionState<AdminState, FormData>(createUser, undefined);
  return (
    <form action={action} className="card grid gap-3 p-5 sm:grid-cols-2">
      <h2 className="font-semibold sm:col-span-2">Buat akun agent</h2>
      <div>
        <label className="label" htmlFor="full_name">Nama</label>
        <input id="full_name" name="full_name" required className="input" />
      </div>
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required className="input" />
      </div>
      <div>
        <label className="label" htmlFor="password">Password awal (min. 8)</label>
        <input id="password" name="password" type="text" minLength={8} required className="input" />
      </div>
      <div>
        <label className="label" htmlFor="role">Role</label>
        <select id="role" name="role" className="input" defaultValue="agent">
          <option value="agent">Agent</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <div className="flex items-center justify-between gap-3 sm:col-span-2">
        <p className={`text-sm ${state?.error ? "text-red-400" : "text-emerald-400"}`}>{state?.error ?? state?.ok}</p>
        <button disabled={pending} className="btn-primary">{pending ? "Membuat..." : "Buat akun"}</button>
      </div>
    </form>
  );
}

export function ResetPasswordForm({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState<AdminState, FormData>(resetPassword.bind(null, userId), undefined);
  return (
    <form action={action} className="flex items-center gap-1">
      <input name="password" placeholder="Password baru" minLength={8} required className="input w-36 py-1 text-xs" />
      <button disabled={pending} className="btn-ghost px-2 py-1 text-xs">Ganti</button>
      {state && <span className={`text-xs ${state.error ? "text-red-400" : "text-emerald-400"}`}>{state.error ?? state.ok}</span>}
    </form>
  );
}

export function DeleteUserButton({ userId, email }: { userId: string; email: string }) {
  return (
    <form
      action={deleteUser.bind(null, userId)}
      onSubmit={(e) => {
        if (!confirm(`Hapus akun ${email}? Issue yang dia buat tetap ada.`)) e.preventDefault();
      }}
    >
      <button className="btn-danger px-2 py-1 text-xs">Hapus</button>
    </form>
  );
}
