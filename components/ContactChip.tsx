import Link from "next/link";
import { CONTACT_TYPES, displayContact, type ContactType } from "@/lib/contacts";
import { HOT_THRESHOLD } from "@/lib/constants";

export default function ContactChip({
  type,
  normalized,
  count30d,
}: {
  type: ContactType;
  normalized: string;
  count30d?: number;
}) {
  const hot = (count30d ?? 0) >= HOT_THRESHOLD;
  return (
    <Link
      href={`/contacts?type=${type}&q=${encodeURIComponent(normalized)}`}
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs ring-1 ring-inset hover:brightness-125 ${
        hot ? "bg-red-500/10 text-red-200 ring-red-500/40" : "bg-zinc-800 text-zinc-300 ring-zinc-700"
      }`}
    >
      <span className="font-semibold text-zinc-500">{CONTACT_TYPES[type].short}</span>
      {displayContact(type, normalized)}
      {count30d && count30d > 1 ? <span className="font-semibold">×{count30d}</span> : null}
    </Link>
  );
}
