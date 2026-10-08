import { Skeleton } from "@/components/ui/skeleton";

// Stable on both SSR and hydration; the generic sidebar skeleton uses random widths.
export function LegalProjectTreeSkeleton({
  showIcon = false,
}: {
  showIcon?: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className="flex h-8 items-center gap-2 rounded-md px-2"
    >
      {showIcon && <Skeleton className="size-4 rounded-md" />}
      <Skeleton className="h-4 w-3/4" />
    </div>
  );
}
