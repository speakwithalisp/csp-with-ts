// Throughput of the dispatcher-driven core, measured with tinybench (vitest 5 has no bench API). One run measures
// the driver named by CSP_SCHEDULER (default: the platform default) and writes JSON to BENCH_OUT if set.
// `npm run bench:ab` runs this file in alternating rounds, one driver per round, so drift hits every driver equally.
import { it } from 'vitest';
import { Bench } from 'tinybench';
import { writeFileSync } from 'node:fs';
import { __resetCSP, getConfig } from '../../src/impl/service';
import { scenarios } from './scenarios';

it('channel scenarios', async () => {
    const bench = new Bench({ time: 700, warmupTime: 200, warmupIterations: 3, iterations: 8 });
    for (const [name, run] of Object.entries(scenarios)) {
        bench.add(name, async () => { await run(); }, { beforeEach: () => { __resetCSP(); } });
    }
    await bench.run();
    const driver = getConfig().scheduler;
    const rows = bench.tasks.map(t => {
        const r = t.result as { latency: { mean: number; p99: number; rme: number }; throughput: { mean: number } } | undefined;
        return { driver, scenario: t.name, meanMs: r?.latency.mean ?? NaN, p99Ms: r?.latency.p99 ?? NaN, rmePct: r?.latency.rme ?? NaN, opsPerSec: r?.throughput.mean ?? NaN };
    });
    console.table(rows.map(r => ({ ...r, meanMs: +r.meanMs.toFixed(3), p99Ms: +r.p99Ms.toFixed(3), rmePct: +r.rmePct.toFixed(1), opsPerSec: Math.round(r.opsPerSec) })));
    if (process.env.BENCH_OUT) { writeFileSync(process.env.BENCH_OUT, JSON.stringify(rows)); }
}, 300_000);
