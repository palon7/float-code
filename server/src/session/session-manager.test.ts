import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SystemEntry, TextEntry, ToolCallEntry } from "@palon7/cc-client";

let mockServerConfig: {
  version: 1;
  port: number;
  authToken: string;
  claude: Record<string, unknown>;
} = {
  version: 1,
  port: 8080,
  authToken: "test-token",
  claude: {
    permissionMode: "acceptEdits",
    mcpConfig: {},
    allowedTools: [],
    disallowedTools: [],
    env: {},
    extraArgs: [],
  },
};

vi.mock("../config.js", () => ({
  getConfig: vi.fn(() => mockServerConfig),
}));

vi.mock("../workspace/workspace-store.js", () => ({
  touchRecent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node:fs/promises", () => ({
  realpath: vi.fn(),
}));

vi.mock("@palon7/cc-client", async () => {
  const { EventEmitter } = await import("node:events");
  const createMockSession = () =>
    Object.assign(new EventEmitter(), {
      sessionId: "",
      exitReason: null as string | null,
      pid: 1234 as number | undefined,
      send: vi.fn(),
      interrupt: vi.fn(),
      abort: vi.fn(),
      done: vi.fn().mockResolvedValue(undefined),
    });
  let currentSession = createMockSession();

  const MockClaudeCodeClient = vi.fn().mockImplementation(() => ({
    start: vi.fn().mockImplementation(() => {
      currentSession = createMockSession();
      return currentSession;
    }),
    resume: vi.fn().mockImplementation(() => {
      currentSession = createMockSession();
      return currentSession;
    }),
  }));

  return {
    ClaudeCodeClient: MockClaudeCodeClient,
    getSessionDir: vi.fn().mockReturnValue("/mock/session/dir"),
    loadSession: vi.fn().mockResolvedValue({
      sessionId: "loaded-id",
      model: "claude-opus-4-6",
      entries: [],
    }),
    __getClientCtor: () => MockClaudeCodeClient,
    __getCurrentSession: () => currentSession,
  };
});

import { realpath } from "node:fs/promises";
// @ts-expect-error - __getCurrentSession は vi.mock 内の非公開変数
import { __getClientCtor, __getCurrentSession } from "@palon7/cc-client";
import { SessionManager } from "./session-manager.js";
import { ConnectionRegistry } from "../ws/connection-registry.js";
import { PidTracker } from "./pid-tracker.js";

vi.mock("./pid-tracker.js", () => ({
  PidTracker: vi.fn().mockImplementation(() => ({
    add: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    killOrphans: vi.fn().mockResolvedValue(undefined),
    killAllSync: vi.fn(),
  })),
}));

const mockRealpath = vi.mocked(realpath);

function makeSystemEntry(sessionId: string): SystemEntry {
  return {
    id: "sys-1",
    kind: "system",
    sessionId,
    model: "claude-opus-4-6",
    tools: [],
    mcpServers: [],
    timestamp: "2026-01-01T00:00:00.000Z",
  };
}

function makeTextEntry(
  id: string,
  text: string,
  isStreaming: boolean,
): TextEntry {
  return {
    id,
    kind: "text",
    text,
    isStreaming,
    timestamp: "2026-01-01T00:00:00.000Z",
  };
}

function makeToolCallEntry(id: string, isStreaming?: boolean): ToolCallEntry {
  return {
    id,
    kind: "tool_call",
    toolName: "Bash",
    toolUseId: id,
    input: { command: "ls" },
    isStreaming,
    timestamp: "2026-01-01T00:00:00.000Z",
  };
}

let manager: SessionManager;
let registry: ConnectionRegistry;
let pidTracker: PidTracker;

function currentSession() {
  return __getCurrentSession() as {
    emit: (event: string, ...args: unknown[]) => boolean;
    removeAllListeners: () => void;
    exitReason: string | null;
    send: ReturnType<typeof vi.fn>;
    interrupt: ReturnType<typeof vi.fn>;
    abort: ReturnType<typeof vi.fn>;
  };
}

