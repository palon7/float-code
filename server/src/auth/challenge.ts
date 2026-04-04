import * as crypto from "node:crypto";
import "@float-code/shared/crypto/ed25519-setup";
import { verifyAsync, etc } from "@noble/ed25519";
import type { AuthChallenge } from "@float-code/shared/protocol";

const CHALLENGE_LIFETIME_MS = 10_000; // 10s

export function createChallenge(publicKey: string): AuthChallenge {
  const now = new Date();
  return {
    kind: "float-code-auth-v1",
    challengeId: crypto.randomUUID(),
    publicKey,
    nonce: crypto.randomBytes(32).toString("hex"),
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CHALLENGE_LIFETIME_MS).toISOString(),
  };
}

export function serializeChallenge(challenge: AuthChallenge): string {
  return JSON.stringify(challenge);
}

export async function verifySignature(
  challenge: AuthChallenge,
  signatureHex: string,
  publicKeyHex: string,
): Promise<boolean> {
  if (new Date(challenge.expiresAt).getTime() < Date.now()) {
    return false;
  }

  if (challenge.publicKey !== publicKeyHex) {
    return false;
  }

  try {
    const message = new TextEncoder().encode(serializeChallenge(challenge));
    const signature = etc.hexToBytes(signatureHex);
    const publicKey = etc.hexToBytes(publicKeyHex);
    return await verifyAsync(signature, message, publicKey);
  } catch {
    return false;
  }
}
