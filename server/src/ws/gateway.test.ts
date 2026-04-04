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
const TEST_PUBLIC_KEY =
  "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

vi.mock("../auth/shared-token.js", () => ({
  verifyToken: (token: string) => token === TEST_TOKEN,
  initTokenCache: () => {},
}));

vi.mock("../auth/approved-keys.js", () => ({
  isApproved: vi.fn().mockResolvedValue(true),

  addKey: vi.fn(),
  removeByCode: vi.fn(),
  removeByPublicKey: vi.fn(),
  listKeys: vi.fn().mockResolvedValue([]),
  findByPublicKey: vi.fn(),
}));

vi.mock("../auth/challenge.js", () => ({
  createChallenge: (publicKey: string) => ({
    kind: "float-code-auth-v1",
    challengeId: "test-challenge-id",
    publicKey,
    nonce: "test-nonce",
    issuedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:10.000Z",
  }),
  verifySignature: vi.fn().mockResolvedValue(true),
}));

vi.mock("../auth/pairing.js", () => ({
  requestPairing: vi
    .fn()
    .mockResolvedValue({ ok: true, code: "ABCD-EFGH-IJKL" }),
  cleanupExpired: vi.fn(),
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

function authMsg() {
  return JSON.stringify({
    type: "auth",
    publicKey: TEST_PUBLIC_KEY,
    authToken: TEST_TOKEN,
    timestamp: "",
  });
}

const VALID_SIGNATURE = "a".repeat(128);

function authResponseMsg() {
  return JSON.stringify({
    type: "auth.response",
    signature: VALID_SIGNATURE,
    timestamp: "",
  });
}

// challenge-response の完全なフローを実行してから ws を返す
async function authenticateWs(
  gateway: WsGateway,
): Promise<import("hono/ws").WSContext> {
  const ws = createMockWs();
  gateway.handleOpen(ws);
  gateway.handleMessage(ws, authMsg());
  // handleAuth is async, wait for it
  await vi.waitFor(() => {
    const msgs = sent(ws);
    expect(
      msgs.some((m) => (m as { type: string }).type === "auth.challenge"),
    ).toBe(true);
  });
  gateway.handleMessage(ws, authResponseMsg());
  await vi.waitFor(() => {
    const msgs = sent(ws);
    expect(msgs.some((m) => (m as { type: string }).type === "auth.ok")).toBe(
      true,
    );
  });
  (ws.send as ReturnType<typeof vi.fn>).mockClear();
  return ws;
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

  describe("認証フロー (challenge-response)", () => {
    it("正しい auth で challenge を返す", async () => {
      const ws = createMockWs();
      gateway.handleOpen(ws);
      gateway.handleMessage(ws, authMsg());

      await vi.waitFor(() => {
        const msgs = sent(ws);
        expect(
          msgs.some((m) => (m as { type: string }).type === "auth.challenge"),
        ).toBe(true);
      });

      const challenge = sent(ws).find(
        (m) => (m as { type: string }).type === "auth.challenge",
      ) as { challenge: { kind: string; publicKey: string } };
      expect(challenge.challenge.kind).toBe("float-code-auth-v1");
      expect(challenge.challenge.publicKey).toBe(TEST_PUBLIC_KEY);
    });

    it("challenge-response 成功で auth.ok を返す", async () => {
      const ws = await authenticateWs(gateway);
      // authenticateWs で send をクリア済み — auth.ok は通過済みなのでレジストリを確認
      expect(registry.getAll().size).toBe(1);
      expect(ws.close).not.toHaveBeenCalled();
    });

    it("不正なフォーマットの auth メッセージは拒否する", () => {
      const ws = createMockWs();
      gateway.handleOpen(ws);
      // publicKey が短すぎる
      gateway.handleMessage(
        ws,
        JSON.stringify({
          type: "auth",
          publicKey: "short",
          authToken: TEST_TOKEN,
          timestamp: "",
        }),
      );

      const msgs = sent(ws);
      expect(
        msgs.some((m) => (m as { type: string }).type === "auth.error"),
      ).toBe(true);
    });

    it("認証タイムアウトで切断する", () => {
      vi.useFakeTimers();
      const ws = createMockWs();
      gateway.handleOpen(ws);

      vi.advanceTimersByTime(10_000);
      const msgs = sent(ws);
      expect(
        msgs.some(
          (m) =>
            (m as { type: string }).type === "auth.error" &&
            (m as { code: string }).code === "AUTH_TIMEOUT",
        ),
      ).toBe(true);
      expect(ws.close).toHaveBeenCalledWith(4401, "auth_timeout");

      vi.useRealTimers();
    });
  });

  describe("認証済みメッセージ", () => {
    it("session.open を SessionManager に委譲する", async () => {
      const ws = await authenticateWs(gateway);

      gateway.handleMessage(
        ws,
        JSON.stringify({
          type: "session.open",
          workspacePath: "/tmp",
          timestamp: "",
        }),
      );

      expect(mockSessionManager.openNewSession).toHaveBeenCalledWith("/tmp");
    });

    it("session.open (load) を SessionManager に委譲する", async () => {
      const ws = await authenticateWs(gateway);

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

    it("session.send を SessionManager に委譲する", async () => {
      const ws = await authenticateWs(gateway);

      gateway.handleMessage(
        ws,
        JSON.stringify({ type: "session.send", text: "hello", timestamp: "" }),
      );

      expect(mockSessionManager.send).toHaveBeenCalledWith("hello");
    });

    it("ping に pong を返す", async () => {
      const ws = await authenticateWs(gateway);

      gateway.handleMessage(
        ws,
        JSON.stringify({ type: "ping", timestamp: "" }),
      );

      expect(lastSent(ws)).toEqual(expect.objectContaining({ type: "pong" }));
    });
  });

  describe("未認証メッセージ", () => {
    it("認証前に不正なペイロードを送ると auth.error を返す", () => {
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
          message: "Invalid auth payload",
        }),
      );
    });
  });

  describe("切断処理", () => {
    it("切断後のメッセージはルーティングされない", async () => {
      const ws = await authenticateWs(gateway);
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

    it("認証済み接続の切断でレジストリから削除される", async () => {
      const ws = await authenticateWs(gateway);
      gateway.handleClose(ws);
      expect(registry.getAll().size).toBe(0);
    });
  });
});
