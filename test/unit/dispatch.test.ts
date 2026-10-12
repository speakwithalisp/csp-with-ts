// The dispatcher itself (T5): drivers, ordering, error handling, and the test-only manual and seeded drivers.
import { describe, expect, it } from 'vitest';
import { dispatch, __drainAll, __pending, __step } from '../../src/impl/dispatch';
import { __resetCSP, configure, getConfig } from '../../src/impl/service';
import { chan, putAsync, takeAsync } from '../../src/index';
import { settle } from '../support/helpers';

describe('dispatcher', () => {
    for (const scheduler of ['immediate', 'messagechannel', 'timeout', 'microtask'] as const) {
        it(`${scheduler}: runs tasks in FIFO order, and tasks queued during a flush run on the next one`, async () => {
            __resetCSP({ scheduler });
            const log: string[] = [];
            dispatch(() => { log.push('a'); dispatch(() => log.push('c')); });
            dispatch(() => log.push('b'));
            expect(log).toEqual([]);
            await settle();
            expect(log).toEqual(['a', 'b', 'c']);
        });

        it(`${scheduler}: a throwing task does not stop the tasks queued after it`, async () => {
            __resetCSP({ scheduler });
            const log: string[] = [];
            const errors: unknown[] = [];
            const onErr = (e: unknown) => { errors.push(e); };
            process.prependListener('uncaughtException', onErr);
            const removeVitest = process.listeners('uncaughtException').filter(l => l !== onErr);
            removeVitest.forEach(l => process.off('uncaughtException', l));
            try {
                dispatch(() => { throw new Error('boom'); });
                dispatch(() => log.push('after'));
                await settle(20);
            } finally {
                process.off('uncaughtException', onErr);
                removeVitest.forEach(l => process.on('uncaughtException', l));
            }
            expect(log).toEqual(['after']);
            if (scheduler !== 'microtask') { expect(errors).toHaveLength(1); }
        });
    }

    it('the default scheduler in Node is setImmediate (D9)', () => {
        __resetCSP();
        if (!process.env.CSP_SCHEDULER) { expect(getConfig().scheduler).toBe('immediate'); }
    });

    it('configure() picks the scheduler before first use', () => {
        __resetCSP();
        configure({ scheduler: 'timeout' });
        expect(getConfig().scheduler).toBe('timeout');
    });

    it('manual: nothing runs until step()/drainAll()', async () => {
        __resetCSP({ scheduler: 'manual' });
        const log: number[] = [];
        dispatch(() => log.push(1)); dispatch(() => log.push(2));
        await settle();
        expect(log).toEqual([]);
        expect(__pending()).toBe(2);
        expect(__step()).toBe(true);
        expect(log).toEqual([1]);
        expect(__drainAll()).toBe(1);
        expect(log).toEqual([1, 2]);
        expect(__step()).toBe(false);
    });

    it('manual: a put and take complete under drainAll() without real time passing', async () => {
        __resetCSP({ scheduler: 'manual' });
        const c = chan<number>(1);
        let got: unknown;
        takeAsync(c).then(v => { got = v; });
        putAsync(c, 5);
        __drainAll();
        await Promise.resolve(); await Promise.resolve();
        expect(got).toBe(5);
    });

    it('manual: drainAll() reports a livelock instead of hanging', () => {
        __resetCSP({ scheduler: 'manual' });
        const spin = () => dispatch(spin);
        spin();
        expect(() => __drainAll(1000)).toThrow(/livelock/);
    });

    it('seeded: the same seed gives the same order, and some seed reorders a batch', async () => {
        const run = async (seed: number) => {
            __resetCSP({ scheduler: 'seeded', seed });
            const log: number[] = [];
            for (let i = 0; i < 8; i++) { dispatch(() => log.push(i)); }
            await settle();
            return log;
        };
        expect(await run(42)).toEqual(await run(42));
        const orders = new Set<string>();
        for (let s = 1; s <= 5; s++) { orders.add((await run(s)).join()); }
        expect(orders.size).toBeGreaterThan(1);
        for (const o of orders) { expect(o.split(',').map(Number).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]); }
    });
});
