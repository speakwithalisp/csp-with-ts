// Model-based test (docs/plans/test-strategy.md §4.4): random interleavings of puts and takes on a fixed(n) channel
// are checked against a plain FIFO queue. Whatever the order of operations, every value put is taken exactly once,
// in put order. fast-check shrinks a failure to the smallest sequence that shows it.
import { expect } from 'vitest';
import fc from 'fast-check';
import { chan, putAsync, takeAsync } from '../../src/index';
import { __resetCSP } from '../../src/impl/service';
import { spec } from '../support/spec';
import { settle, within } from '../support/helpers';

type Cmd = { op: 'put'; v: number } | { op: 'take' };
const cmdArb: fc.Arbitrary<Cmd> = fc.oneof(
    fc.integer({ min: 1, max: 999 }).map(v => ({ op: 'put' as const, v })),
    fc.constant({ op: 'take' as const }),
);

spec('M1', 'any sequence of puts and takes on fixed(n) behaves like a FIFO queue: no loss, no reordering', {
    mustNot: 'drop, duplicate or reorder values', source: 'Hoare 1985 BUFFER; Go TestChan; core.async FIFO',
    knownBug: 'waiting puts come out LIFO and some are lost (see C1, C4)', fixedBy: 'Phase 1 (owner)', timeout: 30000,
}, async () => {
    await fc.assert(fc.asyncProperty(fc.integer({ min: 1, max: 3 }), fc.array(cmdArb, { maxLength: 20 }), async (size, cmds) => {
        __resetCSP();
        const c = chan<number>(size); const model: number[] = []; const got: unknown[] = []; let takes = 0;
        for (const cmd of cmds) {
            if (cmd.op === 'put') { model.push(cmd.v); putAsync(c, cmd.v); }
            // Only take when a value is owed: a parked taker would get the next put by broadcast (K1, decision O4),
            // which a plain queue model does not describe.
            else if (takes < model.length) { takes++; takeAsync(c).then(v => got.push(v)); }
            await settle(1);
        }
        await settle(5);
        for (let i = takes; i < model.length; i++) { got.push(await within(takeAsync(c), 10)); }
        expect(got).toEqual(model);
    }), { numRuns: 40 });
});
