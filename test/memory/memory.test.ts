// Memory suite (run with `npm run test:mem`; the project passes --expose-gc). Measures bytes per channel and per
// parked consumer, and checks that abandoned channels and killed processes can be collected (no leak slope).
// Set MEM_OUT=<file> to write the numbers as JSON (docs/perf/ report).
import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { chan, loop, putAsync, takeAsync } from '../../src/index';
import { __resetCSP } from '../../src/impl/service';
import { __drainAll } from '../../src/impl/dispatch';

const gc = (globalThis as unknown as { gc?: () => void }).gc;
const results: Record<string, number> = {};

async function collect(): Promise<number> {
    if (!gc) { throw new Error('run with --expose-gc (npm run test:mem)'); }
    for (let i = 0; i < 4; i++) { gc(); await new Promise(r => setTimeout(r, 5)); }
    return process.memoryUsage().heapUsed;
}

/** Least-squares slope of ys over 0..n-1. */
function slope(ys: number[]): number {
    const n = ys.length, mx = (n - 1) / 2, my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    ys.forEach((y, i) => { num += (i - mx) * (y - my); den += (i - mx) ** 2; });
    return num / den;
}

describe('memory', () => {
    it('bytes per channel and per parked consumer', async () => {
        __resetCSP({ scheduler: 'manual' });
        const N = 20000;
        const before = await collect();
        const bare = Array.from({ length: N }, () => chan<number>());
        const afterBare = await collect();
        const parked = bare.map(c => takeAsync(c));          // one parked taker each; also creates the queue entry
        __drainAll();
        const afterParked = await collect();
        results.bytesPerBareChannel = (afterBare - before) / N;
        results.bytesPerParkedTake = (afterParked - afterBare) / N;
        console.log(JSON.stringify(results));
        expect(parked).toHaveLength(N);
        expect(results.bytesPerBareChannel).toBeLessThan(2000);
        expect(results.bytesPerParkedTake).toBeLessThan(5000);
    }, 60000);

    it('abandoned channels with parked consumers are collected (no leak slope)', async () => {
        __resetCSP({ scheduler: 'manual' });
        const rounds = 8, perRound = 5000, heap: number[] = [];
        let finalised = 0, created = 0;
        const registry = new FinalizationRegistry(() => { finalised++; });
        for (let r = 0; r < rounds; r++) {
            for (let i = 0; i < perRound; i++) {
                const c = chan<number>(); registry.register(c, 0); created++;
                void takeAsync(c); putAsync(c, i);
            }
            __drainAll();
            heap.push(await collect());
        }
        await collect();
        results.leakSlopeBytesPerRound = slope(heap.slice(1));   // skip the warm-up round
        results.finalisedFraction = finalised / created;
        console.log(JSON.stringify(results));
        expect(results.finalisedFraction).toBeGreaterThan(0.95);
        expect(results.leakSlopeBytesPerRound).toBeLessThan(200_000);   // a leak of one channel per round would be ~1 MB/round
    }, 120000);

    it('killed loops and their processes are collected', async () => {
        __resetCSP();
        const rounds = 6, perRound = 300, heap: number[] = [];
        let finalised = 0, created = 0;
        const registry = new FinalizationRegistry(() => { finalised++; });
        for (let r = 0; r < rounds; r++) {
            for (let i = 0; i < perRound; i++) {
                const c = chan<number>();
                const p = loop`<! ${c} ${function* () { yield; }}`;
                registry.register(p, 0); created++;
                p.run(); putAsync(c, i);
                p.kill();
            }
            await new Promise(r => setTimeout(r, 30));
            heap.push(await collect());
        }
        await collect();
        results.loopLeakSlopeBytesPerRound = slope(heap.slice(1));
        results.loopFinalisedFraction = finalised / created;
        console.log(JSON.stringify(results));
        if (process.env.MEM_OUT) { writeFileSync(process.env.MEM_OUT, JSON.stringify(results, null, 2)); }
        expect(results.loopFinalisedFraction).toBeGreaterThan(0.95);
    }, 120000);
});
