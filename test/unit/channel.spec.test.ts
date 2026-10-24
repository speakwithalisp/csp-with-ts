// Specification tests for the channel core (docs/plans/test-strategy.md §4.1; roadmap Phase 1, acceptance A1-A2).
// Tests with `knownBug` fail on today's code and are registered with it.fails; the fix flips them.
import { expect } from 'vitest';
import * as R from 'ramda';
import { chan, go, loop, putAsync, takeAsync, isChan } from '../../src/index';
import { spec } from '../support/spec';
import { settle, within } from '../support/helpers';
import { __resetCSP } from '../../src/impl/service';
import { __drainAll, __step } from '../../src/impl/dispatch';

const P1 = 'Phase 1 (owner)';

spec('C1', 'waiting puts are delivered to sequential takers in put order', {
    mustNot: 'reorder them (LIFO) or drop the second put',
    source: 'Hoare 1985 BUFFER "behaves like a queue"; Go TestChan; probe p17b',
    knownBug: 'delivered as 0,9,8,...,2 and put 1 is lost', fixedBy: P1,
}, async () => {
    const c = chan<number>(1);
    for (let i = 0; i < 10; i++) { putAsync(c, i); }
    await settle();
    const got: unknown[] = [];
    for (let i = 0; i < 10; i++) { got.push(await within(takeAsync(c))); }
    expect(got).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

spec('C2', 'takers parked on a channel are served in the order they parked', {
    mustNot: 'serve the most recent taker first (LIFO)', source: 'Go/core.async FIFO takers; probe p1_broadcast',
    knownBug: 'parked takers receive in reverse order', fixedBy: P1,
}, async () => {
    const c = chan<number>(); const order: string[] = [];
    takeAsync(c).then(() => order.push('first')); takeAsync(c).then(() => order.push('second'));
    putAsync(c, 1); await settle();
    expect(order).toEqual(['first', 'second']);
});

spec('C3', 'a loop receives every put in order, even when puts arrive faster than one loop iteration', {
    mustNot: 'strand a value while newer values bypass it, or drop values', source: 'probe p13; Hoare 1985 BUFFER',
    knownBug: 'today this fails through bug 1 (the loop dies after 2 values, see C15); re-check once bug 1 is fixed', fixedBy: P1,
}, () => {
    // Manual driver: puts land 2 dispatch steps apart, deterministically, whatever driver the suite runs on.
    __resetCSP({ scheduler: 'manual' });
    const c = chan<number>(); const seen: unknown[] = [];
    const p = loop`<! ${c} ${function* () { seen.push(yield); }}`; p.run(); __drainAll();
    try {
        for (let i = 0; i < 20; i++) { putAsync(c, i); __step(); __step(); }
        __drainAll();
    } finally { p.kill(); }
    expect(seen).toEqual(Array.from({ length: 20 }, (_, i) => i));
});

spec('C4', 'up to 1,024 waiting puts are all delivered', {
    mustNot: 'silently drop waiting puts (MAX_DIRTY cleanup)', source: 'core.async MAX-QUEUE-SIZE; probe p17_pending',
    knownBug: '70 waiting puts deliver 5', fixedBy: P1,
}, async () => {
    const c = chan<number>(1); const N = 70;
    for (let i = 0; i < N; i++) { putAsync(c, i); }
    await settle();
    const got: unknown[] = [];
    for (let i = 0; i < N; i++) { got.push(await within(takeAsync(c), 20)); }
    expect(got.filter(v => v !== 'TIMEOUT')).toHaveLength(N);
});

spec('C5', 'the 1,025th waiting put throws a clear error', {
    mustNot: 'accept it and drop puts silently', source: 'core.async tests: queue-limits',
    knownBug: 'no error; puts are dropped', fixedBy: P1,
}, () => {
    const c = chan<number>(1);
    expect(() => { for (let i = 0; i < 1026; i++) { putAsync(c, i); } }).toThrow(/1024/);
});

spec('C7', 'closing keeps buffered values takeable, then takes return null', {
    mustNot: 'lose buffered values on close', source: 'core.async close! semantics',
}, async () => {
    const c = chan<number>(2);
    putAsync(c, 1); putAsync(c, 2); await settle(); c.close(); await settle();
    expect([await within(takeAsync(c)), await within(takeAsync(c)), await within(takeAsync(c))]).toEqual([1, 2, null]);
});

spec('C9', 'putting null or undefined throws (null means closed)', {
    mustNot: 'insert a close marker into the buffer', source: 'core.async: "Can\'t put nil on a channel"',
}, () => {
    const c = chan<any>(1);
    expect(() => putAsync(c, null)).toThrow();
    expect(() => putAsync(c, undefined)).toThrow();
});

spec('C10', 'a transducer that finishes early (take(2)) closes the channel', {
    mustNot: 'keep accepting values after reduced', source: 'core.async: reduced -> abort; channels.ts XChannel.add',
}, async () => {
    const c = chan<number>(5, R.take(2) as any);
    putAsync(c, 1); putAsync(c, 2); putAsync(c, 3); await settle();
    expect(c.closed).toBe(true);
    expect(c.count()).toBe(2);
});

spec('C11', 'a fixed(1) channel is full once it holds a value, even after an expanding transducer', {
    mustNot: 'report not-full after overflow', source: 'buffers.ts FixedBuffer.isFull',
}, async () => {
    const c = chan<number>(1, R.chain((x: number) => [x, x]) as any);
    putAsync(c, 1); await settle();
    expect(c.count()).toBe(2);
    expect(c.isFull()).toBe(true);
});

spec('C12', 'chan(0), negative and non-integer sizes are rejected', {
    mustNot: 'build a broken channel', source: 'channels.ts chan(); rendezvous arrives in Phase 5',
}, () => {
    expect(() => chan(0)).toThrow(RangeError);
    expect(() => chan(-1)).toThrow(RangeError);
    expect(() => chan(1.5)).toThrow(RangeError);
});

spec('C14', 'an already-closed inner channel put onto a channel still delivers its buffered values', {
    mustNot: 'lose them, or give takers null while the outer channel is open', source: 'probe p15_chanchan (B)',
    knownBug: 'takers get "after", null, null', fixedBy: P1,
}, async () => {
    const outer = chan<any>(4), inner = chan<string>(4); const got: unknown[] = [];
    putAsync(inner, 'i1'); putAsync(inner, 'i2'); inner.close(); putAsync(outer, inner as any); putAsync(outer, 'after');
    for (let k = 0; k < 3; k++) { takeAsync(outer).then(v => got.push(isChan(v) ? '<chan>' : v)); }
    await settle(30);
    expect(got).toEqual(['i1', 'i2', 'after']);
});

spec('C15', 'a loop survives puts that arrive before its previous iteration finishes (bug 1)', {
    mustNot: 'crash with "reading \'add\'" or lose values', source: 'e2e assessment bug 1; probes p5, p6',
    knownBug: 'flush() deletes the registry entry before loops.ts looks it up', fixedBy: P1,
}, () => {
    // Manual driver: deterministic on every driver. A full iteration takes ~7 dispatch steps; puts land 2 apart.
    // (With real time this race shows on 'immediate'/'timeout' but is hidden by 'messagechannel'/'microtask'.)
    __resetCSP({ scheduler: 'manual' });
    const c = chan<number>(); let n = 0;
    const p = loop`<! ${c} ${function* () { yield; n++; }}`; p.run(); __drainAll();
    try {
        expect(() => {
            for (let i = 0; i < 20; i++) { putAsync(c, i); __step(); __step(); }
            __drainAll();
        }).not.toThrow();
    } finally { p.kill(); }
    expect(n).toBe(20);
});

spec('C16', 'a process can take back a value it put on a buffered channel', {
    mustNot: 'leave the value stranded in the buffer', source: 'Go: c := make(chan int, 1); c <- 1; <-c',
    knownBug: 'the take step never receives it', fixedBy: P1,
}, async () => {
    const a = chan<number>(1); const got: unknown[] = [];
    go`>! ${a} ${function* () { yield 1; }}; <! ${a} ${function* () { got.push(yield); }}`;
    await settle(20);
    expect(got).toEqual([1]);
});
