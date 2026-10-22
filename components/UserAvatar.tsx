/** Foto profil (atau huruf depan nama) + titik status online opsional. Aman dipakai di server & client. */
export default function UserAvatar({
  name,
  url,
  size = 32,
  online,
  me = false,
  className = "",
}: {
  name: string | null | undefined;
  url?: string | null;
  size?: number;
  /** true = titik hijau, false = titik abu, undefined = tanpa titik */
  online?: boolean;
  me?: boolean;
  className?: string;
}) {
  const dot = Math.max(8, Math.round(size * 0.32));
  return (
    <span className={`relative inline-flex shrink-0 ${className}`} style={{ width: size, height: size }}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={name ?? ""} width={size} height={size} loading="lazy" className="h-full w-full rounded-full object-cover ring-1 ring-zinc-800" />
      ) : (
        <span
          className={`flex h-full w-full items-center justify-center rounded-full font-semibold uppercase ${me ? "bg-orange-500/15 text-orange-400" : "bg-zinc-800 text-zinc-200"}`}
          style={{ fontSize: Math.max(10, size * 0.4) }}
        >
          {(name ?? "?").trim().slice(0, 1)}
        </span>
      )}
      {online !== undefined && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-zinc-900 ${online ? "bg-emerald-500" : "bg-zinc-500"}`}
          style={{ width: dot, height: dot }}
          title={online ? "Online" : "Offline"}
        />
      )}
    </span>
  );
}

/** Online = aktif dalam 2 menit terakhir */
export const ONLINE_MS = 2 * 60 * 1000;
export const isOnline = (lastSeen: string | null | undefined, now = Date.now()) => !!lastSeen && now - new Date(lastSeen).getTime() < ONLINE_MS;

/** "Online" / "Terakhir dilihat 5 mnt lalu" / "Terakhir dilihat kemarin 22.10" */
export function lastSeenText(lastSeen: string | null | undefined, now = Date.now()) {
  if (isOnline(lastSeen, now)) return "Online";
  if (!lastSeen) return "Belum pernah online";
  const t = new Date(lastSeen);
  const m = Math.round((now - t.getTime()) / 60000);
  if (m < 60) return `Terakhir dilihat ${m} mnt lalu`;
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  const jam = t.toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" });
  if (day(t) === day(new Date(now))) return `Terakhir dilihat ${jam}`;
  if (day(t) === day(new Date(now - 86400000))) return `Terakhir dilihat kemarin ${jam}`;
  return `Terakhir dilihat ${t.toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short" })} ${jam}`;
}
