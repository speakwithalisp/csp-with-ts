// Benchmark scenarios shared by the bench files and the sanity test. Each one moves N values through the library in
// lock step (at most a few values in flight), so it stays clear of the known Phase 1-3 bugs (waiting-put loss, bug 1,
// stale alts arms) and measures the dispatcher and the matching code, not the failures. Each returns a promise
// that resolves to the number of values the last stage saw, so a run that loses values is visible.
import { chan, go, loop, putAsync, takeAsync } from '../../src/index';

export const N = 500;

/** Two parties pass one value back and forth N times through takeAsync/putAsync. */
export async function pingPong(n = N): Promise<number> {
    const ab = chan<number>(1), ba = chan<number>(1);
    let seen = 0;
    const b = (async () => { for (let i = 0; i < n; i++) { const v = await takeAsync(ab); putAsync(ba, (v as number) + 1); } })();
    for (let i = 0; i < n; i++) { putAsync(ab, i); await takeAsync(ba); seen++; }
    await b;
    return seen;
}

/** Four producers feed one channel; one consumer takes everything. A producer waits for its put to be accepted. */
export async function fanIn(n = N): Promise<number> {
    const c = chan<number>(8), producers = 4, per = Math.floor(n / producers);
    const prods = Array.from({ length: producers }, (_, p) => (async () => {
        for (let i = 0; i < per; i++) { await new Promise<void>(resolve => putAsync(c, p * per + i, false, () => resolve())); }
    })());
    let seen = 0;
    for (let i = 0; i < per * producers; i++) { await takeAsync(c); seen++; }
    await Promise.all(prods);
    return seen;
}

/** Source -> stage1 -> stage2 -> sink, three `loop` stages, one value in flight at a time. */
export async function pipeline(n = N): Promise<number> {
    const a = chan<number>(1), b = chan<number>(1), c = chan<number>(1);
    let v = 0, w = 0;
    const s1 = loop`<! ${a} ${function* () { v = (yield) as number; }}; >! ${b} ${function* () { yield v + 1; }}`;
    const s2 = loop`<! ${b} ${function* () { w = (yield) as number; }}; >! ${c} ${function* () { yield w + 1; }}`;
    s1.run(); s2.run();
    let seen = 0;
    try { for (let i = 0; i < n; i++) { putAsync(a, i); await takeAsync(c); seen++; } } finally { s1.kill(); s2.kill(); }
    return seen;
}

/**
 * A loop that chooses between two channels each pass. Only `a` is ever ready: alternating channels would hit the
 * stale losing arm (spec A4) and hang, so this measures the choice machinery with one live arm.
 */
export async function loopAlts(n = N): Promise<number> {
    const a = chan<number>(1), b = chan<number>(1);
    let seen = 0, resolveStep: (() => void) | undefined;
    const p = loop`?: ${[a, b]} ${() => { seen++; resolveStep?.(); }}`;
    p.run();
    try {
        for (let i = 0; i < n; i++) {
            const step = new Promise<void>(r => { resolveStep = r; });
            putAsync(a, i); await step;
        }
    } finally { p.kill(); }
    return seen;
}

/** Plain `go` sink: one `go` block per value (sink budget baseline). */
export async function goSink(n = N): Promise<number> {
    const c = chan<number>(1); let seen = 0;
    for (let i = 0; i < n; i++) {
        const done = new Promise<void>(r => { go`<! ${c} ${function* () { yield; seen++; r(); }}`; });
        putAsync(c, i); await done;
    }
    return seen;
}

export const scenarios = { pingPong, fanIn, pipeline, loopAlts, goSink };
