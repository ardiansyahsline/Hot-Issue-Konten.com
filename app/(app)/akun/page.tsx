import { getCurrentUser, getProfile } from "@/lib/auth";
import { NameForm, PasswordForm } from "./AkunForms";
import AvatarForm from "./AvatarForm";
import NotificationSettings from "./NotificationSettings";
import SoundSettings from "./SoundSettings";
import { normalizeSoundPrefs } from "@/lib/sounds";
import { getTabAccess } from "@/lib/tabs.server";
import { TABS, TAB_IDS, firstOpenHome } from "@/lib/tabs";

export default async function AkunPage() {
  const [{ user, supabase }, profile, access] = await Promise.all([getCurrentUser(), getProfile(), getTabAccess()]);
  // halaman Akun selalu boleh dibuka; di sini user diberi tahu tab mana yang ditutup admin
  // tab khusus (optIn) yang belum dibuka bukan "ditutup" -> tidak disebut di sini
  const closedNames = TABS.filter((t) => !t.optIn && access.blocked.has(t.id)).map((t) => t.label);
  // semua tab ditutup / semua halaman ditutup tapi tombol 🎵 Musik masih boleh
  const allClosed = access.blocked.size === TAB_IDS.length;
  const pagesClosed = !allClosed && closedNames.length > 0 && !firstOpenHome(access.blocked);
  const { data: prefs } = await supabase.from("notification_prefs").select("*").eq("user_id", user.id).maybeSingle();
  const initial = {
    push_issue: prefs?.push_issue ?? true,
    push_dm: prefs?.push_dm ?? true,
    push_room: prefs?.push_room ?? true,
    email_issue: prefs?.email_issue ?? true,
    email_dm: prefs?.email_dm ?? true,
    push_mention: prefs?.push_mention ?? true,
    email_mention: prefs?.email_mention ?? true,
  };
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <h1 className="page-title">Akun saya</h1>
        <p className="text-sm text-zinc-400">{user.email} · {profile?.role}</p>
      </div>
      {closedNames.length > 0 && (
        <div role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-3 text-sm text-amber-200">
          {allClosed || pagesClosed ? (
            <>
              🔒 {allClosed ? "Semua tab ditutup admin untuk akunmu." : "Semua halaman ditutup admin untuk akunmu (tombol 🎵 Musik masih boleh)."} Kamu masih
              bisa mengatur akun di sini. Hubungi admin kalau perlu akses.
            </>
          ) : (
            <>🔒 Tab yang ditutup admin untuk akunmu: <b className="font-semibold">{closedNames.join(", ")}</b>. Hubungi admin kalau perlu akses.</>
          )}
        </div>
      )}
      <AvatarForm userId={user.id} name={profile?.full_name ?? user.email} url={profile?.avatar_url ?? null} />
      <NameForm name={profile?.full_name ?? ""} />
      <NotificationSettings initial={initial} email={user.email} />
      <SoundSettings initial={normalizeSoundPrefs(prefs)} />
      <PasswordForm />
    </div>
  );
}
