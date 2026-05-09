import type { Context } from "hono";
import type { ZodSchema, ZodError } from "zod";
import type { ApiErrorCode } from "@moor/types";

export function formatZodError(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "invalid request";
  const field = issue.path.join(".") || "request";
  return `${field}: ${issue.message}`;
}

export function validate<T>(schema: ZodSchema<T>, data: unknown, c: Context): T | Response {
  const result = schema.safeParse(data);
  if (!result.success) {
    return c.json(
      {
        error: { code: "VALIDATION_ERROR" as ApiErrorCode, message: formatZodError(result.error) },
      },
      400,
    );
  }
  return result.data;
}
