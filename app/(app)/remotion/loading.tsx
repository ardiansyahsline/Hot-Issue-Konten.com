import { Bar } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="space-y-5">
      <Bar className="h-6 w-48" />
      <Bar className="h-[60vh] w-full rounded-2xl" />
    </div>
  );
}
