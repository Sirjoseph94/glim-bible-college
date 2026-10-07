import * as client from "openid-client";
import {
  OidcError,
  type AuthorizationRequest,
  type CompletionChecks,
  type IdentityProvider,
  type OidcProfile,
} from "./port";

export interface OpenIdConnectOptions {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Only for a local fake issuer in tests. */
  allowHttp?: boolean;
}

/** Authorization code + PKCE against an OIDC issuer, by openid-client (TRD §8.1). */
export class OpenIdConnectProvider implements IdentityProvider {
  readonly enabled = true;
  private config: Promise<client.Configuration> | undefined;

  constructor(private readonly options: OpenIdConnectOptions) {}

  async beginAuthorization(redirectUri: string): Promise<AuthorizationRequest> {
    const config = await this.configuration();
    const codeVerifier = client.randomPKCECodeVerifier();
    const state = client.randomState();
    const nonce = client.randomNonce();
    const url = client.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri,
      scope: "openid email profile",
      response_type: "code",
      code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: "S256",
      state,
      nonce,
      prompt: "select_account",
    });
    return { url: url.toString(), state, nonce, codeVerifier };
  }

  async completeAuthorization(callbackUrl: URL, checks: CompletionChecks): Promise<OidcProfile> {
    const config = await this.configuration();
    let claims: client.IDToken | undefined;
    try {
      const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
        pkceCodeVerifier: checks.codeVerifier,
        expectedState: checks.state,
        expectedNonce: checks.nonce,
        idTokenExpected: true,
      });
      claims = tokens.claims();
    } catch (error) {
      throw new OidcError("The sign-in response could not be verified", { cause: error });
    }
    if (claims === undefined) throw new OidcError("No ID token was returned");
    const email = typeof claims.email === "string" ? claims.email : null;
    if (email === null) throw new OidcError("The ID token has no email");
    return {
      subject: claims.sub,
      email,
      emailVerified: claims.email_verified === true,
      name: typeof claims.name === "string" ? claims.name : null,
      hostedDomain: typeof claims.hd === "string" ? claims.hd : null,
    };
  }

  private configuration(): Promise<client.Configuration> {
    this.config ??= client
      .discovery(
        new URL(this.options.issuer),
        this.options.clientId,
        this.options.clientSecret,
        undefined,
        this.options.allowHttp
          ? // Only the local fake issuer in tests speaks plain HTTP; deprecated just to stand out.
            // eslint-disable-next-line @typescript-eslint/no-deprecated
            { execute: [client.allowInsecureRequests] }
          : undefined,
      )
      .catch((error: unknown) => {
        this.config = undefined;
        throw new OidcError("The identity provider could not be reached", { cause: error });
      });
    return this.config;
  }
}

/** Used when no Google client is configured. */
export class DisabledIdentityProvider implements IdentityProvider {
  readonly enabled = false;

  beginAuthorization(): Promise<AuthorizationRequest> {
    return Promise.reject(new OidcError("Google sign-in isn't configured"));
  }

  completeAuthorization(): Promise<OidcProfile> {
    return Promise.reject(new OidcError("Google sign-in isn't configured"));
  }
}
