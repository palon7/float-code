import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { writeJsonAtomic, readJsonSafe, ensureDir } from "./fs.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fs-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("writeJsonAtomic", () => {
  it("ファイルにJSONを書き込める", async () => {
    const filePath = path.join(tmpDir, "test.json");
    const data = { hello: "world", count: 42 };

    await writeJsonAtomic(filePath, data);

    const content = await fs.readFile(filePath, "utf-8");
    expect(JSON.parse(content)).toEqual(data);
  });

  it("既存ファイルを上書きできる", async () => {
    const filePath = path.join(tmpDir, "test.json");

    await writeJsonAtomic(filePath, { version: 1 });
    await writeJsonAtomic(filePath, { version: 2 });

    const content = await fs.readFile(filePath, "utf-8");
    expect(JSON.parse(content)).toEqual({ version: 2 });
  });

  it("一時ファイルが残らない", async () => {
    const filePath = path.join(tmpDir, "test.json");

    await writeJsonAtomic(filePath, { ok: true });

    const files = await fs.readdir(tmpDir);
    expect(files).toEqual(["test.json"]);
  });
});

describe("readJsonSafe", () => {
  it("存在するファイルを読める", async () => {
    const filePath = path.join(tmpDir, "data.json");
    await fs.writeFile(filePath, JSON.stringify({ key: "value" }));

    const result = await readJsonSafe(filePath, { key: "default" });
    expect(result).toEqual({ key: "value" });
  });

  it("存在しないファイルはデフォルト値を返す", async () => {
    const filePath = path.join(tmpDir, "missing.json");

    const result = await readJsonSafe(filePath, { fallback: true });
    expect(result).toEqual({ fallback: true });
  });

  it("不正なJSONはデフォルト値を返す", async () => {
    const filePath = path.join(tmpDir, "bad.json");
    await fs.writeFile(filePath, "not json{{{");

    const result = await readJsonSafe(filePath, { safe: true });
    expect(result).toEqual({ safe: true });
  });
});

describe("ensureDir", () => {
  it("ネストしたディレクトリを作成できる", async () => {
    const dirPath = path.join(tmpDir, "a", "b", "c");

    await ensureDir(dirPath);

    const stat = await fs.stat(dirPath);
    expect(stat.isDirectory()).toBe(true);
  });

  it("既存ディレクトリでもエラーにならない", async () => {
    await ensureDir(tmpDir);
  });
});
