import * as crypto from "node:crypto";
import { getConfig } from "../config.js";

let cachedTokenBuffer: Buffer | null = null;

export function initTokenCache(): void {
  cachedTokenBuffer = Buffer.from(getConfig().authToken);
}

export function verifyToken(token: string): boolean {
  if (!cachedTokenBuffer) {
    throw new Error(
      "Token cache not initialized. Call initTokenCache() first.",
    );
  }
  const actual = Buffer.from(token);
  if (cachedTokenBuffer.length !== actual.length) return false;
  return crypto.timingSafeEqual(cachedTokenBuffer, actual);
}
