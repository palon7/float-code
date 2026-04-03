import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../utils/fs.js", () => ({
  dataPath: (name: string) => `/data/${name}`,
  readJsonSafe: vi.fn(),
  writeJsonAtomic: vi.fn(),
}));

import { PidTracker } from "./pid-tracker.js";
import { readJsonSafe, writeJsonAtomic } from "../utils/fs.js";

const mockReadJsonSafe = vi.mocked(readJsonSafe);
const mockWriteJsonAtomic = vi.mocked(writeJsonAtomic);

beforeEach(() => {
  vi.clearAllMocks();
  mockWriteJsonAtomic.mockResolvedValue(undefined);
});

describe("PidTracker", () => {
  it("add: PID を追加してファイルに書き出す", async () => {
    const tracker = new PidTracker();
    await tracker.add(1234);
    expect(mockWriteJsonAtomic).toHaveBeenCalledWith("/data/claude-pids.json", {
      pids: [1234],
    });
  });

  it("remove: PID を削除してファイルに書き出す", async () => {
    const tracker = new PidTracker();
    await tracker.add(1234);
    await tracker.add(5678);
    vi.clearAllMocks();
    mockWriteJsonAtomic.mockResolvedValue(undefined);
    await tracker.remove(1234);
    expect(mockWriteJsonAtomic).toHaveBeenCalledWith("/data/claude-pids.json", {
      pids: [5678],
    });
  });

  it("killOrphans: ファイルの PID に SIGTERM を送る", async () => {
    mockReadJsonSafe.mockResolvedValue({ pids: [111, 222] });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    const tracker = new PidTracker();
    await tracker.killOrphans();

    expect(killSpy).toHaveBeenCalledWith(111, "SIGTERM");
    expect(killSpy).toHaveBeenCalledWith(222, "SIGTERM");
    expect(mockWriteJsonAtomic).toHaveBeenCalledWith("/data/claude-pids.json", {
      pids: [],
    });

    killSpy.mockRestore();
  });

  it("killOrphans: ファイルが空または存在しない場合はkillしない", async () => {
    mockReadJsonSafe.mockResolvedValue({ pids: [] });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    const tracker = new PidTracker();
    await tracker.killOrphans();

    expect(killSpy).not.toHaveBeenCalled();
    killSpy.mockRestore();
  });

  it("killOrphans: kill 失敗（プロセス不在）でもエラーにならない", async () => {
    mockReadJsonSafe.mockResolvedValue({ pids: [9999] });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });

    const tracker = new PidTracker();
    await expect(tracker.killOrphans()).resolves.not.toThrow();
    killSpy.mockRestore();
  });

  it("killAllSync: in-memory の全 PID に SIGTERM を送る", async () => {
    const tracker = new PidTracker();
    await tracker.add(100);
    await tracker.add(200);
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    tracker.killAllSync();

    expect(killSpy).toHaveBeenCalledWith(100, "SIGTERM");
    expect(killSpy).toHaveBeenCalledWith(200, "SIGTERM");
    killSpy.mockRestore();
  });
});
