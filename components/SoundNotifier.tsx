"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { currentSubscription, pushSupported } from "@/lib/push.client";
import { audio, normalizeSoundPrefs, notifySound, setSoundPrefs, type SoundKind } from "@/lib/sounds";
import { useClosedTabs } from "./TabAccessProvider";

const CACHE = "cs-sound-prefs";

/**
 * Pemutar bunyi notifikasi selama CS Tracker terbuka (tab aktif maupun di belakang):
 *  - notifikasi push dari service worker (Hot Issue, laporan, chat, mention)
 *  - pesan chat baru dari widget / halaman Chat (event "cs-sound")
 *  - perangkat tanpa push: cek Hot Issue & laporan baru tiap 30 detik
 * Tab ditutup admin (daftar terbaru dari TabAccessProvider): Chat -> bunyi chat/mention diam; Dashboard -> bunyi Hot Issue diam & tidak cek berkala.
 */
export default function SoundNotifier({ meId }: { meId: string }) {
  const closedKey = useClosedTabs().join(",");
  useEffect(() => {
    const chatOff = closedKey.split(",").includes("chat");
    const issueOff = closedKey.split(",").includes("dashboard");
    // true = dianggap sudah ditangani (pop-up sistem juga tanpa bunyi)
    const play = (kind: SoundKind) => ((kind === "issue" ? issueOff : chatOff) ? true : notifySound(kind));

    // 1) pengaturan: cache dulu (instan), lalu dari database
    try {
      const c = localStorage.getItem(CACHE);
      if (c) setSoundPrefs(normalizeSoundPrefs(JSON.parse(c)));
    } catch {}
    const supabase = createClient();
    supabase
      .from("notification_prefs")
      .select("*")
      .eq("user_id", meId)
      .maybeSingle()
      .then(({ data }) => {
        const p = normalizeSoundPrefs(data);
        setSoundPrefs(p);
        try {
          localStorage.setItem(CACHE, JSON.stringify(p));
        } catch {}
      });
    const onPrefs = (e: Event) => setSoundPrefs(normalizeSoundPrefs((e as CustomEvent).detail));

    // 2) browser baru mengizinkan bunyi setelah ada interaksi
    const unlock = () => audio()?.resume().catch(() => {});
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock);

    // 3) dari service worker: putar bunyi, lalu kabari supaya pop-up sistem tidak ikut berbunyi
    const onSw = (e: MessageEvent) => {
      if (e.data?.type !== "cs-sound") return;
      const played = play((e.data.kind as SoundKind) || "chat");
      e.ports?.[0]?.postMessage({ played });
    };
    const sw = pushSupported() ? navigator.serviceWorker : null;
    sw?.addEventListener("message", onSw);

    // 4) dari chat (widget / halaman Chat)
    const onLocal = (e: Event) => play(((e as CustomEvent).detail?.kind as SoundKind) || "chat");
    window.addEventListener("cs-sound", onLocal);
    window.addEventListener("cs-sound-prefs", onPrefs);

    // 5) perangkat tanpa push: cek Hot Issue / laporan baru berkala
    let timer: ReturnType<typeof setInterval> | null = null;
    let lastIssue = 0;
    let lastReport = 0;
    (async () => {
      const subscribed = pushSupported() ? !!(await currentSubscription().catch(() => null)) : false;
      if (subscribed || issueOff) return;
      const check = async (first = false) => {
        const [i, r] = await Promise.all([
          supabase.from("issues").select("id").neq("created_by", meId).order("id", { ascending: false }).limit(1).maybeSingle(),
          supabase.from("issue_reports").select("id").neq("created_by", meId).order("id", { ascending: false }).limit(1).maybeSingle(),
        ]);
        const ni = Number(i.data?.id ?? 0);
        const nr = Number(r.data?.id ?? 0);
        if (!first && (ni > lastIssue || nr > lastReport)) notifySound("issue");
        lastIssue = Math.max(lastIssue, ni);
        lastReport = Math.max(lastReport, nr);
      };
      await check(true);
      timer = setInterval(() => check().catch(() => {}), 30000);
    })();

    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      sw?.removeEventListener("message", onSw);
      window.removeEventListener("cs-sound", onLocal);
      window.removeEventListener("cs-sound-prefs", onPrefs);
      if (timer) clearInterval(timer);
    };
  }, [meId, closedKey]);
  return null;
}
