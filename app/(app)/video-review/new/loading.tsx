import { Bar, ListSkeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="space-y-5">
      <Bar className="h-6 w-48" />
      <Bar className="h-14 w-full rounded-xl" />
      <ListSkeleton rows={4} />
    </div>
  );
}
