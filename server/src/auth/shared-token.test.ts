import { describe, it, expect, beforeEach, vi } from "vitest";
import { initTokenCache, verifyToken } from "./shared-token.js";

const TEST_TOKEN = "a]b]c]d]e]f]1234567890abcdef1234567890abcdef12345678";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mock("../config.js", () => ({
    getConfig: () => ({ version: 1, port: 8080, authToken: TEST_TOKEN }),
  }));
  initTokenCache();
});

describe("verifyToken", () => {
  it("正しいトークンで true を返す", () => {
    expect(verifyToken(TEST_TOKEN)).toBe(true);
  });

  it("不正なトークンで false を返す", () => {
    expect(verifyToken("wrong-token")).toBe(false);
  });

  it("空文字で false を返す", () => {
    expect(verifyToken("")).toBe(false);
  });
});
