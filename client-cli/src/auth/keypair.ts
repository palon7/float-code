import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { generateKeypair, type Keypair } from "@float-code/shared/crypto/sign";

export type { Keypair } from "@float-code/shared/crypto/sign";
export { signChallenge } from "@float-code/shared/crypto/sign";

const KEYPAIR_DIR = path.join(
  os.homedir(),
  ".config",
  "float-code",
  "client-cli",
);
const KEYPAIR_PATH = path.join(KEYPAIR_DIR, "keypair.json");

export async function loadOrCreateKeypair(): Promise<Keypair> {
  try {
    const content = await fs.readFile(KEYPAIR_PATH, "utf-8");
    const data = JSON.parse(content) as Keypair;
    if (data.privateKey && data.publicKey) {
      return data;
    }
  } catch {
    // ファイルが存在しないか不正な場合は新規生成
  }

  const keypair = await generateKeypair();
  await fs.mkdir(KEYPAIR_DIR, { recursive: true, mode: 0o700 });
  const fd = await fs.open(KEYPAIR_PATH, "w", 0o600);
  try {
    await fd.writeFile(JSON.stringify(keypair, null, 2), "utf8");
  } finally {
    await fd.close();
  }
  return keypair;
}
