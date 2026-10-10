import type { ReactNode } from "react";
import { cn } from "../../design/cn";

export type Tone = "neutral" | "brand" | "live" | "success" | "warning" | "danger" | "info";

/** Status words are fixed vocabulary (docs/ui-design-handoff.md §9.3, §12.2). */
const STATUSES = {
  // Class Meetings (`no_show` per decision UI-Q3; `processing`/`available` wait on the API change)
  scheduled: { tone: "info", word: "Scheduled" },
  open: { tone: "brand", word: "Open to join" },
  live: { tone: "live", word: "Live now" },
  ended: { tone: "neutral", word: "Ended" },
  no_show: { tone: "neutral", word: "Didn't take place" },
  processing: { tone: "warning", word: "Recording processing" },
  available: { tone: "brand", word: "Recording ready" },
  cancelled: { tone: "danger", word: "Cancelled" },
  // Attendance
  present: { tone: "success", word: "Present" },
  partial: { tone: "warning", word: "Partial" },
  absent: { tone: "danger", word: "Absent" },
  excused: { tone: "info", word: "Excused" },
  // Results and work
  provisional: { tone: "warning", word: "Provisional" },
  approved: { tone: "success", word: "Approved" },
  failed: { tone: "danger", word: "Failed" },
  draft: { tone: "warning", word: "Draft" },
} as const satisfies Record<string, { tone: Tone; word: string }>;

export type BadgeStatus = keyof typeof STATUSES;

const TONES: Record<Tone, string> = {
  neutral: "bg-surface-sunken text-ink-muted",
  brand: "bg-brand-soft text-brand",
  live: "bg-live text-live-on",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
};

type BadgeProps =
  | { status: BadgeStatus; tone?: never; children?: never }
  | { status?: never; tone: Tone; children: ReactNode };

/** A status word on a tinted pill. The word always carries the meaning, never the colour (UI-3). */
export function Badge(props: BadgeProps) {
  const { tone, word } =
    props.status === undefined
      ? { tone: props.tone, word: props.children }
      : STATUSES[props.status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-caption whitespace-nowrap",
        TONES[tone],
      )}
    >
      {tone === "live" ? (
        <span aria-hidden="true" className="glim-live-dot size-2 rounded-pill bg-current" />
      ) : null}
      {word}
    </span>
  );
}
