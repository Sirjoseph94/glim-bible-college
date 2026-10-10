import { useSyncExternalStore } from "react";
import { Icon } from "../../design/icons";
import { Banner } from "./banner";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * Whether the browser thinks it is online. §9.20 also counts requests that fail with a network
 * error; that signal comes with the offline queue (WP-UI-07).
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

/** "1 submission waiting to send" (§9.20). */
export function queuedLabel(count: number, [one, many]: [string, string]): string {
  return `${String(count)} ${count === 1 ? one : many} waiting to send`;
}

/** At the top of the screen while offline (§9.20, §10.4). Actions stay enabled and queue. */
export function OfflineBanner() {
  return (
    <Banner tone="offline" title="You are offline">
      Your work is saved on this phone and will send when you reconnect.
    </Banner>
  );
}

/** Queued actions, shown in the screen's sticky action bar; nothing when the queue is empty. */
export function QueuedPill({ count, noun }: { count: number; noun: [string, string] }) {
  if (count === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-pill bg-surface-sunken px-3 py-1 text-meta text-ink">
      <Icon name="clock" size={16} />
      {queuedLabel(count, noun)}
    </span>
  );
}
