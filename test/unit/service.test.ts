import { afterEach, describe, expect, it } from 'vitest';
import { chan, putAsync, takeAsync } from '../../src/index';
import { CSP, __resetCSP, configure, getConfig } from '../../src/impl/service';

afterEach(() => __resetCSP());

describe('configure() and the test reset hook (T1)', () => {
    it('defaults to setImmediate in Node', () => {
        if (!process.env.CSP_SCHEDULER) { expect(getConfig()).toMatchObject({ scheduler: 'immediate', debug: false }); }
    });

    it('accepts an initial configuration before first use', () => {
        configure({ scheduler: 'timeout', debug: true });
        expect(getConfig()).toMatchObject({ scheduler: 'timeout', debug: true });
    });

    it('rejects configuration after the coordinator is in use', () => {
        chan<number>();
        putAsync(chan<number>(), 1);
        expect(() => configure({ scheduler: 'timeout' })).toThrow(/before any channel/);
    });

    it('a reset gives a fresh registry: queues from before are gone', () => {
        const before = CSP();
        const c = chan<number>();
        takeAsync(c);                       // parks a taker in the old registry
        expect(before.has(c)).toBe(true);
        __resetCSP();
        expect(CSP()).not.toBe(before);
        expect(CSP().has(c)).toBe(false);
    });

    it('channels created after a reset work normally', async () => {
        __resetCSP();
        const c = chan<number>();
        putAsync(c, 7);
        expect(await takeAsync(c)).toBe(7);
    });
});
