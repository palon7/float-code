import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSessionsRouter } from "./sessions.js";
import type { SessionManager } from "../session/session-manager.js";
import type {
  SessionSnapshot,
  ErrorResponse,
  SessionsListResponse,
  SessionDetailResponse,
} from "@float-code/shared/protocol";
import type { SessionSummary, SessionDetail } from "@palon7/cc-client";

vi.mock("@palon7/cc-client", () => ({
  getSessionDir: vi.fn(
    (p: string) => `/mock-claude/projects/${p.replace(/[^a-zA-Z0-9]/g, "-")}`,
  ),
  listSessions: vi.fn(),
  loadSession: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    realpath: vi.fn((p: string) => {
      if (p.includes("nonexistent")) throw new Error("ENOENT");
      return Promise.resolve(p);
    }),
  };
});

import { listSessions, loadSession } from "@palon7/cc-client";

const mockListSessions = vi.mocked(listSessions);
const mockLoadSession = vi.mocked(loadSession);

function makeSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: "aaaa-bbbb-cccc-dddd",
    model: "claude-opus-4-6",
    title: "Test session",
    numTurns: 3,
    durationMs: 5000,
    startedAt: "2026-03-29T00:00:00.000Z",
    lastModified: "2026-03-29T01:00:00.000Z",
    lastMessage: "Hello",
    ...overrides,
  };
}

function makeDetail(overrides: Partial<SessionDetail> = {}): SessionDetail {
  return {
    sessionId: "aaaa-bbbb-cccc-dddd",
    model: "claude-opus-4-6",
    title: "Test session",
    numTurns: 3,
    durationMs: 5000,
    entryCount: 10,
    inputTokens: 1000,
    outputTokens: 500,
    entries: [],
    ...overrides,
  };
}

function makeSessionManager(snapshot?: SessionSnapshot): SessionManager {
  return {
    getSnapshot: () => snapshot,
  } as unknown as SessionManager;
}

function createApp(snapshot?: SessionSnapshot) {
  const sm = makeSessionManager(snapshot);
  return createSessionsRouter(sm);
}

describe("GET /api/sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("workspacePath missing returns 400", async () => {
    const app = createApp();
    const res = await app.request("/");
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorResponse;
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("nonexistent workspacePath returns 404", async () => {
    const app = createApp();
    const res = await app.request("/?workspacePath=/nonexistent/path");
    expect(res.status).toBe(404);
    const body = (await res.json()) as ErrorResponse;
    expect(body.error.code).toBe("WORKSPACE_NOT_FOUND");
  });

  it("returns session list", async () => {
    mockListSessions.mockResolvedValue([makeSummary()]);
    const app = createApp();
    const res = await app.request("/?workspacePath=/tmp");
    expect(res.status).toBe(200);
    const body = (await res.json()) as SessionsListResponse;
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].sessionId).toBe("aaaa-bbbb-cccc-dddd");
    expect(body.sessions[0].status).toBe("idle");
  });

  it("overrides live session status", async () => {
    mockListSessions.mockResolvedValue([
      makeSummary({ sessionId: "live-session-id" }),
      makeSummary({ sessionId: "other-session" }),
    ]);
    const snapshot: SessionSnapshot = {
      sessionId: "live-session-id",
      status: "running",
      entries: [],
    };
    const app = createApp(snapshot);
    const res = await app.request("/?workspacePath=/tmp");
    expect(res.status).toBe(200);
    const body = (await res.json()) as SessionsListResponse;
    expect(body.sessions[0].status).toBe("running");
    expect(body.sessions[1].status).toBe("idle");
  });

  it("returns empty list", async () => {
    mockListSessions.mockResolvedValue([]);
    const app = createApp();
    const res = await app.request("/?workspacePath=/tmp");
    expect(res.status).toBe(200);
    const body = (await res.json()) as SessionsListResponse;
    expect(body.sessions).toHaveLength(0);
  });
});

describe("GET /api/sessions/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("workspacePath missing returns 400", async () => {
    const app = createApp();
    const res = await app.request("/some-id");
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorResponse;
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("nonexistent workspacePath returns 404", async () => {
    const app = createApp();
    const res = await app.request("/some-id?workspacePath=/nonexistent/path");
    expect(res.status).toBe(404);
    const body = (await res.json()) as ErrorResponse;
    expect(body.error.code).toBe("WORKSPACE_NOT_FOUND");
  });

  it("nonexistent sessionId returns 404", async () => {
    mockLoadSession.mockRejectedValue(new Error("ENOENT"));
    const app = createApp();
    const res = await app.request("/bad-id?workspacePath=/tmp");
    expect(res.status).toBe(404);
    const body = (await res.json()) as ErrorResponse;
    expect(body.error.code).toBe("SESSION_NOT_FOUND");
  });

  it("returns session detail", async () => {
    mockLoadSession.mockResolvedValue(makeDetail());
    const app = createApp();
    const res = await app.request("/aaaa-bbbb-cccc-dddd?workspacePath=/tmp");
    expect(res.status).toBe(200);
    const body = (await res.json()) as SessionDetailResponse;
    expect(body.sessionId).toBe("aaaa-bbbb-cccc-dddd");
    expect(body.model).toBe("claude-opus-4-6");
    expect(body.entries).toEqual([]);
    expect(body.inputTokens).toBe(1000);
    expect(body.outputTokens).toBe(500);
  });
});
