// Seeded-driver exploration (informational, not a gate). Runs each scenario under many seeds of the shuffling driver
// and prints, per scenario, how many seeds pass and the first failing seeds, so an interleaving can be replayed with
// `__resetCSP({ scheduler: 'seeded', seed })`. Scenarios marked "known bug" are expected to fail on every seed today;
// the interesting columns are the controls (should be 100%) and any known-bug scenario that passes on SOME seeds.
// Usage: SEEDS=200 npm run explore   (output also written to EXPLORE_OUT if set)
import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { chan, go, loop, putAsync, takeAsync } from '../../src/index';
import { __resetCSP } from '../../src/impl/service';

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const within = <T>(p: Promise<T>, ms = 30) => Promise.race([p, wait(ms).then(() => 'TIMEOUT' as const)]);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

type Scenario = { id: string; note: string; run: () => Promise<boolean> };

const scenarios: Scenario[] = [
    { id: 'C1', note: 'known bug: waiting puts FIFO', run: async () => {
        const c = chan<number>(1); for (let i = 0; i < 10; i++) { putAsync(c, i); } await wait(10);
        const got: unknown[] = []; for (let i = 0; i < 10; i++) { got.push(await within(takeAsync(c))); }
        return same(got, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    } },
    { id: 'C2', note: 'known bug: parked takers FIFO', run: async () => {
        const c = chan<number>(); const order: string[] = [];
        takeAsync(c).then(() => order.push('first')); takeAsync(c).then(() => order.push('second')); putAsync(c, 1); await wait(10);
        return same(order, ['first', 'second']);
    } },
    { id: 'C3', note: 'known bug: loop receives every put', run: async () => {
        const c = chan<number>(); const seen: unknown[] = [];
        const p = loop`<! ${c} ${function* () { seen.push(yield); }}`; p.run();
        try { for (let i = 0; i < 20; i++) { putAsync(c, i); await new Promise<void>(r => setImmediate(r)); } await wait(20); } finally { p.kill(); }
        return same(seen, Array.from({ length: 20 }, (_, i) => i));
    } },
    { id: 'C4', note: 'known bug: 70 waiting puts all delivered', run: async () => {
        const c = chan<number>(1); for (let i = 0; i < 70; i++) { putAsync(c, i); } await wait(10);
        let n = 0; for (let i = 0; i < 70; i++) { if ((await within(takeAsync(c), 20)) !== 'TIMEOUT') { n++; } }
        return n === 70;
    } },
    { id: 'A1', note: 'known bug: exactly one arm completes', run: async () => {
        const a = chan<string>(1), b = chan<string>(1); const got: unknown[] = [];
        putAsync(a, 'A'); putAsync(b, 'B'); await wait(10); go`?: ${[a, b]} ${(v: unknown) => { got.push(v); }}`; await wait(20);
        return got.length === 1 && a.count() + b.count() === 1;
    } },
    { id: 'A3', note: 'known bug: fair choice (40 trials, both orders seen)', run: async () => {
        let first = 0;
        for (let i = 0; i < 40; i++) {
            const a = chan<string>(1), b = chan<string>(1); putAsync(a, 'a'); putAsync(b, 'b'); await wait(0);
            const won = new Promise<unknown>(r => { go`?: ${[a, b]} ${(v: unknown) => { r(v); }}`; });
            if ((await within(won, 20)) === 'a') { first++; }
        }
        return first > 5 && first < 35;
    } },
    { id: 'A4', note: 'known bug: losing arm withdrawn', run: async () => {
        const a = chan<string>(), b = chan<string>(); const got: unknown[] = [];
        go`?: ${[a, b]} ${(v: unknown) => { got.push(v); }}`; await wait(10); putAsync(a, 'A'); await wait(10); putAsync(b, 'B');
        return (await within(takeAsync(b))) === 'B' && same(got, ['A']);
    } },
    { id: 'K1', note: 'control: broadcast to parked takers', run: async () => {
        const c = chan<number>(); const got: string[] = [];
        takeAsync(c).then(v => got.push(`t1:${v}`)); takeAsync(c).then(v => got.push(`t2:${v}`)); putAsync(c, 7); await wait(10);
        return same(got.sort(), ['t1:7', 't2:7']);
    } },
    { id: 'K4', note: 'control: fixed(1) makes puts wait', run: async () => {
        const c = chan<number>(1); let acks = 0; for (let i = 0; i < 3; i++) { putAsync(c, i, false, () => { acks++; }); } await wait(10);
        return acks === 1 && c.count() === 1;
    } },
    { id: 'C7', note: 'control: close keeps buffered values', run: async () => {
        const c = chan<number>(2); putAsync(c, 1); putAsync(c, 2); await wait(10); c.close(); await wait(10);
        return same([await within(takeAsync(c)), await within(takeAsync(c)), await within(takeAsync(c))], [1, 2, null]);
    } },
    { id: 'A2', note: 'control: alts handler runs once', run: async () => {
        const a = chan<string>(), b = chan<string>(); const got: unknown[] = [];
        go`?: ${[a, b]} ${(v: unknown) => { got.push(v); }}`; await wait(10); putAsync(a, 'A'); await wait(10); putAsync(b, 'B'); await wait(10);
        return same(got, ['A']);
    } },
];

it('explore seeds', async () => {
    let crashes = 0;
    process.on('uncaughtException', () => { crashes++; });
    const seeds = Number(process.env.SEEDS ?? '100');
    const lines = ['| spec | note | seeds passing | first failing seeds | |', '|---|---|---|---|---|'];
    for (const s of scenarios) {
        let pass = 0; const failing: number[] = []; const crashesBefore = crashes;
        for (let seed = 1; seed <= seeds; seed++) {
            __resetCSP({ scheduler: 'seeded', seed });
            let ok = false;
            try { ok = await s.run(); } catch { ok = false; }
            if (ok) { pass++; } else if (failing.length < 8) { failing.push(seed); }
        }
        lines.push(`| ${s.id} | ${s.note} | ${pass}/${seeds} | ${failing.join(', ') || '-'} |${crashes > crashesBefore ? ` ${crashes - crashesBefore} uncaught errors (bug 1) |` : ''}`);
    }
    const text = lines.join('\n');
    process.stderr.write(text + '\n');
    if (process.env.EXPLORE_OUT) { writeFileSync(process.env.EXPLORE_OUT, text + '\n'); }
}, 1_800_000);
