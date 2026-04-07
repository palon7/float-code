const NONCE_RETENTION_MS = 60_000; // 60s
const CLEANUP_INTERVAL_MS = 30_000; // 30s

const store = new Map<string, number>();
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

// Atomically check and register a nonce.
// Returns true if the nonce was new (claimed successfully).
// Returns false if the nonce was already seen (replay).
export function claimNonce(nonce: string): boolean {
  if (store.has(nonce)) return false;
  store.set(nonce, Date.now());
  return true;
}

function cleanup(): void {
  const cutoff = Date.now() - NONCE_RETENTION_MS;
  for (const [nonce, acceptedAt] of store) {
    if (acceptedAt < cutoff) {
      store.delete(nonce);
    }
  }
}

export function startNonceCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(cleanup, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();
}

export function stopNonceCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

// For testing
export function clearNonceStore(): void {
  store.clear();
}
