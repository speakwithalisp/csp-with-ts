// The single place where deferred steps are scheduled. Every former setImmediate(fn, ...args) call goes through
// dispatch(), so the scheduler can be swapped (see configure({ scheduler })) and every hop can be counted.
//
// Tasks go into one FIFO queue. A driver decides *when* the queue is flushed (setImmediate, a MessageChannel message,
// setTimeout(0), a microtask, or by hand in tests). A flush runs the tasks that were queued before it started; tasks
// queued while it runs wait for the next flush. That matches the old one-setImmediate-per-task behaviour, where a
// setImmediate called from inside the check phase runs on the next turn of the event loop.
import { record } from './debug';
import { getConfig, onReset, DriverName } from './service';

type Task = () => void;

interface Driver {
    /** Arrange for flush() to be called once, later. */
    schedule(flush: () => void): void;
    /** Optional reordering of a batch before it runs (seeded test driver). */
    order?(batch: Task[]): void;
    /** Called when a flush leaves nothing queued (lets the Node MessageChannel port stop keeping the process alive). */
    idle?(): void;
    /** Release resources when the driver is replaced. */
    dispose?(): void;
}

let queue: Task[] = [];
let scheduled = false;
let driver: Driver | null = null;
let driverKey = '';

function makeMessageChannelDriver(): Driver {
    let pending: (() => void) | null = null;
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => { const f = pending; pending = null; f?.(); };
    // Node: an open port with a handler keeps the process alive. Hold a ref only while a flush is pending.
    const node = port1 as unknown as { ref?: () => void; unref?: () => void };
    node.unref?.();
    return {
        schedule(flush) { pending = flush; node.ref?.(); port2.postMessage(0); },
        idle() { node.unref?.(); },
        dispose() { port1.onmessage = null; port1.close(); },
    };
}

/** mulberry32: a small seeded PRNG, so a failing interleaving can be replayed from its seed. */
function prng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function makeDriver(name: DriverName, seed: number): Driver {
    switch (name) {
        case 'immediate': return { schedule(flush) { setImmediate(flush); } };
        case 'timeout': return { schedule(flush) { setTimeout(flush, 0); } };
        case 'microtask': return { schedule(flush) { queueMicrotask(flush); } };
        case 'messagechannel': return makeMessageChannelDriver();
        case 'manual': return { schedule() { /* flushed by step()/drainAll() */ } };
        case 'seeded': {
            const rand = prng(seed);
            return {
                schedule(flush) { setImmediate(flush); },
                order(batch) {
                    for (let i = batch.length - 1; i > 0; i--) {
                        const j = Math.floor(rand() * (i + 1));
                        [batch[i], batch[j]] = [batch[j], batch[i]];
                    }
                },
            };
        }
    }
}

function currentDriver(): Driver {
    const { scheduler, seed } = getConfig();
    const key = `${scheduler}:${seed}`;
    if (!driver || key !== driverKey) {
        driver?.dispose?.();
        driver = makeDriver(scheduler, seed);
        driverKey = key;
    }
    return driver;
}

function runBatch(batch: Task[], from: number): void {
    for (let i = from; i < batch.length; i++) {
        try {
            batch[i]();
        } catch (e) {
            // Keep the rest of the batch (at the front, in order) and surface the error as an uncaught exception,
            // exactly as a throwing setImmediate callback would.
            queue = batch.slice(i + 1).concat(queue);
            requestFlush();
            throw e;
        }
    }
}

function flush(): void {
    scheduled = false;
    const batch = queue;
    queue = [];
    const d = currentDriver();
    d.order?.(batch);
    runBatch(batch, 0);
    if (queue.length) { requestFlush(); } else { d.idle?.(); }
}

function requestFlush(): void {
    if (scheduled) { return; }
    scheduled = true;
    currentDriver().schedule(flush);
}

export function dispatch<A extends unknown[]>(fn: (...args: A) => unknown, ...args: A): void {
    record('dispatch');
    queue.push(() => { fn(...args); });
    requestFlush();
}

/** Test-only (manual driver): run the next queued task. Returns false if nothing was queued. */
export function __step(): boolean {
    const task = queue.shift();
    if (!task) { return false; }
    task();
    return true;
}

/** Test-only (manual driver): run tasks until the queue is empty. Throws if it does not empty within `limit` tasks. */
export function __drainAll(limit = 100_000): number {
    let n = 0;
    while (__step()) {
        if (++n >= limit) { throw new Error(`drainAll: queue still busy after ${limit} tasks (livelock?)`); }
    }
    return n;
}

/** Test-only: number of queued tasks. */
export function __pending(): number {
    return queue.length;
}

/** Test-only: drop queued tasks and the current driver (called by __resetCSP). */
export function __resetDispatcher(): void {
    queue = [];
    scheduled = false;
    driver?.dispose?.();
    driver = null;
    driverKey = '';
}

onReset(__resetDispatcher);
