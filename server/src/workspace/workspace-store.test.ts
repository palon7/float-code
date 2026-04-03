import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReadJsonSafe = vi.fn();
const mockWriteJsonAtomic = vi.fn();
const mockEnsureDir = vi.fn();
const mockRealpath = vi.fn<(p: string) => Promise<string>>();

vi.mock("../utils/fs.js", () => ({
  readJsonSafe: (...args: unknown[]) => mockReadJsonSafe(...args),
  writeJsonAtomic: (...args: unknown[]) => mockWriteJsonAtomic(...args),
  ensureDir: (...args: unknown[]) => mockEnsureDir(...args),
  dataPath: (filename: string) => `/mock/data/${filename}`,
}));

vi.mock("node:fs/promises", () => ({
  realpath: (p: string) => mockRealpath(p),
}));

beforeEach(() => {
  vi.resetAllMocks();
  mockRealpath.mockImplementation((p) => Promise.resolve(p));
  mockWriteJsonAtomic.mockResolvedValue(undefined);
  mockEnsureDir.mockResolvedValue(undefined);
});

async function loadModule() {
  const mod = await import("./workspace-store.js");
  return mod;
}

describe("getRecent", () => {
  it("returns empty array when no data exists", async () => {
    mockReadJsonSafe.mockResolvedValue({ version: 1, recent: [] });
    const { getRecent } = await loadModule();
    const result = await getRecent();
    expect(result).toEqual([]);
  });

  it("returns workspaces sorted by lastUsedAt descending", async () => {
    mockReadJsonSafe.mockResolvedValue({
      version: 1,
      recent: [
        { path: "/old", lastUsedAt: "2026-01-01T00:00:00.000Z" },
        { path: "/new", lastUsedAt: "2026-03-01T00:00:00.000Z" },
      ],
    });
    const { getRecent } = await loadModule();
    const result = await getRecent();
    expect(result[0].path).toBe("/new");
    expect(result[1].path).toBe("/old");
  });

  it("derives name from path.basename", async () => {
    mockReadJsonSafe.mockResolvedValue({
      version: 1,
      recent: [
        {
          path: "/Users/user/projects/my-app",
          lastUsedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    const { getRecent } = await loadModule();
    const result = await getRecent();
    expect(result[0].name).toBe("my-app");
  });
});

describe("touchRecent", () => {
  it("adds a new workspace to recent list", async () => {
    mockReadJsonSafe.mockResolvedValue({ version: 1, recent: [] });
    const { touchRecent } = await loadModule();
    await touchRecent("/projects/new-app");

    expect(mockWriteJsonAtomic).toHaveBeenCalledOnce();
    const saved = mockWriteJsonAtomic.mock.calls[0][1];
    expect(saved.recent).toHaveLength(1);
    expect(saved.recent[0].path).toBe("/projects/new-app");
  });

  it("moves existing workspace to the top with updated timestamp", async () => {
    mockReadJsonSafe.mockResolvedValue({
      version: 1,
      recent: [
        { path: "/a", lastUsedAt: "2026-03-01T00:00:00.000Z" },
        { path: "/b", lastUsedAt: "2026-02-01T00:00:00.000Z" },
      ],
    });
    const { touchRecent } = await loadModule();
    await touchRecent("/b");

    const saved = mockWriteJsonAtomic.mock.calls[0][1];
    expect(saved.recent).toHaveLength(2);
    expect(saved.recent[0].path).toBe("/b");
    expect(saved.recent[1].path).toBe("/a");
  });

  it("enforces max 20 entries", async () => {
    const existing = Array.from({ length: 20 }, (_, i) => ({
      path: `/project-${i}`,
      lastUsedAt: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
    }));
    mockReadJsonSafe.mockResolvedValue({ version: 1, recent: existing });
    const { touchRecent } = await loadModule();
    await touchRecent("/project-new");

    const saved = mockWriteJsonAtomic.mock.calls[0][1];
    expect(saved.recent).toHaveLength(20);
    expect(saved.recent[0].path).toBe("/project-new");
  });

  it("normalizes path with realpath", async () => {
    mockRealpath.mockResolvedValue("/resolved/path");
    mockReadJsonSafe.mockResolvedValue({ version: 1, recent: [] });
    const { touchRecent } = await loadModule();
    await touchRecent("/symlink/path");

    expect(mockRealpath).toHaveBeenCalledWith("/symlink/path");
    const saved = mockWriteJsonAtomic.mock.calls[0][1];
    expect(saved.recent[0].path).toBe("/resolved/path");
  });

  it("does not create duplicates for the same resolved path", async () => {
    mockRealpath.mockResolvedValue("/resolved");
    mockReadJsonSafe.mockResolvedValue({
      version: 1,
      recent: [{ path: "/resolved", lastUsedAt: "2026-01-01T00:00:00.000Z" }],
    });
    const { touchRecent } = await loadModule();
    await touchRecent("/symlink");

    const saved = mockWriteJsonAtomic.mock.calls[0][1];
    expect(saved.recent).toHaveLength(1);
    expect(saved.recent[0].path).toBe("/resolved");
  });
});
