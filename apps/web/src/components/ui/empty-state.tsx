import type { ReactNode } from "react";
import { Icon, type IconName } from "../../design/icons";

/**
 * A region with nothing to show (§9.12): what's missing, one sentence why, at most one action.
 * Copy comes from §12.4.
 */
export function EmptyState({
  icon,
  title,
  children,
  action,
  headingLevel = 2,
}: {
  icon: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className="flex flex-col items-center gap-3 p-8 text-center">
      <span className="flex size-12 items-center justify-center rounded-pill bg-surface-sunken text-ink-muted">
        <Icon name={icon} size={24} />
      </span>
      <Heading className="text-heading text-ink">{title}</Heading>
      {children ? <p className="max-w-prose text-body-sm text-ink-muted">{children}</p> : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
