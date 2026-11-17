// Configuration reads can retry quietly; a failed read never replaces known values.
// Share in-flight requests between scheduled refreshes and generation completion.
export function createConfigRefresh<T>(
  url: string,
  valid: (value: unknown) => value is T,
  apply: (value: T) => void,
  fetcher: typeof fetch = fetch,
) {
  let pending: Promise<void> | undefined;
  return function refresh(): Promise<void> {
    if (pending) return pending;
    // Defer the call until pending is assigned, including when fetch throws synchronously.
    pending = Promise.resolve().then(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await fetcher(url, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) return;
        const value: unknown = await response.json();
        if (valid(value)) apply(value);
      } catch {
        // Keep the last successful configuration during network/filter interruptions.
      } finally {
        clearTimeout(timeout);
      }
    }).finally(() => { pending = undefined; });
    return pending;
  };
}
