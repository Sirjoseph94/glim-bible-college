import { createHash } from "node:crypto";
import type { EndpointSpec } from "@glim/contracts";
import { Db, IdempotencyStore, type IdempotencyRef } from "@glim/db";
import { AppError, CLOCK, type Clock } from "@glim/shared";
import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyReply, FastifyRequest } from "fastify";
import { catchError, from, mergeMap, of, type Observable } from "rxjs";
import { ENDPOINT_METADATA } from "./endpoint";

const KEY = /^[\x21-\x7e]{16,64}$/;

/**
 * `Idempotency-Key` for endpoints that declare `idempotent` (TRD §5.4): a retried request replays
 * the first response instead of acting twice. Registered before the response interceptor, so it
 * stores the response exactly as it went over the wire.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly store: IdempotencyStore;

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(Db) db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.store = new IdempotencyStore(db);
  }

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const spec = this.reflector.get<EndpointSpec | undefined>(
      ENDPOINT_METADATA,
      context.getHandler(),
    );
    if (spec?.idempotent !== true) return next.handle();
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string" || !KEY.test(key))
      throw new AppError(
        "VALIDATION_FAILED",
        "Send an Idempotency-Key header of 16 to 64 characters with this request.",
      );
    if (req.session === null) throw new AppError("UNAUTHENTICATED", "Please sign in.");

    const path = req.url.split("?")[0] ?? req.url;
    const ref: IdempotencyRef = {
      userId: req.session.userId,
      operation: `${spec.method} ${path}`,
      key,
    };
    const requestHash = createHash("sha256")
      .update(JSON.stringify({ url: req.url, body: req.body ?? null }))
      .digest("hex");
    const claim = await this.store.claim({ ...ref, requestHash, now: this.clock.now() });
    switch (claim.kind) {
      case "replay":
        void reply.header("idempotent-replayed", "true");
        return of(claim.body);
      case "in-progress":
        throw new AppError(
          "IDEMPOTENCY_IN_PROGRESS",
          "This request is still being processed. Wait a moment, then check again.",
        );
      case "reused":
        throw new AppError(
          "IDEMPOTENCY_KEY_REUSED",
          "That Idempotency-Key was already used for a different request.",
        );
      case "claimed": {
        const status = spec.successStatus ?? (spec.method === "POST" ? 201 : 200);
        return next.handle().pipe(
          mergeMap((body: unknown) =>
            from(
              this.store.complete(ref, { status, body: body ?? null }).then((): unknown => body),
            ),
          ),
          catchError((error: unknown) =>
            from(
              this.store.release(ref).then(() => {
                throw error;
              }),
            ),
          ),
        );
      }
    }
  }
}
