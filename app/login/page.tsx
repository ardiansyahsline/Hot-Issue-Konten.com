"use client";

import { useActionState } from "react";
import { signIn } from "./actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(signIn, undefined);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-3xl">🔥</div>
          <h1 className="mt-2 text-xl font-semibold">Hot Issues CS</h1>
          <p className="text-sm text-zinc-400">Konten.com — khusus tim CS</p>
        </div>
        <form action={action} className="card space-y-4 p-6">
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="email" required className="input" />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
          </div>
          {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
          <button type="submit" disabled={pending} className="btn-primary w-full">
            {pending ? "Masuk..." : "Masuk"}
          </button>
          <p className="text-center text-xs text-zinc-500">Belum punya akun? Minta ke admin CS.</p>
        </form>
      </div>
    </main>
  );
}
