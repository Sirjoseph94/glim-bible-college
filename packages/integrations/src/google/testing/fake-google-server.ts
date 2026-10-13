import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { decodeJwt } from "jose";
import { MeetWorld, type WorldFailure } from "../../live-provider/world";
import type { GoogleEndpoints } from "../meet-provider";

/**
 * Google's token, Meet v2, Drive v3, Workspace Events v1 and Pub/Sub v1 endpoints, as far as the
 * adapter uses them, served over a `MeetWorld` (TRD §21.3). The adapter's contract tests talk to
 * this over real HTTP, so request building, paging, auth and error mapping are all exercised.
 * Scripted failures use the port method's name (`world.failNext("provisionSpace", …)`).
 */
export class FakeGoogleServer {
  readonly requests: string[] = [];
  /** Token requests seen (each mints a new token). */
  tokensIssued = 0;
  /** Extra HTTP responses to send before handling, by route op (e.g. 429 with Retry-After). */
  private readonly canned = new Map<
    string,
    { status: number; headers?: Record<string, string> }[]
  >();
  private readonly tokens = new Map<string, { sub: string | null; scopes: string[] }>();
  private readonly operations = new Map<string, unknown>();
  private server: Server | null = null;
  private base = "";
  private seq = 0;

  constructor(readonly world: MeetWorld = new MeetWorld()) {}

