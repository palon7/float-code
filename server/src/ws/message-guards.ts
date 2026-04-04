import type { ClientMessage } from "@float-code/shared/protocol";

const HEX_32_BYTES = /^[0-9a-f]{64}$/i;
const HEX_64_BYTES = /^[0-9a-f]{128}$/i;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function isAuthMessage(
  v: unknown,
): v is Extract<ClientMessage, { type: "auth" }> {
  if (!isObject(v) || v.type !== "auth") return false;
  return (
    typeof v.publicKey === "string" &&
    HEX_32_BYTES.test(v.publicKey) &&
    typeof v.authToken === "string" &&
    v.authToken.length > 0
  );
}

export function isAuthResponseMessage(
  v: unknown,
): v is Extract<ClientMessage, { type: "auth.response" }> {
  if (!isObject(v) || v.type !== "auth.response") return false;
  return typeof v.signature === "string" && HEX_64_BYTES.test(v.signature);
}

export function getMessageType(v: unknown): string | null {
  if (!isObject(v) || typeof v.type !== "string") return null;
  return v.type;
}
