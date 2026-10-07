import { ERROR_STATUS, type ErrorCode, type ErrorEnvelope } from "@glim/contracts";
import { isAppError } from "@glim/shared";
import type { Logger } from "@glim/telemetry";
import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

const STATUS_CODES: Partial<Record<number, ErrorCode>> = {
  400: "VALIDATION_FAILED",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  412: "VERSION_MISMATCH",
  413: "VALIDATION_FAILED",
  415: "VALIDATION_FAILED",
  429: "RATE_LIMITED",
  503: "DEPENDENCY_UNAVAILABLE",
};

const MESSAGES: Partial<Record<ErrorCode, string>> = {
  NOT_FOUND: "Not found.",
  VALIDATION_FAILED: "The request is invalid.",
  RATE_LIMITED: "Too many requests. Please wait and try again.",
  INTERNAL: "Something went wrong. Please try again.",
};

export type SpaFallback = (req: FastifyRequest, reply: FastifyReply) => boolean;

/**
 * Renders every error as the envelope `{ error: { code, message, fieldErrors?, requestId } }`
 * (§5.4). Never includes stack traces, SQL or provider payloads. A browser navigation that misses
 * the API falls back to the SPA's index.html.
 */
export function createErrorRenderer(logger: Logger, spaFallback: SpaFallback | null) {
  return (exception: unknown, req: FastifyRequest, reply: FastifyReply): void => {
    let code: ErrorCode;
    let message: string | undefined;
    let fieldErrors: ErrorEnvelope["error"]["fieldErrors"];

    if (isAppError(exception)) {
      code = exception.code;
      message = exception.message;
      fieldErrors = exception.fieldErrors;
      for (const [name, value] of Object.entries(exception.headers ?? {}))
        void reply.header(name, value);
    } else {
      const status = statusOf(exception);
      if (status === 404 && spaFallback?.(req, reply)) return;
      code = (status !== undefined && STATUS_CODES[status]) || "INTERNAL";
    }

    if (code === "INTERNAL") {
      logger.error(
        { err: exception, requestId: req.id, route: req.routeOptions.url },
        "unhandled error",
      );
    }

    const body: ErrorEnvelope = {
      error: {
        code,
        message: message ?? MESSAGES[code] ?? "The request could not be completed.",
        ...(fieldErrors === undefined ? {} : { fieldErrors }),
        requestId: req.id,
      },
    };
    void reply.status(ERROR_STATUS[code]).send(body);
  };
}

/** Nest's side of the renderer: errors thrown by controllers, pipes, guards and interceptors. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  constructor(private readonly render: ReturnType<typeof createErrorRenderer>) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    this.render(exception, http.getRequest<FastifyRequest>(), http.getResponse<FastifyReply>());
  }
}

function statusOf(exception: unknown): number | undefined {
  if (exception instanceof HttpException) return exception.getStatus();
  if (typeof exception === "object" && exception !== null && "statusCode" in exception) {
    const status = exception.statusCode;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}
