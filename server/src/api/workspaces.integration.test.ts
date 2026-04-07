import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  vi,
} from "vitest";
import { serve, type ServerType } from "@hono/node-server";
import { createApp, type AppContext } from "../app.js";
import { generateKeypair } from "@float-code/shared/crypto/sign";
import { createSignedFetch } from "@float-code/shared/crypto/signed-fetch";
import {
  signRequest,
  normalizeRequestTarget,
  hashBody,
} from "@float-code/shared/crypto/request-sign";
import { generateUUID } from "@float-code/shared/crypto/uuid";
import type { FetchFn } from "@float-code/shared/crypto/signed-fetch";
import type {
  ErrorResponse,
  WorkspacesRecentResponse,
  WorkspacesBrowseResponse,
} from "@float-code/shared/protocol";
import { clearNonceStore } from "../auth/nonce-store.js";

const TEST_KEYPAIR = generateKeypair();

// 可変の承認キーセット（revoke テストで操作する）
const approvedKeySet = new Set([TEST_KEYPAIR.publicKey]);

vi.mock("../auth/approved-keys.js", () => ({
  isApproved: (publicKey: string) =>
    Promise.resolve(approvedKeySet.has(publicKey)),
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
let signedFetch: FetchFn;

beforeAll(async () => {
  const ctx = createApp(Date.now());
  gateway = ctx.gateway;

  server = await new Promise<ServerType>((resolve) => {
    const s = serve({ fetch: ctx.app.fetch, port: 0 }, () => resolve(s));
    ctx.injectWebSocket(s);
  });

  const addr = server.address();
  port = typeof addr === "object" && addr ? addr.port : 0;

  signedFetch = createSignedFetch(globalThis.fetch, {
    privateKey: TEST_KEYPAIR.privateKey,
    publicKey: TEST_KEYPAIR.publicKey,
  });
});

beforeEach(() => {
  clearNonceStore();
  approvedKeySet.clear();
  approvedKeySet.add(TEST_KEYPAIR.publicKey);
});

afterAll(() => {
  gateway.stop();
  server.close();
});

// Helper: 手動で署名ヘッダを組み立てる
function manualSignHeaders(
  overrides: {
    publicKey?: string;
    timestamp?: number;
    nonce?: string;
    signature?: string;
    url?: string;
  } = {},
) {
  const url = overrides.url ?? `http://127.0.0.1:${port}/api/workspaces/recent`;
  const timestamp = overrides.timestamp ?? Date.now();
  const nonce = overrides.nonce ?? generateUUID();
  const requestTarget = normalizeRequestTarget(url);
  const signature =
    overrides.signature ??
    signRequest(
      TEST_KEYPAIR.privateKey,
      "GET",
      requestTarget,
      timestamp,
      nonce,
      hashBody(undefined),
    );
  const publicKey = overrides.publicKey ?? TEST_KEYPAIR.publicKey;

  return {
    url,
    headers: {
      "X-Public-Key": publicKey,
      "X-Timestamp": String(timestamp),
      "X-Nonce": nonce,
      "X-Signature": signature,
    },
  };
}

describe("REST API 認証 — 正常系", () => {
  it("有効な署名付きリクエストが成功する", async () => {
    const res = await signedFetch(
      `http://127.0.0.1:${port}/api/workspaces/recent`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as WorkspacesRecentResponse;
    expect(body.workspaces).toHaveLength(1);
    expect(body.workspaces[0].path).toBe("/projects/app");
  });
});

describe("REST API 認証 — 異常系", () => {
  it("署名ヘッダなしで 401 を返す", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/workspaces/recent`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as ErrorResponse;
    expect(body.error.code).toBe("SIGNATURE_INVALID");
  });

  it("不正なフォーマットの��ッダ値で 401 SIGNATURE_INVALID を返す", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/workspaces/recent`, {
      headers: {
        "X-Public-Key": "not-valid-hex",
        "X-Timestamp": "not-a-number",
        "X-Nonce": "not-a-uuid",
        "X-Signature": "too-short",
      },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as ErrorResponse;
    expect(body.error.code).toBe("SIGNATURE_INVALID");
  });

  it("未承認の公開鍵で 401 KEY_NOT_APPROVED を返す", async () => {
    const otherKeypair = generateKeypair();
    const otherFetch = createSignedFetch(globalThis.fetch, {
      privateKey: otherKeypair.privateKey,
      publicKey: otherKeypair.publicKey,
    });
    const res = await otherFetch(
      `http://127.0.0.1:${port}/api/workspaces/recent`,
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as ErrorResponse;
    expect(body.error.code).toBe("KEY_NOT_APPROVED");
  });

  it("タイムスタンプが ±30s 超で 401 TIMESTAMP_OUT_OF_RANGE を返す", async () => {
    const url = `http://127.0.0.1:${port}/api/workspaces/recent`;
    const { headers } = manualSignHeaders({
      url,
      timestamp: Date.now() - 60_000, // 60s ago
    });
    const res = await fetch(url, { headers });
    expect(res.status).toBe(401);
    const body = (await res.json()) as ErrorResponse;
    expect(body.error.code).toBe("TIMESTAMP_OUT_OF_RANGE");
  });

  it("不正な署名で 401 SIGNATURE_INVALID を返す", async () => {
    const url = `http://127.0.0.1:${port}/api/workspaces/recent`;
    const { headers } = manualSignHeaders({ url });
    // 正しいフォーマット (128 hex chars) だが中身が不正
    headers["X-Signature"] = "a".repeat(128);
    const res = await fetch(url, { headers });
    expect(res.status).toBe(401);
    const body = (await res.json()) as ErrorResponse;
    expect(body.error.code).toBe("SIGNATURE_INVALID");
  });

  it("同じ nonce を再送した場合に 401 NONCE_REUSED を返す", async () => {
    const url = `http://127.0.0.1:${port}/api/workspaces/recent`;
    const { headers } = manualSignHeaders({ url });

    // 1回目は成功
    const res1 = await fetch(url, { headers });
    expect(res1.status).toBe(200);

    // 2回目は同じ nonce で拒否
    const res2 = await fetch(url, { headers });
    expect(res2.status).toBe(401);
    const body = (await res2.json()) as ErrorResponse;
    expect(body.error.code).toBe("NONCE_REUSED");
  });

  it("デバイス revoke 後の REST が即座に 401 KEY_NOT_APPROVED になる", async () => {
    // まず正常アクセスを確認
    const res1 = await signedFetch(
      `http://127.0.0.1:${port}/api/workspaces/recent`,
    );
    expect(res1.status).toBe(200);

    // revoke: 承認セットから削除
    approvedKeySet.delete(TEST_KEYPAIR.publicKey);

    const res2 = await signedFetch(
      `http://127.0.0.1:${port}/api/workspaces/recent`,
    );
    expect(res2.status).toBe(401);
    const body = (await res2.json()) as ErrorResponse;
    expect(body.error.code).toBe("KEY_NOT_APPROVED");
  });
});

describe("CORS preflight", () => {
  it("署名ヘッダが Access-Control-Allow-Headers に含ま��る", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/workspaces/recent`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://example.com",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers":
          "X-Public-Key, X-Timestamp, X-Nonce, X-Signature",
      },
    });
    expect(res.status).toBeLessThan(300);
    const allowHeaders = res.headers.get("Access-Control-Allow-Headers") ?? "";
    for (const h of ["x-public-key", "x-timestamp", "x-nonce", "x-signature"]) {
      expect(allowHeaders.toLowerCase()).toContain(h);
    }
  });
});

describe("GET /api/workspaces/browse", () => {
  it("path パラメータなしでホームディレクトリを返す", async () => {
    const res = await signedFetch(
      `http://127.0.0.1:${port}/api/workspaces/browse`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as WorkspacesBrowseResponse;
    expect(body.path).toBeTruthy();
    expect(Array.isArray(body.entries)).toBe(true);
  });

  it("存在しないパスで 404 を返す", async () => {
    const res = await signedFetch(
      `http://127.0.0.1:${port}/api/workspaces/browse?path=/nonexistent/path/that/does/not/exist`,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as ErrorResponse;
    expect(body.error.code).toBe("WORKSPACE_NOT_FOUND");
  });

  it("存在するパスで 200 とエントリ一覧を返す", async () => {
    const res = await signedFetch(
      `http://127.0.0.1:${port}/api/workspaces/browse?path=/tmp`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as WorkspacesBrowseResponse;
    expect(body.path).toBe("/tmp");
    expect(Array.isArray(body.entries)).toBe(true);
  });
});
