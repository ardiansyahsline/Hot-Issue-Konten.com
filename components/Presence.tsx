"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

/** Tanda "online": kabari server tiap 60 detik selama tab terbuka & terlihat */
export default function Presence() {
  useEffect(() => {
    const supabase = createClient();
    let last = 0;
    const ping = () => {
      if (document.hidden || Date.now() - last < 30000) return;
      last = Date.now();
      supabase.rpc("touch_presence").then(() => {});
    };
    ping();
    const t = setInterval(ping, 60000);
    const vis = () => ping();
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("focus", vis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("focus", vis);
    };
  }, []);
  return null;
}
