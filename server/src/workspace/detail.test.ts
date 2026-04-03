import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Stats } from "node:fs";

const mockStat = vi.fn();
const mockExecFile = vi.fn();

vi.mock("node:fs/promises", () => ({
  stat: (...args: unknown[]) => mockStat(...args),
}));

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

import { getWorkspaceDetail } from "./detail.js";
import { WorkspaceNotFoundError } from "./errors.js";

function mockGit(responses: Record<string, { stdout: string; err?: Error }>) {
  mockExecFile.mockImplementation(
    (
      _cmd: string,
      args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string) => void,
    ) => {
      const key = args.join(" ");
      const resp = Object.entries(responses).find(([k]) => key.includes(k));
      if (resp) {
        cb(resp[1].err ?? null, resp[1].stdout);
      } else {
        cb(new Error("unexpected git command"), "");
      }
    },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
});

describe("getWorkspaceDetail", () => {
  it("returns git info for a git repo", async () => {
    mockGit({
      "rev-parse --is-inside-work-tree": { stdout: "true" },
      "branch --show-current": { stdout: "main" },
      "status --porcelain": { stdout: "" },
    });

    const result = await getWorkspaceDetail("/projects/my-app");
    expect(result).toMatchObject({
      path: "/projects/my-app",
      name: "my-app",
      git: { branch: "main", dirty: false },
    });
  });

  it("returns dirty: true when there are uncommitted changes", async () => {
    mockGit({
      "rev-parse --is-inside-work-tree": { stdout: "true" },
      "branch --show-current": { stdout: "feature" },
      "status --porcelain": { stdout: " M src/app.ts\n?? new-file.ts" },
    });

    const result = await getWorkspaceDetail("/projects/my-app");
    expect(result.git?.dirty).toBe(true);
  });

  it("returns git: undefined for non-git directory", async () => {
    mockGit({
      "rev-parse --is-inside-work-tree": {
        stdout: "",
        err: new Error("not a git repo"),
      },
      "branch --show-current": {
        stdout: "",
        err: new Error("not a git repo"),
      },
      "status --porcelain": {
        stdout: "",
        err: new Error("not a git repo"),
      },
    });

    const result = await getWorkspaceDetail("/projects/plain-dir");
    expect(result.git).toBeUndefined();
  });

  it("returns 'HEAD' when on detached HEAD", async () => {
    mockGit({
      "rev-parse --is-inside-work-tree": { stdout: "true" },
      "branch --show-current": { stdout: "" },
      "status --porcelain": { stdout: "" },
    });

    const result = await getWorkspaceDetail("/projects/detached");
    expect(result.git?.branch).toBe("HEAD");
  });

  it("throws WorkspaceNotFoundError for non-existent path", async () => {
    mockStat.mockRejectedValue(new Error("ENOENT"));

    await expect(getWorkspaceDetail("/nonexistent")).rejects.toThrow(
      WorkspaceNotFoundError,
    );
  });
});
