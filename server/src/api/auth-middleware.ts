import { createMiddleware } from "hono/factory";
import {
  normalizeRequestTarget,
  verifyRequestSignature,
  hashBody,
} from "@float-code/shared/crypto/request-sign";
import { isApproved } from "../auth/approved-keys.js";
import { claimNonce } from "../auth/nonce-store.js";
import { errorResponse } from "./error-response.js";
import { logger } from "../utils/logger.js";

const log = logger.child({ name: "api" });

const TIMESTAMP_TOLERANCE_MS = 30_000;
const HEX_64_RE = /^[0-9a-f]{64}$/;
const HEX_128_RE = /^[0-9a-f]{128}$/;
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const BODYLESS_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const signatureAuth = createMiddleware(async (c, next) => {
  const publicKey = c.req.header("X-Public-Key");
  const timestampStr = c.req.header("X-Timestamp");
  const nonce = c.req.header("X-Nonce");
  const signature = c.req.header("X-Signature");

  if (
    !publicKey ||
    !timestampStr ||
    !nonce ||
    !signature ||
    !HEX_64_RE.test(publicKey) ||
    !HEX_128_RE.test(signature) ||
    !UUID_V4_RE.test(nonce)
  ) {
    return errorResponse(
      c,
      401,
      "SIGNATURE_INVALID",
      "Missing or malformed signature headers",
    );
  }

  const timestamp = Number(timestampStr);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    return errorResponse(
      c,
      401,
      "SIGNATURE_INVALID",
      "Invalid timestamp format",
    );
  }

  const diff = Math.abs(Date.now() - timestamp);
  if (diff > TIMESTAMP_TOLERANCE_MS) {
    return errorResponse(
      c,
      401,
      "TIMESTAMP_OUT_OF_RANGE",
      "Request timestamp is out of acceptable range",
    );
  }

  if (!(await isApproved(publicKey))) {
    log.warn(
      { publicKey: publicKey.slice(0, 16) },
      "Unapproved key REST attempt",
    );
    return errorResponse(
      c,
      401,
      "KEY_NOT_APPROVED",
      "Public key is not approved",
    );
  }

  const requestTarget = normalizeRequestTarget(c.req.url);
  const body = BODYLESS_METHODS.has(c.req.method)
    ? undefined
    : await c.req.text();
  const bodyDigest = hashBody(body);

  const valid = await verifyRequestSignature(
    publicKey,
    signature,
    c.req.method,
    requestTarget,
    timestamp,
    nonce,
    bodyDigest,
  );

  if (!valid) {
    log.warn(
      { method: c.req.method, path: c.req.path },
      "API signature verification failed",
    );
    return errorResponse(
      c,
      401,
      "SIGNATURE_INVALID",
      "Request signature verification failed",
    );
  }

  // Claim nonce after signature verification to prevent
  // unauthenticated requests from exhausting the nonce store
  if (!claimNonce(nonce)) {
    return errorResponse(
      c,
      401,
      "NONCE_REUSED",
      "Request nonce has already been used",
    );
  }

  await next();
});
