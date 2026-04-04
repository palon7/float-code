import { readJsonSafe, writeSecretJsonAtomic, dataPath } from "../utils/fs.js";
import { withLock as createLock } from "../utils/lock.js";

export type ApprovedKey = {
  publicKey: string;
  pairingCode: string;
  label: string;
  approvedAt: string;
};

type ApprovedKeysFile = {
  version: 1;
  keys: ApprovedKey[];
};

const FILE_PATH = dataPath("approved-keys.json");

const DEFAULT_DATA: ApprovedKeysFile = { version: 1, keys: [] };

const withLock = createLock();

// ディスク読み込みを減らすインメモリキャッシュ（save 時に更新）
let cache: ApprovedKeysFile | null = null;

async function load(): Promise<ApprovedKeysFile> {
  if (cache) return cache;
  cache = await readJsonSafe(FILE_PATH, DEFAULT_DATA);
  return cache;
}

async function save(data: ApprovedKeysFile): Promise<void> {
  await writeSecretJsonAtomic(FILE_PATH, data);
  cache = data;
}

export async function isApproved(publicKey: string): Promise<boolean> {
  const data = await load();
  return data.keys.some((k) => k.publicKey === publicKey);
}

export function addKey(
  publicKey: string,
  pairingCode: string,
): Promise<ApprovedKey> {
  return withLock(async () => {
    const data = await load();

    const existing = data.keys.find((k) => k.publicKey === publicKey);
    if (existing) return existing;

    const entry: ApprovedKey = {
      publicKey,
      pairingCode,
      label: "",
      approvedAt: new Date().toISOString(),
    };
    data.keys.push(entry);
    await save(data);
    return entry;
  });
}

export function removeByPublicKey(publicKey: string): Promise<boolean> {
  return withLock(async () => {
    const data = await load();
    const before = data.keys.length;
    data.keys = data.keys.filter((k) => k.publicKey !== publicKey);
    if (data.keys.length === before) return false;
    await save(data);
    return true;
  });
}

export function removeByCode(pairingCode: string): Promise<boolean> {
  return withLock(async () => {
    const data = await load();
    const before = data.keys.length;
    data.keys = data.keys.filter((k) => k.pairingCode !== pairingCode);
    if (data.keys.length === before) return false;
    await save(data);
    return true;
  });
}

export async function listKeys(): Promise<ApprovedKey[]> {
  const data = await load();
  return data.keys;
}

export async function findByPublicKey(
  publicKey: string,
): Promise<ApprovedKey | undefined> {
  const data = await load();
  return data.keys.find((k) => k.publicKey === publicKey);
}
