import { cn } from "../../design/cn";

/**
 * Progress out of 100 (§9.13): a label row with the rounded percentage over a 6px track, or a
 * thin 4px track inside list rows.
 */
export function ProgressBar({
  label,
  value,
  thin = false,
}: {
  /** Names the bar for screen readers, and is shown unless `thin`. */
  label: string;
  /** 0–100; values outside are clamped. */
  value: number;
  thin?: boolean;
}) {
  const percent = Math.round(Math.min(100, Math.max(0, value)));
  return (
    <div className="space-y-1">
      {thin ? null : (
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-body-sm text-ink-muted">{label}</span>
          <span className="text-label text-ink tabular-nums">{percent}%</span>
        </div>
      )}
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className={cn("overflow-hidden rounded-pill bg-surface-sunken", thin ? "h-1" : "h-1.5")}
      >
        <div
          className="h-full rounded-pill bg-brand transition-all duration-200 ease-out"
          style={{ width: `${String(percent)}%` }}
        />
      </div>
    </div>
  );
}
