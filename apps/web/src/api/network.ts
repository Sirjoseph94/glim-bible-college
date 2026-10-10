/**
 * Whether requests are getting through (handoff §9.20: offline when `navigator.onLine` is false
 * **or** requests fail with network errors). The API client reports each outcome here.
 */
let failing = false;
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (next === failing) return;
  failing = next;
  for (const listener of listeners) listener();
}

export function reportNetworkFailure(): void {
  set(true);
}

export function reportNetworkSuccess(): void {
  set(false);
}

export function requestsFailing(): boolean {
  return failing;
}

export function subscribeNetwork(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
