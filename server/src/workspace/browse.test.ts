import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Dirent } from "node:fs";

const mockReaddir = vi.fn();

vi.mock("node:fs/promises", () => ({
  readdir: (...args: unknown[]) => mockReaddir(...args),
}));

import { browseDirectory } from "./browse.js";
import { WorkspaceNotFoundError } from "./errors.js";

function makeDirent(name: string, isDir: boolean): Dirent {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
  } as Dirent;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("browseDirectory", () => {
  it("returns only directories", async () => {
    mockReaddir.mockResolvedValue([
      makeDirent("src", true),
      makeDirent("README.md", false),
      makeDirent("lib", true),
    ]);

    const result = await browseDirectory("/test");
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.name)).toEqual(["lib", "src"]);
  });

  it("excludes hidden directories", async () => {
    mockReaddir.mockResolvedValue([
      makeDirent(".hidden", true),
      makeDirent(".git", true),
      makeDirent("visible", true),
    ]);

    const result = await browseDirectory("/test");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("visible");
  });

  it("excludes node_modules", async () => {
    mockReaddir.mockResolvedValue([
      makeDirent("node_modules", true),
      makeDirent("src", true),
    ]);

    const result = await browseDirectory("/test");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("src");
  });

  it("throws WorkspaceNotFoundError for non-existent path", async () => {
    mockReaddir.mockRejectedValue(new Error("ENOENT"));

    await expect(browseDirectory("/nonexistent")).rejects.toThrow(
      WorkspaceNotFoundError,
    );
  });

  it("throws WorkspaceNotFoundError when path is a file", async () => {
    mockReaddir.mockRejectedValue(new Error("ENOTDIR"));

    await expect(browseDirectory("/some/file.txt")).rejects.toThrow(
      WorkspaceNotFoundError,
    );
  });

  it("sorts entries alphabetically", async () => {
    mockReaddir.mockResolvedValue([
      makeDirent("zebra", true),
      makeDirent("alpha", true),
      makeDirent("middle", true),
    ]);

    const result = await browseDirectory("/test");
    expect(result.map((e) => e.name)).toEqual(["alpha", "middle", "zebra"]);
  });
});
