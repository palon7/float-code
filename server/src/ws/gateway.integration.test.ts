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

// auth モジュールをモックしてトークンを固定
vi.mock("../auth/shared-token.js", () => ({
  verifyToken: (token: string) => token === TEST_TOKEN,
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

// テストで開いた WS を追跡して afterEach で閉じる
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

function waitClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    ws.once("close", (code, reason) =>
      resolve({ code, reason: reason.toString() }),
    );
  });
}

async function authenticate(ws: WebSocket): Promise<ServerMessage> {
  const msgPromise = waitMessage(ws);
  sendJson(ws, { type: "auth", token: TEST_TOKEN });
  return msgPromise;
}

describe("WebSocket 統合テスト", () => {
  describe("認証", () => {
    it("正しいトークンで接続して auth.ok を受け取る", async () => {
      const ws = await connect();
      const msg = await authenticate(ws);

      expect(msg).toMatchObject({ type: "auth.ok" });
    });

    it("不正なトークンで auth.error を受け取り切断される", async () => {
      const ws = await connect();
      const msgPromise = waitMessage(ws);
      const closePromise = waitClose(ws);

      sendJson(ws, { type: "auth", token: "wrong" });

      const msg = await msgPromise;
      expect(msg).toMatchObject({ type: "auth.error" });

      const { code } = await closePromise;
      expect(code).toBe(4403);
    });

    it("認証前に auth 以外を送ると拒否される", async () => {
      const ws = await connect();
      const msgPromise = waitMessage(ws);

      sendJson(ws, { type: "session.send", text: "hi" });

      const msg = await msgPromise;
      expect(msg).toMatchObject({
        type: "auth.error",
        message: "Authentication required",
      });
    });
  });

  describe("単一接続ポリシー", () => {
    it("新しい認証済み接続が既存接続を切断する", async () => {
      const ws1 = await connect();
      await authenticate(ws1);

      const closePromise = waitClose(ws1);

      const ws2 = await connect();
      await authenticate(ws2);

      const { code, reason } = await closePromise;
      expect(code).toBe(4001);
      expect(reason).toBe("replaced_by_new_connection");
    });

    it("未認証の接続は既存の認証済み接続に影響しない", async () => {
      const ws1 = await connect();
      await authenticate(ws1);

      // ws2 は接続だけして認証しない
      await connect();

      // ws1 はまだ生きている
      expect(ws1.readyState).toBe(WebSocket.OPEN);
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
