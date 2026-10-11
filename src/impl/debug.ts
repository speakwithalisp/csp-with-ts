// Debug counters for tests and performance budgets. Counting only happens when configure({ debug: true }).
import { getConfig } from './service';
import { IStream } from './constants';
import { IChan } from './interfaces';
import { CSP } from './service';

export type DebugEventKind = 'dispatch' | 'timer-armed' | 'timer-fired' | 'process-started' | 'process-ended';

export interface DebugStats {
    /** Deferred steps handed to the scheduler. */
    dispatches: number;
    timersArmed: number;
    timersFired: number;
    processesStarted: number;
    processesEnded: number;
}

const zero = (): DebugStats => ({ dispatches: 0, timersArmed: 0, timersFired: 0, processesStarted: 0, processesEnded: 0 });
let stats: DebugStats = zero();
let listener: ((kind: DebugEventKind) => void) | null = null;

const field: Record<DebugEventKind, keyof DebugStats> = {
    'dispatch': 'dispatches',
    'timer-armed': 'timersArmed',
    'timer-fired': 'timersFired',
    'process-started': 'processesStarted',
    'process-ended': 'processesEnded',
};

/** Internal: record one event (no-op unless debug is on). */
export function record(kind: DebugEventKind): void {
    if (!getConfig().debug) { return; }
    stats[field[kind]] += 1;
    if (listener) { listener(kind); }
}

/** A snapshot of the counters since the last reset. */
export function debugStats(): Readonly<DebugStats> {
    return { ...stats };
}

export function resetDebugStats(): void {
    stats = zero();
}

/** Subscribe to debug events; returns an unsubscribe function. One listener at a time. */
export function onDebugEvent(fn: (kind: DebugEventKind) => void): () => void {
    listener = fn;
    return () => { if (listener === fn) { listener = null; } };
}

/** Operations currently parked on a channel's queue, and whether they are puts or takes. */
export function parked<T extends IStream>(ch: IChan<T, any>): { count: number; kind: 'put' | 'take' | 'sleep' | undefined } {
    const q = CSP().has(ch) ? CSP().get(ch) : undefined;
    if (!q) { return { count: 0, kind: undefined }; }
    const kinds = ['put', 'take', 'sleep'] as const;
    return { count: q.length, kind: q.currentEventType === undefined ? undefined : kinds[q.currentEventType] };
}
