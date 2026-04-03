import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConnectionRegistry } from "./connection-registry.js";

function createMockWs() {
  return {
    send: vi.fn(),
    close: vi.fn(),
  } as unknown as import("hono/ws").WSContext;
}

describe("ConnectionRegistry", () => {
  let registry: ConnectionRegistry;

  beforeEach(() => {
    registry = new ConnectionRegistry();
  });

  it("初期状態では接続がない", () => {
    expect(registry.getAll().size).toBe(0);
  });

  it("接続を追加できる", () => {
    const ws = createMockWs();
    registry.add(ws);
    expect(registry.getAll().size).toBe(1);
    expect(registry.getAll().has(ws)).toBe(true);
  });

  it("複数の接続を同時に���持できる", () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    registry.add(ws1);
    registry.add(ws2);
    expect(registry.getAll().size).toBe(2);
  });

  it("接続を削除できる", () => {
    const ws = createMockWs();
    registry.add(ws);
    registry.remove(ws);
    expect(registry.getAll().size).toBe(0);
  });

  it("broadcast で全���続にメッセージを送信する", () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    registry.add(ws1);
    registry.add(ws2);

    registry.broadcast("session.error", {
      code: "TEST",
      message: "test",
    });

    expect(ws1.send).toHaveBeenCalledWith(
      expect.stringContaining('"session.error"'),
    );
    expect(ws2.send).toHaveBeenCalledWith(
      expect.stringContaining('"session.error"'),
    );
  });

  it("sendTo で特定の接続にだけ送信する", () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    registry.add(ws1);
    registry.add(ws2);

    registry.sendTo(ws1, "pong", {});

    expect(ws1.send).toHaveBeenCalled();
    expect(ws2.send).not.toHaveBeenCalled();
  });

  it("接続がない場合 broadcast は何もしない", () => {
    registry.broadcast("session.error", {
      code: "TEST",
      message: "test",
    });
  });
});
