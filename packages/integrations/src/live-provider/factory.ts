import type { Config } from "@glim/shared/config";
import type { BucketAcquire } from "../google/limiter";
import { GoogleRateLimiter } from "../google/limiter";
import { GoogleMeetProvider } from "../google/meet-provider";
import { FakeLiveProvider } from "./fake";
import type { LiveProvider } from "./port";

/**
 * The live-class provider for `LIVE_PROVIDER` (TRD §11.1); null keeps v1's pasted links.
 * `acquire` is `rl_acquire`, so the quota limiter is shared by every instance.
 */
export function createLiveProvider(
  config: Config,
  deps: { acquire?: BucketAcquire } = {},
): LiveProvider | null {
  switch (config.liveProvider) {
    case "none":
      return null;
    case "fake":
      return new FakeLiveProvider();
    case "google_meet": {
      const { serviceAccount, pubsubSubscription, pubsubTopic } = config.google;
      // loadConfig refuses google_meet without these; this guards other callers.
      if (
        serviceAccount === undefined ||
        pubsubSubscription === undefined ||
        pubsubTopic === undefined
      )
        throw new Error("LIVE_PROVIDER=google_meet needs the service account and Pub/Sub names.");
      return new GoogleMeetProvider({
        serviceAccount,
        pubsubSubscription,
        pubsubTopic,
        ...(deps.acquire === undefined ? {} : { limiter: new GoogleRateLimiter(deps.acquire) }),
      });
    }
  }
}
