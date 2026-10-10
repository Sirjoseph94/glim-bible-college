import type { ReactNode } from "react";
import { cn } from "../../design/cn";

/** Header cell (§9.19): sunken ground, 13/18 semibold muted, may wrap to two lines. */
export const headCell =
  "bg-surface-sunken px-3.5 py-3 text-left align-bottom text-meta font-semibold text-ink-muted";

/** Body cell: 14/20, 12 × 14 padding, no wrapping. Add `numericCell` for numbers. */
export const bodyCell = "px-3.5 py-3 text-body-sm whitespace-nowrap";

/** Numbers line up: right-aligned, tabular figures. */
export const numericCell = "text-right tabular-nums";

/**
 * The first column stays put while the rest scroll sideways. Its width is fixed so the scroller
 * can keep a cell brought into view (by focus or Tab) clear of it: see `scroll-pl-44` below.
 * Long names wrap.
 */
export const stickyCell =
  "sticky left-0 z-sticky w-44 min-w-44 max-w-44 bg-surface-raised whitespace-normal";

/**
 * A table of comparable rows (gradebook, cohorts, broadsheets; §9.19): inside a card that scrolls
 * sideways so the page never does, with a minimum width so columns never squash. Rows are
 * divided by 1 px lines and tinted on hover from 1024 px. `caption` names the table for screen
 * readers (hidden when a heading already names it on screen).
 */
export function DataTable({
  caption,
  captionHidden = true,
  minWidth,
  children,
}: {
  caption: string;
  captionHidden?: boolean;
  /** A Tailwind min-width class, e.g. "min-w-205" (820 px) for the gradebook. */
  minWidth: string;
  children: ReactNode;
}) {
  return (
    <div
      role="region"
      aria-label={caption}
      // Focusable, so the table can be scrolled sideways from the keyboard (axe: scrollable-region).
      tabIndex={0}
      className="scroll-pl-44 overflow-x-auto rounded-md border border-line bg-surface-raised"
    >
      <table
        className={cn(
          "w-full border-collapse text-body-sm [&_tbody_tr]:border-t [&_tbody_tr]:border-line",
          "lg:[&_tbody_tr:hover]:bg-surface-sunken lg:[&_tbody_tr:hover>*]:bg-surface-sunken",
          minWidth,
        )}
      >
        <caption className={captionHidden ? "sr-only" : "p-3.5 text-left text-heading"}>
          {caption}
        </caption>
        {children}
      </table>
    </div>
  );
}
