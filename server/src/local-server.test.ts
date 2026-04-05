import { describe, it, expect, vi, beforeEach } from "vitest";
import { createLocalServer } from "./local-server.js";

const TEST_LOCAL_TOKEN = "test-local-token-1234567890";

vi.mock("./config.js", () => ({
  getConfig: () => ({ localAuthToken: TEST_LOCAL_TOKEN }),
}));

vi.mock("./auth/pairing.js", () => ({
  listPending: vi.fn().mockResolvedValue([]),
  approvePairing: vi.fn().mockResolvedValue(null),
}));

vi.mock("./auth/approved-keys.js", () => ({
  listKeys: vi.fn().mockResolvedValue([]),
  removeByCode: vi.fn().mockResolvedValue(false),
}));

function authHeader() {
  return { Authorization: `Bearer ${TEST_LOCAL_TOKEN}` };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function jsonBody(res: Response): Promise<any> {
  return res.json();
}

describe("Local Management Server", () => {
  let app: ReturnType<typeof createLocalServer>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createLocalServer();
  });

  describe("認証ミドルウェア", () => {
    it("Authorization ヘッダなしで 401", async () => {
      const res = await app.request("/pairing/pending");
      expect(res.status).toBe(401);
    });

    it("不正な localAuthToken で 401", async () => {
      const res = await app.request("/pairing/pending", {
        headers: { Authorization: "Bearer wrong-token" },
      });
      expect(res.status).toBe(401);
    });

    it("正しい localAuthToken で通過する", async () => {
      const res = await app.request("/pairing/pending", {
        headers: authHeader(),
      });
      expect(res.status).toBe(200);
    });
  });

  describe("GET /pairing/pending", () => {
    it("pending 一覧を返す", async () => {
      const { listPending } = await import("./auth/pairing.js");
      vi.mocked(listPending).mockResolvedValueOnce([
        {
          publicKey: "abc",
          pairingCode: "ABCD-EFGH",
          createdAt: "2026-01-01T00:00:00Z",
          expiresAt: "2026-01-01T00:10:00Z",
        },
      ]);

      const res = await app.request("/pairing/pending", {
        headers: authHeader(),
      });
      expect(res.status).toBe(200);

      const body = await jsonBody(res);
      expect(body.pairings).toHaveLength(1);
      expect(body.pairings[0]).toEqual({
        code: "ABCD-EFGH",
        createdAt: "2026-01-01T00:00:00Z",
        expiresAt: "2026-01-01T00:10:00Z",
      });
    });
  });

  describe("POST /pairing/approve", () => {
    it("code 欠如で 400", async () => {
      const res = await app.request("/pairing/approve", {
        method: "POST",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await jsonBody(res);
      expect(body.error).toMatch(/code/i);
    });

    it("不明な code で 404", async () => {
      const res = await app.request("/pairing/approve", {
        method: "POST",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ code: "UNKNOWN-CODE" }),
      });
      expect(res.status).toBe(404);
    });

    it("正常な code で approve 成功", async () => {
      const { approvePairing } = await import("./auth/pairing.js");
      vi.mocked(approvePairing).mockResolvedValueOnce({
        publicKey: "abc123",
        pairingCode: "ABCD-EFGH",
        label: "abc123",
        approvedAt: "2026-01-01T00:00:00Z",
      });

      const res = await app.request("/pairing/approve", {
        method: "POST",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ code: "ABCD-EFGH" }),
      });
      expect(res.status).toBe(200);

      const body = await jsonBody(res);
      expect(body.approved.publicKey).toBe("abc123");
      expect(body.approved.pairingCode).toBe("ABCD-EFGH");
    });
  });

  describe("DELETE /pairing/revoke", () => {
    it("code 欠如で 400", async () => {
      const res = await app.request("/pairing/revoke", {
        method: "DELETE",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await jsonBody(res);
      expect(body.error).toMatch(/code/i);
    });

    it("不明な code で 404", async () => {
      const res = await app.request("/pairing/revoke", {
        method: "DELETE",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ code: "UNKNOWN-CODE" }),
      });
      expect(res.status).toBe(404);
    });

    it("正常な code で revoke 成功", async () => {
      const { removeByCode } = await import("./auth/approved-keys.js");
      vi.mocked(removeByCode).mockResolvedValueOnce(true);

      const res = await app.request("/pairing/revoke", {
        method: "DELETE",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ code: "ABCD-EFGH" }),
      });
      expect(res.status).toBe(200);

      const body = await jsonBody(res);
      expect(body.revoked).toBe(true);
    });
  });

  describe("GET /pairing/approved", () => {
    it("approved 一覧を返す", async () => {
      const { listKeys } = await import("./auth/approved-keys.js");
      vi.mocked(listKeys).mockResolvedValueOnce([
        {
          publicKey: "abc",
          pairingCode: "ABCD-EFGH",
          label: "My Device",
          approvedAt: "2026-01-01T00:00:00Z",
        },
      ]);

      const res = await app.request("/pairing/approved", {
        headers: authHeader(),
      });
      expect(res.status).toBe(200);

      const body = await jsonBody(res);
      expect(body.keys).toHaveLength(1);
      expect(body.keys[0]).toEqual({
        pairingCode: "ABCD-EFGH",
        label: "My Device",
        approvedAt: "2026-01-01T00:00:00Z",
      });
    });
  });
});
