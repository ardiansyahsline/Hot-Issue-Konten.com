"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// posisi awal (kanan-atas layar), lama siklus & jeda dibuat beda-beda supaya lewatnya acak
const M = [
  { l: 72, t: -4, dur: 7.5, delay: 0.4, len: 180 },
  { l: 104, t: 8, dur: 9, delay: 2.6, len: 150 },
  { l: 48, t: -6, dur: 11, delay: 5.1, len: 200 },
  { l: 92, t: 30, dur: 8.2, delay: 3.8, len: 140 },
  { l: 118, t: -2, dur: 10, delay: 6.9, len: 210 },
  { l: 62, t: 14, dur: 12.5, delay: 8.3, len: 160 },
  { l: 110, t: 46, dur: 9.6, delay: 1.5, len: 130 },
];

/** ☄️ meteor lewat cepat beberapa kali selama musik (AI / YouTube) menyala */
export default function Meteors({ on }: { on: boolean }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!on || !mounted) return null;
  return createPortal(
    <div className="meteors" aria-hidden>
      {M.map((m, i) => (
        <span key={i} className="meteor" style={{ left: `${m.l}%`, top: `${m.t}%`, ["--dur" as string]: `${m.dur}s`, ["--delay" as string]: `${m.delay}s`, ["--len" as string]: `${m.len}px` }} />
      ))}
    </div>,
    document.body,
  );
}
