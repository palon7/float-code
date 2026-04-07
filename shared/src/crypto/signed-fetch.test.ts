import { describe, it, expect, vi } from "vitest";
import { generateKeypair } from "./sign.js";
import { createSignedFetch } from "./signed-fetch.js";
import { verifyRequestSignature, hashBody } from "./request-sign.js";

describe("createSignedFetch", () => {
  const keypair = generateKeypair();
  const fixedNow = 1712300000000;
  const fixedNonce = "550e8400-e29b-41d4-a716-446655440000";

  function createMockFetch() {
    return vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async () => new Response("ok"),
    );
  }

  it("adds 4 signature headers to the request", async () => {
    const mockFetch = createMockFetch();
    const signedFetch = createSignedFetch(mockFetch, {
      privateKey: keypair.privateKey,
      publicKey: keypair.publicKey,
      now: () => fixedNow,
      generateNonce: () => fixedNonce,
    });

    await signedFetch("http://localhost:3210/api/workspaces/recent");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, init] = mockFetch.mock.calls[0]!;
    const headers = new Headers(init?.headers);

    expect(headers.get("X-Public-Key")).toBe(keypair.publicKey);
    expect(headers.get("X-Timestamp")).toBe(String(fixedNow));
    expect(headers.get("X-Nonce")).toBe(fixedNonce);
    expect(headers.get("X-Signature")).toBeTruthy();
  });

  it("produces a valid signature for GET (no body)", async () => {
    const mockFetch = createMockFetch();
    const signedFetch = createSignedFetch(mockFetch, {
      privateKey: keypair.privateKey,
      publicKey: keypair.publicKey,
      now: () => fixedNow,
      generateNonce: () => fixedNonce,
    });

    await signedFetch("http://localhost:3210/api/workspaces/recent");

    const [, init] = mockFetch.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    const sig = headers.get("X-Signature")!;

    const valid = await verifyRequestSignature(
      keypair.publicKey,
      sig,
      "GET",
      "/api/workspaces/recent",
      fixedNow,
      fixedNonce,
      hashBody(undefined),
    );
    expect(valid).toBe(true);
  });

  it("generates different nonces per request", async () => {
    const mockFetch = createMockFetch();
    const signedFetch = createSignedFetch(mockFetch, {
      privateKey: keypair.privateKey,
      publicKey: keypair.publicKey,
    });

    await signedFetch("http://localhost:3210/api/test");
    await signedFetch("http://localhost:3210/api/test");

    const nonce1 = new Headers(mockFetch.mock.calls[0]![1]?.headers).get(
      "X-Nonce",
    );
    const nonce2 = new Headers(mockFetch.mock.calls[1]![1]?.headers).get(
      "X-Nonce",
    );
    expect(nonce1).not.toBe(nonce2);
  });

  it("returns the original fetch response", async () => {
    const expected = new Response("test-body", { status: 201 });
    const mockFetch = vi.fn(async () => expected);
    const signedFetch = createSignedFetch(mockFetch, {
      privateKey: keypair.privateKey,
      publicKey: keypair.publicKey,
    });

    const result = await signedFetch("http://localhost:3210/api/test");
    expect(result).toBe(expected);
  });

  it("preserves existing headers from init", async () => {
    const mockFetch = createMockFetch();
    const signedFetch = createSignedFetch(mockFetch, {
      privateKey: keypair.privateKey,
      publicKey: keypair.publicKey,
    });

    await signedFetch("http://localhost:3210/api/test", {
      headers: { "Content-Type": "application/json" },
    });

    const headers = new Headers(mockFetch.mock.calls[0]![1]?.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-Public-Key")).toBe(keypair.publicKey);
  });

  it("defaults to GET when method is not specified in init", async () => {
    const mockFetch = createMockFetch();
    const signedFetch = createSignedFetch(mockFetch, {
      privateKey: keypair.privateKey,
      publicKey: keypair.publicKey,
      now: () => fixedNow,
      generateNonce: () => fixedNonce,
    });

    await signedFetch("http://localhost:3210/api/test");

    const [, init] = mockFetch.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    const sig = headers.get("X-Signature")!;

    const validAsGet = await verifyRequestSignature(
      keypair.publicKey,
      sig,
      "GET",
      "/api/test",
      fixedNow,
      fixedNonce,
      hashBody(undefined),
    );
    expect(validAsGet).toBe(true);

    const validAsPost = await verifyRequestSignature(
      keypair.publicKey,
      sig,
      "POST",
      "/api/test",
      fixedNow,
      fixedNonce,
      hashBody(undefined),
    );
    expect(validAsPost).toBe(false);
  });

  it("uses method from init", async () => {
    const mockFetch = createMockFetch();
    const signedFetch = createSignedFetch(mockFetch, {
      privateKey: keypair.privateKey,
      publicKey: keypair.publicKey,
      now: () => fixedNow,
      generateNonce: () => fixedNonce,
    });

    await signedFetch("http://localhost:3210/api/test", { method: "POST" });

    const [, init] = mockFetch.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    const sig = headers.get("X-Signature")!;

    const valid = await verifyRequestSignature(
      keypair.publicKey,
      sig,
      "POST",
      "/api/test",
      fixedNow,
      fixedNonce,
      hashBody(undefined),
    );
    expect(valid).toBe(true);
  });

  it("includes body hash in signature for POST with body", async () => {
    const mockFetch = createMockFetch();
    const signedFetch = createSignedFetch(mockFetch, {
      privateKey: keypair.privateKey,
      publicKey: keypair.publicKey,
      now: () => fixedNow,
      generateNonce: () => fixedNonce,
    });

    const body = '{"text":"hello"}';
    await signedFetch("http://localhost:3210/api/test", {
      method: "POST",
      body,
    });

    const [, init] = mockFetch.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    const sig = headers.get("X-Signature")!;

    // Verifying with correct body hash should succeed
    const valid = await verifyRequestSignature(
      keypair.publicKey,
      sig,
      "POST",
      "/api/test",
      fixedNow,
      fixedNonce,
      hashBody(body),
    );
    expect(valid).toBe(true);

    // Verifying with wrong body hash should fail (body tampering detection)
    const invalid = await verifyRequestSignature(
      keypair.publicKey,
      sig,
      "POST",
      "/api/test",
      fixedNow,
      fixedNonce,
      hashBody("tampered"),
    );
    expect(invalid).toBe(false);
  });

  it("throws for non-string body", async () => {
    const mockFetch = createMockFetch();
    const signedFetch = createSignedFetch(mockFetch, {
      privateKey: keypair.privateKey,
      publicKey: keypair.publicKey,
    });

    await expect(
      signedFetch("http://localhost:3210/api/test", {
        method: "POST",
        body: new Uint8Array([1, 2, 3]),
      }),
    ).rejects.toThrow("createSignedFetch only supports string body");
  });
});
