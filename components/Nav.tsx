"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/issues/new", label: "+ Issue Baru" },
  { href: "/contacts", label: "Cek Kontak" },
];

export default function Nav({ isAdmin }: { isAdmin: boolean }) {
  const path = usePathname();
  const all = isAdmin ? [...links, { href: "/admin", label: "Admin" }] : links;
  return (
    <nav className="flex flex-wrap gap-1">
      {all.map((l) => {
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
