// Promise-chain lock to prevent read-modify-write races on file stores
export function withLock(): <T>(fn: () => Promise<T>) => Promise<T> {
  let chain = Promise.resolve();

  return function run<T>(fn: () => Promise<T>): Promise<T> {
    const next = chain.then(fn, fn);
    chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
}
