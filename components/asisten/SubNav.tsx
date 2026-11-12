"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AR_BASE, AR_PAGES } from "@/lib/asistenReview";

/** sub-menu di dalam tab Asisten Review (Uji). HP: 4 tombol sejajar (ikon + label kecil), layar lebar: pil. */
export default function SubNav() {
  const path = usePathname() || AR_BASE;
  // "Hasil" juga aktif di halaman detail /asisten-review/hasil/<id>
  const active = (href: string) =>
    href === AR_BASE ? path === AR_BASE || path.startsWith(`${AR_BASE}/hasil`) : path === href || path.startsWith(`${href}/`);
  return (
    <nav aria-label="Menu Asisten Review" className="grid grid-cols-4 gap-1 rounded-2xl border border-zinc-800/80 bg-zinc-900 p-1 sm:inline-grid sm:auto-cols-max sm:grid-flow-col sm:grid-cols-none sm:rounded-full">
      {AR_PAGES.map((p) => {
        const on = active(p.href);
        return (
          <Link
            key={p.href}
            href={p.href}
            aria-current={on ? "page" : undefined}
            className={`flex min-w-0 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-[11px] font-semibold transition sm:flex-row sm:gap-1.5 sm:rounded-full sm:px-3.5 sm:text-sm sm:font-medium ${
              on ? "bg-zinc-800 text-zinc-50" : "text-zinc-400 hover:text-zinc-100"
            }`}
            style={on ? { boxShadow: "var(--shadow-pop)" } : undefined}
          >
            <span aria-hidden className="text-[15px] leading-none sm:text-sm">
              {p.icon}
            </span>
            <span className="w-full truncate text-center sm:w-auto">{p.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