function broadcasted(): unknown[] {
  const calls = (registry.broadcast as ReturnType<typeof vi.fn>).mock.calls;
  return calls.map((args: unknown[]) => ({
    type: args[0] as string,
    ...(args[1] as Record<string, unknown>),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockServerConfig = {
    version: 1,
    port: 8080,
    authToken: "test-token",
    claude: {
      permissionMode: "acceptEdits",
      mcpConfig: {},
      allowedTools: [],
      disallowedTools: [],
      env: {},
      extraArgs: [],
    },
  };
  const session = currentSession();
  session.removeAllListeners();
  session.exitReason = null;
  registry = new ConnectionRegistry();
  vi.spyOn(registry, "broadcast");
  pidTracker = new PidTracker();
  manager = new SessionManager(registry, pidTracker);
  mockRealpath.mockResolvedValue("/resolved/path");
});

describe("SessionManager", () => {
  describe("openNewSession", () => {
    it("session.opened を broadcast する（idle 状態）", async () => {
      await manager.openNewSession("/some/path");

      const msgs = broadcasted();
      const opened = msgs.find(
        (m) => (m as { type: string }).type === "session.opened",
      );
      expect(opened).toBeTruthy();
      expect((opened as { status: string }).status).toBe("idle");
    });

    it("realpath 失敗 → WORKSPACE_NOT_FOUND broadcast", async () => {
      mockRealpath.mockRejectedValue(new Error("ENOENT"));
      await manager.openNewSession("/bad/path");
      const msgs = broadcasted();
      expect(msgs[0]).toMatchObject({
        type: "session.error",
        code: "WORKSPACE_NOT_FOUND",
      });
    });
  });

  describe("loadSession", () => {
    it("ディスクから履歴をロードして session.opened を broadcast する", async () => {
      await manager.loadSession("loaded-id", "/some/path");

      const msgs = broadcasted();
      const opened = msgs.find(
        (m) => (m as { type: string }).type === "session.opened",
      );
      expect(opened).toBeTruthy();
      expect((opened as { status: string }).status).toBe("idle");
      expect((opened as { sessionId: string }).sessionId).toBe("loaded-id");
    });
  });

  describe("send from idle", () => {
    it("新規: idle + sessionIdなし → client.start(text) で spawn", async () => {
      await manager.openNewSession("/some/path");
      (registry.broadcast as ReturnType<typeof vi.fn>).mockClear();

      manager.send("hello");
      currentSession().emit("entry", makeSystemEntry("real-session-id"));

      const msgs = broadcasted();
      const started = msgs.find(
        (m) => (m as { type: string }).type === "session.started",
      );
      expect(started).toBeTruthy();
      expect(started).toMatchObject({
        type: "session.started",
        sessionId: "real-session-id",
        status: "running",
        meta: {
          workspacePath: "/resolved/path",
          model: "claude-opus-4-6",
        },
      });
      expect(started).not.toHaveProperty("meta.sessionId");
      expect(started).not.toHaveProperty("entries");
    });

    it("再開: idle + sessionIdあり → client.resume(sessionId, text) で起動", async () => {
      await manager.loadSession("loaded-id", "/some/path");
      (registry.broadcast as ReturnType<typeof vi.fn>).mockClear();

      manager.send("follow-up");

      currentSession().emit("entry", makeSystemEntry("loaded-id"));
      // resume の第2引数で text が渡されるため、sendQueue 経由の send は呼ばれない
      expect(currentSession().send).not.toHaveBeenCalled();
    });

    it("config の Claude 設定を渡して client を作る", async () => {
      mockServerConfig = {
        version: 1,
        port: 8080,
        authToken: "test-token",
        claude: {
          model: "claude-sonnet-4-6",
          appendSystemPrompt: "Follow repo conventions.",
          allowedTools: ["Read"],
          disallowedTools: ["Bash"],
          permissionMode: "plan",
          env: { FOO: "bar" },
          extraArgs: ["--strict-mcp-config"],
        },
      };

      await manager.openNewSession("/some/path");
      manager.send("hello");

      const ctor = vi.mocked(__getClientCtor());
      expect(ctor).toHaveBeenCalledWith({
        workspacePath: "/resolved/path",
        model: "claude-sonnet-4-6",
        appendSystemPrompt: "Follow repo conventions.",
        allowedTools: ["Read"],
        disallowedTools: ["Bash"],
        permissionMode: "plan",
        env: { FOO: "bar" },
        extraArgs: ["--strict-mcp-config"],
      });
    });

    it("pid を PidTracker に追加する", async () => {
      await manager.openNewSession("/some/path");
      manager.send("hello");
      await Promise.resolve();
      expect(pidTracker.add).toHaveBeenCalledWith(1234);
    });
  });

  describe("streaming entries", () => {
    beforeEach(async () => {
      await manager.openNewSession("/some/path");
      manager.send("hello");
      currentSession().emit("entry", makeSystemEntry("real-id"));
      (registry.broadcast as ReturnType<typeof vi.fn>).mockClear();
    });

    it("streaming text delta が broadcast される", () => {
      currentSession().emit("entry", makeTextEntry("t1", "hel", true));
      currentSession().emit("entry", makeTextEntry("t1", "lo", true));

      const snapshot = manager.getSnapshot();
      const textEntry = snapshot?.entries.find((e) => e.id === "t1");
      expect((textEntry as TextEntry)?.text).toBe("hello");
    });

    it("final entry で streaming が clearStreaming される", () => {
      currentSession().emit("entry", makeTextEntry("t1", "stream", true));
      currentSession().emit("entry", makeTextEntry("t2", "final", false));

      const snapshot = manager.getSnapshot();
      expect(snapshot?.entries.find((e) => e.id === "t1")).toBeUndefined();
      expect(snapshot?.entries.find((e) => e.id === "t2")).toBeTruthy();
    });

    it("streaming tool_call が置き換えられる", () => {
      currentSession().emit("entry", makeToolCallEntry("tc1", true));
      currentSession().emit("entry", {
        ...makeToolCallEntry("tc1", true),
        input: { command: "pwd" },
      });

      const snapshot = manager.getSnapshot();
      const tc = snapshot?.entries.find((e) => e.id === "tc1");
      expect((tc as ToolCallEntry)?.input.command).toBe("pwd");
    });
  });

  describe("spawn 失敗", () => {
    it("system entry 前に end → SESSION_SPAWN_FAILED broadcast", async () => {
      await manager.openNewSession("/some/path");
      manager.send("hello");
      currentSession().exitReason = "error";
      currentSession().emit("end");

      const msgs = broadcasted();
      expect(
        msgs.find(
          (m) =>
            (m as { type: string }).type === "session.error" &&
            (m as { code: string }).code === "SESSION_SPAWN_FAILED",
        ),
      ).toBeTruthy();
    });

    it("spawn 失敗後の send は SESSION_NOT_FOUND broadcast", async () => {
      await manager.openNewSession("/some/path");
      manager.send("hello");
      currentSession().exitReason = "error";
      currentSession().emit("end");
      (registry.broadcast as ReturnType<typeof vi.fn>).mockClear();

      manager.send("follow-up");

      const msgs = broadcasted();
      expect(msgs[0]).toMatchObject({
        type: "session.error",
        code: "SESSION_NOT_FOUND",
      });
    });
  });

  describe("end event", () => {
    it("session.done を broadcast し、status を idle に戻す", async () => {
      await manager.openNewSession("/some/path");
      manager.send("hello");
      currentSession().emit("entry", makeSystemEntry("done-session"));
      (registry.broadcast as ReturnType<typeof vi.fn>).mockClear();

      currentSession().exitReason = "complete";
      currentSession().emit("end");

      const msgs = broadcasted();
      const done = msgs.find(
        (m) => (m as { type: string }).type === "session.done",
      );
      expect(done).toMatchObject({
        sessionId: "done-session",
        exitReason: "complete",
      });

      const snapshot = manager.getSnapshot();
      expect(snapshot?.status).toBe("idle");
    });
  });

  describe("send / interrupt / abort", () => {
    beforeEach(async () => {
      await manager.openNewSession("/some/path");
      manager.send("hello");
      currentSession().emit("entry", makeSystemEntry("active-s"));
    });

    it("send: running セッションに転送", () => {
      manager.send("follow-up");
      expect(currentSession().send).toHaveBeenCalledWith("follow-up");
    });

    it("send: idle セッション（完了後）は resume(sessionId, text) で再開", () => {
      currentSession().emit("end");
      (registry.broadcast as ReturnType<typeof vi.fn>).mockClear();

      manager.send("text");

      currentSession().emit("entry", makeSystemEntry("active-s"));
      // resume の第2引数で text が渡されるため、sendQueue 経由の send は呼ばれない
      expect(currentSession().send).not.toHaveBeenCalled();
    });

    it("interrupt: running セッションに委譲", () => {
      manager.interrupt();
      expect(currentSession().interrupt).toHaveBeenCalled();
    });

    it("abort: running セッションに委譲", () => {
      manager.abort();
      expect(currentSession().abort).toHaveBeenCalled();
    });

    it("アクティブなしで SESSION_NOT_FOUND broadcast", () => {
      const freshManager = new SessionManager(registry, pidTracker);
      freshManager.send("text");
      const msgs = broadcasted();
      expect(
        msgs.find(
          (m) =>
            (m as { type: string }).type === "session.error" &&
            (m as { code: string }).code === "SESSION_NOT_FOUND",
        ),
      ).toBeTruthy();
    });
  });

  describe("send queue while spawning", () => {
    it("spawning 中は send をキューし、running で順に flush する", async () => {
      await manager.openNewSession("/some/path");
      manager.send("hello");

      manager.send("q1");
      manager.send("q2");

      currentSession().emit("entry", makeSystemEntry("queued-session"));
      expect(currentSession().send).toHaveBeenNthCalledWith(1, "q1");
      expect(currentSession().send).toHaveBeenNthCalledWith(2, "q2");
    });

    it("spawning 中の sendQueue は 10 件までで超過時エラー", async () => {
      await manager.openNewSession("/some/path");
      manager.send("hello");

      for (let i = 1; i <= 10; i += 1) {
        manager.send(`q${i}`);
      }
      manager.send("q11");

      const msgs = broadcasted();
      expect(
        msgs.find(
          (m) =>
            (m as { type: string }).type === "session.error" &&
            (m as { code: string }).code === "SESSION_SEND_QUEUE_FULL",
        ),
      ).toBeTruthy();

      currentSession().emit("entry", makeSystemEntry("queued-session"));
      expect(currentSession().send).toHaveBeenCalledTimes(10);
      expect(currentSession().send).toHaveBeenNthCalledWith(10, "q10");
    });
  });

  describe("getSnapshot", () => {
    it("アクティブセッションがなければ undefined", () => {
      expect(manager.getSnapshot()).toBeUndefined();
    });

    it("running セッションの snapshot を返す", async () => {
      await manager.openNewSession("/some/path");
      manager.send("hello");
      currentSession().emit("entry", makeSystemEntry("snap-id"));

      const snapshot = manager.getSnapshot();
      expect(snapshot?.sessionId).toBe("snap-id");
      expect(snapshot?.status).toBe("running");
    });

    it("idle セッション（完了後）の snapshot を返す", async () => {
      await manager.openNewSession("/some/path");
      manager.send("hello");
      currentSession().emit("entry", makeSystemEntry("done-id"));
      currentSession().exitReason = "complete";
      currentSession().emit("end");

      const snapshot = manager.getSnapshot();
      expect(snapshot?.status).toBe("idle");
      expect(snapshot?.sessionId).toBe("done-id");
    });
  });
});
