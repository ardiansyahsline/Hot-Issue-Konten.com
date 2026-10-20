"use client";

import { useActionState } from "react";
import Logo from "@/components/Logo";
import { signIn } from "./actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(signIn, undefined);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo size={52} />
          <h1 className="page-title mt-4">Hot Issues CS</h1>
          <p className="mt-1 text-sm text-zinc-400">Tools internal tim Customer Service Konten.com</p>
        </div>
        <form action={action} className="card space-y-4 p-6 sm:p-7">
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="email" required className="input" placeholder="nama@orovagroup.id" />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
          </div>
          {state?.error && (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{state.error}</p>
          )}
          <button type="submit" disabled={pending} className="btn-primary w-full py-3">
            {pending ? "Masuk..." : "Masuk"}
          </button>
        </form>
        <p className="mt-5 text-center text-xs text-zinc-500">Akun dibuat oleh admin CS. Lupa password? Hubungi admin.</p>
      </div>
    </main>
  );
}
