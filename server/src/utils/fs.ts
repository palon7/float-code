import * as fs from "node:fs/promises";
import * as crypto from "node:crypto";
import * as path from "node:path";
import * as os from "node:os";

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

// 秘密情報を含むファイル用: 0600 パーミッション + 0700 ディレクトリ
export async function writeSecretJsonAtomic(
  filePath: string,
  data: unknown,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tmp = `${filePath}.tmp.${crypto.randomUUID()}`;
  const fd = await fs.open(tmp, "wx", 0o600);
  try {
    await fd.writeFile(JSON.stringify(data, null, 2), "utf8");
    await fd.sync();
  } finally {
    await fd.close();
  }
  await fs.rename(tmp, filePath);
  await fs.chmod(filePath, 0o600);
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

const CONFIG_BASE = path.join(os.homedir(), ".config", "float-code", "server");

export function configDir(): string {
  return CONFIG_BASE;
}

export function dataPath(filename: string): string {
  return path.join(CONFIG_BASE, filename);
}
