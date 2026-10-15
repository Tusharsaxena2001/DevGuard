import type { PipeTransform } from "@nestjs/common";
import { ErrorCode } from "@devguard/shared";
import type { z } from "zod";
import { ApiError } from "../../errors.js";

/**
 * Validates a request body/query/param with a Zod schema from `@devguard/shared`.
 * Failures carry only the field path and issue code: never the rejected value (it may be a secret).
 */
export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  public constructor(private readonly schema: S) {}

  public transform(value: unknown): z.output<S> {
    const parsed = this.schema.safeParse(value);
    if (parsed.success) return parsed.data;
    throw new ApiError(
      ErrorCode.ValidationFailed,
      "The request is invalid.",
      parsed.error.issues.map((i) => ({ path: i.path.join("."), code: i.code })),
    );
  }
}
