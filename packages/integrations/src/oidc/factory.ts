import type { Config } from "@glim/shared/config";
import { DisabledIdentityProvider, OpenIdConnectProvider } from "./openid";
import type { IdentityProvider } from "./port";

/** Google sign-in when a client is configured; otherwise sign-in with Google is unavailable. */
export function createIdentityProvider(config: Config): IdentityProvider {
  const { oidcIssuer, oauthClientId, oauthClientSecret } = config.google;
  if (oauthClientId === undefined || oauthClientSecret === undefined)
    return new DisabledIdentityProvider();
  return new OpenIdConnectProvider({
    issuer: oidcIssuer,
    clientId: oauthClientId,
    clientSecret: oauthClientSecret,
  });
}
