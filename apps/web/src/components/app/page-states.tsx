import { Link } from "@tanstack/react-router";
import { Banner } from "../ui/banner";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty-state";

/**
 * The page-wide states every data-driven region has (docs/ui-design-handoff.md §10.1). A
 * failed load whose answer was "not found" or "not yours" is NotAvailable, worded the same
 * either way so it never reveals whether the thing exists; anything else is LoadFailed.
 */
export function NotAvailable() {
  return (
    <EmptyState
      icon="info"
      title="This page isn't available to you"
      action={
        <Button asChild variant="secondary">
          <Link to="/">Go to Home</Link>
        </Button>
      }
    />
  );
}

export function LoadFailed({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <Banner
      tone="danger"
      title={`We couldn't load ${what}`}
      action={
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      }
    >
      Check your connection.
    </Banner>
  );
}

/** Whether a failed load means "not there or not yours" (show NotAvailable), not "try again". */
export function isNotAvailable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error.status === 403 || error.status === 404)
  );
}
