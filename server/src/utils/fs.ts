import * as fs from "node:fs/promises";
import * as crypto from "node:crypto";
import * as path from "node:path";

// tmp + fsync + rename でクラッシュ時の破損を防ぐ
export async function writeJsonAtomic(
  filePath: string,
  data: unknown,
): Promise<void> {
  const tmp = `${filePath}.tmp.${crypto.randomUUID()}`;
  const fd = await fs.open(tmp, "w");
  try {
    await fd.writeFile(JSON.stringify(data, null, 2));
    await fd.sync();
    await fd.close();
    await fs.rename(tmp, filePath);
  } catch (e) {
    await fd.close().catch(() => {});
    await fs.unlink(tmp).catch(() => {});
    throw e;
  }
}

export async function readJsonSafe<T>(
  filePath: string,
  defaultValue: T,
): Promise<T> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return defaultValue;
  }
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export function dataPath(filename: string): string {
  return path.join(import.meta.dirname, "../../data", filename);
}
