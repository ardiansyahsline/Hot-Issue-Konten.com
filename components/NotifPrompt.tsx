"use client";

import { useEffect, useState } from "react";
import { currentSubscription, pushSupported, subscribePush } from "@/lib/push.client";
import { savePushSubscription, type PushSub } from "@/lib/notifyActions";

const KEY = "cs-notif-prompt-dismissed";

/** Ajakan sekali untuk menyalakan notifikasi browser (bisa ditutup, muncul lagi setelah 7 hari) */
export default function NotifPrompt() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pushSupported() || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return;
    (async () => {
      if (Notification.permission === "granted") {
        // sudah diizinkan: pastikan perangkat ini terdaftar untuk akun yang sedang login
        const sub = await currentSubscription();
        if (sub && !sessionStorage.getItem("cs-push-synced")) {
          await savePushSubscription(sub.toJSON() as unknown as PushSub, navigator.userAgent);
          try { sessionStorage.setItem("cs-push-synced", "1"); } catch {}
        }
        return;
      }
      if (Notification.permission !== "default") return;
      let dismissed = 0;
      try { dismissed = Number(localStorage.getItem(KEY) || 0); } catch {}
      if (Date.now() - dismissed > 7 * 86400000) setShow(true);
    })();
  }, []);

  if (!show) return null;
  const close = () => {
    try { localStorage.setItem(KEY, String(Date.now())); } catch {}
    setShow(false);
  };

  return (
    <div className="card card-plain fixed bottom-6 left-4 z-40 w-[min(340px,calc(100vw-6rem))] p-4 sm:left-6" style={{ boxShadow: "var(--shadow-card), 0 20px 40px -18px rgba(0,0,0,.35)" }}>
      <div className="flex gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: "linear-gradient(150deg,#fbbf24,#f97316 45%,#dc2626)" }}>🔔</span>
        <div className="min-w-0">
          <div className="text-[14px] font-semibold">Aktifkan notifikasi?</div>
          <p className="mt-0.5 text-[12.5px] text-zinc-500">Dapat kabar Hot Issue baru & chat walau tab CS Tracker tertutup.</p>
          <div className="mt-3 flex gap-2">
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const sub = await subscribePush().catch(() => null);
                if (sub) await savePushSubscription(sub as unknown as PushSub, navigator.userAgent);
                setBusy(false);
                close();
              }}
              className="btn-primary px-3 py-1.5 text-xs"
            >
              {busy ? "…" : "Aktifkan"}
            </button>
            <button onClick={close} className="btn-ghost px-3 py-1.5 text-xs">Nanti</button>
          </div>
        </div>
      </div>
    </div>
  );
}
