// TYPE-ONLY SKETCH: a process carries local state through its operations (go-loop/recur, Go for-select, flow transform).
// Names are placeholders. Ops are immutable descriptions; go()/loop() instantiate them, so one recipe runs in many blocks.

interface Chan<In, Out = In> { readonly __in?: (x: In) => void; readonly __out?: () => Out }
declare function chan<T>(n?: number): Chan<T>;

/** An operation inside a process whose local state has type S. Invariant in S (it reads and returns S). */
interface Op<S> { readonly __op?: (s: S) => S }

// ── the two CSP operations, each with a handler that threads state ───────────────
/** Take one value; the handler gets (value, state) and returns the next state. Closing `ch` ends the enclosing loop. */
declare function take<T, S>(ch: Chan<any, T>, handle: (value: T, state: S) => NoInfer<S>): Op<S>;
/** Bare take: wait for one value (sequencing on an event); state passes through unchanged. */
declare function take<S>(ch: Chan<any, unknown>): Op<S>;
/** Put the value computed from the current state. The channel's transducer applies as usual. */
declare function put<T, S>(ch: Chan<T, any>, value: (state: S) => T): Op<S>;
/** Put every value of an iterable, one at a time, as the channel accepts them (backpressure). */
declare function putEach<T, S>(ch: Chan<T, any>, values: (state: S) => Iterable<T>): Op<S>;

// ── time and choice ─────────────────────────────────────────────────────────────────────
/** Armed when reached, so inside a loop it re-arms every iteration (per-iteration timeout). */
declare function sleep<S>(ms: number): Op<S>;
/** A timeout *channel*: create once and share it for a whole-conversation deadline; it closes at the deadline. */
declare function timeout(ms: number): Chan<void, never>;
/** Exactly one arm completes; each arm carries its own handler (Go select / core.async alt!). */
declare function alts<S>(...arms: Op<S>[]): Op<S>;
declare function alts<S>(opts: { priority?: boolean; default?: (state: S) => S }, ...arms: Op<S>[]): Op<S>;

// ── processes ────────────────────────────────────────────────────────────────────────────
type Kill = () => void;
/** Run the ops once, in order, starting from `init`. Returns the kill function (as today). */
declare function go<S>(init: S, ...ops: Op<S>[]): Kill;
declare function go(...ops: Op<undefined>[]): Kill;
/**
 * Repeat the ops, carrying state between iterations. The loop ends when
 *  (a) `until(state)` is true after an iteration (pure, testable), or
 *  (b) a channel it takes from closes (Hoare's distributed termination), or
 *  (c) it is killed from outside.
 */
declare function loop<S>(spec: { init: S; until?: (state: S) => boolean }, ...ops: Op<S>[]): Kill;
/** A nested sequence, so an alts arm can be several steps. */
declare function seq<S>(...ops: Op<S>[]): Op<S>;

// ═══════════════════════════════ usage ═════════════════════════════════
type Point = { x: number; y: number };
const pt = (e: MouseEvent): Point => ({ x: e.clientX, y: e.clientY });
const down = chan<MouseEvent>(), move = chan<MouseEvent>(), up = chan<MouseEvent>(), keys = chan<KeyboardEvent>();
const positions = chan<Point>(1);

// 1. A drag gesture: ONE process, logic in one place, no shared mutable state between handlers.
type Drag = { phase: 'idle' } | { phase: 'dragging'; origin: Point; last: Point };
const idle: Drag = { phase: 'idle' };
const killDrag = loop<Drag>({ init: idle },
  alts(
    take(down, (e, s) => (s.phase === 'idle' ? { phase: 'dragging', origin: pt(e), last: pt(e) } : s)),
    take(move, (e, s) => (s.phase === 'dragging' ? { ...s, last: pt(e) } : s)),
    take(up, () => idle),
    take(keys, (k, s) => (k.key === 'Escape' && s.phase === 'dragging' ? idle : s)),
  ),
  put(positions, s => (s.phase === 'dragging' ? s.last : { x: 0, y: 0 })),
);

// 2. Count clicks, stop after 3 (state-based termination, no sentinel).
loop({ init: 0, until: n => n >= 3 }, take(down, (_e, n) => n + 1));

// 3. Per-iteration timeout vs whole-conversation deadline (both expressible).
const deadline = timeout(3000);                                   // shared, closes once
loop({ init: [] as Point[] },
  alts(
    take(positions, (p, acc) => [...acc, p]),
    sleep(200),                                                   // re-armed each iteration
    take(deadline),                                               // closes at 3 s → loop ends (rule b)
  ));

// 4. Sequencing on an event, then streaming from an infinite generator with backpressure.
const ticks = chan<number>(1);
go<undefined>(undefined, take(down), putEach(ticks, () => (function* () { for (let i = 0; ; i++) yield i; })()));

// 5. Reuse: the same description runs in two blocks, each with its own state.
const counter = [take(down, (_e: MouseEvent, n: number) => n + 1)] as const;
loop({ init: 0 }, ...counter); loop({ init: 100 }, ...counter);

// ═════════════════════ mistakes the compiler must catch ══════════════════════
loop<Drag>({ init: idle }, take(down, (e, s) => ({ phase: 'draging' })));            // ✗ typo in state tag
loop({ init: 0 }, take(keys, (k, n) => n + k.clientX));                                // ✗ KeyboardEvent has no clientX
loop({ init: 0 }, put(positions, n => n));                                              // ✗ number into Point channel
loop({ init: 0, until: n => n === 'done' });                                            // ✗ state is number
