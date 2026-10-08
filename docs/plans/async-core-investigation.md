# Investigation: scheduler, looping timeouts, generator-free API, generator cost

Status: **preliminary investigation only**. Nothing is implemented, and nothing below was run; every
finding comes from reading the code. Written 2026-10-03 against `master` @ `b745c2f` plus the uncommitted
working tree. Compared against core.async's ClojureScript implementation (`clojure/core.async`,
`src/main/clojure/cljs/core/async/impl/`).

This is separate from, and comes after, `docs/plans/typing-and-lifecycle.md`. Read that plan's §0 first,
because the uncommitted `sleep` rewrite affects Q2 below.

---

## Q1. The "coordinated batch scheduler": is it really async?

It is async, in that nothing blocks. But it isn't really a scheduler. `src/impl/scheduler.ts` is a set
of helpers.

- **Matching is synchronous, on the caller's stack.** `createQ().add` (`processQueue.ts:83-272`) pairs
  puts with takes and calls user callbacks inline. Those callbacks can call `add` again, so calls can
  nest.
- **Resumption is ad-hoc.** About 20 sites call `setTimeout(fn, 0)` directly (e.g. `instructions.ts:48,53,90,94`,
  `processQueue.ts:113,172,201`). There is no single queue, no ordering guarantee and no batching.
  Browsers clamp nested `setTimeout(0)` to 4 ms or more, so a chain of N hops costs about N×4 ms.

**core.async (CLJS)** also matches immediately, but it sends *every* callback through one dispatcher
(`dispatch.cljs`):

```clojure
(def tasks (buffers/ring-buffer 32))
(def TASK_BATCH_SIZE 1024)
(defn run [f] (.unbounded-unshift tasks f) (queue-dispatcher))
;; process-messages pops up to 1024 tasks, then re-queues via goog.async.nextTick
```

Our `ring`, `unboundedUnshift`, `cleanup` and `MAX_DIRTY` are ported from core.async, but the
dispatcher was never ported.

**Direction:** write a `dispatch(fn)` of about 30 lines in `scheduler.ts`: a ring buffer drained in
batches through `MessageChannel` (a macrotask with no clamping) or `queueMicrotask` (which can starve
rendering). Route every `setTimeout(…, 0)` through it.

**Correctness issue:** core.async `alts` uses a per-handler `active?`/`commit` protocol, so the winner
deactivates the other handlers. Our `altFlag` is one mutable boolean on the **channel**
(`instructions.ts:15,68`, `scheduler.ts:12`). Two alts, or an alt and a plain take, on the same channel
overwrite each other's flag.

---

## Q2. A timeout inside `loop` only waits once

Example: ``loop`<! ${timeout(500)}; <! ${ch} ${function* () { handler(yield); }}` ``

There are three causes, and they add up:

1. **The interpolation is evaluated once.** `${timeout(500)}` runs when the tagged template is
   evaluated, before `loop` starts. `loop` shallow-copies `args` (`loops.ts:23`), so every iteration
   gets the same channel.
2. **The timer starts when `timeout()` is called**, not when the loop reaches that step
   (`go.ts:104-111` calls `proc.run()` straight away). CLJS does the same, but its `go-loop` macro
   evaluates `(timeout 500)` again on every iteration.
3. **The channel closes after firing** (`instructions.ts:82`). On later iterations, a take on that
   closed, empty channel resolves straight away with `CLOSED` (`processQueue.ts:91-96`).

The root cause is that JS template literals can't defer evaluation the way a Clojure macro can.

Fix options, cheapest first:

- Accept a thunk, `${() => timeout(500)}`, and have `go`/`loop` call it on each run.
- Make `timeout(ms)` return a lazy descriptor that `go` turns into a real timer when it reaches that
  step. This also fixes "the timer starts at the call site."
- Q3 option B, which makes the problem go away.

**Related:** `Process.clone()` reuses the same put/take generator objects (`process.ts:89`). This is
harmless in `loop` today, because `_go_` is called again before cloning. It breaks if a process that has
already run is cloned.

**First step:** write a failing test that loops 3 times over timeout(50) + take and asserts that the
elapsed time is at least 150 ms.

---

## Q3. Not forcing consumers to write generators

| Option | Consumer code | Cost |
|---|---|---|
| A. Callback sinks in the DSL | ``loop`<! ${ch} ${v => handle(v)}` `` | Very small. `go.ts:91` already wraps a callback into a generator for `?:`, so this generalises it. |
| B. async/await core | `go(async () => { for (;;) { await sleep(500); handle(await take(ch)); } })` | Most idiomatic, and Q2 goes away. Cancellation needs an `AbortSignal`. `alts` needs the commit protocol, not `Promise.race`, or the losing takes leak. Means rewriting the process layer. |
| C. Async iterators | `for await (const v of ch) handle(v)` | Works alongside B for consuming a channel. |

The tagged-template DSL can remain as optional sugar compiled onto B. Counterpoint to "generators never
caught on": Effect-TS (`Effect.gen`) and redux-saga do use them. For everyday consumers, async/await is
the norm.

**Open decision for the user:** A (keep the DSL and add callbacks) or B/C (an async-first core).

---

## Q4. Are generators slowing us down?

Probably not much compared with everything else. V8 has optimised generators and async functions since
about 2017–2018 (https://v8.dev/blog/fast-async). The more likely costs are:

- **4 ms `setTimeout` clamping on every hop.** This probably outweighs everything else by orders of
  magnitude.
- **`Object.defineProperties` on new functions and prototypes for every operation**
  (`instructions.ts:57-58,100`, `processEvents.ts:28,55`). This creates a fresh prototype each call and
  forces megamorphic, slow-mode objects.
- **`Array.includes` inside loops** (`othersDone`, `doneIndices` in `processQueue.ts`), which is O(n²).

CLJS's `go` compiles to a callback state machine with no generators. JS has no macros, so a generator or
an async function is the closest native equivalent.

**Measure first:** write a ping-pong benchmark (two processes passing N values) and run it before and
after the Q1 dispatcher change.

---

## Suggested order

1. Write the Q2 reproduction test and the ping-pong benchmark (the baseline).
2. Build the Q1 dispatcher.
3. Fix the Q2 timeout with the thunk or lazy-descriptor approach.
4. Make the Q3 API decision (A or B/C).
5. Re-measure, then decide whether generators stay internally (Q4).

## Sources

- https://github.com/clojure/core.async/blob/master/src/main/clojure/cljs/core/async/impl/dispatch.cljs
- https://github.com/clojure/core.async/blob/master/src/main/clojure/cljs/core/async/impl/timers.cljs
- https://github.com/clojure/core.async/blob/master/src/main/clojure/cljs/core/async/impl/channels.cljs
- https://v8.dev/blog/fast-async
- https://glebbahmutov.com/blog/performance-of-v8-generators-vs-promises
