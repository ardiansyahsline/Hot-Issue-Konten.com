"use client";

import { GROUPS, personaOf, type Prop } from "@/lib/aiPersona";

/** senjata / benda yang dibawa hero (sesuai role) */
function PropArt({ p, c }: { p: Prop; c: string }) {
  switch (p) {
    case "sword":
      return (
        <g className="hero-arm-point">
          <rect x="86" y="62" width="5" height="26" rx="2" fill="#94a3b8" />
          <rect x="82" y="86" width="13" height="4" rx="2" fill={c} />
        </g>
      );
    case "dagger":
      return (
        <g className="hero-arm-point">
          <path d="M88 70 l4 -10 l4 10 v8 h-8z" fill="#cbd5e1" />
          <rect x="86" y="78" width="12" height="3" rx="1.5" fill={c} />
        </g>
      );
    case "bow":
      return (
        <g>
          <path d="M88 58 q14 18 0 36" fill="none" stroke="#a16207" strokeWidth="3" />
          <line x1="88" y1="58" x2="88" y2="94" stroke="#78716c" strokeWidth="1" />
        </g>
      );
    case "staff":
      return (
        <g>
          <rect x="88" y="50" width="4" height="50" rx="2" fill="#a16207" />
          <circle cx="90" cy="48" r="6" fill={c} className="hero-prop-spin" opacity=".85" />
        </g>
      );
    case "orb":
      return (
        <g>
          <circle cx="92" cy="78" r="8" fill={c} opacity=".85" className="hero-prop-spin" />
          <circle cx="89" cy="75" r="2.5" fill="#fff" opacity=".8" />
        </g>
      );
    case "shield":
      return (
        <g>
          <path d="M84 66 h16 v12 q0 10 -8 14 q-8 -4 -8 -14z" fill={c} />
          <path d="M92 70 v18" stroke="#fff" strokeWidth="2" opacity=".6" />
        </g>
      );
    case "gun":
      return (
        <g>
          <rect x="84" y="76" width="18" height="6" rx="2" fill="#334155" />
          <rect x="86" y="82" width="5" height="7" rx="1" fill="#334155" />
        </g>
      );
    case "spear":
      return (
        <g className="hero-arm-point">
          <rect x="88" y="40" width="3" height="56" fill="#a16207" />
          <path d="M89.5 32 l5 10 h-10z" fill="#94a3b8" />
        </g>
      );
    case "umbrella":
      return (
        <g>
          <path d="M76 56 q16 -14 32 0z" fill={c} />
          <rect x="91" y="56" width="2" height="30" fill="#78716c" />
        </g>
      );
    case "fist":
      return <circle cx="92" cy="80" r="6" fill="#fcd34d" />;
  }
}

function Hair({ h, hc }: { h: number; hc: string }) {
  switch (h % 10) {
    case 0:
      return <path d="M38 40 q22 -26 44 0 v-4 q-22 -20 -44 0z" fill={hc} />;
    case 1:
      return (
        <g fill={hc}>
          <path d="M36 44 q24 -34 48 0 q-6 -10 -24 -10 q-18 0 -24 10z" />
          <path d="M36 44 l-2 22 l6 -10z M84 44 l2 22 l-6 -10z" />
        </g>
      );
    case 2:
      return <path d="M38 42 q22 -30 44 0 l-6 -6 l-6 6 l-6 -8 l-6 8 l-6 -6 l-6 6z" fill={hc} />;
    case 3:
      return (
        <g>
          <path d="M38 40 q22 -28 44 0 q-10 -6 -22 -6 q-12 0 -22 6z" fill={hc} />
          <rect x="46" y="50" width="28" height="7" rx="3" fill="none" stroke="#111827" strokeWidth="1.6" />
        </g>
      );
    case 4:
      return (
        <g fill={hc}>
          <path d="M36 46 q24 -36 48 0 q-4 -16 -24 -16 q-12 0 -24 16z" />
          <path d="M80 40 q14 10 6 30 q-2 -18 -10 -22z" />
        </g>
      );
    case 5:
      return <path d="M34 48 q26 -40 52 0 v26 q-6 -14 -6 -26 q-20 -10 -40 0 q0 12 -6 26z" fill={hc} />;
    case 6:
      return (
        <g fill={hc}>
          <path d="M36 44 q24 -34 48 0 h-48z" />
          <circle cx="60" cy="16" r="7" />
        </g>
      );
    case 7:
      return (
        <g fill={hc}>
          <path d="M36 44 q24 -34 48 0 q-8 -8 -24 -8 q-16 0 -24 8z" />
          <circle cx="36" cy="50" r="7" />
          <circle cx="84" cy="50" r="7" />
        </g>
      );
    case 8:
      return (
        <g>
          <path d="M38 42 q22 -30 44 0 q-4 -12 -22 -12 q-18 0 -22 12z" fill={hc} />
          <path d="M52 18 l8 -10 l8 10" fill="#facc15" />
        </g>
      );
    default:
      return <path d="M40 40 q20 -22 40 0z" fill={hc} />;
  }
}

