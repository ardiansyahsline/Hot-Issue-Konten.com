import { PRIORITIES, STATUSES, type PriorityKey, type StatusKey } from "@/lib/constants";

export function StatusBadge({ status }: { status: StatusKey }) {
  const s = STATUSES[status] ?? STATUSES.open;
  return <span className={`badge ${s.cls}`}>{s.label}</span>;
}

export function PriorityBadge({ priority }: { priority: PriorityKey }) {
  const p = PRIORITIES[priority] ?? PRIORITIES.medium;
  return <span className={`badge ${p.cls}`}>{p.label}</span>;
}

export function HotBadge({ manual, auto }: { manual?: boolean; auto?: boolean }) {
  if (!manual && !auto) return null;
  const why = [manual && "ditandai manual", auto && "kontak dilaporkan berulang"].filter(Boolean).join(" + ");
  return (
    <span title={`HOT: ${why}`} className="badge bg-red-600/20 text-red-300 ring-red-500/40">
      🔥 HOT
    </span>
  );
}
