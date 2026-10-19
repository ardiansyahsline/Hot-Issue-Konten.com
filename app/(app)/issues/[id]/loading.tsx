import { Bar } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Bar className="h-4 w-24" />
      <div className="card space-y-4 p-5">
        <div className="flex gap-2">
          <Bar className="h-5 w-10" />
          <Bar className="h-5 w-16" />
          <Bar className="h-5 w-16" />
        </div>
        <Bar className="h-6 w-2/3" />
        <Bar className="h-4 w-full" />
        <Bar className="h-4 w-5/6" />
        <div className="grid grid-cols-4 gap-3 pt-2">
          {Array.from({ length: 4 }).map((_, i) => <Bar key={i} className="h-8" />)}
        </div>
      </div>
      <Bar className="h-32 w-full rounded-xl" />
      <Bar className="h-48 w-full rounded-xl" />
    </div>
  );
}
