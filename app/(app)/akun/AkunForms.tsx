"use client";

import { useActionState } from "react";
import { updateName, updatePassword, type AkunState } from "./actions";

function Msg({ s }: { s: AkunState }) {
  if (!s) return null;
  return <p className={`text-sm ${s.error ? "text-red-400" : "text-emerald-400"}`}>{s.error ?? s.ok}</p>;
}

export function NameForm({ name }: { name: string }) {
  const [s, action, pending] = useActionState<AkunState, FormData>(updateName, undefined);
  return (
    <form action={action} className="card space-y-3 p-5">
      <h2 className="font-semibold">Nama tampilan</h2>
      <input name="full_name" defaultValue={name} required className="input" />
      <Msg s={s} />
      <button disabled={pending} className="btn-primary">Simpan</button>
    </form>
  );
}

export function PasswordForm() {
  const [s, action, pending] = useActionState<AkunState, FormData>(updatePassword, undefined);
  return (
    <form action={action} className="card space-y-3 p-5">
      <h2 className="font-semibold">Ganti password</h2>
      <input name="password" type="password" placeholder="Password baru (min. 8)" minLength={8} required className="input" autoComplete="new-password" />
      <input name="confirm" type="password" placeholder="Ulangi password baru" minLength={8} required className="input" autoComplete="new-password" />
      <Msg s={s} />
      <button disabled={pending} className="btn-primary">Ganti password</button>
    </form>
  );
}
