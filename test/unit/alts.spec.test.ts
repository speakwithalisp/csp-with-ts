// Specification tests for alts (docs/plans/alts-design.md; test-strategy.md §4.3; roadmap Phase 3).
import { expect } from 'vitest';
import { chan, go, putAsync, takeAsync } from '../../src/index';
import { spec } from '../support/spec';
import { settle, wait, within } from '../support/helpers';

const P3 = 'Phase 3 (owner)';

spec('A1', 'with two ready arms, exactly one completes and the other channel keeps its value', {
    mustNot: 'consume a value from both channels', source: 'Hoare 1978 guarded commands; core.async alt-flag; probe p14_alts',
    knownBug: 'both arms take their value; one is lost', fixedBy: P3,
}, async () => {
    const a = chan<string>(1), b = chan<string>(1); const got: unknown[] = [];
    putAsync(a, 'A'); putAsync(b, 'B'); await settle();
    go`?: ${[a, b]} ${(v: unknown) => { got.push(v); }}`;
    await settle(20);
    expect(got).toHaveLength(1);
    expect(a.count() + b.count()).toBe(1);
});

spec('A2', 'the handler runs once even if a second arm becomes ready later', {
    mustNot: 'call the handler twice', source: 'core.async alts! returns one [val port]',
}, async () => {
    const a = chan<string>(), b = chan<string>(); const got: unknown[] = [];
    go`?: ${[a, b]} ${(v: unknown) => { got.push(v); }}`;
    await settle(); putAsync(a, 'A'); await settle(); putAsync(b, 'B'); await settle();
    expect(got).toEqual(['A']);
});

spec('A3', 'when both arms are always ready, each wins about half the time (10 sigma)', {
    mustNot: 'always pick the first (or last) listed arm', source: 'Go runtime select fairness test (chan_test.go TestSelectFairness)',
    knownBug: 'alts consumes both, so wins cannot be counted fairly', fixedBy: P3, timeout: 20000,
}, async () => {
    const N = 400; let firstWins = 0;
    for (let i = 0; i < N; i++) {
        const a = chan<string>(1), b = chan<string>(1);
        putAsync(a, 'a'); putAsync(b, 'b'); await wait(0);
        const won = new Promise<unknown>(r => { go`?: ${[a, b]} ${(v: unknown) => { r(v); }}`; });
        const v = await within(won, 50);
        if (v === 'a') { firstWins++; }
        expect(a.count() + b.count()).toBe(1);
    }
    const sigma = Math.sqrt(N) / 2;
    expect(Math.abs(firstWins - N / 2)).toBeLessThanOrEqual(10 * sigma);
});

spec('A4', 'an arm that loses leaves its channel usable by other takers', {
    mustNot: 'leave a stale alts handler that steals the next value', source: 'core.async alt-flag commit; CML withNack',
    knownBug: 'the losing arm stays parked on b and swallows B', fixedBy: P3,
}, async () => {
    const a = chan<string>(), b = chan<string>(); const got: unknown[] = [];
    go`?: ${[a, b]} ${(v: unknown) => { got.push(v); }}`;
    await settle(); putAsync(a, 'A'); await settle();
    putAsync(b, 'B');
    expect(await within(takeAsync(b))).toBe('B');
    expect(got).toEqual(['A']);
});

spec('A6', 'a put arm that is ready completes, and the unready take arm is withdrawn', {
    mustNot: 'leave the take arm parked so that it swallows the next value', source: 'Hoare 1978 output guards; core.async alts! put operations',
    knownBug: 'the take arm stays parked on b and swallows B (same defect as A4)', fixedBy: P3,
}, async () => {
    const a = chan<string>(1), b = chan<string>(); const got: unknown[] = [];
    go`?: ${[[a, 'X'], b]} ${(v: unknown) => { got.push(v); }}`;
    await settle(20);
    expect(a.count()).toBe(1);
    putAsync(b, 'B');
    expect(await within(takeAsync(b))).toBe('B');
    expect(got).not.toContain('B');
});