  async start(): Promise<this> {
    this.server = createServer((req, res) => {
      void this.handle(req, res).catch((error: unknown) => {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: String(error) } }));
      });
    });
    await new Promise<void>((resolve) => this.server?.listen(0, "127.0.0.1", resolve));
    const { port } = this.server.address() as AddressInfo;
    this.base = `http://127.0.0.1:${String(port)}`;
    return this;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (this.server === null) resolve();
      else
        this.server.close(() => {
          resolve();
        });
    });
  }

  get endpoints(): GoogleEndpoints {
    return {
      token: `${this.base}/token`,
      meet: `${this.base}/meet/v2`,
      drive: `${this.base}/drive/v3`,
      events: `${this.base}/events/v1`,
      pubsub: `${this.base}/pubsub/v1`,
    };
  }

  /** Every token issued so far stops working (the adapter should refresh once). */
  revokeTokens(): void {
    this.tokens.clear();
  }

  /** The next calls to `op` get these raw responses first. */
  respond(op: string, ...responses: { status: number; headers?: Record<string, string> }[]): this {
    this.canned.set(op, [...(this.canned.get(op) ?? []), ...responses]);
    return this;
  }

  /** Who a request authenticated as (for DWD assertions in tests). */
  lastSubjects: (string | null)[] = [];

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<unknown> {
    const url = new URL(req.url ?? "/", this.base);
    const method = req.method ?? "GET";
    this.requests.push(`${method} ${url.pathname}`);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    const send = (status: number, body?: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(body === undefined ? "" : JSON.stringify(body));
      return true as const;
    };
    const error = (status: number, message: string) =>
      send(status, { error: { code: status, message, status: STATUS[status] ?? "ERROR" } });

    if (url.pathname === "/token") {
      const form = new URLSearchParams(raw);
      const claims = decodeJwt(form.get("assertion") ?? "");
      const failure = this.world.take("token");
      if (failure !== null)
        return error(failure === "unavailable" ? 503 : 400, "unauthorized_client");
      const token = `fake-token-${String(++this.tokensIssued)}`;
      this.tokens.set(token, {
        sub: typeof claims.sub === "string" ? claims.sub : null,
        scopes: typeof claims.scope === "string" ? claims.scope.split(" ") : [],
      });
      return send(200, { access_token: token, expires_in: 3600, token_type: "Bearer" });
    }

    const auth = this.tokens.get((req.headers.authorization ?? "").replace(/^Bearer /, ""));
    if (auth === undefined) return error(401, "Request had invalid authentication credentials.");
    this.lastSubjects.push(auth.sub);

    const route = this.route(method, url.pathname);
    if (route === null) return error(404, `No route for ${method} ${url.pathname}`);
    const canned = this.canned.get(route.op)?.shift();
    if (canned !== undefined) return send(canned.status, {}, canned.headers);
    if (route.take) {
      const failure = this.world.take(route.op);
      if (failure !== null) return error(FAILURE_STATUS[failure], `Scripted ${failure}.`);
    }
    const body = raw === "" ? {} : (JSON.parse(raw) as Record<string, unknown>);
    return route.run({ url, body, sub: auth.sub, send, error, req, res });
  }

  private route(
    method: string,
    path: string,
  ): { op: string; take: boolean; run: (ctx: Ctx) => unknown } | null {
    const w = this.world;
    const m = (re: RegExp) => re.exec(path);
    let g: RegExpExecArray | null;
    const ownSpace = (ctx: Ctx, id: string) => {
      const space = w.space(id);
      return space !== undefined && space.hostEmail === ctx.sub ? space : null;
    };
    const page = (ctx: Ctx, key: string, items: unknown[], size = 2) => {
      const start = Number(ctx.url.searchParams.get("pageToken") ?? "0");
      const next = start + size < items.length ? String(start + size) : undefined;
      return ctx.send(200, {
        [key]: items.slice(start, start + size),
        ...(next ? { nextPageToken: next } : {}),
      });
    };
    const conference = (c: {
      conferenceId: string;
      spaceId: string;
      startedAt: Date;
      endedAt: Date | null;
    }) => ({
      name: `conferenceRecords/${c.conferenceId}`,
      startTime: c.startedAt.toISOString(),
      ...(c.endedAt === null ? {} : { endTime: c.endedAt.toISOString() }),
      space: `spaces/${c.spaceId}`,
    });

    // ---- Meet v2 ----
    if (method === "POST" && path === "/meet/v2/spaces")
      return {
        op: "provisionSpace",
        take: true,
        run: (ctx) => {
          if (ctx.sub === null) return ctx.error(403, "Needs a user.");
          const config = ctx.body.config as {
            accessType: "RESTRICTED";
            moderation: string;
            moderationRestrictions: { presentRestriction: "HOSTS_ONLY" };
            artifactConfig: { recordingConfig: { autoRecordingGeneration: string } };
          };
          const space = w.createSpace(ctx.sub, {
            accessType: config.accessType,
            moderation: config.moderation === "ON",
            presentRestriction: config.moderationRestrictions.presentRestriction,
            autoRecording: config.artifactConfig.recordingConfig.autoRecordingGeneration === "ON",
          });
          return ctx.send(200, {
            name: `spaces/${space.spaceId}`,
            meetingUri: space.joinUrl,
            meetingCode: space.meetingCode,
            config,
          });
        },
      };
    if ((g = m(/^\/meet\/v2\/spaces\/([^/:]+)$/)) && method === "GET") {
      const id = g[1] ?? "";
      return {
        op: "getSpaceStatus",
        take: true,
        run: (ctx) => {
          const space = ownSpace(ctx, id);
          if (space === null) return ctx.error(404, "Space not found.");
          return ctx.send(200, {
            name: `spaces/${id}`,
            meetingUri: space.joinUrl,
            meetingCode: space.meetingCode,
            ...(space.activeConferenceId === null
              ? {}
              : {
                  activeConference: {
                    conferenceRecord: `conferenceRecords/${space.activeConferenceId}`,
                  },
                }),
          });
        },
      };
    }
    if ((g = m(/^\/meet\/v2\/spaces\/([^/:]+):endActiveConference$/)) && method === "POST") {
      const id = g[1] ?? "";
      return {
        op: "endActiveConference",
        take: true,
        run: (ctx) => {
          const space = ownSpace(ctx, id);
          if (space === null) return ctx.error(404, "Space not found.");
          if (space.activeConferenceId === null) return ctx.error(400, "No active conference.");
          w.endConference(space.activeConferenceId);
          return ctx.send(200, {});
        },
      };
    }
    if ((g = m(/^\/meet\/v2\/spaces\/([^/]+)\/members$/))) {
      const id = g[1] ?? "";
      if (method === "GET")
        return {
          op: "syncAccess",
          take: true,
          run: (ctx) => {
            const space = ownSpace(ctx, id);
            if (space === null) return ctx.error(404, "Space not found.");
            return page(
              ctx,
              "members",
              [...space.members].map(([email, role]) => ({
                name: `spaces/${id}/members/${Buffer.from(email).toString("base64url")}`,
                email,
                role,
              })),
            );
          },
        };
      if (method === "POST")
        return {
          op: "members.create",
          take: false,
          run: (ctx) => {
            const space = ownSpace(ctx, id);
            if (space === null) return ctx.error(404, "Space not found.");
            const email = String(ctx.body.email).toLowerCase();
            if (space.members.has(email)) return ctx.error(409, "Already a member.");
            const role = ctx.body.role === "COHOST" ? "COHOST" : "MEMBER";
            space.members.set(email, role);
            return ctx.send(200, {
              name: `spaces/${id}/members/${Buffer.from(email).toString("base64url")}`,
              email,
              role,
            });
          },
        };
    }
    if ((g = m(/^\/meet\/v2\/spaces\/([^/]+)\/members\/([^/]+)$/)) && method === "DELETE") {
      const id = g[1] ?? "";
      const email = Buffer.from(g[2] ?? "", "base64url").toString("utf8");
      return {
        op: "members.delete",
        take: false,
        run: (ctx) => {
          const space = ownSpace(ctx, id);
          if (space?.members.delete(email) !== true) return ctx.error(404, "No such member.");
          return ctx.send(200, {});
        },
      };
    }
    if (method === "GET" && path === "/meet/v2/conferenceRecords")
      return {
        op: "listConferences",
        take: true,
        run: (ctx) => {
          const spaceName = /space\.name\s*=\s*"spaces\/([^"]+)"/.exec(
            ctx.url.searchParams.get("filter") ?? "",
          )?.[1];
          if (spaceName === undefined) return ctx.error(400, "Filter required.");
          if (ownSpace(ctx, spaceName) === null) return ctx.error(404, "Space not found.");
          return page(ctx, "conferenceRecords", w.conferencesOf(spaceName).map(conference));
        },
      };
    if ((g = m(/^\/meet\/v2\/conferenceRecords\/([^/]+)$/)) && method === "GET") {
      const id = g[1] ?? "";
      return {
        op: "getConference",
        take: true,
        run: (ctx) => {
          const c = w.conferences.get(id);
          if (c === undefined || w.space(c.spaceId)?.hostEmail !== ctx.sub)
            return ctx.error(404, "Conference not found.");
          return ctx.send(200, conference(c));
        },
      };
    }
    if ((g = m(/^\/meet\/v2\/conferenceRecords\/([^/]+)\/participants$/)) && method === "GET") {
      const id = g[1] ?? "";
      return {
        op: "listParticipantSessions",
        take: true,
        run: (ctx) => {
          if (!w.conferences.has(id)) return ctx.error(404, "Conference not found.");
          const seen = new Map<string, unknown>();
          for (const s of w.sessions.get(id) ?? [])
            if (!seen.has(s.participantId))
              seen.set(s.participantId, {
                name: `conferenceRecords/${id}/participants/${s.participantId}`,
                ...(s.kind === "SIGNED_IN"
                  ? {
                      signedinUser: {
                        user: s.providerUserId ?? undefined,
                        displayName: s.displayName ?? undefined,
                      },
                    }
                  : s.kind === "PHONE"
                    ? { phoneUser: { displayName: s.displayName ?? undefined } }
                    : { anonymousUser: { displayName: s.displayName ?? undefined } }),
              });
          return page(ctx, "participants", [...seen.values()]);
        },
      };
    }
    if (
      (g = m(
        /^\/meet\/v2\/conferenceRecords\/([^/]+)\/participants\/([^/]+)\/participantSessions$/,
      )) &&
      method === "GET"
    ) {
      const id = g[1] ?? "";
      const pid = g[2] ?? "";
      return {
        op: "participantSessions.list",
        take: false,
        run: (ctx) => {
          return page(
            ctx,
            "participantSessions",
            (w.sessions.get(id) ?? [])
              .filter((s) => s.participantId === pid)
              .map((s) => ({
                name: `conferenceRecords/${id}/participants/${pid}/participantSessions/${s.sessionId}`,
                startTime: s.startedAt.toISOString(),
                ...(s.endedAt === null ? {} : { endTime: s.endedAt.toISOString() }),
              })),
          );
        },
      };
    }
    if ((g = m(/^\/meet\/v2\/conferenceRecords\/([^/]+)\/recordings$/)) && method === "GET") {
      const id = g[1] ?? "";
      return {
        op: "listRecordings",
        take: true,
        run: (ctx) => {
          if (!w.conferences.has(id)) return ctx.error(404, "Conference not found.");
          return page(
            ctx,
            "recordings",
            (w.recordings.get(id) ?? []).map((r) => ({
              name: `conferenceRecords/${id}/recordings/${r.recordingId}`,
              state: r.state,
              startTime: r.startedAt.toISOString(),
              ...(r.endedAt === null ? {} : { endTime: r.endedAt.toISOString() }),
              ...(r.fileId === null ? {} : { driveDestination: { file: r.fileId } }),
            })),
          );
        },
      };
    }

    // ---- Drive v3 ----
    if ((g = m(/^\/drive\/v3\/files\/([^/]+)$/))) {
      const id = g[1] ?? "";
      if (method === "GET" && path.length > 0)
        return {
          op: "drive.get",
          take: false,
          run: (ctx) => {
            const media = ctx.url.searchParams.get("alt") === "media";
            const failure = w.take(media ? "openArtifactStream" : "describeArtifact");
            if (failure !== null) return ctx.error(FAILURE_STATUS[failure], `Scripted ${failure}.`);
            const file = w.files.get(id);
            if (file === undefined || file.ownerEmail !== ctx.sub || (media && file.trashed))
              return ctx.error(404, "File not found.");
            if (!media)
              return ctx.send(200, {
                id,
                size: String(file.bytes.length),
                mimeType: file.mime,
                trashed: file.trashed,
                ...(file.durationMs === null
                  ? {}
                  : { videoMediaMetadata: { durationMillis: String(file.durationMs) } }),
              });
            const range = /^bytes=(\d+)-$/.exec(ctx.req.headers.range ?? "");
            const start = range === null ? 0 : Number(range[1]);
            const bytes = file.bytes.subarray(start);
            ctx.res.writeHead(range === null ? 200 : 206, {
              "content-type": file.mime,
              "content-length": String(bytes.length),
            });
            ctx.res.end(bytes);
            return true;
          },
        };
      if (method === "PATCH")
        return {
          op: "trashArtifact",
          take: true,
          run: (ctx) => {
            const file = w.files.get(id);
            if (file === undefined || file.ownerEmail !== ctx.sub)
              return ctx.error(404, "File not found.");
            file.trashed = ctx.body.trashed === true;
            return ctx.send(200, { id, trashed: file.trashed });
          },
        };
    }
    if (method === "GET" && path === "/drive/v3/about")
      return {
        op: "storageUsage",
        take: true,
        run: (ctx) => {
          if (ctx.sub === null) return ctx.error(403, "Needs a user.");
          const host = w.host(ctx.sub);
          return ctx.send(200, {
            storageQuota: {
              usage: String(host.usedBytes),
              ...(host.limitBytes === null ? {} : { limit: String(host.limitBytes) }),
            },
          });
        },
      };

    // ---- Workspace Events v1 ----
    if (method === "POST" && path === "/events/v1/subscriptions")
      return {
        op: "subscribe",
        take: true,
        run: (ctx) => {
          const target = String(ctx.body.targetResource);
          const userId = target.slice(target.lastIndexOf("/") + 1);
          const host = [...w.hosts].find(([, h]) => h.userId === userId);
          if (host === undefined || host[0] !== ctx.sub) return ctx.error(403, "Not your user.");
          const name = `subscriptions/sub-${userId}`;
          const expiresAt = new Date(w.now().getTime() + w.subscriptionLifetimeMs);
          w.subscriptions.set(name, { hostEmail: host[0], expiresAt });
          // Not done at first: the adapter must poll the operation.
          const op = `operations/op${String(++this.seq)}`;
          this.operations.set(op, { name, expireTime: expiresAt.toISOString() });
          return ctx.send(200, { name: op, done: false });
        },
      };
    if ((g = m(/^\/events\/v1\/(operations\/[^/]+)$/)) && method === "GET") {
      const op = g[1] ?? "";
      return {
        op: "operations.get",
        take: false,
        run: (ctx) => {
          const response = this.operations.get(op);
          if (response === undefined) return ctx.error(404, "No such operation.");
          return ctx.send(200, { name: op, done: true, response });
        },
      };
    }
    if ((g = m(/^\/events\/v1\/(subscriptions\/[^/]+)$/)) && method === "PATCH") {
      const name = g[1] ?? "";
      return {
        op: "renewSubscription",
        take: true,
        run: (ctx) => {
          const sub = w.subscriptions.get(name);
          if (sub?.hostEmail !== ctx.sub) return ctx.error(404, "No such subscription.");
          sub.expiresAt = new Date(w.now().getTime() + w.subscriptionLifetimeMs);
          return ctx.send(200, {
            name: `operations/renew${String(++this.seq)}`,
            done: true,
            response: { name, expireTime: sub.expiresAt.toISOString() },
          });
        },
      };
    }

    // ---- Pub/Sub v1 ----
    if (
      (g = m(/^\/pubsub\/v1\/projects\/[^/]+\/subscriptions\/[^/:]+:(pull|acknowledge)$/)) &&
      method === "POST"
    ) {
      const action = g[1];
      if (action === "pull")
        return {
          op: "pullEvents",
          take: true,
          run: (ctx) => {
            if (ctx.sub !== null) return ctx.error(403, "Pub/Sub uses the service account.");
            const max = Number(ctx.body.maxMessages ?? 10);
            return ctx.send(200, {
              receivedMessages: [...w.pending.entries()].slice(0, max).map(([ackId, e]) => ({
                ackId,
                message: {
                  messageId: e.messageId,
                  data: e.data,
                  attributes: e.attributes,
                  publishTime: e.publishTime,
                },
              })),
            });
          },
        };
      return {
        op: "ackEvents",
        take: true,
        run: (ctx) => {
          for (const id of (ctx.body.ackIds as string[] | undefined) ?? []) w.pending.delete(id);
          return ctx.send(200, {});
        },
      };
    }
    return null;
  }
}

interface Ctx {
  url: URL;
  body: Record<string, unknown>;
  sub: string | null;
  req: IncomingMessage;
  res: ServerResponse;
  send: (status: number, body?: unknown, headers?: Record<string, string>) => true;
  error: (status: number, message: string) => true;
}

const FAILURE_STATUS: Record<WorldFailure, number> = {
  unavailable: 503,
  permanent: 403,
  notfound: 404,
};
const STATUS: Record<number, string> = {
  400: "INVALID_ARGUMENT",
  401: "UNAUTHENTICATED",
  403: "PERMISSION_DENIED",
  404: "NOT_FOUND",
  409: "ALREADY_EXISTS",
  429: "RESOURCE_EXHAUSTED",
  503: "UNAVAILABLE",
};
