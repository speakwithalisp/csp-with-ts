# Roadmap to a functioning CSP implementation (October 2026)

Status: **plan only.** This replaces the task list in [`2026-10-inspection.md` §13](2026-10-inspection.md#13-task-list)
and the priority list in [`2026-10-csp-lens.md` §6](2026-10-csp-lens.md#6-priority-after-this-pass). It's ordered
by dependency: each phase relies on the tests and invariants of the phases before it.

**Owner** = library logic written by hand by the owner. **Claude** = scaffolding or sweeping mechanical changes.

## What "functioning CSP" means here (the acceptance tests)

A release can call itself a CSP implementation when these pass as automated tests:

1. **FIFO, no loss.** Values come out of a channel in the order they went in. No put is ever dropped silently,
   whether buffered, waiting, or spliced from an inner channel.
2. **Bounded, explicit overflow.** Buffers are bounded. Exceeding the waiting-operation limit (1,024) throws a
   clear error instead of dropping.
3. **Choice: exactly one.** Of an alts' arms, exactly one completes and the others have no effect. The choice is
   random by default and in order when `priority` is set. The result says which arm won.
4. **Termination by communication.** A loop over an input ends when that input closes (Hoare's distributed
   termination). Closing a channel wakes every parked taker with `null`.
5. **Timeouts are channels that close** at their deadline. Both a per-iteration timeout and a whole-conversation
   deadline can be expressed.
6. **Rendezvous available.** An unbuffered channel exists, where a put completes only when a taker takes it.
7. **Kill releases everything.** Killing a process kills its children, cancels its timers and parks no handler
   forever.

## What stays (the owner's choices), and the CSP framing for each

| Kept | Why it can stay | Condition |
|---|---|---|
| **WeakMap side table** (channel → queue) | Equivalent to core.async's queues on the channel for GC (measured); keeps the channel as pure storage | Remove the manual `delete` in `flush`; one get-or-create helper (Phase 1) |
| **Broadcast** | It's the Kahn-network fan-out Hoare describes in §7.7; CSP has its own multiway form | Deterministic, FIFO, with defined membership (Phase 6) |
| **Generators** as the inside of a process | Faithful to "linear code inside a process"; measured cheap (18–33 ns per `next()`) | None |
| **`go`/`loop` return kill functions** | Needed for component unmount | Kill must work (Phase 2); inside the network, processes stop by communication |
| **Tagged-template DSL** | Original design | Becomes sugar that parses into operations (Phase 7) |
| **Channel splicing** (a channel put on a channel is flattened in order) | Bespoke, gives ordered flatten for free | Fix the closed-inner loss (Phase 1); request/reply via a wrapper object, documented |
| **`putAsync`/`takeAsync`** at the edges | Same role as core.async `put!`/`take!` | None |
| **Transducers on channels** | Hickey's design | Fix `reduced` and completion (Phase 1) |

---

## Phase 0: foundations *(Claude)*

- Resolve the local uncommitted changes. Keep the `setImmediate`→`setTimeout` swap only if Phase 4 isn't next;
  drop the broken `sleep` hunk either way.
- Test runner (Vitest on Node 22), a reset hook for the `CSP()` singleton, and the probes from `probes/` turned into
  tests. **Every acceptance test above starts as a failing test** (`it.fails`), so each fix flips one.
- npm isn't reachable from the cloud container, so this runs on the owner's machine, or after network access is
  enabled for the environment.

## Phase 1: the channel core (FIFO, no loss) *(owner)*

The largest phase and the most important. Nearly all of it lives in `createQ().add` / `flush` in
`processQueue.ts`, so it's best done as **one rewrite of that function around explicit invariants** rather than
point fixes:

1. Waiting puts are FIFO, and none is lost. Today: `[0, 9, 8, 7, 6, 5, 4, 3, 2]`, with the second put always lost
   (`p17b`).
2. Parked takers are served FIFO (today LIFO, `p1`).
3. A put never bypasses a non-empty buffer; a taker never parks while the buffer holds a value it should get
   (`p13`).
4. The `MAX_DIRTY` cleanup removes only *inactive* entries. It must never drop a live callback waiter (`p17`).
   Hitting 1,024 throws.
5. Bug 1: remove the `CSP().delete(chan)` in `flush`; add a get-or-create helper in place of the ~30
   `has()`/`get()!` pairs; replace "missing from the registry means finished" with `closed && count() === 0`.
6. Splicing: an already-closed inner channel's buffered values are delivered, not lost (`p15`).
7. Small, same area: `FixedBuffer.isFull` uses `>=`; `chan(0)` and invalid sizes throw until Phase 5; `reduced`
   from a transducer closes the channel; `@@transducer/result` runs on close.

**Done when:** acceptance tests 1 and 2 pass.

## Phase 2: process lifecycle *(owner)*

1. Bug 2: `setImmediate(() => proc.kill())`; remove the meaningless `if (!this)` guard.
2. A loop ends when a channel it takes from closes, instead of stalling (`p3`). This is acceptance test 4.
3. `timeout` **closes** its channel at the deadline, whether or not anyone is waiting; a late take gets `null`
   (`p11`). This is acceptance test 5 (the channel half).
4. Sleep is cancellable: kill cancels the timer rather than arming another one.
5. Investigate the "~440 timers a second after unmount" with the old demo's traces, once available.

**Done when:** acceptance tests 4, 5 (channel half) and 7 pass.

## Phase 3: choice *(owner)*

Replace the per-**channel** `altFlag` with a per-**operation** commit flag shared by all arms of one alts
(core.async's `alt-flag`). Everything in this phase depends on it:

1. Exactly one arm completes; with two ready arms, the other value is not consumed (`p14`).
2. The winner is the first to commit, not the last to finish.
3. Random choice by default; `priority` option; `default` option.
4. The result says which arm won.
5. The same flag makes cancelling a parked take safe, which Phase 7 needs (stopping a loop from outside without
   swallowing a value).

**Done when:** acceptance test 3 passes.

## Phase 4: scheduler *(Claude, sweeping)*

One `dispatch(fn)`: a ring buffer drained from a microtask with a time budget, continuing on `MessageChannel`
(browser) or `setImmediate` (Node). It replaces every direct `setImmediate`/`setTimeout(0)`. This comes *after*
Phases 1–3 because it changes ordering, and the tests from those phases are what show it didn't break anything.
Expected gain: fewer hops per value (today 7 through `loop`, 14 with alts), not lower latency.

## Phase 5: rendezvous channels *(owner)*

An unbuffered channel, where a put parks until a taker commits. It uses the Phase 1 queue invariants and the
Phase 3 commit flag. **Owner decision:** make `chan()` unbuffered by default (Go and core.async; a breaking
change), or keep `fixed(1)` as the default and add `chan(0)`.

**Done when:** acceptance test 6 passes.

## Phase 6: broadcast, kept and made deterministic *(owner)*

Pick one (both keep broadcast; both fix the timing dependence measured in `p1b`):

- **A. In-channel, "present at delivery".** Every taker parked at the dispatcher turn when a value is delivered
  gets it, in FIFO order. A buffered value goes to all takers parked by the next turn. Smallest change; closest to
  today; same rule as Effection channels and DOM events.
- **B. Registered membership.** An explicit broadcast channel (or `mult`/`tap`) with subscribe/unsubscribe. Either
  Hoare-style (a put completes when every member has taken it) or Kahn-style (a buffer per member). Deterministic
  regardless of timing, and plain channels keep one-to-one CSP semantics.

## Phase 7: the operation DSL with state threading *(owner)*

Operations become **descriptions** (`{ kind: 'take', ch, handle }`). `go`/`loop` create the generators when they
run, so one description can run in many blocks, and `sleep` is armed when it's reached. The template becomes sugar
that parses into the same operations.

A process carries **local state** through its operations, the CSP idiom in all three references: core.async's
`go-loop`/`recur`, Go's for-select loop ("the cases interact via local state"), and core.async.flow's
`transform(state, msg) → state'`. Handlers are pure `(value, state) => state`, so a gesture's logic lives in one
process instead of being split across callbacks that share mutable state.

Type-checked sketch: [`probes/dsl-state-loop-sketch.ts`](probes/dsl-state-loop-sketch.ts). `tsc --strict` catches all
four planted mistakes: a misspelled state tag, a property missing on the event type, a wrong value type put into a
channel, and comparing a numeric state to a string.

```ts
// the core signatures (placeholders)
declare function take<T, S>(ch: Chan<any, T>, handle: (value: T, state: S) => NoInfer<S>): Op<S>;
declare function take<S>(ch: Chan<any, unknown>): Op<S>;                    // wait for one value
declare function put<T, S>(ch: Chan<T, any>, value: (state: S) => T): Op<S>;
declare function putEach<T, S>(ch: Chan<T, any>, values: (state: S) => Iterable<T>): Op<S>;  // backpressured
declare function sleep<S>(ms: number): Op<S>;                               // per-iteration
declare function timeout(ms: number): Chan<void, never>;                    // shared deadline; closes
declare function alts<S>(...arms: Op<S>[]): Op<S>;                          // exactly one arm runs its handler
declare function go<S>(init: S, ...ops: Op<S>[]): Kill;
declare function loop<S>(spec: { init: S; until?: (s: S) => boolean }, ...ops: Op<S>[]): Kill;

// a drag gesture as one process
type Drag = { phase: 'idle' } | { phase: 'dragging'; origin: Point; last: Point };
const idle: Drag = { phase: 'idle' };
loop<Drag>({ init: idle },
  alts(
    take(down, (e, s) => (s.phase === 'idle' ? { phase: 'dragging', origin: pt(e), last: pt(e) } : s)),
    take(move, (e, s) => (s.phase === 'dragging' ? { ...s, last: pt(e) } : s)),
    take(up, () => idle),
    take(keys, (k, s) => (k.key === 'Escape' && s.phase === 'dragging' ? idle : s)),
  ),
  put(positions, s => (s.phase === 'dragging' ? s.last : { x: 0, y: 0 })),
);

loop({ init: 0, until: n => n >= 3 }, take(down, (_e, n) => n + 1));   // ends by state, no sentinel

const deadline = timeout(3000);                                          // whole conversation
loop({ init: [] as Point[] },
  alts(take(positions, (p, acc) => [...acc, p]), sleep(200), take(deadline)));  // per-iteration + deadline
```

How a loop ends, with no `STOP` sentinel and no `stop()` threaded through handlers:
- `until(state)` after an iteration: pure and testable, the analogue of not calling `recur`;
- a channel it takes from closes: Hoare's distributed termination;
- `kill()` from outside: component unmount.

Design notes:
- `NoInfer<S>` on the handler's return type is needed so the state type comes from the loop, not from whatever a
  handler happens to return. Without it, `() => idle` narrowed the state to `{ phase: 'idle' }`. Found by
  compiling the sketch.
- State should be treated as immutable (handlers return new state). That's what makes one description safe to
  run in many blocks, and it matches core.async's "value of values".
- Open: should `alts` arms also allow `seq(...)` for multi-step arms? Should handlers be allowed to return a
  promise (wait before the next operation)?

## Phase 8: release *(Claude, sweeping; README by the owner)*

TypeScript 5/6 (`NoInfer` needs ≥ 5.4) and tslib 2; modern build (Rollup 4 or tsup, ESM + CJS); remove CRA/React
dev dependencies; CI running the acceptance tests; LICENSE file; real `homepage`; README.

## Later

`mult`/`pub`/`merge`/`pipeline`; typed `chan` overloads (no union return); `scope()` for owning channels and
processes; an instrumentation hook for a channel inspector; `chain` (Hoare's `>>`) for wiring stages.

## Order at a glance

| Phase | What | Who | Unblocks |
|---|---|---|---|
| 0 | Test runner, failing acceptance tests | Claude | everything |
| 1 | Channel core: FIFO, no loss, bug 1, splicing, transducer fixes | Owner | 2–7 |
| 2 | Lifecycle: bug 2, loops end on close, timeouts close, cancellable sleep | Owner | 7 |
| 3 | Choice: per-operation commit flag, exactly-one alts, winner, priority/default | Owner | 5, 7 |
| 4 | Single dispatcher | Claude | performance |
| 5 | Rendezvous channels | Owner | full CSP semantics |
| 6 | Deterministic broadcast (A or B) | Owner | — |
| 7 | Operation DSL with state threading; template as sugar | Owner | showcase |
| 8 | Toolchain, build, CI, README, release | Claude / Owner | publishing |
