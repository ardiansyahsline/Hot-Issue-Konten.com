import { SG_CATEGORIES, SG_STATUSES, type SgCategory, type SgStatus } from "@/lib/suggestions";

export function SgCategoryBadge({ category }: { category: SgCategory }) {
  const c = SG_CATEGORIES[category];
  if (!c) return null;
  return <span className={`badge ${c.cls}`}>{c.icon} {c.label}</span>;
}

export function SgStatusBadge({ status }: { status: SgStatus }) {
  const s = SG_STATUSES[status] ?? SG_STATUSES.baru;
  return (
    <span className={`badge ${s.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

export function Avatar({ name, size = 32 }: { name: string | null; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-zinc-800 font-semibold uppercase text-zinc-200"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {(name ?? "?").trim().slice(0, 1)}
    </span>
  );
}
