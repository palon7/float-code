import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { serve, type ServerType } from "@hono/node-server";
import { createApp, type AppContext } from "../app.js";
import type {
  ErrorResponse,
  WorkspacesRecentResponse,
  WorkspacesBrowseResponse,
} from "@float-code/shared/protocol";

const TEST_TOKEN = "integration-test-token-1234567890";

vi.mock("../auth/shared-token.js", () => ({
  verifyToken: (token: string) => token === TEST_TOKEN,
}));

vi.mock("../workspace/workspace-store.js", () => ({
  getRecent: () =>
    Promise.resolve([
      {
        path: "/projects/app",
        name: "app",
        lastUsedAt: "2026-03-29T00:00:00.000Z",
      },
    ]),
}));

let server: ServerType;
let port: number;
let gateway: AppContext["gateway"];

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

function authHeader(): Record<string, string> {
  return { Authorization: `Bearer ${TEST_TOKEN}` };
}

describe("REST API 認証", () => {
  it("Authorization ヘッダなしで 401 を返す", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/workspaces/recent`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as ErrorResponse;
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("不正なトークンで 401 を返す", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/workspaces/recent`, {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/workspaces/recent", () => {
  it("認証付きで 200 とワークスペース一覧を返す", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/workspaces/recent`, {
      headers: authHeader(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as WorkspacesRecentResponse;
    expect(body.workspaces).toHaveLength(1);
    expect(body.workspaces[0].path).toBe("/projects/app");
  });
});

describe("GET /api/workspaces/browse", () => {
  it("path パラメータなしでホームディレクトリを返す", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/workspaces/browse`, {
      headers: authHeader(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as WorkspacesBrowseResponse;
    expect(body.path).toBeTruthy();
    expect(Array.isArray(body.entries)).toBe(true);
  });

  it("存在しないパスで 404 を返す", async () => {
    const res = await fetch(
      `http://127.0.0.1:${port}/api/workspaces/browse?path=/nonexistent/path/that/does/not/exist`,
      { headers: authHeader() },
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as ErrorResponse;
    expect(body.error.code).toBe("WORKSPACE_NOT_FOUND");
  });

  it("存在するパスで 200 とエントリ一覧を返す", async () => {
    const res = await fetch(
      `http://127.0.0.1:${port}/api/workspaces/browse?path=/tmp`,
      { headers: authHeader() },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as WorkspacesBrowseResponse;
    expect(body.path).toBe("/tmp");
    expect(Array.isArray(body.entries)).toBe(true);
  });
});
