import {
  Children,
  cloneElement,
  isValidElement,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { cn } from "../../design/cn";
import { Icon, type IconName } from "../../design/icons";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "live" | "danger";
export type ButtonSize = "md" | "sm";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-brand text-brand-on hover:bg-brand-strong active:bg-brand-strong",
  secondary:
    "border border-line-strong bg-surface-raised text-ink hover:bg-surface-sunken active:bg-surface-sunken",
  quiet: "text-brand hover:bg-brand-soft active:bg-brand-soft",
  live: "glim-live-hover bg-live text-live-on",
  danger:
    "border border-danger bg-surface-raised text-danger hover:bg-danger-soft active:bg-danger-soft",
};

const SIZES: Record<ButtonSize, string> = {
  md: "h-control px-5 text-body",
  // §9.1: sm is for desktop toolbars and tables; below 1024px it keeps the 44px target (UI-5).
  sm: "h-tap px-3 text-body-sm lg:h-control-sm",
};

/** The class list for a button-styled element; Button uses it, and so can a plain link. */
export function buttonClass({
  variant = "secondary",
  size = "md",
  block = false,
}: {
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
  block?: boolean | undefined;
} = {}): string {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-md font-semibold whitespace-nowrap",
    "transition-colors duration-120 disabled:cursor-not-allowed disabled:opacity-55",
    "aria-disabled:cursor-not-allowed",
    VARIANTS[variant],
    SIZES[size],
    block && "w-full",
  );
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon: 20 (md) or 16 (sm). */
  icon?: IconName;
  /** For actions over 300 ms: keeps the label and width, shows a spinner, blocks clicks. */
  loading?: boolean;
  block?: boolean;
  /** Style the single child (a link) as the button instead of rendering a <button>. */
  asChild?: boolean;
};

function Spinner({ size }: { size: 16 | 20 }) {
  return (
    <svg
      aria-hidden="true"
      className="glim-spinner"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
    >
      <path d="M12 3a9 9 0 1 1-9 9" />
    </svg>
  );
}

/**
 * Every action (docs/ui-design-handoff.md §9.1). Labels are verbs; one `primary` or `live` per
 * region. A disabled button needs a visible reason nearby, linked with `aria-describedby`.
 */
export function Button({
  variant,
  size = "md",
  icon,
  loading = false,
  block,
  asChild = false,
  className,
  children,
  type = "button",
  onClick,
  ...rest
}: ButtonProps) {
  const classes = cn(buttonClass({ variant, size, block }), className);
  const iconSize = size === "md" ? 20 : 16;
  if (asChild) {
    // A link styled as a button: it keeps its leading icon; `loading` doesn't apply to links.
    const child = Children.only(children);
    if (!isValidElement<{ className?: string; children?: ReactNode }>(child))
      throw new Error("Button asChild needs one element child");
    return cloneElement(
      child as ReactElement<{ className?: string; children?: ReactNode }>,
      { className: cn(classes, child.props.className) },
      icon ? <Icon name={icon} size={iconSize} /> : null,
      child.props.children,
    );
  }
  return (
    <button
      type={type}
      className={classes}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={(event) => {
        if (loading) event.preventDefault();
        else onClick?.(event);
      }}
      {...rest}
    >
      {loading ? <Spinner size={iconSize} /> : icon ? <Icon name={icon} size={iconSize} /> : null}
      {children}
    </button>
  );
}
