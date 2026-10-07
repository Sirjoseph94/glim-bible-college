import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from "jose";

/** Who the next person to "sign in at Google" is. */
export interface FakeGoogleUser {
  sub: string;
  email: string;
  emailVerified?: boolean;
  name?: string;
  hd?: string;
}

interface PendingCode {
  user: FakeGoogleUser;
  nonce: string | null;
  codeChallenge: string | null;
  redirectUri: string;
}

/**
 * A minimal OpenID Connect issuer for tests: discovery, an authorization endpoint that signs in
 * whoever is queued with `nextSignIn`, a token endpoint that checks the client secret and PKCE,
 * and RS256 ID tokens. It behaves like Google for the parts the app relies on.
 */
export class FakeOidcIssuer {
  readonly clientId = "fake-client-id.apps.googleusercontent.com";
  readonly clientSecret = "fake-client-secret";
  private server: Server | undefined;
  private issuer = "";
  private privateKey: CryptoKey | undefined;
  private jwk: JWK | undefined;
  private queue: FakeGoogleUser[] = [];
  private readonly codes = new Map<string, PendingCode>();

  get issuerUrl(): string {
    return this.issuer;
  }

  /** The next authorization request signs in as this user. */
  nextSignIn(user: FakeGoogleUser): void {
    this.queue.push(user);
  }

  async start(): Promise<this> {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    this.privateKey = privateKey;
    this.jwk = { ...(await exportJWK(publicKey)), kid: "fake-key", alg: "RS256", use: "sig" };
    this.server = createServer((req, res) => {
      this.handle(req, res).catch((error: unknown) => {
        res.statusCode = 500;
        res.end(String(error));
      });
    });
    await new Promise<void>((resolve) => this.server?.listen(0, "127.0.0.1", resolve));
    const { port } = this.server.address() as AddressInfo;
    this.issuer = `http://127.0.0.1:${String(port)}`;
    return this;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (this.server === undefined) resolve();
      else
        this.server.close(() => {
          resolve();
        });
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", this.issuer);
    if (url.pathname === "/.well-known/openid-configuration") {
      json(res, 200, {
        issuer: this.issuer,
        authorization_endpoint: `${this.issuer}/authorize`,
        token_endpoint: `${this.issuer}/token`,
        jwks_uri: `${this.issuer}/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
      });
      return;
    }
    if (url.pathname === "/jwks") {
      json(res, 200, { keys: [this.jwk] });
      return;
    }
    if (url.pathname === "/authorize") {
      this.authorize(url, res);
      return;
    }
    if (url.pathname === "/token" && req.method === "POST") return this.token(req, res);
    json(res, 404, { error: "not_found" });
  }

  private authorize(url: URL, res: ServerResponse): void {
    const user = this.queue.shift();
    const redirectUri = url.searchParams.get("redirect_uri") ?? "";
    if (user === undefined || url.searchParams.get("client_id") !== this.clientId) {
      json(res, 400, { error: "invalid_request" });
      return;
    }
    const code = randomBytes(16).toString("base64url");
    this.codes.set(code, {
      user,
      nonce: url.searchParams.get("nonce"),
      codeChallenge: url.searchParams.get("code_challenge"),
      redirectUri,
    });
    const back = new URL(redirectUri);
    back.searchParams.set("code", code);
    const state = url.searchParams.get("state");
    if (state !== null) back.searchParams.set("state", state);
    res.writeHead(302, { location: back.toString() });
    res.end();
  }

  private async token(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const form = new URLSearchParams(await readBody(req));
    const basic = /^Basic (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    const [id, secret] = basic
      ? Buffer.from(basic, "base64").toString().split(":").map(decodeURIComponent)
      : [form.get("client_id"), form.get("client_secret")];
    if (id !== this.clientId || secret !== this.clientSecret) {
      json(res, 401, { error: "invalid_client" });
      return;
    }

    const pending = this.codes.get(form.get("code") ?? "");
    this.codes.delete(form.get("code") ?? "");
    if (pending === undefined || pending.redirectUri !== form.get("redirect_uri")) {
      json(res, 400, { error: "invalid_grant" });
      return;
    }
    const challenge = createHash("sha256")
      .update(form.get("code_verifier") ?? "")
      .digest("base64url");
    if (pending.codeChallenge !== challenge) {
      json(res, 400, { error: "invalid_grant" });
      return;
    }

    const { user } = pending;
    const idToken = await new SignJWT({
      email: user.email,
      email_verified: user.emailVerified ?? true,
      ...(user.name === undefined ? {} : { name: user.name }),
      ...(user.hd === undefined ? {} : { hd: user.hd }),
      ...(pending.nonce === null ? {} : { nonce: pending.nonce }),
    })
      .setProtectedHeader({ alg: "RS256", kid: "fake-key" })
      .setIssuer(this.issuer)
      .setAudience(this.clientId)
      .setSubject(user.sub)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(this.privateKey as CryptoKey);
    json(res, 200, {
      access_token: "fake-access-token",
      token_type: "Bearer",
      expires_in: 3600,
      id_token: idToken,
    });
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString();
}
