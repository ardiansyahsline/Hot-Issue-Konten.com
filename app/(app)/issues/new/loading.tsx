import { Bar } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Bar className="h-6 w-40" />
      <Bar className="h-80 w-full rounded-xl" />
      <Bar className="h-40 w-full rounded-xl" />
    </div>
  );
}
