import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  claimNonce,
  clearNonceStore,
  startNonceCleanup,
  stopNonceCleanup,
} from "./nonce-store.js";

describe("nonce-store", () => {
  beforeEach(() => {
    clearNonceStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopNonceCleanup();
    vi.useRealTimers();
  });

  it("新しい nonce の claim は true を返す", () => {
    expect(claimNonce("nonce-1")).toBe(true);
  });

  it("同じ nonce の2回目の claim は false を返す", () => {
    claimNonce("nonce-1");
    expect(claimNonce("nonce-1")).toBe(false);
  });

  it("異なる nonce は独立して claim できる", () => {
    expect(claimNonce("nonce-a")).toBe(true);
    expect(claimNonce("nonce-b")).toBe(true);
  });

  it("clearNonceStore で全エントリが削除される", () => {
    claimNonce("a");
    claimNonce("b");
    clearNonceStore();
    expect(claimNonce("a")).toBe(true);
    expect(claimNonce("b")).toBe(true);
  });

  it("cleanup は 60s 以上経過した nonce を削除する", () => {
    claimNonce("old");
    startNonceCleanup();

    // 60s + cleanup interval (30s) で確実に削除される
    vi.advanceTimersByTime(90_000);

    // 再度 claim できるようになっている
    expect(claimNonce("old")).toBe(true);
  });

  it("cleanup は 60s 未満の nonce を保持する", () => {
    startNonceCleanup();
    claimNonce("fresh");

    // 30s 経過で cleanup が走るが、nonce はまだ 60s 未満
    vi.advanceTimersByTime(30_000);

    expect(claimNonce("fresh")).toBe(false);
  });

  it("60s 経過直前の nonce はまだ保持されている", () => {
    claimNonce("borderline");
    startNonceCleanup();

    vi.advanceTimersByTime(59_000);

    expect(claimNonce("borderline")).toBe(false);
  });

  it("startNonceCleanup を複数回呼んでもタイマーが重複しない", () => {
    startNonceCleanup();
    startNonceCleanup();

    claimNonce("test");
    vi.advanceTimersByTime(90_000);

    expect(claimNonce("test")).toBe(true);
  });
});
