// Characterisation tests: behaviour that exists today and is meant to be KEPT (docs/plans/test-strategy.md §4.5).
// They protect the owner's design choices while the internals are rewritten.
import { expect } from 'vitest';
import * as R from 'ramda';
import { chan, go, loop, loopFor, loopUntil, putAsync, takeAsync, timeout, dropping, sliding, isChan } from '../../src/index';
import { spec } from '../support/spec';
import { settle, within } from '../support/helpers';

const kind = 'characterisation' as const;

spec('K1', 'one put reaches every taker parked on the channel (broadcast)', {
    kind, source: 'owner design (8 Oct); probe p1_broadcast', mustNot: 'deliver to only one parked taker',
}, async () => {
    const c = chan<number>(); const got: string[] = [];
    takeAsync(c).then(v => got.push(`t1:${v}`)); takeAsync(c).then(v => got.push(`t2:${v}`));
    putAsync(c, 7); await settle();
    expect(got.sort()).toEqual(['t1:7', 't2:7']);
});

spec('K2', 'a channel put onto a channel is spliced: its values arrive in order before the outer channel\'s next value', {
    kind, source: 'owner design; probe p15_chanchan (A)',
}, async () => {
    const outer = chan<any>(4), inner = chan<string>(4); const got: unknown[] = [];
    putAsync(inner, 'i1'); putAsync(inner, 'i2'); putAsync(outer, inner as any); putAsync(outer, 'after');
    for (let k = 0; k < 3; k++) { takeAsync(outer).then(v => got.push(isChan(v) ? '<chan>' : v)); }
    await settle(); expect(got).toEqual(['i1', 'i2']);
    inner.close(); await settle(); expect(got).toEqual(['i1', 'i2', 'after']);
});

spec('K3', 'dropping(2) keeps the first two values, sliding(2) the last two; neither makes puts wait', {
    kind, source: 'core.async buffers; probe p18_claims',
}, async () => {
    for (const [buf, expected] of [[dropping<number>(2), [1, 2]], [sliding<number>(2), [4, 5]]] as const) {
        const c = chan<number>(buf as any); let acks = 0;
        for (let i = 1; i <= 5; i++) { putAsync(c, i, false, () => { acks++; }); }
        await settle();
        expect(acks).toBe(5);
        expect([await takeAsync(c), await takeAsync(c)]).toEqual(expected);
    }
});

spec('K4', 'a fixed(1) channel makes further puts wait until a take', {
    kind, source: 'Hickey: fixed buffers block puts when full; probe p16_bounded', mustNot: 'grow the buffer past its size',
}, async () => {
    const c = chan<number>(1); let acks = 0;
    for (let i = 0; i < 10; i++) { putAsync(c, i, false, () => { acks++; }); }
    await settle();
    expect(c.count()).toBe(1); expect(acks).toBe(1);
});

spec('K5', 'takeAsync on a closed, empty channel resolves null', { kind, source: 'core.async: take on closed returns nil' }, async () => {
    const c = chan<number>(); c.close(); await settle();
    expect(await within(takeAsync(c))).toBe(null);
});

spec('K6', 'putAsync with close=true closes the channel after the put', { kind, source: 'putAsync API' }, async () => {
    const c = chan<number>(1); putAsync(c, 3, true); await settle();
    expect(c.closed).toBe(true);
    expect(await within(takeAsync(c))).toBe(3);
});

spec('K7', 'putAsync on a closed channel drops the value and still calls its callback', {
    kind, source: 'probe p18_claims', mustNot: 'put a value into a closed channel',
}, async () => {
    const c = chan<number>(1); c.close(); await settle(); let called = false;
    putAsync(c, 7, false, () => { called = true; }); await settle();
    expect(called).toBe(true); expect(c.count()).toBe(0);
});

spec('K8', 'a map transducer (ramda) transforms values on the channel', { kind, source: 'Hickey, transducers on channels' }, async () => {
    const c = chan<number, number>(1, R.map((x: number) => x * 2) as any);
    putAsync(c, 21);
    expect(await within(takeAsync(c))).toBe(42);
});

