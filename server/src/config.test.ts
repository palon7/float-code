import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

let tmpDir: string;

beforeEach(async () => {
  vi.resetModules();
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "config-test-"));
  vi.doMock("./utils/fs.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./utils/fs.js")>();
    return {
      ...actual,
      dataPath: (filename: string) => path.join(tmpDir, filename),
    };
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("初回起動時にトークンを自動生成して保存する", async () => {
    const { loadConfig } = await import("./config.js");
    const config = await loadConfig();

    expect(config.authToken).toBeTruthy();
    expect(config.authToken.length).toBe(64); // 32 bytes hex
    expect(config.port).toBe(8080);
    expect(config.claude).toEqual({
      permissionMode: "acceptEdits",
      mcpConfig: {},
      allowedTools: [],
      disallowedTools: [],
      env: {},
      extraArgs: [],
    });

    const saved = JSON.parse(
      await fs.readFile(path.join(tmpDir, "config.json"), "utf-8"),
    );
    expect(saved.authToken).toBe(config.authToken);
    expect(saved.claude).toEqual({
      permissionMode: "acceptEdits",
      mcpConfig: {},
      allowedTools: [],
      disallowedTools: [],
      env: {},
      extraArgs: [],
    });
  });

  it("既存のconfig を読み込みつつ不足項目を補完する", async () => {
    await fs.writeFile(
      path.join(tmpDir, "config.json"),
      JSON.stringify({ version: 1, port: 9090, authToken: "my-token" }),
    );

    const { loadConfig } = await import("./config.js");
    const config = await loadConfig();

    expect(config.port).toBe(9090);
    expect(config.authToken).toBe("my-token");
    expect(config.claude).toEqual({
      permissionMode: "acceptEdits",
      mcpConfig: {},
      allowedTools: [],
      disallowedTools: [],
      env: {},
      extraArgs: [],
    });

    const saved = JSON.parse(
      await fs.readFile(path.join(tmpDir, "config.json"), "utf-8"),
    );
    expect(saved.claude).toEqual({
      permissionMode: "acceptEdits",
      mcpConfig: {},
      allowedTools: [],
      disallowedTools: [],
      env: {},
      extraArgs: [],
    });
  });

  it("Claude CLI 向け設定を読み込める", async () => {
    await fs.writeFile(
      path.join(tmpDir, "config.json"),
      JSON.stringify({
        version: 1,
        port: 3001,
        authToken: "my-token",
        claude: {
          model: "claude-sonnet-4-6",
          appendSystemPrompt: "Follow repo conventions.",
          mcpConfig: {
            filesystem: {
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
            },
          },
          allowedTools: ["Read", "Edit"],
          disallowedTools: ["Bash"],
          permissionMode: "plan",
          env: {
            FOO: "bar",
          },
          extraArgs: ["--strict-mcp-config"],
        },
      }),
    );

    const { loadConfig } = await import("./config.js");
    const config = await loadConfig();

    expect(config.port).toBe(3001);
    expect(config.claude).toEqual({
      model: "claude-sonnet-4-6",
      appendSystemPrompt: "Follow repo conventions.",
      mcpConfig: {
        filesystem: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
        },
      },
      allowedTools: ["Read", "Edit"],
      disallowedTools: ["Bash"],
      permissionMode: "plan",
      env: {
        FOO: "bar",
      },
      extraArgs: ["--strict-mcp-config"],
    });
  });

  it("不正な port はデフォルト値にフォールバックする", async () => {
    await fs.writeFile(
      path.join(tmpDir, "config.json"),
      JSON.stringify({
        version: 1,
        port: 70000,
        authToken: "my-token",
      }),
    );

    const { loadConfig } = await import("./config.js");
    const config = await loadConfig();

    expect(config.port).toBe(8080);
  });
});
