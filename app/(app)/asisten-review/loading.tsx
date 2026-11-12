import { Bar, ListSkeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="space-y-4">
      <Bar className="h-12 w-full rounded-xl" />
      <ListSkeleton rows={4} />
    </div>
  );
}
