import { createMiddleware } from "hono/factory";
import { verifyToken } from "../auth/shared-token.js";
import { errorResponse } from "./error-response.js";
import { logger } from "../utils/logger.js";

const log = logger.child({ name: "api" });

export const bearerAuth = createMiddleware(async (c, next) => {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return errorResponse(
      c,
      401,
      "UNAUTHORIZED",
      "Missing or invalid Authorization header",
    );
  }

  const token = header.slice(7);
  if (!verifyToken(token)) {
    log.warn({ method: c.req.method, path: c.req.path }, "API auth failed");
    return errorResponse(c, 401, "UNAUTHORIZED", "Invalid token");
  }

  await next();
});
