import { cn } from "../../design/cn";

/**
 * "Something new" (§9.21): 8px brand dot with a ring. Never a count and never live red (UI-4).
 * Decorative: the control it sits on says "new" in its label.
 */
export function NotificationDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("block size-2 rounded-pill bg-brand ring-2 ring-surface-raised", className)}
    />
  );
}
