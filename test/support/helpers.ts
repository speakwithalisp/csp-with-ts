// Shared helpers for behaviour tests (real timers; the library defers work through dispatch()).
export const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Let queued dispatches and timers run. */
export const settle = (ms = 10) => wait(ms);

/** Race a promise against a timeout; resolves to 'TIMEOUT' if it doesn't settle in time. */
export function within<T>(p: Promise<T>, ms = 30): Promise<T | 'TIMEOUT'> {
    return Promise.race([p, wait(ms).then(() => 'TIMEOUT' as const)]);
}
