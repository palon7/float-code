import { readJsonSafe, writeSecretJsonAtomic, dataPath } from "../utils/fs.js";
import { withLock as createLock } from "../utils/lock.js";
import { derivePairingCode } from "./pairing-code.js";
import { addKey, type ApprovedKey } from "./approved-keys.js";

export type PendingPairing = {
  publicKey: string;
  pairingCode: string;
  createdAt: string;
  expiresAt: string;
};

type PendingPairingsFile = {
  version: 1;
  pairings: PendingPairing[];
};

const FILE_PATH = dataPath("pending-pairings.json");
const TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_PENDING = 5;

const DEFAULT_DATA: PendingPairingsFile = { version: 1, pairings: [] };

const withLock = createLock();

async function loadRaw(): Promise<PendingPairingsFile> {
  return readJsonSafe(FILE_PATH, DEFAULT_DATA);
}

function filterExpired(data: PendingPairingsFile): PendingPairingsFile {
  const now = Date.now();
  return {
    ...data,
    pairings: data.pairings.filter(
      (p) => new Date(p.expiresAt).getTime() > now,
    ),
  };
}

async function save(data: PendingPairingsFile): Promise<void> {
  await writeSecretJsonAtomic(FILE_PATH, data);
}

export type RequestPairingResult =
  | { ok: true; code: string }
  | { ok: false; reason: "collision" | "too_many_pending" };

export function requestPairing(
  publicKey: string,
): Promise<RequestPairingResult> {
  return withLock(async () => {
    const data = filterExpired(await loadRaw());

    data.pairings = data.pairings.filter((p) => p.publicKey !== publicKey);

    if (data.pairings.length >= MAX_PENDING) {
      return { ok: false, reason: "too_many_pending" };
    }

    const code = derivePairingCode(publicKey);

    // Approval is granted to the public key, not the pairing code
    const pendingCollision = data.pairings.some(
      (p) => p.pairingCode === code && p.publicKey !== publicKey,
    );
    if (pendingCollision) {
      return { ok: false, reason: "collision" };
    }

    const now = new Date();
    data.pairings.push({
      publicKey,
      pairingCode: code,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + TTL_MS).toISOString(),
    });

    await save(data);
    return { ok: true, code };
  });
}

export function approvePairing(code: string): Promise<ApprovedKey | null> {
  return withLock(async () => {
    const data = filterExpired(await loadRaw());
    const idx = data.pairings.findIndex((p) => p.pairingCode === code);
    if (idx === -1) return null;

    const pending = data.pairings[idx];

    // addKey first so pending survives if save fails
    const approved = await addKey(pending.publicKey, pending.pairingCode);
    data.pairings.splice(idx, 1);
    await save(data);

    return approved;
  });
}

export function listPending(): Promise<PendingPairing[]> {
  return withLock(async () => {
    const raw = await loadRaw();
    const data = filterExpired(raw);
    if (data.pairings.length < raw.pairings.length) await save(data);
    return data.pairings;
  });
}

export function cleanupExpired(): Promise<void> {
  return withLock(async () => {
    const raw = await loadRaw();
    const data = filterExpired(raw);
    if (data.pairings.length < raw.pairings.length) await save(data);
  });
}
