import { Link, type LinkProps } from "@tanstack/react-router";
import { Icon } from "../../design/icons";

/**
 * Back to the parent page (§9.10), always by name ("Home", "Recordings") and always a real link
 * to the parent route, never history.back(), so deep links work. `params` and `search` fill a
 * parent like `/teach/$offeringId?tab=live`.
 */
export function BackLink({
  to,
  label,
  params,
  search,
}: {
  to: NonNullable<LinkProps["to"]>;
  label: string;
  params?: Record<string, string> | undefined;
  search?: Record<string, string> | undefined;
}) {
  return (
    <Link
      to={to}
      // The parent route is chosen at runtime, so its params can't be checked here.
      params={params as never}
      search={search as never}
      className="inline-flex min-h-tap items-center gap-0.5 text-subhead text-ink"
    >
      <Icon name="chevronLeft" />
      {label}
    </Link>
  );
}
