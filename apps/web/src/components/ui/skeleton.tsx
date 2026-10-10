import type { ReactNode } from "react";
import { cn } from "../../design/cn";

/**
 * A still placeholder block shaped like the content to come (§9.12); no shimmer. Size it with
 * classes (`h-4 w-3/4`). Show skeletons only when loading takes over 300 ms.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("rounded-sm bg-surface-sunken", className)} />;
}

/** Wraps a region's skeletons and says once, for screen readers, what is loading. */
export function SkeletonGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="status" aria-busy="true" className="space-y-3">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
