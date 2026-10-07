import type { EndpointSpec } from "@glim/contracts";
import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { map, type Observable } from "rxjs";
import { ENDPOINT_METADATA } from "./endpoint";

/**
 * Parses every response through its contract schema. Unknown fields are stripped, so a handler
 * can never leak data the contract doesn't declare (§5.4, INV-15).
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const spec = this.reflector.get<EndpointSpec | undefined>(
      ENDPOINT_METADATA,
      context.getHandler(),
    );
    if (spec === undefined) return next.handle();
    return next
      .handle()
      .pipe(
        map((body: unknown) =>
          spec.successStatus === 204 ? undefined : spec.response.parse(body),
        ),
      );
  }
}
