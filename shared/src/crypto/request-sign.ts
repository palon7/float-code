import "./ed25519-setup.js";
import { sign, etc, verifyAsync } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha2.js";

const CONTEXT = "float-code-rest-v1";
const encoder = new TextEncoder();
const EMPTY_BODY_HASH = etc.bytesToHex(sha256(new Uint8Array()));

export function normalizeRequestTarget(url: string): string {
  const parsed = new URL(url, "http://localhost");
  return `${parsed.pathname}${parsed.search}`;
}

export function hashBody(body: string | undefined): string {
  if (!body) return EMPTY_BODY_HASH;
  return etc.bytesToHex(sha256(encoder.encode(body)));
}

export function buildSignPayload(
  method: string,
  requestTarget: string,
  timestamp: number,
  nonce: string,
  bodyHash: string,
): string {
  return `${CONTEXT}\n${method}\n${requestTarget}\n${timestamp}\n${nonce}\n${bodyHash}`;
}

export function signRequest(
  privateKeyHex: string,
  method: string,
  requestTarget: string,
  timestamp: number,
  nonce: string,
  bodyHash: string,
): string {
  const payload = buildSignPayload(
    method,
    requestTarget,
    timestamp,
    nonce,
    bodyHash,
  );
  const message = encoder.encode(payload);
  const privateKey = etc.hexToBytes(privateKeyHex);
  const signature = sign(message, privateKey);
  return etc.bytesToHex(signature);
}

export async function verifyRequestSignature(
  publicKeyHex: string,
  signatureHex: string,
  method: string,
  requestTarget: string,
  timestamp: number,
  nonce: string,
  bodyHash: string,
): Promise<boolean> {
  const payload = buildSignPayload(
    method,
    requestTarget,
    timestamp,
    nonce,
    bodyHash,
  );
  const message = encoder.encode(payload);
  try {
    const signature = etc.hexToBytes(signatureHex);
    const publicKey = etc.hexToBytes(publicKeyHex);
    return await verifyAsync(signature, message, publicKey);
  } catch {
    return false;
  }
}
