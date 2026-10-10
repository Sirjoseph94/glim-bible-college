import type { ReactNode } from "react";

/**
 * A page's header (§6.2): an optional overline (course code or role), the title as the page's
 * one h1, a meta line, and the page's actions, which wrap under the title below 1024px.
 */
export function PageHeader({
  overline,
  title,
  meta,
  actions,
  headingLevel = 1,
}: {
  /** 1 on a page; 2 only where a page shows a header sample (the /dev/ui gallery). */
  headingLevel?: 1 | 2;
  overline?: ReactNode;
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0 space-y-1">
        {overline ? <p className="font-mono text-code text-brand">{overline}</p> : null}
        {headingLevel === 1 ? (
          <h1 className="text-title">{title}</h1>
        ) : (
          <h2 className="text-title">{title}</h2>
        )}
        {meta ? <p className="text-body-sm text-ink-muted">{meta}</p> : null}
      </div>
      {actions ? (
        <div className="flex flex-col gap-2 md:flex-row md:flex-wrap lg:shrink-0">{actions}</div>
      ) : null}
    </header>
  );
}
