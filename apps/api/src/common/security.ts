import type { Config } from "@glim/shared/config";

/** Content Security Policy and headers from TRD §19.1. */
export function helmetOptions(config: Config) {
  const spaces = new URL(config.storage.endpoint).origin;
  return {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://www.youtube.com"],
        frameSrc: ["https://www.youtube-nocookie.com"],
        imgSrc: ["'self'", "data:", "https://i.ytimg.com"],
        connectSrc: ["'self'", spaces],
        styleSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    referrerPolicy: { policy: "no-referrer" as const },
    strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: true },
    crossOriginEmbedderPolicy: false,
  };
}
