/** Sign-in with an OpenID Connect provider (Google, TRD §8.1). */
export interface OidcProfile {
  /** The provider's stable user id (Google `sub`). */
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  /** Google Workspace domain (`hd`); null for personal accounts. */
  hostedDomain: string | null;
}

/** What the caller must keep (signed, short-lived) between the redirect and the callback. */
export interface AuthorizationRequest {
  url: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

export interface CompletionChecks {
  state: string;
  nonce: string;
  codeVerifier: string;
}

export class OidcError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OidcError";
  }
}

export interface IdentityProvider {
  /** False when no client is configured; sign-in with this provider is then unavailable. */
  readonly enabled: boolean;
  /** Authorization code flow with PKCE (S256), a state and a nonce. */
  beginAuthorization(redirectUri: string): Promise<AuthorizationRequest>;
  /** Exchanges the code and verifies the ID token; throws OidcError when anything doesn't check out. */
  completeAuthorization(callbackUrl: URL, checks: CompletionChecks): Promise<OidcProfile>;
}

export const IDENTITY_PROVIDER = Symbol.for("glim.IdentityProvider");
