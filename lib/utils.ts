import { HOT_THRESHOLD, REPORT_HOT_THRESHOLD } from "./constants";
import type { IssueRow } from "./types";

type HotFields = Pick<IssueRow, "max_contact_reports_30d" | "report_count">;

/** HOT otomatis: kontak yang sama di banyak issue, ATAU topiknya sudah banyak laporan */
export function isAutoHot(issue: HotFields) {
  return issue.max_contact_reports_30d >= HOT_THRESHOLD || (issue.report_count ?? 1) >= REPORT_HOT_THRESHOLD;
}

/** tingkat panas topik dari jumlah laporan: 1 = baru, 2 = mulai ramai, 3 = HOT, 4 = membara */
export function heatLevel(reports: number) {
  if (reports >= REPORT_HOT_THRESHOLD * 3) return 4;
  if (reports >= REPORT_HOT_THRESHOLD + 2) return 3;
  if (reports >= REPORT_HOT_THRESHOLD) return 2;
  return reports >= 2 ? 1 : 0;
}

export function isHot(issue: Pick<IssueRow, "is_hot" | "status"> & HotFields) {
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

/** Tanggal hari ini (WIB) format YYYY-MM-DD */
export function todayWib() {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

/** "2026-10-05" -> "05 Okt 2026" */
export function fmtDay(d: string | null | undefined) {
  if (!d) return "-";
  const [y, m, day] = d.split("-").map(Number);
  return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, day))
  );
}
