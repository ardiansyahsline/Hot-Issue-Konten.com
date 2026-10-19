export function Bar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-zinc-800/80 ${className}`} />;
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <ul className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="card space-y-3 p-4">
          <div className="flex gap-2">
            <Bar className="h-5 w-10" />
            <Bar className="h-5 w-16" />
            <Bar className="h-5 w-16" />
            <Bar className="h-5 w-24" />
          </div>
          <Bar className="h-4 w-2/3" />
          <Bar className="h-3 w-1/3" />
        </li>
      ))}
    </ul>
  );
}
