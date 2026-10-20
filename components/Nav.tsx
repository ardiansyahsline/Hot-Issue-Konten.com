"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { canWriteIssues } from "@/lib/roles";

export default function Nav({ role }: { role: string | null }) {
  const path = usePathname();
  const links = [
    { href: "/", label: "Dashboard", show: true },
    { href: "/issues/new", label: "+ Issue Baru", show: canWriteIssues(role) },
    { href: "/video-review", label: "Video Review", show: true },
    { href: "/catatan", label: "Catatan & Saran", show: true },
    { href: "/admin", label: "Admin", show: role === "admin" },
  ].filter((l) => l.show);

  return (
    <nav className="flex max-w-full gap-1 overflow-x-auto rounded-full border border-zinc-800/80 bg-zinc-900 p-1 [scrollbar-width:none]" style={{ boxShadow: "var(--shadow-sm)" }}>
      {links.map((l) => {
        const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
              active ? "bg-zinc-800 text-zinc-50" : "text-zinc-400 hover:text-zinc-100"
            }`}
            style={active ? { boxShadow: "var(--shadow-pop)" } : undefined}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
