import type { Context } from "hono";
import type { ErrorResponse } from "@float-code/shared/protocol";

export function errorResponse(
  c: Context,
  status: 400 | 401 | 404,
  code: ErrorResponse["error"]["code"],
  message: string,
) {
  return c.json<ErrorResponse>({ error: { code, message } }, status);
}
