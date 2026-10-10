import { Link, type LinkProps } from "@tanstack/react-router";
import { Icon } from "../../design/icons";

/**
 * Back to the parent page (§9.10), always by name ("Home", "Recordings") and always a real link
 * to the parent route, never history.back(), so deep links work.
 */
export function BackLink({ to, label }: { to: NonNullable<LinkProps["to"]>; label: string }) {
  return (
    <Link to={to} className="inline-flex min-h-tap items-center gap-0.5 text-subhead text-ink">
      <Icon name="chevronLeft" />
      {label}
    </Link>
  );
}
