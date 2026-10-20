import { Bar } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Bar className="h-7 w-24" />
        <Bar className="h-4 w-80" />
      </div>
      <div className="card grid md:grid-cols-[300px_1fr]" style={{ height: "calc(100vh - 210px)", minHeight: 480 }}>
        <div className="space-y-3 border-r border-zinc-800/80 p-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Bar key={i} className="h-9 w-full rounded-xl" />
          ))}
        </div>
        <div />
      </div>
    </div>
  );
}
