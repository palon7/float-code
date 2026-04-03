import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WsGateway } from "./gateway.js";
import { ConnectionRegistry } from "./connection-registry.js";
import type { SessionManager } from "../session/session-manager.js";

function createMockWs() {
  return {
    send: vi.fn(),
    close: vi.fn(),
  } as unknown as import("hono/ws").WSContext;
}

function sent(ws: import("hono/ws").WSContext): unknown[] {
  return (ws.send as ReturnType<typeof vi.fn>).mock.calls.map(
    (args: unknown[]) => JSON.parse(args[0] as string),
  );
}

function lastSent(ws: import("hono/ws").WSContext): unknown {
  const msgs = sent(ws);
  return msgs[msgs.length - 1];
}

const TEST_TOKEN = "test-token-12345678901234567890123456789012";
vi.mock("../auth/shared-token.js", () => ({
  verifyToken: (token: string) => token === TEST_TOKEN,
}));

function createMockSessionManager(): SessionManager {
  return {
    openNewSession: vi.fn().mockResolvedValue(undefined),
    loadSession: vi.fn().mockResolvedValue(undefined),
    send: vi.fn(),
    interrupt: vi.fn(),
    abort: vi.fn(),
    getSnapshot: vi.fn().mockReturnValue(undefined),
    getActiveSessionCount: vi.fn().mockReturnValue(0),
    killOrphans: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    killAllSync: vi.fn(),
  } as unknown as SessionManager;
}

