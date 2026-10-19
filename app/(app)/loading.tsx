import { Bar, ListSkeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card space-y-2 p-4">
            <Bar className="h-3 w-20" />
            <Bar className="h-7 w-10" />
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-3">
          <Bar className="h-28 w-full rounded-xl" />
          <ListSkeleton />
        </div>
        <Bar className="h-64 w-full rounded-xl" />
      </div>
    </div>
  );
}
