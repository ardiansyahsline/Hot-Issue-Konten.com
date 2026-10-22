"use client";

import { useEffect, useState, useTransition } from "react";
import { currentSubscription, pushSupported, subscribePush } from "@/lib/push.client";
import { removePushSubscription, savePushSubscription, saveNotifPrefs, sendTestPush, type NotifPrefs, type PushSub } from "@/lib/notifyActions";

const ROWS: [keyof NotifPrefs, string, string][] = [
  ["push_issue", "Hot Issue baru", "browser"],
  ["push_dm", "Chat pribadi", "browser"],
  ["push_room", "Chat room (semua-cs, dll.)", "browser"],
  ["push_mention", "Saat di-mention / pesanmu dibalas (tetap muncul walau chat room dimatikan)", "browser"],
  ["email_issue", "Hot Issue baru", "email"],
  ["email_dm", "Chat pribadi saat kamu offline (maks 1 email / 15 menit)", "email"],
  ["email_mention", "Di-mention / dibalas di room saat kamu offline (maks 1 email / 15 menit per room)", "email"],
];

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-orange-500" : "bg-zinc-700"}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

export default function NotificationSettings({ initial, email }: { initial: NotifPrefs; email: string }) {
  const [prefs, setPrefs] = useState(initial);
  const [device, setDevice] = useState<"unsupported" | "blocked" | "off" | "on" | "checking">("checking");
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const hasKey = !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    (async () => {
      if (!pushSupported() || !hasKey) return setDevice("unsupported");
      if (Notification.permission === "denied") return setDevice("blocked");
      setDevice((await currentSubscription()) ? "on" : "off");
    })();
  }, [hasKey]);

  const enable = () =>
    start(async () => {
      setMsg(null);
      try {
        const sub = await subscribePush();
        if (!sub) {
          setDevice(Notification.permission === "denied" ? "blocked" : "off");
          return setMsg({ error: "Izin notifikasi tidak diberikan di browser ini." });
        }
        const r = await savePushSubscription(sub as unknown as PushSub, navigator.userAgent);
        setMsg(r);
        if (r.ok) setDevice("on");
      } catch (e) {
        setMsg({ error: e instanceof Error ? e.message : "Gagal mengaktifkan" });
      }
    });

  const disable = () =>
    start(async () => {
      const sub = await currentSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setDevice("off");
      setMsg({ ok: "Notifikasi browser dimatikan di perangkat ini." });
    });

  const toggle = (k: keyof NotifPrefs, v: boolean) => {
    const next = { ...prefs, [k]: v };
    setPrefs(next);
    start(async () => setMsg(await saveNotifPrefs(next)));
  };

  return (
    <div className="card space-y-4 p-5">
      <div>
        <h2 className="font-semibold">Notifikasi</h2>
        <p className="text-[12.5px] text-zinc-500">Kabar Hot Issue baru & chat lewat pop-up browser (walau tab tertutup) dan email ke {email}.</p>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 px-3.5 py-3">
        <div className="min-w-0">
          <div className="text-[13.5px] font-semibold">Notifikasi browser di perangkat ini</div>
          <div className="text-[12px] text-zinc-500">
            {device === "on" && <span className="text-emerald-500">Aktif</span>}
            {device === "off" && "Belum aktif"}
            {device === "checking" && "Memeriksa…"}
            {device === "blocked" && <span className="text-amber-400">Diblokir — izinkan notifikasi untuk situs ini di pengaturan browser (ikon gembok di address bar).</span>}
            {device === "unsupported" &&
              (hasKey ? "Browser ini belum mendukung. Di iPhone: Share → Add to Home Screen, lalu buka dari ikon itu." : "Admin belum mengisi kunci push (VAPID) di Vercel.")}
          </div>
        </div>
        {device === "off" && (
          <button disabled={pending} onClick={enable} className="btn-primary shrink-0 px-3 py-1.5 text-xs">
            Aktifkan
          </button>
        )}
        {device === "on" && (
          <div className="flex shrink-0 gap-2">
            <button disabled={pending} onClick={() => start(async () => setMsg(await sendTestPush()))} className="btn-ghost px-3 py-1.5 text-xs">
              Kirim tes
            </button>
            <button disabled={pending} onClick={disable} className="btn-ghost px-3 py-1.5 text-xs">
              Matikan
            </button>
          </div>
        )}
      </div>

      {(["browser", "email"] as const).map((group) => (
        <div key={group}>
          <div className="label">{group === "browser" ? "Pop-up browser" : "Email"}</div>
          <ul className="divide-y divide-zinc-800/80 rounded-xl border border-zinc-800">
            {ROWS.filter((r) => r[2] === group).map(([k, label]) => (
              <li key={k} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-[13.5px]">
                <span>{label}</span>
                <Switch on={prefs[k]} onChange={(v) => toggle(k, v)} label={label} />
              </li>
            ))}
          </ul>
        </div>
      ))}
      {msg?.error && <p className="text-xs text-red-400">{msg.error}</p>}
      {msg?.ok && <p className="text-xs text-emerald-400">✓ {msg.ok}</p>}
    </div>
  );
}
