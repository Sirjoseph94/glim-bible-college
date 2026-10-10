import type { ReactNode } from "react";
import { Icon } from "../../design/icons";

/**
 * A collapsible section (decision UI-Q12): native details/summary, so it works by keyboard and
 * without script. The chevron turns when open.
 */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="group" open={defaultOpen || undefined}>
      <summary className="flex min-h-tap cursor-pointer list-none items-center gap-2 text-subhead text-ink [&::-webkit-details-marker]:hidden">
        <span className="text-ink-muted transition-transform duration-120 group-open:rotate-90">
          <Icon name="chevronRight" />
        </span>
        <span className="min-w-0 flex-1">{summary}</span>
      </summary>
      <div className="pt-2 pb-3">{children}</div>
    </details>
  );
}
