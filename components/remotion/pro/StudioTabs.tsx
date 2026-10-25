"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import RemotionStudio, { StudioPro, VoiceBank } from "../StudioLazy";

type Tab = "pro" | "lama" | "suara";
const TABS: [Tab, string][] = [
  ["pro", "🎬 Studio Pro"],
  ["lama", "🧩 Template lama"],
  ["suara", "🎙️ Bank suara"],
];
const isTab = (v: string | null): v is Tab => v === "pro" || v === "lama" || v === "suara";

/**
 * Tab halaman Studio. Tiap tab baru dipasang saat pertama dibuka, lalu tetap terpasang saat pindah tab
 * (chat, editan "Ubah teks", form bank suara & render yang sedang jalan tidak hilang); pemutarnya berhenti saat ditinggal.
 */
export default function StudioTabs() {
  const [tab, setTab] = useState<Tab>("pro");
  const [seen, setSeen] = useState<ReadonlySet<Tab>>(() => new Set<Tab>(["pro"]));
  const btns = useRef<(HTMLButtonElement | null)[]>([]);

  const show = (t: Tab) => {
    setTab(t);
    setSeen((s) => (s.has(t) ? s : new Set(s).add(t)));
  };
  // ?tab=lama / ?tab=suara bisa dibagikan sebagai link
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (isTab(t)) show(t);
  }, []);
  const pick = (t: Tab) => {
    show(t);
    try {
      const u = new URL(window.location.href);
      if (t === "pro") u.searchParams.delete("tab");
      else u.searchParams.set("tab", t);
      window.history.replaceState(window.history.state, "", u);
    } catch {}
  };
  // panah kiri/kanan pindah tab (pola tablist)
  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const j = (i + d + TABS.length) % TABS.length;
    pick(TABS[j][0]);
    btns.current[j]?.focus();
  };

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Menu Studio"
        className="grid w-full grid-cols-3 rounded-full border border-zinc-800/80 bg-zinc-900 p-1 text-[11.5px] font-semibold sm:inline-grid sm:w-auto sm:text-[13px]"
        style={{ boxShadow: "var(--shadow-sm)" }}
      >
        {TABS.map(([k, label], i) => (
          <button
            key={k}
            ref={(el) => {
              btns.current[i] = el;
            }}
            id={`studio-tab-${k}`}
            type="button"
            role="tab"
            aria-selected={tab === k}
            aria-controls={`studio-panel-${k}`}
            tabIndex={tab === k ? 0 : -1}
            onClick={() => pick(k)}
            onKeyDown={(e) => onKey(e, i)}
            className={`whitespace-nowrap rounded-full px-1.5 py-1.5 transition sm:px-3.5 ${tab === k ? "text-white" : "text-zinc-400 hover:text-zinc-100"}`}
            style={tab === k ? { backgroundImage: "linear-gradient(180deg,#fb8a3c,#ea580c)", boxShadow: "var(--shadow-primary)" } : undefined}
          >
            {label}
          </button>
        ))}
      </div>

      <div id="studio-panel-pro" role="tabpanel" aria-labelledby="studio-tab-pro" hidden={tab !== "pro"}>
        <StudioPro active={tab === "pro"} />
      </div>
      {seen.has("lama") && (
        <div id="studio-panel-lama" role="tabpanel" aria-labelledby="studio-tab-lama" hidden={tab !== "lama"}>
          <RemotionStudio active={tab === "lama"} />
        </div>
      )}
      {seen.has("suara") && (
        <div id="studio-panel-suara" role="tabpanel" aria-labelledby="studio-tab-suara" hidden={tab !== "suara"}>
          <VoiceBank active={tab === "suara"} />
        </div>
      )}
    </div>
  );
}
