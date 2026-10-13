import { importPKCS8, SignJWT } from "jose";

/** OAuth scopes the integration uses (TRD §11.3). The wizard shows the DWD ones to the admin. */
export const SCOPES = {
  meetCreated: "https://www.googleapis.com/auth/meetings.space.created",
  meetReadonly: "https://www.googleapis.com/auth/meetings.space.readonly",
  driveMeet: "https://www.googleapis.com/auth/drive.meet.readonly",
  drive: "https://www.googleapis.com/auth/drive",
  pubsub: "https://www.googleapis.com/auth/pubsub",
} as const;

/** What the Admin Console's domain-wide delegation entry must list (Appendix A.2 step 4). */
export const DWD_SCOPES = [
  SCOPES.meetCreated,
  SCOPES.meetReadonly,
  SCOPES.driveMeet,
  SCOPES.drive,
] as const;

export interface ServiceAccount {
  clientEmail: string;
  privateKey: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** The token endpoint refused (a 4xx is a configuration problem, e.g. DWD scopes not granted). */
export class TokenError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TokenError";
  }
}

const SKEW_MS = 5 * 60_000;

/**
 * Access tokens for the service account, acting as a Workspace user through domain-wide
 * delegation (`subject`) or as itself (Pub/Sub). Uses the JWT-bearer grant (RFC 7523), signed
 * with `jose`. Tokens are cached per (subject, scopes) until five minutes before expiry and are
 * never logged.
 */
export class ServiceAccountTokens {
  private key: Awaited<ReturnType<typeof importPKCS8>> | null = null;
  private readonly cache = new Map<string, { token: string; expiresAt: number }>();

  constructor(
    private readonly account: ServiceAccount,
    private readonly options: {
      tokenUrl?: string;
      fetch?: FetchLike;
      now?: () => number;
    } = {},
  ) {}

  private get tokenUrl() {
    return this.options.tokenUrl ?? "https://oauth2.googleapis.com/token";
  }

  private now() {
    return this.options.now?.() ?? Date.now();
  }

  /** Forgets a cached token (after a 401). */
  invalidate(subject: string | null, scopes: readonly string[]): void {
    this.cache.delete(cacheKey(subject, scopes));
  }

  async token(subject: string | null, scopes: readonly string[]): Promise<string> {
    const key = cacheKey(subject, scopes);
    const cached = this.cache.get(key);
    if (cached !== undefined && cached.expiresAt - SKEW_MS > this.now()) return cached.token;

    this.key ??= await importPKCS8(this.account.privateKey, "RS256");
    const issuedAt = Math.floor(this.now() / 1000);
    const jwt = new SignJWT({ scope: scopes.join(" ") })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(this.account.clientEmail)
      .setAudience(this.tokenUrl)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 3600);
    if (subject !== null) jwt.setSubject(subject);
    const assertion = await jwt.sign(this.key);

    const response = await (this.options.fetch ?? fetch)(this.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
    });
    if (!response.ok) {
      // Google's error code only (e.g. unauthorized_client): never the assertion or a token.
      let reason = `HTTP ${String(response.status)}`;
      try {
        const body = (await response.json()) as { error?: unknown };
        if (typeof body.error === "string") reason = body.error;
      } catch {
        // keep the status
      }
      throw new TokenError(
        `Token request for ${subject ?? "the service account"} failed: ${reason}`,
        response.status,
      );
    }
    const body = (await response.json()) as { access_token: string; expires_in: number };
    this.cache.set(key, {
      token: body.access_token,
      expiresAt: this.now() + body.expires_in * 1000,
    });
    return body.access_token;
  }
}

function cacheKey(subject: string | null, scopes: readonly string[]) {
  return `${subject ?? ""}|${[...scopes].sort().join(" ")}`;
}
