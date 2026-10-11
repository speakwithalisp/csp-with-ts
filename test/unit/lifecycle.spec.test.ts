// Specification tests for process lifecycle and timeouts (docs/plans/test-strategy.md §4.2; roadmap Phase 2).
import { expect } from 'vitest';
import { chan, go, loop, loopFor, putAsync, takeAsync, timeout, debugStats, resetDebugStats } from '../../src/index';
import { __resetCSP } from '../../src/impl/service';
import { spec } from '../support/spec';
import { settle, wait, within } from '../support/helpers';

const P2 = 'Phase 2 (owner)';

spec('L1', 'killing a process also stops a process it started with eval', {
    mustNot: 'leave the child running after its parent is killed', source: 'Hoare 1985 §4.5 (P/Q termination); bug 2',
    knownBug: 'the child keeps taking after the parent is killed', fixedBy: 'T8 (Claude)',
}, async () => {
    const c = chan<number>(); let n = 0;
    const child = loop`<! ${c} ${function* () { yield; n++; }}`;
    const kill = go`eval ${child}`;
    putAsync(c, 1); await settle();
    kill(); await settle();
    putAsync(c, 2); await settle(20);
    expect(n).toBe(1);
});

spec('L2', 'after a looping process is killed it arms no more timers', {
    mustNot: 'keep scheduling work for a dead process', source: 'e2e assessment: ~440 timers/s after unmount',
}, async () => {
    __resetCSP({ debug: true }); resetDebugStats();
    const c = chan<number>(); let n = 0;
    const p = loop`<! ${c} ${function* () { yield; n++; }}`; p.run();
    putAsync(c, 1); await settle(); p.kill(); await settle(20);
    const before = { ...debugStats() };
    await wait(50);
    expect(debugStats().timersArmed).toBe(before.timersArmed);
    expect(debugStats().dispatches).toBe(before.dispatches);
});

spec('L3', 'a loop whose input channel closes ends instead of stalling', {
    mustNot: 'stay live forever waiting on a closed channel', source: 'core.async go-loop: (when-some [v (<! c)] (recur)); probe p9',
    knownBug: 'the loop stays live', fixedBy: P2,
}, async () => {
    const c = chan<number>(); let n = 0;
    const p = loop`<! ${c} ${function* () { const v = (yield) as unknown; if (v !== null) { n++; } }}`; p.run();
    putAsync(c, 1); await settle(); c.close(); await settle(30);
    expect(n).toBe(1);
    expect(p.isLive).toBe(false);
});

spec('L4', 'a timeout channel closes at its deadline even if no one takes from it', {
    mustNot: 'stay open (and hold a value) forever', source: 'core.async timeout: "returns a channel that will close after msecs"',
    knownBug: 'the untaken timeout never closes', fixedBy: P2,
}, async () => {
    const t = timeout(5);
    await wait(40);
    expect(t.closed).toBe(true);
});

spec('L5', 'a timeout step inside a loop waits on every iteration', {
    mustNot: 'wait only on the first iteration and then spin', source: 'probe p8; Go time.After in a for loop',
    knownBug: 'the body runs once: timeout(10) is created once, closes, and later iterations stall', fixedBy: P2,
}, async () => {
    let n = 0;
    const p = loop`<! ${timeout(10)} ${function* () { yield; n++; }}`; p.run();
    await wait(55); p.kill();
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(6);
});

spec('L6', 'loopFor(n) runs its body exactly n times', { kind: 'characterisation', source: 'loops.ts loopFor' }, async () => {
    const c = chan<number>(); const got: unknown[] = [];
    const p = loopFor(3)`<! ${c} ${function* () { got.push(yield); }}`; p.run();
    for (let i = 1; i <= 5; i++) { putAsync(c, i); await settle(); }
    expect(got).toEqual([1, 2, 3]);
    expect(await within(takeAsync(c), 10)).toBe(4); // the 4th put waits: no body is left to take it
});
