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

/** rambut belakang (digambar SEBELUM kepala) — memberi volume supaya tidak terlihat botak */
function HairBack({ h, hc }: { h: number; hc: string }) {
  switch (h % 10) {
    case 1:
      return <path d="M32 48 Q31 17 60 17 Q89 17 88 48 L90 84 Q80 90 74 80 L74 66 L46 66 L46 80 Q40 90 30 84Z" fill={hc} />;
    case 4:
      return (
        <g fill={hc}>
          <ellipse cx="60" cy="44" rx="28" ry="27" />
          <path className="hero-prop-spin" style={{ transformOrigin: "84px 40px" }} d="M82 34 Q104 36 98 70 Q94 58 84 52Z" />
        </g>
      );
    case 5:
      return <path d="M31 48 Q30 16 60 16 Q90 16 89 48 Q94 62 88 74 Q92 84 82 88 Q76 76 76 66 L44 66 Q44 76 38 88 Q28 84 32 74 Q26 62 31 48Z" fill={hc} />;
    case 7:
      return (
        <g fill={hc}>
          <ellipse cx="60" cy="44" rx="28" ry="27" />
          <path d="M33 46 Q18 52 22 80 Q30 70 36 60Z M87 46 Q102 52 98 80 Q90 70 84 60Z" />
        </g>
      );
    default:
      return <ellipse cx="60" cy="44" rx="28" ry="27" fill={hc} />;
  }
}

/** poni / rambut depan (digambar SESUDAH kepala, tidak menutup mata) */
function Hair({ h, hc }: { h: number; hc: string }) {
  const shine = <path d="M44 27 Q52 22 60 22" stroke="#fff" strokeOpacity=".28" strokeWidth="3" fill="none" strokeLinecap="round" />;
  switch (h % 10) {
    case 0:
      return (
        <g>
          <path d="M34 47 Q36 21 60 20 Q84 21 86 47 Q78 34 64 32 Q56 38 46 37 Q40 40 34 47Z" fill={hc} />
          {shine}
        </g>
      );
    case 1:
      return (
        <g>
          <path d="M33 50 Q34 19 60 19 Q86 19 87 50 Q80 35 62 31 L60 36 L58 31 Q40 35 33 50Z" fill={hc} />
          {shine}
        </g>
      );
    case 2:
      return (
        <g>
          <path d="M34 46 L36 30 L42 34 L44 20 L52 28 L58 14 L64 27 L72 17 L76 31 L84 28 L86 46 Q78 35 60 34 Q44 35 34 46Z" fill={hc} />
        </g>
      );
    case 3:
      return (
        <g>
          <path d="M33 54 Q32 19 60 19 Q88 19 87 54 Q84 40 76 38 Q66 34 60 40 Q54 34 44 38 Q36 40 33 54Z" fill={hc} />
          {shine}
          <rect x="45" y="47" width="12" height="9" rx="3.5" fill="none" stroke="#111827" strokeWidth="1.8" />
          <rect x="63" y="47" width="12" height="9" rx="3.5" fill="none" stroke="#111827" strokeWidth="1.8" />
          <path d="M57 51 h6" stroke="#111827" strokeWidth="1.8" />
        </g>
      );
    case 4:
      return (
        <g>
          <path d="M34 46 Q36 20 60 20 Q84 20 86 46 Q80 32 66 30 Q50 34 34 46Z" fill={hc} />
          <circle cx="84" cy="36" r="3.5" fill="#f472b6" />
          {shine}
        </g>
      );
    case 5:
      return (
        <g>
          <path d="M32 52 Q33 18 60 18 Q87 18 88 52 Q82 36 70 33 Q62 40 52 35 Q38 38 32 52Z" fill={hc} />
          {shine}
        </g>
      );
    case 6:
      return (
        <g fill={hc}>
          <circle cx="60" cy="15" r="9" />
          <path d="M34 46 Q36 21 60 21 Q84 21 86 46 Q76 33 60 33 Q44 33 34 46Z" />
          <path d="M53 18 Q60 22 67 18" stroke="#fff" strokeOpacity=".3" strokeWidth="2" fill="none" />
        </g>
      );
    case 7:
      return (
        <g>
          <path d="M34 47 Q36 20 60 20 Q84 20 86 47 Q80 34 70 33 L60 39 L50 33 Q40 34 34 47Z" fill={hc} />
          <circle cx="33" cy="47" r="4" fill="#facc15" />
          <circle cx="87" cy="47" r="4" fill="#facc15" />
        </g>
      );
    case 8:
      return (
        <g>
          <path d="M34 46 Q36 22 60 22 Q84 22 86 46 Q78 34 60 34 Q42 34 34 46Z" fill={hc} />
          <path d="M47 23 L50 11 L55 18 L60 8 L65 18 L70 11 L73 23Z" fill="#facc15" stroke="#ca8a04" strokeWidth="1" />
        </g>
      );
    default:
      return (
        <g>
          <path d="M34 48 Q34 20 60 20 Q86 20 86 48 Q84 30 70 28 Q60 36 44 34 Q38 40 34 48Z" fill={hc} />
          <path d="M70 28 Q78 24 80 32" stroke={hc} strokeWidth="5" fill="none" strokeLinecap="round" />
          {shine}
        </g>
      );
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
      <HairBack h={p.hair} hc={p.hc} />
      <circle cx="60" cy="48" r="24" fill={p.skin} />
      <ellipse cx="36" cy="52" rx="3" ry="4.5" fill={p.skin} />
      <ellipse cx="84" cy="52" rx="3" ry="4.5" fill={p.skin} />
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
