import { VR_STATUSES, linkPlatform, type VrLinkKind, type VrStatus } from "@/lib/videoReview";

export function VrStatusBadge({ status }: { status: VrStatus }) {
  const s = VR_STATUSES[status] ?? VR_STATUSES.menunggu;
  return <span className={`badge ${s.cls}`}>{s.label}</span>;
}

export function VrLinks({ links, max }: { links: { id?: number; kind: VrLinkKind; value: string }[]; max?: number }) {
  const shown = max ? links.slice(0, max) : links;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((l, i) => {
        const href = l.kind === "url" ? (l.value.startsWith("http") ? l.value : `https://${l.value}`) : l.kind === "email" ? `mailto:${l.value}` : null;
        const label = l.kind === "url" ? l.value.replace(/^https?:\/\/(www\.)?/, "").slice(0, 38) : l.value;
        const inner = (
          <>
            <span className="font-semibold text-zinc-500">{linkPlatform(l.value)}</span>
            <span className="truncate">{label}</span>
          </>
        );
        const cls = "inline-flex max-w-full items-center gap-1 rounded-md bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300";
        return href ? (
          <a key={l.id ?? i} href={href} target="_blank" rel="noreferrer" className={`${cls} hover:bg-zinc-700`}>
            {inner}
          </a>
        ) : (
          <span key={l.id ?? i} className={cls}>{inner}</span>
        );
      })}
      {max && links.length > max && <span className="text-xs text-zinc-500">+{links.length - max} lagi</span>}
    </div>
  );
}

/** Kolom Catatan: baris "Argumen clipper: …" diberi label redup supaya mudah dibedakan dari insight */
export function VrNotes({ text, clamp = false }: { text: string | null; clamp?: boolean }) {
  if (!text) return <span className="text-zinc-600">—</span>;
  const lines = text.split("\n");
  return (
    <div className={clamp ? "line-clamp-4" : ""} title={clamp ? text : undefined}>
      {lines.map((line, i) => {
        const m = line.match(/^(argumen clipper:)\s*(.*)$/i);
        return (
          <p key={i} className="whitespace-pre-wrap">
            {m ? (
              <>
                <span className="font-semibold text-zinc-500">Argumen clipper:</span> {m[2]}
              </>
            ) : (
              line
            )}
          </p>
        );
      })}
    </div>
  );
}
