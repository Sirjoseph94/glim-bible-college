import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { institutionQuery } from "../../api/institution";
import { Crest } from "../../design/crest";

/**
 * The signed-out pages (§11.1): the 72px crest and the college's name over one column, 400px
 * wide at most. Sign-in keeps its page title for screen readers only, since the name is the
 * visible heading there; the other pages show theirs.
 */
export function AuthLayout({
  title,
  showTitle = true,
  intro,
  children,
}: {
  title: string;
  showTitle?: boolean;
  intro?: ReactNode;
  children: ReactNode;
}) {
  const institution = useQuery(institutionQuery);
  return (
    <div className="mx-auto w-full max-w-100 space-y-5">
      <div className="flex flex-col items-center gap-3 text-center">
        <Crest size={72} />
        {institution.data ? (
          <p data-testid="institution-name" className="text-display text-ink">
            {institution.data.name}
          </p>
        ) : (
          // A line of display text, so the name replaces it without moving anything (CLS).
          <p className="text-display">
            <span className="inline-block w-56 rounded-sm bg-surface-sunken">
              <span className="sr-only">Loading</span>&nbsp;
            </span>
          </p>
        )}
        <h1 className={showTitle ? "text-title" : "sr-only"}>{title}</h1>
        {intro ? <p className="text-body text-ink-muted">{intro}</p> : null}
      </div>
      {children}
    </div>
  );
}
