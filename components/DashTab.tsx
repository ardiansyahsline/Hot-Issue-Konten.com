"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type DashTabKey = "vr" | "agent";
const KEY = "cs-top-tab";
const Ctx = createContext<{ tab: DashTabKey; setTab: (t: DashTabKey) => void } | null>(null);

/**
 * Tab Video Review / Dari agent di Dashboard — dipakai bersama oleh Top 3 dan list ranking di bawahnya.
 * `only` = kunci ke satu tab (mis. tab Video Review ditutup admin untuk user ini -> selalu "agent").
 */
export function DashTabProvider({ children, only }: { children: React.ReactNode; only?: DashTabKey }) {
  const [picked, set] = useState<DashTabKey>(only ?? "vr");
  const tab = only ?? picked;
  useEffect(() => {
    try {
      if (localStorage.getItem(KEY) === "agent") set("agent");
    } catch {}
  }, []);
  const setTab = (t: DashTabKey) => {
    set(t);
    try {
      localStorage.setItem(KEY, t);
    } catch {}
  };
  return <Ctx.Provider value={{ tab, setTab }}>{children}</Ctx.Provider>;
}

export function useDashTab() {
  const c = useContext(Ctx);
  const [local, setLocal] = useState<DashTabKey>("vr");
  return c ?? { tab: local, setTab: setLocal };
}

/** Tampilkan isi hanya saat tab tertentu aktif */
export function TabOnly({ when, children }: { when: DashTabKey; children: React.ReactNode }) {
  const { tab } = useDashTab();
  return tab === when ? <>{children}</> : null;
}
