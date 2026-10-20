import { getCurrentUser, getProfile } from "@/lib/auth";
import { NameForm, PasswordForm } from "./AkunForms";

export default async function AkunPage() {
  const [{ user }, profile] = await Promise.all([getCurrentUser(), getProfile()]);
  return (
    <div className="mx-auto max-w-md space-y-4">
      <div>
        <h1 className="page-title">Akun saya</h1>
        <p className="text-sm text-zinc-400">{user.email} · {profile?.role}</p>
      </div>
      <NameForm name={profile?.full_name ?? ""} />
      <PasswordForm />
    </div>
  );
}
