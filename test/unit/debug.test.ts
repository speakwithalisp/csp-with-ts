import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chan, go, loop, putAsync, takeAsync, timeout, debugStats, resetDebugStats, onDebugEvent, parked } from '../../src/index';
import { __resetCSP } from '../../src/impl/service';
import { __drainAll } from '../../src/impl/dispatch';

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

beforeEach(() => { __resetCSP({ debug: true }); resetDebugStats(); });
afterEach(() => __resetCSP());

describe('debug hook (T4)', () => {
    it('counts nothing when debug is off', async () => {
        __resetCSP({ debug: false });
        const c = chan<number>();
        putAsync(c, 1); await takeAsync(c);
        expect(debugStats().dispatches).toBe(0);
    });

    it('reports parked operations per channel', () => {
        const c = chan<number>();
        takeAsync(c); takeAsync(c);
        expect(parked(c)).toEqual({ count: 2, kind: 'take' });
        expect(parked(chan<number>())).toEqual({ count: 0, kind: undefined });
    });

    it('counts armed and fired timers', async () => {
        await takeAsync(timeout(5));
        await wait(5);
        expect(debugStats().timersArmed).toBe(1);
        expect(debugStats().timersFired).toBe(1);
    });

    it('notifies a listener and can unsubscribe', async () => {
        const seen: string[] = [];
        const off = onDebugEvent(k => seen.push(k));
        await takeAsync(timeout(1));
        off();
        expect(seen).toContain('timer-armed');
        expect(seen).toContain('timer-fired');
    });

    it('counts process start', async () => {
        const c = chan<number>();
        const p = loop`<! ${c} ${function* () { yield; }}`;
        p.run();
        expect(debugStats().processesStarted).toBeGreaterThanOrEqual(1);
        p.kill();
        await wait(10);
    });
});

// Dispatches per value for each consumer style. These are baselines: the dispatcher swap (T5) must not raise them.
// Counted on the manual driver (put, then drain), so they are exact and do not depend on timing or on the driver.
describe('dispatch budgets per value (baselines, T4/T5)', () => {
    const N = 50;
    beforeEach(() => { __resetCSP({ debug: true, scheduler: 'manual' }); resetDebugStats(); });

    /** Run queued steps and the promise callbacks they resolve, until both are quiet. */
    async function pump(): Promise<void> {
        for (let k = 0; k < 20; k++) { __drainAll(); await Promise.resolve(); }
    }

    async function perValue(setup: (c: ReturnType<typeof chan>) => () => void): Promise<number> {
        const c = chan<number>();
        const stop = setup(c);
        await pump();
        resetDebugStats();
        for (let i = 0; i < N; i++) { putAsync(c, i); await pump(); }
        const d = debugStats().dispatches / N;
        stop(); await pump();
        return d;
    }

    it('go with a looping generator sink: <= 1 dispatch per value', async () => {
        const d = await perValue(c => go`<! ${c} ${function* () { while (true) { yield; } }}`);
        expect(d).toBeLessThanOrEqual(1);
    });

    it('loop over a take: <= 7 dispatches per value', async () => {
        const d = await perValue(c => { const p = loop`<! ${c} ${function* () { yield; }}`; p.run(); return () => p.kill(); });
        expect(d).toBeLessThanOrEqual(7);
    });

    it('takeAsync/putAsync round trip: <= 4 dispatches per round trip', async () => {
        const ping = chan<number>(), pong = chan<number>();
        let running = true;
        (async () => { while (running) { const v = await takeAsync(ping); if (v === null) { break; } putAsync(pong, (v as number) + 1); } })();
        await pump(); resetDebugStats();
        let v = 0;
        for (let i = 0; i < N; i++) {
            putAsync(ping, v);
            const reply = takeAsync(pong);
            await pump();
            v = (await reply) as number;
        }
        const d = debugStats().dispatches / N;
        running = false; ping.close(); await pump();
        expect(v).toBe(N);
        expect(d).toBeLessThanOrEqual(4);
    });
});
