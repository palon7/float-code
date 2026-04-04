import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  vi,
} from "vitest";
import { serve, type ServerType } from "@hono/node-server";
import { WebSocket } from "ws";
import { createApp } from "../app.js";
import type { ServerMessage } from "@float-code/shared/protocol";

const TEST_TOKEN = "integration-test-token-1234567890";
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

let server: ServerType;
let port: number;
let gateway: ReturnType<typeof createApp>["gateway"];

beforeAll(async () => {
  const ctx = createApp(Date.now());
  gateway = ctx.gateway;

  server = await new Promise<ServerType>((resolve) => {
    const s = serve({ fetch: ctx.app.fetch, port: 0 }, () => resolve(s));
    ctx.injectWebSocket(s);
  });

  const addr = server.address();
  port = typeof addr === "object" && addr ? addr.port : 0;
});

afterAll(() => {
  gateway.stop();
  server.close();
});

const openSockets: WebSocket[] = [];
afterEach(() => {
  for (const ws of openSockets) {
    if (ws.readyState === WebSocket.OPEN) ws.close();
  }
  openSockets.length = 0;
});

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    openSockets.push(ws);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function sendJson(ws: WebSocket, data: Record<string, unknown>): void {
  ws.send(JSON.stringify({ timestamp: new Date().toISOString(), ...data }));
}

function waitMessage(ws: WebSocket): Promise<ServerMessage> {
  return new Promise((resolve) => {
    ws.once("message", (raw) =>
      resolve(JSON.parse(raw.toString()) as ServerMessage),
    );
  });
}

const VALID_SIGNATURE = "a".repeat(128);

// challenge-response の完全なフローを実行
async function authenticate(ws: WebSocket): Promise<ServerMessage> {
  const challengePromise = waitMessage(ws);
  sendJson(ws, {
    type: "auth",
    publicKey: TEST_PUBLIC_KEY,
    authToken: TEST_TOKEN,
  });
  const challengeMsg = await challengePromise;
  expect(challengeMsg.type).toBe("auth.challenge");

  const authOkPromise = waitMessage(ws);
  sendJson(ws, { type: "auth.response", signature: VALID_SIGNATURE });
  return authOkPromise;
}

describe("WebSocket 統合テスト", () => {
  describe("認証", () => {
    it("challenge-response で auth.ok を受け取る", async () => {
      const ws = await connect();
      const msg = await authenticate(ws);

      expect(msg).toMatchObject({ type: "auth.ok" });
    });

    it("不正なフォーマットの auth で auth.error を受け取る", async () => {
      const ws = await connect();
      const msgPromise = waitMessage(ws);

      sendJson(ws, { type: "auth", publicKey: "short", authToken: TEST_TOKEN });

      const msg = await msgPromise;
      expect(msg).toMatchObject({ type: "auth.error" });
    });

    it("認証前に auth 以外を送ると拒否される", async () => {
      const ws = await connect();
      const msgPromise = waitMessage(ws);

      sendJson(ws, { type: "session.send", text: "hi" });

      const msg = await msgPromise;
      expect(msg).toMatchObject({
        type: "auth.error",
        message: "Invalid auth payload",
      });
    });
  });

  describe("health check", () => {
    it("GET /health が正常レスポンスを返す", async () => {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(200);
      expect(body).toMatchObject({ status: "ok" });
      expect(typeof body.uptime).toBe("number");
    });
  });
});
