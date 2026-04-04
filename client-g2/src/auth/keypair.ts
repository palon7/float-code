import { generateKeypair, type Keypair } from "@float-code/shared/crypto/sign";

export type { Keypair } from "@float-code/shared/crypto/sign";
export { signChallenge } from "@float-code/shared/crypto/sign";

const STORAGE_KEY = "float-code-keypair";

export async function loadOrCreateKeypair(): Promise<Keypair> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const data = JSON.parse(stored) as Keypair;
      if (data.privateKey && data.publicKey) {
        return data;
      }
    }
  } catch {
    // 不正なデータの場合は新規生成
  }

  const keypair = await generateKeypair();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(keypair));
  return keypair;
}
