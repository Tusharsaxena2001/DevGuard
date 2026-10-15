import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import { ErrorCode } from "@devguard/shared";
import type { Response } from "express";
import { ApiError, GENERIC_MESSAGES, httpStatusFor } from "../../errors.js";

interface ErrorBody {
  readonly code: ErrorCode;
  readonly message: string;
  readonly issues?: readonly { readonly path: string; readonly code: string }[];
}

const CODE_BY_STATUS: Readonly<Record<number, ErrorCode>> = {
  400: ErrorCode.ValidationFailed,
  401: ErrorCode.Unauthenticated,
  403: ErrorCode.Forbidden,
  404: ErrorCode.NotFound,
  409: ErrorCode.Conflict,
  413: ErrorCode.ValidationFailed,
  429: ErrorCode.RateLimited,
};

function statusOf(error: unknown): number | undefined {
  if (error instanceof HttpException) return error.getStatus();
  // body-parser / http-errors style errors (malformed JSON, payload too large)
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status: unknown }).status;
    if (typeof status === "number" && status >= 400 && status < 500) return status;
  }
  return undefined;
}

/** Maps any thrown value to `{ code, message, issues? }`. Never includes stacks, SQL, or raw error text. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  public catch(exception: unknown, host: ArgumentsHost): void {
    const { status, body } = this.describe(exception);
    host.switchToHttp().getResponse<Response>().status(status).json(body);
  }

  private describe(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof ApiError) {
      const body: ErrorBody = { code: exception.code, message: exception.message };
      return {
        status: httpStatusFor(exception.code),
        body: exception.issues.length > 0 ? { ...body, issues: exception.issues } : body,
      };
    }
    const status = statusOf(exception);
    const code = status === undefined ? undefined : CODE_BY_STATUS[status];
    if (status !== undefined && code !== undefined) {
      return { status, body: { code, message: GENERIC_MESSAGES[code] } };
    }
    // Unknown failure: log the error name only (messages from drivers can contain connection strings or values).
    this.logger.error(`Unhandled exception: ${exception instanceof Error ? exception.name : typeof exception}`);
    return { status: 500, body: { code: ErrorCode.Internal, message: GENERIC_MESSAGES[ErrorCode.Internal] } };
  }
}
