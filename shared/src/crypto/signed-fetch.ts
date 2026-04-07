import { generateUUID } from "./uuid.js";
import {
  normalizeRequestTarget,
  signRequest,
  hashBody,
} from "./request-sign.js";

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export type SignedFetchOptions = {
  privateKey: string;
  publicKey: string;
  now?: () => number;
  generateNonce?: () => string;
};

export function createSignedFetch(
  fetchFn: FetchFn,
  options: SignedFetchOptions,
): FetchFn {
  const { privateKey, publicKey } = options;
  const getNow = options.now ?? (() => Date.now());
  const getNonce = options.generateNonce ?? generateUUID;

  return async (url: string, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? "GET").toUpperCase();
    const requestTarget = normalizeRequestTarget(url);
    const timestamp = getNow();
    const nonce = getNonce();

    if (init?.body != null && typeof init.body !== "string") {
      throw new Error("createSignedFetch only supports string body");
    }
    const bodyDigest = hashBody(init?.body ?? undefined);

    const signature = signRequest(
      privateKey,
      method,
      requestTarget,
      timestamp,
      nonce,
      bodyDigest,
    );

    const headers = new Headers(init?.headers);
    headers.set("X-Public-Key", publicKey);
    headers.set("X-Timestamp", String(timestamp));
    headers.set("X-Nonce", nonce);
    headers.set("X-Signature", signature);

    return fetchFn(url, { ...init, headers });
  };
}
