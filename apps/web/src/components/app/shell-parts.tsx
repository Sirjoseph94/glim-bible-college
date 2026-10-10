import { createContext, useContext, useEffect } from "react";
import type { BackLink } from "./back-link";

export function InstitutionName({ name, testId }: { name: string | undefined; testId?: string }) {
  return name === undefined ? (
    <span className="block h-6 w-40 rounded-sm bg-surface-sunken">
      <span className="sr-only">Loading</span>
    </span>
  ) : (
    <span data-testid={testId} className="truncate text-wordmark text-ink">
      {name}
    </span>
  );
}

/** A detail page's top bar (§6.2): back to the parent by name, and the course code. */
export interface DetailBar {
  back: { to: Parameters<typeof BackLink>[0]["to"]; label: string };
  code?: string;
}

export const DetailBarContext = createContext<(bar: DetailBar | null) => void>(() => undefined);

/**
 * Turns the top bar into a detail bar while the calling page is shown: the back link replaces
 * the crest and name, and the course code sits on the right.
 */
export function useDetailBar(bar: DetailBar): void {
  const setBar = useContext(DetailBarContext);
  const { to, label } = bar.back;
  const { code } = bar;
  useEffect(() => {
    setBar({ back: { to, label }, ...(code === undefined ? {} : { code }) });
    return () => {
      setBar(null);
    };
  }, [setBar, to, label, code]);
}
