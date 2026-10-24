// Specification tests for rendezvous (unbuffered) channels (docs/plans/gaps-to-complete-csp.md A5; roadmap Phase 5,
// acceptance test 6). Nothing is implemented yet. How a rendezvous channel is spelled is open decision O3 (chan(0), or
// a new default), so every spec builds one through rendezvous() and only that line changes when O3 is settled.
import { expect } from 'vitest';
import { chan, putAsync, takeAsync } from '../../src/index';
import { spec } from '../support/spec';
import { settle, within } from '../support/helpers';

const P5 = 'Phase 5 (owner)';
const rendezvous = () => chan<number>(0);

spec('R1', 'a put on a rendezvous channel completes only when a taker takes it', {
    mustNot: 'complete the put while no taker has arrived', source: 'Hoare 1978 input/output commands; Go make(chan T)',
    knownBug: 'not implemented', fixedBy: P5,
}, async () => {
    const c = rendezvous(); let acked = false;
    putAsync(c, 1, false, () => { acked = true; });
    await settle();
    expect(acked).toBe(false);
    expect(await within(takeAsync(c))).toBe(1);
    await settle();
    expect(acked).toBe(true);
});

spec('R2', 'a take on a rendezvous channel waits until a putter arrives', {
    mustNot: 'resolve the take before any put', source: 'Hoare 1978 input/output commands; Go make(chan T)',
    knownBug: 'not implemented', fixedBy: P5,
}, async () => {
    const c = rendezvous();
    const taken = takeAsync(c);
    expect(await within(taken, 20)).toBe('TIMEOUT');
    putAsync(c, 7);
    expect(await within(taken)).toBe(7);
});

spec('R3', 'a rendezvous channel never holds a value', {
    mustNot: 'buffer a put that has no taker', source: 'Go make(chan T): capacity 0',
    knownBug: 'not implemented', fixedBy: P5,
}, async () => {
    const c = rendezvous();
    putAsync(c, 1);
    await settle();
    expect(c.count()).toBe(0);
});
