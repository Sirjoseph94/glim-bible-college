import type { Config } from "@glim/shared/config";
import { FakeLiveProvider } from "./fake";
import type { LiveProvider } from "./port";

/** The live-class provider for `LIVE_PROVIDER` (TRD §11.1); null keeps v1's pasted links. */
export function createLiveProvider(config: Config): LiveProvider | null {
  switch (config.liveProvider) {
    case "none":
      return null;
    case "fake":
      return new FakeLiveProvider();
    case "google_meet":
      throw new Error("LIVE_PROVIDER=google_meet: the Google adapter isn't built yet.");
  }
}