describe("WsGateway", () => {
  let gateway: WsGateway;
  let registry: ConnectionRegistry;
  let mockSessionManager: SessionManager;

  beforeEach(() => {
    mockSessionManager = createMockSessionManager();
    registry = new ConnectionRegistry();
    gateway = new WsGateway(mockSessionManager, registry);
  });

  afterEach(() => {
    gateway.stop();
  });

  describe("認証フロー", () => {
    it("正しいトークンで auth.ok を返す", () => {
      const ws = createMockWs();
      gateway.handleOpen(ws);

      gateway.handleMessage(
        ws,
        JSON.stringify({ type: "auth", token: TEST_TOKEN, timestamp: "" }),
      );

      const msgs = sent(ws);
      expect(msgs).toContainEqual(expect.objectContaining({ type: "auth.ok" }));
    });

    it("認証成功時にアクティブセッションがなければ activeSession なし", () => {
      const ws = createMockWs();
      gateway.handleOpen(ws);

      gateway.handleMessage(
        ws,
        JSON.stringify({ type: "auth", token: TEST_TOKEN, timestamp: "" }),
      );

      const msgs = sent(ws);
      expect(msgs[0]).toMatchObject({ type: "auth.ok" });
      expect(msgs[0]).not.toHaveProperty("activeSession");
    });

    it("認証成功時にアクティブセッションがあれば activeSession を含む", () => {
      const snapshot = {
        sessionId: "s1",
        status: "running",
        entries: [],
      };
      (
        mockSessionManager.getSnapshot as ReturnType<typeof vi.fn>
      ).mockReturnValue(snapshot);

      const ws = createMockWs();
      gateway.handleOpen(ws);
      gateway.handleMessage(
        ws,
        JSON.stringify({ type: "auth", token: TEST_TOKEN, timestamp: "" }),
      );

      const msgs = sent(ws);
      expect(msgs[0]).toMatchObject({
        type: "auth.ok",
        activeSession: snapshot,
      });
    });

    it("不正なトークンで切断する", () => {
      const ws = createMockWs();
      gateway.handleOpen(ws);

      gateway.handleMessage(
        ws,
        JSON.stringify({ type: "auth", token: "wrong", timestamp: "" }),
      );

      const msgs = sent(ws);
      expect(msgs).toContainEqual(
        expect.objectContaining({
          type: "auth.error",
          message: "Authentication failed",
        }),
      );
      expect(ws.close).toHaveBeenCalledWith(4403, "auth_failed");
    });

    it("認証失敗後にメッセージを送ってもルーティングされない", () => {
      const ws = createMockWs();
      gateway.handleOpen(ws);

      gateway.handleMessage(
        ws,
        JSON.stringify({ type: "auth", token: "wrong", timestamp: "" }),
      );

      gateway.handleMessage(
        ws,
        JSON.stringify({
          type: "session.open",
          workspacePath: "/tmp",
          timestamp: "",
        }),
      );

      expect(mockSessionManager.openNewSession).not.toHaveBeenCalled();
    });

    it("認証タイムアウトで切断する", () => {
      vi.useFakeTimers();
      const ws = createMockWs();
      gateway.handleOpen(ws);

      vi.advanceTimersByTime(10_000);
      const msgs = sent(ws);
      expect(msgs).toContainEqual(
        expect.objectContaining({
          type: "auth.error",
          message: "Authentication timeout",
        }),
      );
      expect(ws.close).toHaveBeenCalledWith(4401, "auth_timeout");

      vi.useRealTimers();
    });
  });

  describe("複数クライアント接続", () => {
    it("複数クライアントが同時に認証できる", () => {
      const ws1 = createMockWs();
      const ws2 = createMockWs();

      gateway.handleOpen(ws1);
      gateway.handleMessage(
        ws1,
        JSON.stringify({ type: "auth", token: TEST_TOKEN, timestamp: "" }),
      );

      gateway.handleOpen(ws2);
      gateway.handleMessage(
        ws2,
        JSON.stringify({ type: "auth", token: TEST_TOKEN, timestamp: "" }),
      );

      // 両方とも接続中
      expect(ws1.close).not.toHaveBeenCalled();
      expect(ws2.close).not.toHaveBeenCalled();
      expect(registry.getAll().size).toBe(2);
    });

    it("未認証の接続は既存の認証済み接続に影響しない", () => {
      const ws1 = createMockWs();
      const ws2 = createMockWs();

      gateway.handleOpen(ws1);
      gateway.handleMessage(
        ws1,
        JSON.stringify({ type: "auth", token: TEST_TOKEN, timestamp: "" }),
      );

      gateway.handleOpen(ws2);
      // ws2 は認証しない

      expect(ws1.close).not.toHaveBeenCalled();
    });
  });

  describe("認証済みメッセージ", () => {
    function authenticatedWs() {
      const ws = createMockWs();
      gateway.handleOpen(ws);
      gateway.handleMessage(
        ws,
        JSON.stringify({ type: "auth", token: TEST_TOKEN, timestamp: "" }),
      );
      (ws.send as ReturnType<typeof vi.fn>).mockClear();
      return ws;
    }

    it("session.open を SessionManager に委譲する", () => {
      authenticatedWs();

      const ws2 = createMockWs();
      gateway.handleOpen(ws2);
      gateway.handleMessage(
        ws2,
        JSON.stringify({ type: "auth", token: TEST_TOKEN, timestamp: "" }),
      );
      (ws2.send as ReturnType<typeof vi.fn>).mockClear();

      gateway.handleMessage(
        ws2,
        JSON.stringify({
          type: "session.open",
          workspacePath: "/tmp",
          timestamp: "",
        }),
      );

      expect(mockSessionManager.openNewSession).toHaveBeenCalledWith("/tmp");
    });

    it("session.open (load) を SessionManager に委譲する", () => {
      const ws = authenticatedWs();

      gateway.handleMessage(
        ws,
        JSON.stringify({
          type: "session.open",
          sessionId: "session-1",
          workspacePath: "/tmp",
          timestamp: "",
        }),
      );

      expect(mockSessionManager.loadSession).toHaveBeenCalledWith(
        "session-1",
        "/tmp",
      );
    });

    it("session.open で sessionId なしは新規セッション", () => {
      const ws = authenticatedWs();

      gateway.handleMessage(
        ws,
        JSON.stringify({
          type: "session.open",
          workspacePath: "/tmp",
          timestamp: "",
        }),
      );

      expect(mockSessionManager.openNewSession).toHaveBeenCalledWith("/tmp");
      expect(mockSessionManager.loadSession).not.toHaveBeenCalled();
    });

    it("session.send を SessionManager に委譲する", () => {
      authenticatedWs();

      gateway.handleMessage(
        createMockWs(), // need authenticated ws
        JSON.stringify({ type: "session.send", text: "hello", timestamp: "" }),
      );

      // This ws is not authenticated, so it won't work. Let's use authenticated one:
      const ws = authenticatedWs();
      gateway.handleMessage(
        ws,
        JSON.stringify({ type: "session.send", text: "hello", timestamp: "" }),
      );

      expect(mockSessionManager.send).toHaveBeenCalledWith("hello");
    });

    it("ping に pong を返す", () => {
      const ws = authenticatedWs();

      gateway.handleMessage(
        ws,
        JSON.stringify({ type: "ping", timestamp: "" }),
      );

      expect(lastSent(ws)).toEqual(expect.objectContaining({ type: "pong" }));
    });
  });

  describe("未認証メッセージ", () => {
    it("認証前に auth 以外を送ると auth.error を返す", () => {
      const ws = createMockWs();
      gateway.handleOpen(ws);

      gateway.handleMessage(
        ws,
        JSON.stringify({ type: "session.send", text: "hi", timestamp: "" }),
      );

      const msgs = sent(ws);
      expect(msgs).toContainEqual(
        expect.objectContaining({
          type: "auth.error",
          message: "Authentication required",
        }),
      );
    });
  });

  describe("切断処理", () => {
    it("切断後のメッセージはルーティングされない", () => {
      const ws = createMockWs();
      gateway.handleOpen(ws);
      gateway.handleMessage(
        ws,
        JSON.stringify({ type: "auth", token: TEST_TOKEN, timestamp: "" }),
      );

      gateway.handleClose(ws);

      gateway.handleMessage(
        ws,
        JSON.stringify({
          type: "session.open",
          workspacePath: "/tmp",
          timestamp: "",
        }),
      );

      expect(mockSessionManager.openNewSession).not.toHaveBeenCalled();
    });

    it("切断時に認証タイマーがクリアされる", () => {
      vi.useFakeTimers();
      const ws = createMockWs();
      gateway.handleOpen(ws);
      gateway.handleClose(ws);

      vi.advanceTimersByTime(10_000);
      expect(ws.close).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it("認証済み接続の切断でレジストリから削除される", () => {
      const ws = createMockWs();
      gateway.handleOpen(ws);
      gateway.handleMessage(
        ws,
        JSON.stringify({ type: "auth", token: TEST_TOKEN, timestamp: "" }),
      );

      gateway.handleClose(ws);
      expect(registry.getAll().size).toBe(0);
    });
  });
});