/**
 * Karakter chibi hero (SVG + animasi CSS). `talk` = mulut bergerak (lagi mengetik jawaban), `still` = tanpa animasi.
 * Desain sendiri: kepala bulat, badan kecil, warna baju = kelompok kepribadian, benda = role hero.
 */
export default function HeroArt({ hero, size = 96, talk = false, still = false, title }: { hero: string; size?: number; talk?: boolean; still?: boolean; title?: string }) {
  const p = personaOf(hero);
  const c = GROUPS[p.group].color;
  const arm = p.act === "wave" ? "hero-arm-wave" : p.act === "point" ? "hero-arm-point" : "";
  const flat = p.type[2] === "T" && p.type[3] === "J";
  if (p.img)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={p.img}
        alt={title ?? ""}
        width={size}
        height={size}
        className={`shrink-0 rounded-full object-cover hero-${p.anim} ${talk ? "hero-talk" : ""} ${still ? "hero-still" : ""}`}
        style={{ width: size, height: size, boxShadow: `0 0 0 2px ${c}` }}
        aria-hidden={title ? undefined : true}
      />
    );
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={`shrink-0 hero-${p.anim} ${talk ? "hero-talk" : ""} ${still ? "hero-still" : ""}`}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <rect x="46" y="96" width="9" height="16" rx="4" fill="#334155" />
      <rect x="65" y="96" width="9" height="16" rx="4" fill="#334155" />
      <path d="M40 104 q0 -34 20 -34 q20 0 20 34z" fill={c} />
      <path d="M52 72 l8 10 l8 -10" fill="#fff" opacity=".85" />
      <g className={arm}>
        <rect x="76" y="74" width="8" height="22" rx="4" fill={c} transform="rotate(-12 80 74)" />
        <circle cx="84" cy="96" r="4.5" fill={p.skin} />
      </g>
      <rect x="36" y="74" width="8" height="22" rx="4" fill={c} transform="rotate(12 40 74)" />
      <circle cx="36" cy="96" r="4.5" fill={p.skin} />
      <PropArt p={p.prop} c={c} />
      <circle cx="60" cy="48" r="24" fill={p.skin} />
      <Hair h={p.hair} hc={p.hc} />
      <g className="hero-eye">
        <ellipse cx="51" cy="52" rx="2.6" ry="3.4" fill="#111827" />
        <ellipse cx="69" cy="52" rx="2.6" ry="3.4" fill="#111827" />
      </g>
      <circle cx="46" cy="60" r="3.2" fill="#fb7185" opacity=".35" />
      <circle cx="74" cy="60" r="3.2" fill="#fb7185" opacity=".35" />
      <path className="hero-mouth" d={flat ? "M54 63 h12" : "M53 62 q7 6 14 0"} stroke="#7c2d12" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}
