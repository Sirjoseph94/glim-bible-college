import type { ReactNode } from "react";
import { credits, hundredths, percent } from "../../design/format";
import { Badge } from "../ui/badge";

function Figure({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex-1 p-4">
      <p className="text-caption text-ink-muted uppercase">{label}</p>
      <p className="font-mono text-figure text-ink tabular-nums">{hundredths(value)}</p>
    </div>
  );
}

/**
 * The student's standing at a glance (§9.17): the CGPA, always to two decimals from exact
 * integers, whether it's still provisional, and the credits earned (ADR-0005: no semester GPA).
 */
export function GpaSummary({
  cgpaX100,
  provisional,
  earnedX10,
  attemptedX10,
}: {
  cgpaX100: number | null;
  provisional?: boolean;
  earnedX10?: number;
  attemptedX10?: number;
}) {
  const none = cgpaX100 === null;
  return (
    <section
      aria-label="Grade point average"
      className="overflow-hidden rounded-md border border-line bg-surface-raised"
    >
      <div className="flex divide-x divide-line">
        <Figure label="CGPA" value={cgpaX100} />
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
        {none ? (
          <p className="text-body-sm text-ink-muted">No results yet</p>
        ) : (
          <>
            {provisional === undefined ? null : (
              <Badge status={provisional ? "provisional" : "approved"} />
            )}
            {earnedX10 === undefined || attemptedX10 === undefined ? null : (
              <p className="ml-auto text-body-sm text-ink-muted">
                {credits(earnedX10)} of {credits(attemptedX10)} credits earned
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/**
 * One course result (§9.17): code and credits, title and a note on the left; the letter and the
 * percentage on the right. Not in yet: "—" and Awaiting.
 */
export function ResultRow({
  code,
  title,
  creditsX10,
  letter,
  pctX100,
  note,
  pending = pctX100 === null && letter === null,
}: {
  code: string;
  title: string;
  creditsX10: number;
  letter: string | null;
  pctX100: number | null;
  note?: ReactNode;
  /** Not finalized yet ("Awaiting"); false for a result with no grade, such as Withdrawn. */
  pending?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="font-mono text-meta text-ink-muted">
          {code} · {credits(creditsX10)} credits
        </p>
        <p className="text-subhead text-ink">{title}</p>
        {note ? <p className="text-meta text-ink-muted">{note}</p> : null}
      </div>
      <div className="shrink-0 text-right">
        <strong className="block font-mono text-title">{letter ?? "—"}</strong>
        <span className="text-meta text-ink-muted tabular-nums">
          {pending ? "Awaiting" : pctX100 === null ? null : percent(pctX100)}
        </span>
      </div>
    </div>
  );
}
