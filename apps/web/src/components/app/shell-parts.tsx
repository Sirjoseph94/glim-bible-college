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
  back: {
    to: Parameters<typeof BackLink>[0]["to"];
    params?: Record<string, string>;
    label: string;
  };
  code?: string;
}

export const DetailBarContext = createContext<(bar: DetailBar | null) => void>(() => undefined);

/**
 * Turns the top bar into a detail bar while the calling page is shown: the back link replaces
 * the crest and name, and the course code sits on the right.
 */
export function useDetailBar(bar: DetailBar): void {
  const setBar = useContext(DetailBarContext);
  const { to, label, params } = bar.back;
  const { code } = bar;
  const paramsKey = JSON.stringify(params ?? {});
  useEffect(() => {
    const parsed = JSON.parse(paramsKey) as Record<string, string>;
    setBar({ back: { to, label, params: parsed }, ...(code === undefined ? {} : { code }) });
    return () => {
      setBar(null);
    };
  }, [setBar, to, label, paramsKey, code]);
}
