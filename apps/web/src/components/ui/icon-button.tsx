import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../design/cn";
import { Icon, type IconName } from "../../design/icons";
import { NotificationDot } from "./notification-dot";

/** An icon-only button: 44 × 44 hit area and a required label (§9.2, §13). */
export function IconButton({
  icon,
  label,
  dot = false,
  className,
  type = "button",
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children"> & {
  icon: IconName;
  /** What it does, for screen readers: "Notifications", "Dismiss". */
  label: string;
  /** Something new behind it; never a count (§9.21). */
  dot?: boolean;
}) {
  return (
    <button
      type={type}
      aria-label={label}
      className={cn(
        "relative inline-flex size-tap shrink-0 items-center justify-center rounded-pill text-ink-muted",
        "transition-colors duration-120 hover:bg-surface-sunken",
        className,
      )}
      {...rest}
    >
      <Icon name={icon} />
      {dot ? <NotificationDot className="absolute top-2 right-2" /> : null}
    </button>
  );
}
