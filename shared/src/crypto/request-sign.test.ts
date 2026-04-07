import { describe, it, expect } from "vitest";
import { generateKeypair } from "./sign.js";
import {
  normalizeRequestTarget,
  buildSignPayload,
  signRequest,
  verifyRequestSignature,
  hashBody,
} from "./request-sign.js";

describe("normalizeRequestTarget", () => {
  it("returns pathname only when no query", () => {
    expect(normalizeRequestTarget("/api/workspaces/recent")).toBe(
      "/api/workspaces/recent",
    );
  });

  it("returns pathname + query for URLs with query params", () => {
    expect(normalizeRequestTarget("/api/sessions?workspacePath=%2Ftmp")).toBe(
      "/api/sessions?workspacePath=%2Ftmp",
    );
  });

  it("normalizes full URL to pathname + search", () => {
    expect(
      normalizeRequestTarget(
        "http://localhost:3210/api/workspaces/recent?a=1&b=2",
      ),
    ).toBe("/api/workspaces/recent?a=1&b=2");
  });

  it("normalizes percent-encoding", () => {
    expect(normalizeRequestTarget("/api/sessions?path=/tmp/my%20dir")).toBe(
      "/api/sessions?path=/tmp/my%20dir",
    );
  });
});

describe("hashBody", () => {
  // SHA-256 of empty input
  const EMPTY_HASH =
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

  it("returns SHA-256 of empty for undefined", () => {
    expect(hashBody(undefined)).toBe(EMPTY_HASH);
  });

  it("returns SHA-256 of the body string", () => {
    const hash = hashBody('{"key":"value"}');
    expect(hash).toHaveLength(64);
    expect(hash).not.toBe(EMPTY_HASH);
  });

  it("returns different hashes for different bodies", () => {
    expect(hashBody("body-a")).not.toBe(hashBody("body-b"));
  });

  it("returns same hash for same body", () => {
    expect(hashBody("same")).toBe(hashBody("same"));
  });
});

describe("buildSignPayload", () => {
  it("builds canonical string with context prefix and bodyHash", () => {
    const bodyHash = hashBody(undefined);
    const result = buildSignPayload(
      "GET",
      "/api/workspaces/recent",
      1712300000000,
      "550e8400-e29b-41d4-a716-446655440000",
      bodyHash,
    );
    expect(result).toBe(
      `float-code-rest-v1\nGET\n/api/workspaces/recent\n1712300000000\n550e8400-e29b-41d4-a716-446655440000\n${bodyHash}`,
    );
  });
});

describe("signRequest / verifyRequestSignature", () => {
  const keypair = generateKeypair();
  const method = "GET";
  const requestTarget = "/api/workspaces/recent";
  const timestamp = Date.now();
  const nonce = "550e8400-e29b-41d4-a716-446655440000";
  const bodyHash = hashBody(undefined);

  it("sign then verify succeeds", async () => {
    const sig = signRequest(
      keypair.privateKey,
      method,
      requestTarget,
      timestamp,
      nonce,
      bodyHash,
    );
    const valid = await verifyRequestSignature(
      keypair.publicKey,
      sig,
      method,
      requestTarget,
      timestamp,
      nonce,
      bodyHash,
    );
    expect(valid).toBe(true);
  });

  it("rejects when method differs", async () => {
    const sig = signRequest(
      keypair.privateKey,
      method,
      requestTarget,
      timestamp,
      nonce,
      bodyHash,
    );
    const valid = await verifyRequestSignature(
      keypair.publicKey,
      sig,
      "POST",
      requestTarget,
      timestamp,
      nonce,
      bodyHash,
    );
    expect(valid).toBe(false);
  });

  it("rejects when requestTarget differs", async () => {
    const sig = signRequest(
      keypair.privateKey,
      method,
      requestTarget,
      timestamp,
      nonce,
      bodyHash,
    );
    const valid = await verifyRequestSignature(
      keypair.publicKey,
      sig,
      method,
      "/api/other",
      timestamp,
      nonce,
      bodyHash,
    );
    expect(valid).toBe(false);
  });

  it("rejects when timestamp differs", async () => {
    const sig = signRequest(
      keypair.privateKey,
      method,
      requestTarget,
      timestamp,
      nonce,
      bodyHash,
    );
    const valid = await verifyRequestSignature(
      keypair.publicKey,
      sig,
      method,
      requestTarget,
      timestamp + 1,
      nonce,
      bodyHash,
    );
    expect(valid).toBe(false);
  });

  it("rejects when nonce differs", async () => {
    const sig = signRequest(
      keypair.privateKey,
      method,
      requestTarget,
      timestamp,
      nonce,
      bodyHash,
    );
    const valid = await verifyRequestSignature(
      keypair.publicKey,
      sig,
      method,
      requestTarget,
      timestamp,
      "different-nonce",
      bodyHash,
    );
    expect(valid).toBe(false);
  });

  it("rejects when bodyHash differs", async () => {
    const sig = signRequest(
      keypair.privateKey,
      method,
      requestTarget,
      timestamp,
      nonce,
      bodyHash,
    );
    const valid = await verifyRequestSignature(
      keypair.publicKey,
      sig,
      method,
      requestTarget,
      timestamp,
      nonce,
      hashBody("tampered body"),
    );
    expect(valid).toBe(false);
  });

  it("rejects with wrong public key", async () => {
    const other = generateKeypair();
    const sig = signRequest(
      keypair.privateKey,
      method,
      requestTarget,
      timestamp,
      nonce,
      bodyHash,
    );
    const valid = await verifyRequestSignature(
      other.publicKey,
      sig,
      method,
      requestTarget,
      timestamp,
      nonce,
      bodyHash,
    );
    expect(valid).toBe(false);
  });

  it("rejects with invalid signature hex", async () => {
    const valid = await verifyRequestSignature(
      keypair.publicKey,
      "invalid",
      method,
      requestTarget,
      timestamp,
      nonce,
      bodyHash,
    );
    expect(valid).toBe(false);
  });

  it("signs and verifies POST with body", async () => {
    const postBody = '{"text":"hello"}';
    const postBodyHash = hashBody(postBody);
    const sig = signRequest(
      keypair.privateKey,
      "POST",
      requestTarget,
      timestamp,
      nonce,
      postBodyHash,
    );
    const valid = await verifyRequestSignature(
      keypair.publicKey,
      sig,
      "POST",
      requestTarget,
      timestamp,
      nonce,
      postBodyHash,
    );
    expect(valid).toBe(true);
  });
});
