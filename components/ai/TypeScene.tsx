"use client";

import { GROUPS, typeGroup, type Group } from "@/lib/aiPersona";
import HeroArt from "./HeroArt";

/** dekorasi bergerak per kelompok kepribadian: Analis = roda gigi & bohlam, Diplomat = hati & kilau, Penjaga = centang & perisai, Penjelajah = petir & roket */
function Deco({ g, c }: { g: Group; c: string }) {
  if (g === "NT")
    return (
      <>
        <g className="ts-spin" style={{ transformOrigin: "34px 38px" }}>
          <circle cx="34" cy="38" r="11" fill="none" stroke={c} strokeWidth="5" strokeDasharray="5 4" />
          <circle cx="34" cy="38" r="4" fill={c} />
        </g>
        <g className="ts-spin-rev" style={{ transformOrigin: "52px 26px" }}>
          <circle cx="52" cy="26" r="7" fill="none" stroke={c} strokeWidth="4" strokeDasharray="4 3" opacity=".7" />
        </g>
        <g className="ts-pulse" style={{ transformOrigin: "190px 34px" }}>
          <circle cx="190" cy="32" r="11" fill="#facc15" opacity=".9" />
          <rect x="185" y="42" width="10" height="7" rx="2" fill="#a1a1aa" />
          <path d="M190 22 v-6 M178 26 l-5 -4 M202 26 l5 -4" stroke="#facc15" strokeWidth="2.5" strokeLinecap="round" />
        </g>
      </>
    );
  if (g === "NF")
    return (
      <>
        {[
          [36, 60, 0],
          [196, 54, 0.8],
          [58, 30, 1.6],
          [176, 24, 2.3],
        ].map(([x, y, d], i) => (
          <path key={i} className="ts-float" style={{ animationDelay: `${d}s` }} d={`M${x} ${y} c-6 -8 -16 -2 -10 6 l10 9 l10 -9 c6 -8 -4 -14 -10 -6z`} fill={i % 2 ? "#f472b6" : c} opacity=".85" />
        ))}
        {[
          [30, 30],
          [204, 84],
        ].map(([x, y], i) => (
          <path key={i} className="ts-twinkle" style={{ animationDelay: `${i * 0.7}s`, transformOrigin: `${x}px ${y}px` }} d={`M${x} ${y - 7} l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2z`} fill="#fde68a" />
        ))}
      </>
    );
  if (g === "SJ")
    return (
      <>
        <g transform="translate(18 20)">
          <rect width="46" height="58" rx="6" fill="rgba(255,255,255,.9)" stroke={c} strokeWidth="2" />
          {[0, 1, 2].map((i) => (
            <g key={i} transform={`translate(8 ${12 + i * 15})`}>
              <rect width="9" height="9" rx="2" fill="none" stroke={c} strokeWidth="1.8" />
              <path className="ts-tick" style={{ animationDelay: `${i * 0.6}s` }} d="M1.5 4.5 l2.5 2.5 l4 -5" fill="none" stroke="#16a34a" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="12" />
              <rect x="13" y="3" width="18" height="3" rx="1.5" fill="#d4d4d8" />
            </g>
          ))}
        </g>
        <g className="ts-pulse" style={{ transformOrigin: "192px 40px" }}>
          <path d="M180 24 h24 v16 q0 14 -12 20 q-12 -6 -12 -20z" fill={c} />
          <path d="M186 40 l4 4 l8 -9" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
        </g>
      </>
    );
  return (
    <>
      <path className="ts-flash" d="M40 16 l-12 26 h11 l-7 22 l20 -30 h-11 l8 -18z" fill="#facc15" />
      <path className="ts-flash" style={{ animationDelay: ".5s" }} d="M200 50 l-8 17 h7 l-5 14 l13 -20 h-7 l5 -11z" fill="#fb923c" />
      <g className="ts-rocket">
        <path d="M178 40 q8 -22 22 -26 q-4 14 -26 22z" fill={c} />
        <circle cx="191" cy="25" r="3" fill="#fff" />
        <path d="M176 38 l-8 8 M180 42 l-6 10" stroke="#fb923c" strokeWidth="3" strokeLinecap="round" />
      </g>
      {[0, 1, 2].map((i) => (
        <rect key={i} className="ts-speed" style={{ animationDelay: `${i * 0.35}s` }} x="20" y={70 + i * 9} width="34" height="3" rx="1.5" fill={c} opacity=".5" />
      ))}
    </>
  );
}

/**
 * Adegan hasil tipe kepribadian: chibi bergerak (gaya gerak ikut tipe), dekorasi animasi per kelompok,
 * dan 4 huruf tipe yang muncul satu per satu.
 */
export default function TypeScene({ hero, type, headline }: { hero: string; type: string; headline?: string }) {
  const g = typeGroup(type);
  const G = GROUPS[g];
  return (
    <div className="ts-wrap relative overflow-hidden rounded-2xl" style={{ background: `radial-gradient(120% 90% at 50% 100%, ${G.soft}, transparent 70%)` }}>
      <svg viewBox="0 0 232 110" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden preserveAspectRatio="xMidYMid meet">
        <Deco g={g} c={G.color} />
      </svg>
      <div className="relative flex flex-col items-center pb-3 pt-4">
        <div className="ts-pop">
          <HeroArt hero={hero} size={128} talk title={`Karakter ${type}`} />
        </div>
        <div className="mt-1 flex gap-1.5">
          {type.split("").map((l, i) => (
            <span key={i} className="ts-letter flex h-9 w-9 items-center justify-center rounded-xl text-[18px] font-black text-white" style={{ background: G.color, animationDelay: `${0.25 + i * 0.18}s` }}>
              {l}
            </span>
          ))}
        </div>
        {headline && (
          <div className="ts-fade mt-2 max-w-[92%] rounded-full bg-zinc-900/80 px-3 py-1 text-center text-[12px] font-semibold text-zinc-100" style={{ animationDelay: "1s" }}>
            {G.icon} {headline}
          </div>
        )}
      </div>
    </div>
  );
}