spec('K9', 'timeout(ms) taken on time delivers true and then closes', { kind, source: 'probe p18_claims' }, async () => {
    const t = timeout(5);
    expect(await within(takeAsync(t), 100)).toBe(true);
    await settle(); expect(t.closed).toBe(true);
});

spec('K10', 'the template DSL accepts take, put, alts, eval and ; forms', { kind, source: 'go.ts parser' }, async () => {
    const got: unknown[] = [];
    // ; sequencing: take from b, then put on c
    const b = chan<number>(1), c = chan<number>(1);
    const k1 = go`<! ${b} ${function* () { got.push(['b', (yield) as unknown]); }}; >! ${c} ${function* () { yield 9; }}`;
    putAsync(b, 5); await settle();
    got.push(['c', await within(takeAsync(c))]);
    // two takes in sequence
    const d = chan<number>(2);
    const k2 = go`<! ${d} ${function* () { got.push(['d1', (yield) as unknown]); }}; <! ${d} ${function* () { got.push(['d2', (yield) as unknown]); }}`;
    putAsync(d, 1); putAsync(d, 2); await settle(30);
    // alts
    const e = chan<number>(1), f = chan<number>(1);
    const k3 = go`?: ${[e, f]} ${(v: unknown) => { got.push(['alts', v]); }}`;
    await settle(); putAsync(f, 2); await settle();
    // eval of a nested process
    const g = chan<number>(1);
    const inner = loopFor(1)`<! ${g} ${function* () { got.push(['eval', (yield) as unknown]); }}`;
    const k4 = go`eval ${inner}`;
    putAsync(g, 3); await settle();
    expect(got).toEqual([['b', 5], ['c', 9], ['d1', 1], ['d2', 2], ['alts', 2], ['eval', 3]]);
    k1(); k2(); k3(); k4();
});

spec('K11', 'a malformed eval statement is rejected', { kind, source: 'go.ts parser' }, () => {
    const a = chan<number>();
    expect(() => go`eval ${a as any}`).toThrow(/eval/);
});

spec('K12', 'alts with one ready arm delivers that value to the handler', { kind, source: 'probe p14_alts' }, async () => {
    const a = chan<string>(1), b = chan<string>(1); const got: unknown[] = [];
    go`?: ${[a, b]} ${(v: unknown) => { got.push(v); }}`;
    await settle(); putAsync(a, 'A'); await settle();
    expect(got).toEqual(['A']);
});

spec('K13', 'an alts arm and a plain take on the same channel both receive one put (broadcast interplay)', {
    kind, source: 'probe p14_alts; to be revisited with the broadcast decision (O4)',
}, async () => {
    const a = chan<string>(), t = timeout(50); const got: unknown[] = []; let plain: unknown;
    go`?: ${[a, t] as any} ${(v: unknown) => { got.push(v); }}`;
    takeAsync(a).then(v => { plain = v; });
    await settle(); putAsync(a, 'X'); await settle(80);
    expect(got).toEqual(['X']); expect(plain).toBe('X');
});

spec('K14', 'request/reply works by putting an object that carries a reply channel', { kind, source: 'Effective Go "Channels of channels"; probe p15' }, async () => {
    const reqs = chan<{ q: string; reply: any }>(), reply = chan<number>();
    takeAsync(reqs).then(r => { const req = r as { q: string; reply: any }; putAsync(req.reply, req.q.length); });
    putAsync(reqs, { q: 'hello', reply });
    expect(await within(takeAsync(reply))).toBe(5);
});

spec('K15', 'loopUntil(pred) with an alts step stops after the first value for which pred is true', {
    kind, source: 'loops.ts loopUntil; go.ts hook (only the ?: form calls it)', mustNot: 'keep looping after the matching value',
}, async () => {
    const c = chan<number>(); const seen: unknown[] = [];
    const p = loopUntil((v: number) => v === 3)`?: ${[c]} ${(v: unknown) => { seen.push(v); }}`; p.run();
    for (let i = 1; i <= 6; i++) { putAsync(c, i); await settle(15); }
    p.kill();
    expect(seen).toEqual([1, 2, 3]);
});

spec('K16', 'loopUntil() without a predicate is loop', {
    kind, source: 'loops.ts loopUntil', mustNot: 'stop on its own',
}, async () => {
    expect(loopUntil()).toBe(loop);
});
