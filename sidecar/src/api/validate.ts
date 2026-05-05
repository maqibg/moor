import type { Context } from "hono";
import type { ZodSchema, ZodError } from "zod";

export function validate<T>(schema: ZodSchema<T>, data: unknown, c: Context): T | Response {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = (result.error as ZodError).issues[0];
    const field = issue?.path.join(".") || "request";
    return c.json({ error: `${field}: ${issue?.message ?? "invalid value"}` }, 400);
  }
  return result.data;
}
