"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { canWriteIssues } from "@/lib/roles";

export default function Nav({ role }: { role: string | null }) {
  const path = usePathname();
  const links = [
    { href: "/", label: "Dashboard", show: true },
    { href: "/issues/new", label: "+ Issue Baru", show: canWriteIssues(role) },
    { href: "/contacts", label: "Cek Kontak", show: true },
    { href: "/video-review", label: "Video Review", show: true },
    { href: "/admin", label: "Admin", show: role === "admin" },
  ].filter((l) => l.show);

  return (
    <nav className="flex flex-wrap gap-1">
      {links.map((l) => {
        const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              active ? "bg-zinc-800 text-white" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
