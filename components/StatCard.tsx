import Link from "next/link";

export type Tone = "amber" | "emerald" | "red" | "sky" | "violet" | "orange" | "indigo" | "zinc";

const ICONS: Record<string, React.ReactNode> = {
  flame: <path d="M12 3c1 3.5-3 5-3 9a3 3 0 0 0 6 0c0-1-.5-2-.5-2 2.5 1.5 4 4 4 6.5a6.5 6.5 0 0 1-13 0C5.5 10 12 8 12 3z" />,
  alert: (
    <>
      <path d="M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  inbox: (
    <>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  x: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m9 9 6 6M15 9l-6 6" />
    </>
  ),
  play: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m10 8.5 5 3.5-5 3.5z" />
    </>
  ),
  flag: <path d="M5 21V4m0 0h11l-2 4 2 4H5" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  sparkles: <path d="M12 3l1.8 4.7L18 9.5l-4.2 1.8L12 16l-1.8-4.7L6 9.5l4.2-1.8zM19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />,
};

// Warna tetap (tidak ikut dibalik di mode terang): [terang, utama]
const HEX: Record<Tone, [string, string]> = {
  amber: ["#fcd34d", "#f59e0b"],
  emerald: ["#6ee7b7", "#10b981"],
  red: ["#fca5a5", "#ef4444"],
  sky: ["#7dd3fc", "#0ea5e9"],
  violet: ["#c4b5fd", "#8b5cf6"],
  orange: ["#fdba74", "#f97316"],
  indigo: ["#a5b4fc", "#6366f1"],
  zinc: ["#d4d4d8", "#71717a"],
};

const alpha = (hex: string, a: number) => {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
};

/** Kartu angka gaya "D3": kartu bersih, garis warna penuh di kiri, ikon gradasi, cahaya warna lembut di bawah. */
export default function StatCard({
  label,
  value,
  unit,
  tone,
  icon,
  href,
  active,
  footer,
}: {
  label: string;
  value: number;
  unit?: string;
  tone: Tone;
  icon: keyof typeof ICONS;
  href?: string;
  active?: boolean;
  footer?: string;
}) {
  const [lt, md] = HEX[tone];
  const style: React.CSSProperties = {
    boxShadow: `var(--shadow-card), 0 22px 44px -22px ${alpha(md, 0.5)}${active ? `, 0 0 0 2px ${alpha(md, 0.55)}` : ""}`,
  };
  const body = (
    <>
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: `linear-gradient(180deg, ${lt}, ${md})` }} />
      <div className="flex items-start justify-between gap-3">
        <span className="pt-1.5 text-[13.5px] font-semibold text-zinc-100">{label}</span>
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white"
          style={{
            background: `linear-gradient(145deg, ${lt}, ${md})`,
            boxShadow: `0 6px 14px -6px ${alpha(md, 0.7)}, inset 0 1px 0 rgba(255,255,255,.35)`,
          }}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {ICONS[icon]}
          </svg>
        </span>
      </div>
      <div className="mt-4 flex items-baseline gap-1.5">
        <span className="font-display text-[34px] font-bold leading-none tabular-nums" style={{ color: `rgb(var(--c-${tone}-300))` }}>
          {value}
        </span>
        {unit && <span className="text-[14px] font-medium text-zinc-500">{unit}</span>}
      </div>
      {footer && <div className="mt-3 text-[12px] text-zinc-500">{footer}</div>}
    </>
  );
  const cls = "card relative block overflow-hidden py-5 pl-6 pr-5 transition duration-200 hover:-translate-y-0.5";
  return href ? (
    <Link href={href} className={cls} style={style}>
      {body}
    </Link>
  ) : (
    <div className={cls} style={style}>
      {body}
    </div>
  );
}
