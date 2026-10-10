import type { ReactNode } from "react";
import { cn } from "../../design/cn";
import { Icon, type IconName } from "../../design/icons";
import { IconButton } from "./icon-button";

export type BannerTone = "info" | "success" | "warning" | "danger" | "offline";

const TONES: Record<BannerTone, { icon: IconName; ground: string; title: string }> = {
  info: { icon: "info", ground: "bg-info-soft", title: "text-info" },
  success: { icon: "check", ground: "bg-success-soft", title: "text-success" },
  warning: { icon: "alert", ground: "bg-warning-soft", title: "text-warning" },
  danger: { icon: "alert", ground: "bg-danger-soft", title: "text-danger" },
  offline: { icon: "wifiOff", ground: "bg-surface-sunken border border-line", title: "text-ink" },
};

/**
 * An inline message above the content it concerns (§9.4). At most one per region. Errors are
 * announced at once (`alert`); the rest wait politely (`status`).
 */
export function Banner({
  tone,
  title,
  children,
  action,
  onDismiss,
  className,
}: {
  tone: BannerTone;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  const t = TONES[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("flex items-start gap-3 rounded-md px-4 py-3", t.ground, className)}
    >
      <span className={cn("mt-0.5 shrink-0", t.title)}>
        <Icon name={t.icon} />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        {title ? <p className={cn("text-subhead", t.title)}>{title}</p> : null}
        {children ? <div className="text-body-sm text-ink">{children}</div> : null}
        {action ? <div className="pt-1">{action}</div> : null}
      </div>
      {onDismiss ? (
        <IconButton icon="close" label="Dismiss" onClick={onDismiss} className="-my-2 -mr-2" />
      ) : null}
    </div>
  );
}
