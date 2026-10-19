import { HOT_THRESHOLD } from "./constants";
import type { IssueRow } from "./types";

export function isAutoHot(issue: Pick<IssueRow, "max_contact_reports_30d">) {
  return issue.max_contact_reports_30d >= HOT_THRESHOLD;
}

export function isHot(issue: Pick<IssueRow, "is_hot" | "max_contact_reports_30d" | "status">) {
  return issue.status !== "resolved" && (issue.is_hot || isAutoHot(issue));
}

export function fmtDate(iso: string | null | undefined) {
  if (!iso) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(new Date(iso));
}

export function timeAgo(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "baru saja";
  if (diff < 3600) return `${Math.floor(diff / 60)} mnt lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  return `${Math.floor(diff / 86400)} hari lalu`;
}

/** Bersihkan input user sebelum dipakai di filter .or() PostgREST */
export function cleanSearch(q: string) {
  return q.replace(/[,()*%"\\]/g, " ").trim().slice(0, 100);
}
