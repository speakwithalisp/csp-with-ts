# CSP inspection and research (October 2026)

Status: **research only.** No library code was changed. Every "measured" result below was produced by a probe
in [`probes/`](probes/README.md) running against a compiled scratch copy of `master` @ `b745c2f`. Where something
was only read and not run, it says so.

Inputs: the two earlier plans written by a local Claude Code session (copied verbatim into
[`docs/plans/`](../plans/)), an earlier end-to-end assessment of an old demo app (5 Oct 2026, summarised in §1), and this
session's discussion. Comparison sources: a clone of `clojure/core.async` (master, June 2026), including the
new `core.async.flow` docs, and the Go blog's *Pipelines and cancellation* article.

> **Second pass:** [`2026-10-csp-lens.md`](2026-10-csp-lens.md) re-evaluates the library and the DSL ideas against
> CSP sources (Hoare 1978/1985, Go docs and talks, Rich Hickey's core.async talk). It adds a core FIFO bug (C1) and
> revises the broadcast and `sink` recommendations. Where the two documents disagree, the second pass wins.
> **Roadmap:** [`2026-10-roadmap.md`](2026-10-roadmap.md) is the current, dependency-ordered plan.
> **Claims check:** [`2026-10-claims-validation.md`](2026-10-claims-validation.md) checks earlier inventory and
> assessment claims against the code.

Contents

1. [Ground rules and context (the owner's position)](#1-ground-rules-and-context)
2. [Findings at a glance](#2-findings-at-a-glance)
3. [Scheduler](#3-scheduler)
4. [WeakMap registry](#4-weakmap-registry)
5. [Broadcast-to-all-takers](#5-broadcast-to-all-takers)
6. [Timeouts](#6-timeouts)
7. [Generators vs async/await](#7-generators-vs-asyncawait)
8. [The tagged-template DSL](#8-the-tagged-template-dsl)
9. [A composable DSL: `convert`, operations as values, stages](#9-a-composable-dsl)
10. [Other bugs confirmed](#10-other-bugs-confirmed)
11. [Claims that turned out wrong](#11-claims-that-turned-out-wrong)
12. [Decision log](#12-decision-log)
13. [Task list](#13-task-list)
14. [Open questions](#14-open-questions)
15. [What's needed to explain the leftover timers](#15-whats-needed-to-explain-the-leftover-timers)
16. [Sources](#16-sources)

---

## 1. Ground rules and context

The owner set these rules during the session, and they shape every recommendation below:

- **Most code is written by the owner, by hand.** Claude does scaffolding (test runner, CI, probes) and sweeping
  mechanical changes (for example swapping `setImmediate` for a dispatcher everywhere). Library logic is the owner's.
- **Fix only what stops the library from being professional.** Lower-priority anomalies may stay, *with a proper
  answer*: what the original reasoning was, why it would change, and why it didn't.
- **It's a passion project.** The obvious answer is not automatically the chosen one. If WeakMap and broadcast can
  be kept with fixes, keep them. Generators stay the internal mechanism unless they're shown to be too costly.
- **Ideas are avenues to explore, not prescriptions.** Names (`convert`, `take`, …) are placeholders.
- **Preferences stated:** no thunks in the user-facing DSL, and no async/await inside go blocks. Type safety matters
  (the tagged template "completely forgoes" it). Composability matters: reusable behaviour objects that run on
  several go blocks, like `compose` in ramda or transducist.
- **Historical reasoning (2020)** that was examined: (1) the Node manual and forum posts said async functions were
  much slower than callbacks, `.then` and generators; (2) async iterators and `for await` were too new to trust;
  (3) the per-channel put/take design of core.async was avoided because it becomes callback-heavy; (4) the WeakMap
  was meant to let closed channels and processes be garbage-collected automatically; (5) broadcast was built in on
  purpose to avoid needing a pub/sub layer for simple cases (ruled "not a bug" on 8 Oct).
- **Priority:** the timeout-in-a-loop bug is the most important one.

**Earlier e2e assessment (5 Oct), as relevant here.** An old drag-and-drop demo app was used as a test bench. It
identified two library bugs to fix first: the `loop` crash ("bug 1") and nested
`kill` losing `this` ("bug 2"). The e2e numbers measured there: 21.4 ms median from mouse move to screen update;
about 153 `setTimeout` calls per drag cycle; about 440 timers a second left running after unmount in the
production build.

---

## 2. Findings at a glance

| # | Finding | Evidence | Verdict |
|---|---|---|---|
| F1 | Bug 1 root cause: `kill` → `putAsync` → `flush()` **deletes the channel from the registry** before `loops.ts:34`'s deferred `get()` runs | Run (`p5`, `p6`, stack trace) | Fix: remove the explicit delete |
| F2 | Removing that one `delete` stops the crash and **keeps GC behaviour identical** | Run (`p5`, `p7`) | Keep WeakMap |
| F3 | Bug 2: `setImmediate(proc.kill)` is called unbound, throws `this._events is not iterable`, child keeps consuming | Run (`p3`) | Fix: one line |
| F4 | Broadcast depends on timing: parked takers all get a value, but a **buffered** value reaches only one taker | Run (`p1b`) | Fix the buffer path, keep broadcast |
| F5 | **FIFO violation:** a value is stranded in the buffer while newer values bypass it to parked takers | Run (`p13`) | Same root as F4 |
| F6 | Delivery to parked takers is LIFO (later taker first) | Run (`p1_broadcast`) | Make FIFO |
| F7 | `loop` over `timeout(ms)` fires **once**, then stalls silently | Run (`p4`) | Most important bug |
| F8 | An untaken `timeout(100)` **stays open past its deadline**; a take at 200 ms resolves at about 300 ms | Run (`p11`) | `timeout` should close at the deadline |
| F9 | Scheduler choice does **not** change per-event latency (about 0.1 ms on every scheduler) | Run in Chromium (`bench2`, `bench3`) | Swap for hop count/CPU, not latency |
| F10 | Hops per value: 1 (`go`), 7 (`loop`), 14 (`loop` + alts), 4 (`takeAsync` round trip) | Run (`p2`, `p12`) | Main cost driver |
| F11 | Generators are cheap (18–33 ns per `next()`); async/await is now the fastest *scheduled* resume | Run (`perf`, `perfb`) | Keep generators internally |
| F12 | A typed, composable function DSL catches the mistakes the template can't | `tsc` on `dsl-*-sketch.ts(x)` | Recommended direction |
| F13 | TypeScript 6 reports type errors in `channels.ts` and `go.ts` (emit still works) | Compile | Budget for it in the TS upgrade |

---

## 3. Scheduler

**Owner's idea:** replace it wholesale, because it "is not truly async" and uses `setImmediate` everywhere. Instead
of `setTimeout`, use `postMessage`, `MessageChannel` or a microtask API, cross-compatible with Node.

**Measured, Chromium 141, cost of one hop:**

| Primitive | µs per hop | Notes |
|---|---|---|
| `setTimeout(0)`, nested | 4,254 | Clamped to 4 ms after 5 nesting levels |
| `requestAnimationFrame` | 15,947 | Frame-bound, wrong tool |
| `window.postMessage` | 25 | Shares the page's `message` event with everything else |
| `MessageChannel` | 17 | What React's scheduler uses in browsers |
| `scheduler.postTask` | 8–13 | Not in Safari |
| `queueMicrotask` / `Promise.then` | 0.7–1.3 | Runs before paint; can starve rendering |

**But per-event latency was the same on every scheduler.** A 3-stage go pipeline and a `loop` both delivered in
about 0.1 ms (median) with `setTimeout`, `MessageChannel` and `queueMicrotask`. One event's chain is too short to
reach the clamp. So the e2e run's **21.4 ms is not scheduler latency**. It's most likely the wait for the next frame
plus React rendering.

**What the swap actually buys:** fewer hops (F10), which means less CPU and garbage, plus no clamp in deep chains and
deterministic ordering.

**core.async (CLJS) for comparison** (`impl/dispatch.cljs`, `impl/channels.cljs`): matching puts to takes happens
synchronously *inside the channel*. Only the resulting callbacks go through **one** dispatcher, a ring buffer
drained in batches of 1,024 via `goog.async.nextTick`. This library already ported `ring`, `unboundedUnshift`,
`cleanup` and `MAX_DIRTY`, but not the dispatcher.

**Recommendation:**
- One `dispatch(fn)`: a ring buffer drained from a microtask within a time budget (about 4 ms).
- If work is left when the budget runs out, continue on a macrotask: `MessageChannel` in browsers, `setImmediate`
  in Node. Node's `MessageChannel` keeps the process alive unless the port is `unref`ed.
- Real `setTimeout` only for timers.
- Not `window.postMessage` (slower, pollutes the page's events) and not `postTask` as the primary path (no Safari).

This is a sweeping, mechanical change, so it's Claude's to do. The owner's justification ("not truly async") is
better stated as: "it hops through the event loop far more often than it needs to, and the hops are scattered
across about 20 call sites with no ordering guarantee."

---

## 4. WeakMap registry

**Owner's reasoning (2020):** the WeakMap would garbage-collect channels and processes once they closed.
**Owner's position now:** keep it if it can be fixed. The per-channel queue design of core.async was avoided
because it becomes callback-heavy.

**Measured (`p7`, 2,000 channels per case):**

| Case | WeakMap | Plain Map | WeakMap without the explicit `delete` |
|---|---|---|---|
| Used, then closed | collected | collected | collected |
| Idle, never closed | collected | collected | collected |
| Abandoned, go block parked on take | collected | **leaked** | collected |
| Abandoned, `takeAsync` pending | collected | **leaked** | collected |

So the reasoning **half holds**. A WeakMap does beat a Map for abandoned channels. But `close()` has nothing to do
with it: only reachability does. And it's equivalent to storing the queue on the channel object, which is what
core.async does.

**The bug (F1) comes from the one place the WeakMap wasn't trusted.** `flush()` ends with
`if (!chan.count() && !chan.altFlag) CSP().delete(chan)`. The stack trace:

1. A process finishes and calls `kill()`.
2. `kill()` calls `putAsync`, which calls `drainToChan`.
3. `drainToChan` runs the callback *before* adding the value, so `flush()` deletes the entry.
4. The deferred `CSP().get(...)` in `loops.ts:34` then returns `undefined`, and `.add` throws.

`setTimeout` widens the window to 1–4 ms, which is why the e2e crash needed events 1–4 ms apart. Removing the
`delete` stopped the crash (0 at all gaps) and left GC unchanged.

**Fix (owner's to write):**
- Remove the `delete`.
- Add a get-or-create helper in place of the roughly 30 `has()`/`get()!` pairs.
- Where code uses "missing from the registry" to mean "finished" (`instructions.ts:16`, `process.ts:129,156`,
  `loops.ts:33`), check `ch.closed && ch.count() === 0` instead.

**On "callback-heavy":** core.async's handlers are callbacks, but so are this library's `InstructionCallback`s, and
this library measures 7–14 macrotasks per value through `loop` against core.async's one dispatch. Hop count is a
weak argument. Separation of concerns is the strong one.



Leaks the WeakMap can't prevent: anything rooted outside the library, such as DOM listeners feeding channels and
pending timers.

---

## 5. Broadcast-to-all-takers

**Owner's reasoning:** every listener gets each incoming value, unlike standard CSP, so simple fan-out doesn't need a
pub/sub layer. Deliberate (ruled 8 Oct). **Question asked:** still justified, or too esoteric? Bad for memory? Is
the buffered-drop problem easy to fix?

**Measured (`p1_broadcast`, `p1b`, `p13`):**
- One put with two parked go takers: both receive it, in **LIFO** order (`g2` before `g1`). The same holds for two
  `takeAsync` calls.
- One put **before** the takers arrive (buffered): **only the first taker gets it.** The second stays pending.
- At 0 ms gaps, value `3` was stranded in the buffer while values 4–99 went straight to the parked takers.

**Root cause.** Two delivery paths, the buffer and the direct handoff to parked takers, don't coordinate. A taker
arriving drains the buffer synchronously, before the other takers register, and puts can bypass a non-empty buffer.

**Fix, easy (in `createQ.add`, owner's to write):**
1. Invariant: puts never bypass a non-empty buffer, and a taker never parks while the buffer has values meant for it.
2. A taker arriving at a non-empty buffer doesn't drain it on the spot. It schedules one dispatcher turn, which
   delivers the value to **every taker parked by then**.
3. Deliver in FIFO order.

After this, the semantics are "delivered to every subscriber present at delivery time", the same rule as
Effection's `Channel`, RxJS `Subject` and DOM events.

**Fix, principled (later, optional):** give each subscriber its own read position in a shared log, as Kafka and the
Disruptor do. Late subscribers no longer miss values, and the slowest reader sets the backpressure. More work, and a
good "what I'd do next" answer.

**Is it standard?** Broadcast is a legitimate primitive: Effection's `Channel`, RxJS `Subject` and the browser's
`BroadcastChannel` all broadcast. Go uses `close(done)` as a broadcast signal, and `core.async.flow` broadcasts when
one output is connected to several inputs (via `mult`). In each of those, though, broadcast is a **named,
explicit** construct. Baking it into the CSP channel rules out work queues, worker pools and `pipeline`, and makes
"who wins" in alts ill-defined.

**Memory:** no inherent leak. Implicit membership means there's no way to unsubscribe, so a forgotten parked
consumer stays alive as long as its channel does. An explicit stop handle per consumer solves that.

**alts under broadcast:** the losing arms of an alts must be removed so they don't get copies later. That's the
per-handler `active` flag (core.async's `alt-flag`), replacing the per-channel `altFlag`. Until then, document "one
alts per channel at a time".



---

## 6. Timeouts

**Owner:** this is the most important bug. Thunks are disliked.

**Measured:**
- `loop` over `` `<! ${timeout(100)} …` `` for 500 ms: the body ran **once**, then the loop stalled. Three causes
  (detailed in `docs/plans/async-core-investigation.md` Q2):
  1. The interpolation is evaluated once.
  2. The timer starts when `timeout()` is called.
  3. The channel is closed on later iterations.
- **New (F8):** an untaken `timeout(100)` is still open at 150 ms. A take at 200 ms resolves at about 300 ms,
  waiting the full duration again.
- Concurrent timeouts with takers fire correctly (100, 150 and 200 ms).

**core.async `timeouts.cljs`:**
- `timeout` returns a channel that **closes** at the deadline, so a late take gets `nil` immediately.
- Timeouts that fall within 10 ms of each other share one channel, tracked in a skip list.

**Recommendation:**
- `timeout(ms)` stays a channel (for alts) but **closes at its deadline**.
- Add a `sleep(ms)` *operation* in the new DSL (§9). It's a description, armed when the step is reached, so a
  loop re-arms it every iteration. No thunks are needed.
- Sharing a channel between near-equal timeouts is optional.

---

## 7. Generators vs async/await

**Owner's 2020 reasoning:** async was much slower, and async iterators were too new. **Question:** has it improved
enough to consider? Generators should stay internal unless too costly.

**History:** V8 7.2 (Chrome 72 and Node 12, early 2019) made `await` cheaper than hand-written promise chains
([v8.dev/blog/fast-async](https://v8.dev/blog/fast-async)). `for await` was standard in ES2018 and shipped in Node
10. The "async is slow" advice dates from the Node 7–8 era, so it was already out of date in 2020.

**Measured, 1M operations each:**

| | Node 22 | Chromium 141 |
|---|---|---|
| async/await | 97 ns | **57 ns** |
| Generator resumed by microtask (closure driver) | 166 ns | 1,080 ns |
| Generator `next()` alone | **33 ns** | **18 ns** |
| `for await`, hand-rolled iterator | 101 ns | 113 ns |
| `for await`, async generator | 226 ns | 161 ns |
| Callback via `queueMicrotask` | 166 ns | 1,131 ns |

Retained memory per parked consumer (Node): suspended generator 537 B, async function 672 B, bare closure 104 B.
10,000 parked go blocks come to about 5 MB.

**Conclusion:** generators themselves are cheap. The cost is in the hops around them, so **keep generators
internally** and cut the hops (§3). Async/await doesn't belong inside go blocks, per the owner's preference. It can
appear at the edges, for example an optional `for await (v of ch)` for code outside the DSL, next to the existing
`takeAsync`.

One real advantage generators have over async functions: they can be cancelled from outside with `.return()`.
Effection builds structured concurrency on exactly that.

---

## 8. The tagged-template DSL

**Owner:** the idea came from a popular styling library in 2020, almost certainly
[styled-components](https://styled-components.com) (or Emotion). Do any other libraries use templates, and does it
fit this use case?

**Who uses tagged templates:** styled-components and Emotion (CSS), lit-html and htm (HTML), graphql-tag
(GraphQL), postgres.js and slonik (SQL), zx (shell). All of them embed a **foreign language with its own grammar**:
the string is the program, the `${}` slots are data, and editor plugins add highlighting.

This DSL is the reverse: three operators (`<!`, `>!`, `?:`) plus `;` and `eval`, and the interpolated values carry
all the meaning. TypeScript types the string parts as `TemplateStringsArray`, so it can't relate `<!` to the type of
the next value. Every interpolation becomes a union (`IGoArgs`). The costs (no types, parsing on every call, syntax
errors only at runtime) outweigh the benefit.



---

## 9. A composable DSL

**Owner's ideas:**
- (a) a `convert(fn)` higher-order function that turns a plain `(value, i)` function into a sink, so users never
  write generators, with a way to break out passed in the arguments;
- (b) a Clojure-like function DSL, `go(take, chan, convert(example))`, with no template strings;
- (c) composed behaviour objects, built by a helper, that run on several go blocks, like `compose` in ramda or
  transducist.

### 9.1 What core.async and Go say about composition

- **core.async:** go blocks compose because a go block *returns a channel* (its result), so processes are
  first-class values. Transducers compose value transformations on channels. `mult`/`tap`, `pub`/`sub`, `merge`
  and `pipeline` compose topology.
- **core.async.flow (2025):** "a strict separation of your application logic from its topology, execution,
  communication, lifecycle…". Users write **step functions**: ordinary data→data functions that "do not access
  channels directly or hold state". A flow *definition* (data) wires processes together. Helpers `lift1->step` and
  `lift*->step` turn a plain function into a step function. **That's the owner's `convert`.** One output connected
  to several inputs gets every message, via `mult`. (`flow` is JVM-only; it has no ClojureScript version, so a JS
  take on it would be new ground.)
- **Go, *Pipelines and cancellation*:** a pipeline is "a series of stages connected by channels". The rules:
  "stages close their outbound channels when all the send operations are done" and "keep receiving values from
  inbound channels until those channels are closed". Fan-out means several readers on one channel; fan-in means
  `merge`. Cancellation works by closing a `done` channel, which "is effectively a broadcast signal". `select`
  picks at random among ready cases; core.async's `alts!` is random by default, with a `:priority` option.

### 9.2 The design: three layers of composition

| Layer | Unit | Composes with | Prior art |
|---|---|---|---|
| Value | `Step<A, B> = (a, ctl) => B \| SKIP \| STOP` | `comp(f, g, h)` | Transducers, flow step functions, ramda `compose` |
| Operation | `Op<R>`: an **immutable description** of a channel operation producing `R` | `seq`, `loop`, `alts`, `spawn`, plus `.map` / `.then` / `.into` / `.each` | redux-saga "effects as data", Effection operations |
| Process | `Stage<A, B> = (in, out) => Op<void>` | `chain(s1, s2)`, `fanOut(n, s)` | Go pipeline stages, flow processes |

- `convert(fn)` is `.each(fn)` (or `take(ch).each(fn)`). `go.ts:91` already does this for `?:`.
- **Reuse across go blocks works because operations are descriptions.** Each `go(op)` creates fresh state
  (generators, counters, intermediate channels), so one recipe can run on many go blocks. Today's
  `Process.clone()` shares generator objects between clones, which is why the current design can't do this safely.
- **The timeout bug disappears:** `loop(sleep(500), take(ch).each(f))`. `sleep` is armed when it's reached, on
  every iteration, with no thunks.
- **Generators stay internal.** Each operation compiles to the existing `put`/`take`/`sleep` process events, and
  `seq`/`loop` nest through `yield*`. Generator delegation gives nesting for free.
- **Passing a value from one step to the next** without async/await: `.map(step)` and `.into(ch)` for data flow,
  and `.then(v => op)` when the next operation depends on the value (for example, replying on a channel carried in
  a message).
- **Why not a flat `go(take, chan, sink)`:** it can be typed with tuple-parsing types, but the error messages are
  unreadable. Operation builders give the same Clojure-like shape with ordinary generics.

### 9.3 Compiled sketch (type-only, [`probes/dsl-compose-sketch.ts`](probes/dsl-compose-sketch.ts))

```ts
const toPoint   = step((e: MouseEvent) => ({ x: e.clientX, y: e.clientY }));
const inBox     = step((p: Point) => (p.x < 300 ? p : SKIP));
const untilUp   = step((e: MouseEvent) => (e.type === 'mouseup' ? STOP : e));

// reusable behaviours are values
const dragging: Stage<MouseEvent, Point> = (inp, out) => loop(take(inp).map(comp(untilUp, toPoint, inBox)).into(out));
const throttle = <T>(ms: number): Stage<T, T> => (inp, out) => loop(take(inp).into(out), sleep(ms));

const pipeline = chain(dragging, throttle<Point>(16));
const a = go(pipeline(mouse, points));    // same recipe…
const b = go(pipeline(mouse, points2));   // …independent second instance

go(loop(alts(take(points), sleep(200).map(() => null)).each(p => { /* render or reset */ })));
go(loop(take(reqs).then(r => put(r.reply, r.q.length))));   // request/reply
```

`tsc --strict` rejects all three planted mistakes: a `KeyboardEvent` put into a `Point` channel, chaining a
`Point` stage into a `string` stage, and a `string` reply on a `number` channel. A first test case, `MouseEvent`
into `Point`, compiled. That's correct: `MouseEvent` really has numeric `x`/`y`, and TypeScript typing is
structural.

### 9.4 Open design points (owner to decide)

- Names: `convert` vs `each`, `sink` or `handle`; `Op` vs `Effect` or `Instr`; `stage` vs `process`.
- Does `take` inside `loop` end the loop when the channel closes? Recommended: yes, matching Go's `range` and
  core.async's `go-loop` with a `nil` check.
- Should `STOP` from a step also close the stage's outbound channel? This is Go's rule, and recommended.
- Should `go(op)` return a `Proc` with a `done` channel? That's how core.async go blocks compose, and recommended.
- Keep the template DSL as sugar that parses into operations, or retire it.

### 9.5 Surface options explored (second round)

Every surface below compiles to the same core of operation values, so they are not mutually exclusive. They are
just different ways to write the same operations. Type-only sketches of A–E are in
[`probes/dsl-surfaces-sketch.tsx`](probes/dsl-surfaces-sketch.tsx). Each one includes a planted mistake, checked
with `tsc --strict`.

| Surface | Example | Planted mistake caught? | Owner's verdict |
|---|---|---|---|
| Fluent operation builders (§9.3) | `take(ch).map(f).into(out)` | yes | Vocabulary to keep |
| **A. pipe-first** | `pipe(take(mouse), map(toPoint), into(points))` | yes | **Considering as the main surface**, with the vocabulary limited (§9.6) |
| **B. typed template** (each `${}` is a self-typed operation) | `` go`${sleep(500)}; ${each(take(mouse), f)}` `` | yes | **Keep as sugar** (the original syntax, now typed) |
| C. s-expressions as data | `goS(['sleep', 500], sx(['<!', ch, f]))` | only with the `sx()` helper; raw tuples lose `T` | not pursued |
| D. JSX, custom factory (no React) | `<Loop><Sleep ms={16}/><Take from={ch} each={f}/></Loop>` | yes | not pursued |
| E. statechart | `states('idle','dragging').machine('idle', on => …)` | only with states declared up front (two earlier versions missed a misspelled state) | **Rejected** by owner |
| F. topology as data (core.async.flow) | `{ procs, conns }` | not sketched | later, for app-level wiring |
| G. typed `yield*` generators | `const v = yield* take(ch)` | not sketched | possible power-user layer only |
| H. compile-time `go` macro (Babel or TS transformer) | real `go` blocks | not sketched | too heavy |

### 9.6 Owner's position on surface area, and how it checks out

**Owner (paraphrased):** ramda and RxJS, with 100+ operators, are good libraries. But they have a large initial learning curve. AI-assisted
coding makes learning curves matter less, but there is still a place for CSP's simple building blocks: at the core,
channels and two operations, from which surprisingly sophisticated logic can be written. So `pipe` is good for
readability, but the functions offered should be limited to the operation-builder vocabulary. Concern: `pipe`
alone feels non-idiomatic for CSP.

**Checked against sources:**
- *The operator count is a real learning cost.* **Supported.** RxJS's lead maintainer, Ben Lesh, wrote that RxJS
  "has too many operators" and that the team has been deprecating them (W3C public-webapps list, Dec 2023).
  Consultancies cite "more than 100 operators" as a hurdle. A counterpoint worth knowing: some argue the real
  hurdle is the change in mental model (declarative streams vs. procedural code), and that about 4 operators
  (`map`, `filter`, `mergeMap`, `switchMap`) cover most needs.
- *CSP's power comes from a tiny core.* **Supported in substance.** Go's concurrency vocabulary is channels,
  send/receive and `select`; core.async's is channels, put/take and `alts`. Pike's proverbs: "Don't communicate by
  sharing memory, share memory by communicating", "Channels orchestrate; mutexes serialize". No source found states
  "small set of primitives" as an explicit design principle in those words, so present it as the owner's view.
- *AI makes learning curves matter less.* **Unproven.** The METR randomised trial (2025) found experienced
  developers were 19% *slower* with AI on codebases they knew, while believing they were 20% faster. It didn't
  study unfamiliar libraries, so the claim is neither confirmed nor refuted. Keep it as an opinion, not a fact.
- *`pipe` is the right mechanism if you want few names.* **Supported by RxJS's own history.** RxJS 5.5 moved from
  operators patched onto `Observable.prototype` to standalone "pipeable" operators, because patched operators can't
  be removed by bundlers, create hidden dependencies between libraries, and make custom operators second-class.

**Resolving "non-idiomatic for CSP":** use `pipe` for one *line* of data flow (take → transform → put), and keep
*process structure* sequential (`go`/`loop` over a list of operations), the way a CSP process reads:

```ts
loop(
  sleep(16),                                           // process structure: sequential steps
  pipe(take(mouse), map(toPoint), into(points)),       // one line of data flow
)
```

**Suggested limited vocabulary (about 12 names, placeholders):**
- channels: `chan`, `close`
- the two operations and choice: `take`, `put`, `alts`
- time: `sleep` (operation), `timeout` (channel)
- process structure: `go`, `loop`, `spawn`
- data flow: `pipe`, `map`, `into`, `each`

Filtering, deduplicating and the like stay in **transducers on channels**, which the library already supports. That
keeps the operation vocabulary from growing into an RxJS-sized one.

### 9.7 Clarified: the owner's actual design (supersedes the fluent-builder reading in §9.3 and §9.6)

**Owner (clarified):** no builder pattern was intended. The focus is on *converting plain functions into something
the library can run inside a go block*:

- `go(...ops)` takes an argument list of operations instead of `` `proc1; proc2` ``.
- Each operation is `take`, `put`, `sleep`/`timeout` or `alts`, and holds a channel plus a *converted* function.
  `sleep` creates its own channel; `alts` holds a selection of channels.
- `convert(exampleFn)` wraps a function with a fixed signature, roughly `(val: IChanValue<T>, stop: () => void) =>
  IChan | IProc` (return type not decided).
- `pipe` threads **plain functions** (ramda-style) so you don't write nested calls. It does *not* compose operations.

```ts
go(take(mouse, convert(pipe(untilUp, toPoint, render))));      // consume until a stage returns STOP
loop(sleep(16), take(mouse, convert(pipe(toPoint, render))));  // sleep re-armed every iteration
const dragOps = [take(mouse, convert(pipe(untilUp, toPoint, render)))] as const;
go(...dragOps); go(...dragOps);                                // one description, two go blocks
```

Type-only sketch: [`probes/dsl-owner-shape-sketch.ts`](probes/dsl-owner-shape-sketch.ts). `tsc --strict` catches
all three planted mistakes: a `string` channel with a `MouseEvent` pipeline, mismatched `pipe` stages, and a
`string` put into a `Point` channel.

**Why it fits:** it's the tagged-template DSL with the string parser removed. `go.ts` already turns the template
into an array of process events (`processEvs`) and calls `createProcess(...processEvs)`. Here, the argument list
*is* that array:

| Template | Function form |
|---|---|
| `` <! ${ch} ${function* () {…}} `` | `take(ch, convert(fn))` |
| `` >! ${ch} ${src} `` | `put(ch, value \| source(fn))` |
| `` ?: ${[a, b]} ${cb} `` | `alts([a, b], convert(fn))` |
| `` eval ${proc} `` | a nested `go`/`loop` descriptor passed as an operation |
| `;` | the comma between arguments |

The process layer stays flat and sequential, which is idiomatic CSP. `pipe` only composes the value-level
functions, which is where ramda-style threading belongs.

**The one implementation change that matters: operations must be descriptions, not live generators.** Today the
internal `put()`/`take()` in `processEvents.ts` create a running generator immediately (`return proc()`). That's
why `loop` has to call `_go_` again and `clone()`, and why `Process.clone()` shares generator objects. In this
design, the public `take(ch, sink)` returns plain data `{ kind: 'take', ch, sink }`. `go()` calls the internal
`take`/`put` **when it runs**, and `convert` returns a generator *function* (as the template already expects), so
every run gets fresh state. That one change fixes three things: timeouts in loops (`sleep(ms)` is armed when it's
reached), reusing one operation list across go blocks, and the `clone()` sharing hazard.

**Decisions still open:**
1. *Handler return type.* `void`, or "return an operation or process to run next" (a continuation, which enables
   request/reply: `(req) => put(req.reply, answer)`). Returning `IChan` as the go block's result channel is a third
   option (the core.async model).
2. *One value vs. many.* In the template, `<! ${ch}` with no function takes one value, and with a generator it
   consumes until the generator returns. Keep that: `take(ch)` waits for one value, `take(ch, convert(fn))`
   consumes until `stop`.
3. *How to stop.* Pass `stop()` in the arguments (the owner's idea), let a `pipe` stage return a `STOP` sentinel
   (like a transducer's `reduced`, which works without threading `stop` through every stage), or both. The sketch
   does both.
4. *alts handler.* Does it receive which channel won (`{ value, ch }`), or just the value?
5. *put sources.* A plain value, or a `source(fn)` producer called each time a value is needed?

### 9.8 Second pass on the open decisions

**Naming direction (owner):** `go` and the `convert` placeholder are functions that take functions and return
functions with specific signatures. The DSL should read like literal pipe networking. Plumbing names that already
have a meaning in the field: **`source`** (wraps a producer for `put`) and **`sink`** (wraps a consumer for
`take`). The Go pipelines article uses those terms ("the first stage is sometimes called the *source* or
*producer*; the last stage, the *sink* or *consumer*"), and core.async.flow uses them for its edge processes.
Others in the metaphor: `tap`, `valve`, `drain`, `plumb`, `pipe`.

**Async operators outside go blocks stay (owner).** `putAsync`, `takeAsync` and an optional `for await` are kept,
like core.async's `put!`/`take!`. Not everything can live inside a go block.

#### Decision 1: `go(...)` returns a channel (**misread; see §9.9.** The owner meant operations, not `go`)

This is the core.async model: a go block returns a channel that receives the block's result. Internally, every
`Process` already has a completion channel (`Process._channel`, which gets `true` on kill), so exposing it is
natural.

Downsides and what each needs:
- **No kill handle.** Today `go` returns a kill function, and React `useEffect` cleanup relies on that. core.async
  has no kill for go blocks either; cancellation is by convention (a `done` channel, like Go's `context.Done()`:
  "a channel that acts as a cancellation signal"). Options: (a) attach `.kill()` to the returned channel;
  (b) return a `Proc` with a `.result` channel; (c) cancellation only through a `done` channel the caller puts in
  an alts. (a) is the least disruptive.
- **Late readers miss the result under broadcast** if they weren't parked when it arrived. That calls for a
  promise-style buffer, one that holds its value for every later reader (core.async's `promise-chan`).
  **`buffers.ts` already has a commented-out `PromiseBuffer`.**
- **A block with no result:** `null` is `CLOSED`, so "no value" means the channel just closes (core.async: a go
  block returning `nil` closes its channel).
- **Errors:** what happens if a handler throws? core.async prints it and closes the channel. Options: close the
  channel, put an `Error` value, or route errors through a handler like `chan`'s `exHandler`. Needs a decision.
- **Cost:** one extra channel per go block. Small, and GC'd like any other channel (§4).

#### Decision 2: is a bare `take(ch)` with no handler ever useful?

Yes, **inside go blocks, to sequence on an event**: "wait for `mousedown`, *then* start consuming moves", "wait
for a ready or `done` signal". This is Go's `<-done` and core.async's `(<! ch)` used for its effect. Waiting on
*time* is covered by `sleep`, but waiting on an *event* isn't. Outside go blocks, `takeAsync` is the right tool.
Recommendation: keep the bare `take(ch)` as "wait for one value, then continue" (it could be named `wait(ch)`).

#### Decision 3: how to stop (pros, cons, implementation)

| Option | Analogue | Pros | Cons | Implementation |
|---|---|---|---|---|
| **A. `STOP` returned by a stage** | Transducers' `reduced`; core.async `go-loop` stopping by not calling `recur` | Handlers stay pure and testable; short-circuits through `pipe` naturally; decided synchronously, so no value is lost | `STOP` appears in types (`T \| typeof STOP`); can't stop from a later async callback | **Easy:** check the return in the sink's driver loop and in `pipe` (about 5 lines) |
| **B. `stop()` passed in** (owner's idea) | Imperative `break` | Can be called from anywhere, including a later callback or timer | Must be threaded through every `pipe` stage; **if called while the take is parked, the parked take must be cancelled or it swallows the next value** | Easy for synchronous calls (a flag checked per value). Asynchronous `stop()` needs the per-handler `active` flag (same as alts and `altFlag`, §10) |
| **C. Close the channel** | Go `range` ending on close | No API at all | Stops *every* consumer (with broadcast, all subscribers); Go's rule is that only the sender closes | Already works |
| **D. External cancel** (`done` channel, kill) | Go `context.Done()`; core.async alts on a `done` channel | Stops from outside; composes over many operations | More API; it's a different job (cancelling the whole block, not ending one consumer) | `done` + alts works today; kill exists (fix bug 2) |

Recommendation: **A as the core**, B as a thin wrapper that sets the same flag (fine for synchronous use, documented
for async until per-handler flags exist), and D for cancelling from outside. Go and core.async both separate
"this consumer is finished" (control flow) from "cancel this work" (a `done` signal), and this keeps that split.

#### Decision 4: alts, how it works today and what to change

**Current implementation** (`go.ts:126-150`, `process.ts:149-201`), confirmed by a probe ([`probes/p14_alts.js`](probes/p14_alts.js)):
1. `alts(...args)` turns each arm into a process event. A channel becomes a take; `[ch, val]` becomes a put. Each
   is driven by `pseudoSourceSink`, which writes into one shared `winVal` object (`done` + `val`) when it completes.
2. Every event is created with `altFlag = true`, which is written onto the **channel** (`ch.altFlag`).
3. `createAlts` registers an instruction for every arm on its channel's queue, then yields.
4. On resume, the winner is `events.filter(isDone).pop()`, which is the **last** finished event, not the first.
   The others get `.return()`.
5. The winning **value** (not the channel) is put on a fresh `returnChan`. The `?:` form then takes from it, calls
   the callback, closes the channel and calls the `loopUntil` hook.

**Measured problems:** with both arms ready, **both values are consumed and one is lost** (`A1` delivered, `B1`
gone). The callback can't tell which channel won. There's no `default` and no priority; the order is fixed, not
random. Loser cleanup itself works: a later put on the losing channel reached a normal taker.

**How Go and core.async do it:**
- **Go `select`:** each case is a send *or* receive **with its own body**. If several are ready, one is chosen
  "via a uniform pseudo-random selection". A `default` case runs if none is ready. A `nil` channel is never ready,
  which is used to switch arms off dynamically.
- **core.async `alts!`:** "Completes at most one of several channel operations". Ports are takes or `[ch val]`
  puts; it returns `[val port]`. Options are `:priority true` (try in order) and `:default val`. `alt!` adds a
  result expression **per clause**, the equivalent of Go's per-case bodies. "At most one" is enforced by one
  shared `alt-flag` handler: the first arm to commit deactivates the rest.

**Brainstorm for this DSL: arms are operations.**

```ts
loop(alts(
  take(clicks, sink(onClick)),     // each arm carries its own handler, like Go's select
  take(keys,   sink(onKey)),
  put(out,     source(next)),
  sleep(200),                      // timeout arm
  { default: sink(idle), priority: true },   // optional, as in core.async
))
```

- It reuses the existing vocabulary, so there's nothing new to learn, and `loop(alts(…))` is Go's `for { select {…} }`.
- The question of what the winner callback receives goes away: each arm's own sink gets its value. A
  single-handler form `alts([a, b], sink(({ value, ch }) => …))` could exist as sugar.
- **Required change:** one shared commit flag across the arms (core.async's `alt-flag`), replacing the
  per-channel `altFlag`. That fixes the double-consumption bug, makes "first to finish" actually first, and is the
  same flag that asynchronous `stop()` needs. Under broadcast, an alts arm is one more parked taker. It commits
  only if the shared flag is still active, and plain takers on the same channel still get their copy.

#### Decision 5: `put(ch, source(fn))`, mirroring `take(ch, sink(fn))` (owner)

- `fn` returns the value to put. The channel's transducer applies as usual, because the value goes through
  `chan.add`.
- **When is `fn` called?** Recommendation: whenever the channel can accept, which gives pull-based backpressure.
  It repeats until `fn` returns `STOP` (mirroring a sink consuming until `STOP`).
- **Return values to decide:** `null` can't be put (it's `CLOSED`), so return `STOP` instead. Is `undefined` a
  skip or an error? A returned `Promise` could be awaited before the put (I/O producers). `IChanValue` already
  includes `Promise<T>`.
- A one-off constant put could be `put(ch, value)` as sugar.

### 9.9 Third pass (owner's clarifications, corrections to §9.8)

**Corrections from the owner:**
- `go`/`loop` **keep returning their destructor (kill) functions.** A returned channel would be more idiomatic, but
  it's a hassle when go blocks aren't being composed. §9.8 Decision 1 discussed the wrong thing.
- "Returning a channel" was meant for the **operations** (`take`, `put`, `alts`), so their output can feed other
  operations, for example taking from an alts' result.
- `stop` should be passed into the user function by the `sink`/`source` wrapper. `STOP` isn't liked; it needs a
  strong reason to be adopted.
- The bare `take(ch)` is liked. Question: will the polymorphic signature cause typing trouble, or is a `noop` sink
  simpler?
- Winner handling in alts is wanted. Does Go or core.async report which channel won?
- `put` takes a channel and a function returning the value. Wanted: first-class support for **iterables** (finite or
  infinite) being split into separate puts, with backpressure. Especially interested in **putting channels onto
  channels**.
- The promise channel is liked.

**Refresher: `IProc` vs `IChan` (from `interfaces.ts`).** `IChan` is a channel: buffer, `add`/`remove`, `close`,
`closed`. `IProc` is a process: `events` (its ordered put/take/sleep steps or nested processes), a completion
`channel: IChan<boolean>`, `isLive`, `run()`, `kill()`, `clone()`. Public `go` returns `proc.kill`; the internal
`_go_` returns the `IProc`. **Internal `alts()` already returns both, `{ process, channel }`.** The `channel` carries
the winning value, and the template's `` >! ${ch} ?: ${[a, b]} `` form puts that channel onto `ch`. So operations
returning channels for composition is already in the design. The owner remembered correctly.

**Operations as ports.** If `take(alts(a, b), sink(f))` creates the alts' channel *when the description is
written*, two go blocks running the same description would share one channel. Instead, let any operation that
produces values be usable wherever a channel is expected (a "port"), and have `go()` create a fresh channel for it
on each run. Type-checked in [`probes/dsl-ports-sketch.ts`](probes/dsl-ports-sketch.ts):
`take(alts(clicks, keys), sink(({ value, from }) => …))`.

**Stop passed in by the wrapper: agreed, and `STOP` isn't needed.** The wrapper creates `stop` once per run and
passes it as the second argument. Calling `stop()` *during* the handler has exactly the effect a returned `STOP`
would (decided synchronously, no value lost), so the sentinel adds nothing. Two caveats:
- `pipe` must pass `stop` through to every stage. Ramda's `pipe` doesn't: only its first function may take more
  than one argument. So the library needs its own `pipe`.
- Calling `stop()` *later* (from a timer) while the take is parked still needs the per-handler active flag (§9.8,
  Decision 4).
- "Skip this value" in a `pipe` stage can be **returning `undefined`**, since `undefined`/`null` can never go on a
  channel anyway.

**Bare `take(ch)` typing: no problem.** Two overloads, `take<T>(ch): Op<T>` and `take<T>(ch, sink: Sink<T>):
Op<void>`, compile cleanly. A `noop` sink also works if an explicit "do nothing" reads better; both can exist.

**Winner channel: the owner remembers correctly.**
- **core.async `alts!`** returns `[val port]` of the completed operation (docstring: "Returns [val port] of the
  completed operation, where val is the value taken for takes, and a boolean … for puts"). `alt!` clauses can bind
  it: `([val ch] (foo ch val))`.
- **Go `select`** doesn't need to, because each case is written against a known channel. The dynamic version,
  `reflect.Select(cases)`, returns `(chosen int, recv Value, recvOK bool)`: the **index** of the case that won.
- So both styles exist: per-arm handlers (Go `select`, core.async `alt!`) and a single result with the winner (core.async `alts!`,
  `reflect.Select`). The sketch types the second as `Op<{ value, from }>`. Both forms can coexist.

**Iterables in `put`.** Precedents: core.async `onto-chan!`/`to-chan!` (put a collection onto a channel, then
close), Go's `gen(nums ...int) <-chan int` generator stage. Recommendation: an **explicit** `from(iterable)`
source, not automatic flattening, because strings and arrays are iterable and are often meant as single values.
**Implementation is nearly free:** the internal `put()` in `processEvents.ts` already takes a generator *function*
and yields its values one at a time, only as the channel accepts them (backpressure). `from(it)` is
`() => it[Symbol.iterator]()`. An infinite generator is pulled only on demand.

**Putting channels onto channels.**
- **Go (Effective Go, "Channels of channels"):** "a channel is a first-class value that can be allocated and
  passed around like any other". The canonical use is request/reply: a `Request` struct carries
  `resultChan chan int`, and the server does `req.resultChan <- req.f(req.args)`. The channel is delivered *as a
  value*.
- **core.async `pipeline*`:** puts a per-job channel `p` onto `results`, then for each `p` takes the result channel
  `res` and **drains it into `to` in order**. Channels of channels are used to keep results in order.
- **This library (measured, [`probes/p15_chanchan.js`](probes/p15_chanchan.js)):** a channel put as a value is
  **spliced, in order**. Takers receive the inner channel's values, and the outer channel's next value only after
  the inner one closes. That's built-in ordered flattening, the same thing `pipeline*`'s drain loop does by hand.
  Request/reply still works by wrapping the channel in an object (`{ q, reply }` → reply received).
- **Bug found:** if the inner channel is **already closed** (with values buffered) when it's put, those values are
  **lost**, and two takers get `null` while the outer channel is still open.
- Worth deciding whether splicing stays the default or becomes opt-in (as in the earlier typing plan, §1.3).

---

## 10. Other bugs confirmed

| Bug | Where | Evidence |
|---|---|---|
| Early-terminating transducer (`reduced`) never closes the channel | `channels.ts:155-158` | Run, earlier plan §4.1 |
| No transducer completion (`@@transducer/result`) on close | `channels.ts:145-152` | Read, earlier plan §4.2 |
| `MAX_DIRTY` cleanup drops every callback waiter (65+ pending `takeAsync` hang) | `processQueue.ts:107-122` | Run, earlier plan §4.3 |
| `FixedBuffer.isFull` uses `===` (expanding transducers overflow) | `buffers.ts:149-151` | Run, earlier plan §4.4 |
| `chan(0)` builds a broken channel | `channels.ts:177,181` | Run, earlier plan §4.5 |
| Per-channel `altFlag` overwritten by concurrent operations | `instructions.ts:15,68`, `scheduler.ts:12` | Read |
| **Puts waiting on a full channel are delivered LIFO and the second put is always lost** (CSP pass, C1) | `processQueue.ts` pending-put path | Run (`p17b`) |
| More than 64 waiting puts mostly lost; no error at 1,024 (CSP pass, C2) | `processQueue.ts:107-122` | Run (`p17_pending`) |
| Channel put onto a channel when already closed with buffered values: values lost, takers get `null` | `processQueue.ts:40-58` | Run (`p15_chanchan`) |
| alts with both arms ready consumes **both** values and delivers one (`B1` lost); winner is the last finished, not the first | `process.ts:161` | Run (`p14_alts`) |
| `kill` on a sleeping process arms another sleep | `process.ts:68` | Read |
| `putAsync` on a closed channel calls `cb` and drops the value silently | `processEvents.ts:69` | Run, earlier plan §3.1 |

---

## 11. Claims that turned out wrong

These are recorded because the reasoning, and the correction, are part of the story.

- **"The 4 ms `setTimeout` clamp causes the latency."** (Earlier plan Q4, and Claude in this session.) False for
  per-event latency (F9). The clamp only applies past 5 nesting levels. It does matter for throughput in deep
  chains.
- **"A `loop` over a closed channel spins forever and causes the ~440 timers a second."** (Claude, this session.)
  False: it stalls (6 timers in 200 ms). The cause of the 440 a second is still unexplained (§15).
- **"`loopUntil` crash: closure over a reassigned variable."** (A first theory in the earlier e2e assessment.) Falsified by a
  patch then, and now explained by F1. The generator is suspended at `yield`, so `proc` can't change underneath
  the callback.

---

## 12. Decision log

| Topic | Owner's original reasoning | Finding | Decision (status) |
|---|---|---|---|
| Scheduler | "Not truly async", `setImmediate`-only | Latency equal; hop count is the cost | **Replace** with one dispatcher (Claude, sweeping) |
| WeakMap registry | Auto-GC of closed channels | Half holds; equivalent to queue-on-channel; crash comes from manual `delete` | **Keep**, remove the `delete` (owner) |
| Per-channel queues | Avoided as callback-heavy | Current design does more hops, not fewer | **Not adopted**; argue separation of concerns |
| Broadcast | Avoid a pub/sub layer | Legitimate primitive, but timing-dependent today | **Keep**, fix the buffer path and FIFO (owner); explicit `mult` later |
| Generators | Faster than async in 2020 | Generators cheap (18–33 ns); async also fast now | **Keep** internally |
| async/await in go blocks | Disliked | Not needed | **Not used** inside the DSL; optional `for await` at edges |
| Thunks for timeouts | Disliked | `sleep` as an operation removes the need | **Not used** |
| Tagged template | Inspired by styled-components | Fits embedded languages, not combinators; untyped | **Demote** to optional sugar (open) |
| Function DSL + `convert` | New idea | Typed, composable, matches flow and redux-saga | **Recommended** (owner designs, §9.4) |
| DSL shape (clarified) | `go(...ops)` with `convert`ed plain functions; `pipe` threads functions | Template minus the parser; typed; operations must become descriptions | **Owner's design** (§9.7); open decisions listed there |
| DSL surface | Ramda/RxJS are powerful but steep; CSP's strength is a tiny core | Supported (RxJS maintainer; RxJS 5.5 history); the AI claim is unproven | **`pipe` + limited vocabulary** under consideration; typed template as sugar; statechart rejected (§9.5–9.6) |
| `altFlag` | n/a | Concurrent ops corrupt each other | **Document** the limitation; per-handler flag in alts v2 |

---

## 13. Task list

> **Superseded** by [`2026-10-roadmap.md`](2026-10-roadmap.md), which reorders this list after the CSP pass. Kept for history.

Owner = written by hand by the owner. Claude = scaffolding or sweeping change.

**Phase 0: foundations**
- [ ] Commit or discard the local WIP (`setImmediate`→`setTimeout`, `0.7.0-alpha.2`). Don't keep the broken `sleep`
      hunk (earlier plan §0). *(owner)*
- [ ] Node 22 + Vitest + a reset hook for the global `CSP()` singleton; turn the probes into failing `it.fails`
      tests. *(Claude, scaffolding)*

**Phase 1: professional blockers**
- [ ] **Channels are FIFO and never drop a put**: waiting puts LIFO and lost (C1, C2), buffer stranding, LIFO takers. Top priority after the CSP pass. *(owner)*
- [ ] Choice: exactly one alts arm completes (no double consumption). *(owner)*
- [ ] Loops end when their input channels close (Hoare's distributed termination). *(owner)*
- [ ] Bug 1: remove the `delete` in `flush`, add a get-or-create helper, and replace "missing = finished" checks
      (§4). *(owner)*
- [ ] Bug 2: `setImmediate(() => proc.kill())`; drop the meaningless `if (!this)` guard. *(owner)*
- [ ] Timeouts: `timeout` closes at its deadline; a late take returns `null` (§6). *(owner)*
- [ ] Broadcast: no bypass of a non-empty buffer, deliver to all parked takers on one dispatcher turn, FIFO
      (§5). *(owner)*
- [ ] `MAX_DIRTY` must not drop callback waiters; `reduced` closes the channel; `chan(0)` throws (§10). *(owner)*
- [ ] One dispatcher replacing every `setImmediate`/`setTimeout(0)` (§3). *(Claude, sweeping)*

**Phase 2: the new interaction layer**
- [ ] Settle the open points in §9.4 and the names. *(owner)*
- [ ] `step`/`comp`, the `Op` builders (`take`, `put`, `sleep`, `alts`, `seq`, `loop`, `spawn`, `.map`/`.then`/
      `.into`/`.each`), `Stage` + `chain`. *(owner)*
- [ ] Rebuild `loop` on operations so `sleep` re-arms each iteration (fixes the timeout-in-loop bug). *(owner)*
- [ ] Type tests (`.test-d.ts`) based on `dsl-compose-sketch.ts`. *(Claude, scaffolding)*
- [ ] Decide `pipe` as the main surface and fix the limited vocabulary (§9.6). *(owner)*
- [ ] Typed template as sugar: each `${}` is an operation (§9.5 B). *(owner)*

**Phase 3: later**
- [ ] Per-handler `active`/`commit` flag in place of `altFlag`; alts v2 reporting the winning channel. *(owner)*
- [ ] Per-subscriber read position for broadcast (log + cursors). *(owner)*
- [ ] TS 5/6 + tslib 2; build modernisation (Rollup 4 or tsup, ESM + CJS); remove CRA/React dev dependencies.
      *(Claude, sweeping)*

---

## 14. Open questions

1. Final names for the DSL (§9.4).
2. Does `go()` return a `Proc` with a `done` channel (the core.async composition model)?
3. Keep the tagged template as sugar, or retire it?
4. Broadcast semantics for late subscribers: "present at delivery time" (easy fix), or per-subscriber cursors?
5. Is the local WIP still the starting point, or should Phase 0 recreate it on this branch?

---

## 15. What's needed to explain the leftover timers

The "~440 timers a second after unmount, forever" from the earlier e2e assessment is not explained by anything reproduced
here. Any one of these, in order of preference, would settle it:

1. **Push the old demo's `assessment/2026-showcase` branch** to GitHub, including `docs/assessment-traces/` and
   `e2e/`, plus a **production build** (`PUBLIC_URL=. yarn build` output). This container can't install npm
   packages, but it has Chromium and Playwright, so it can serve a prebuilt `build/` statically, run the unmount
   scenario with a `setTimeout`/`setImmediate` stack sampler, and report the top call stacks.
2. Or attach the existing traces from `docs/assessment-traces/`.
3. Or record a Chrome Performance trace yourself: mount, one drag, unmount, idle 5 s. Export the JSON.

---

## 16. Sources

- core.async (cloned `clojure/core.async`): `src/main/clojure/cljs/core/async/impl/dispatch.cljs`, `channels.cljs`,
  `timers.cljs`, `async.cljs` (`alt-flag`, `mult`); `doc/rationale.md`, `doc/flow.md`, `doc/flow-guide.md`
- Go blog, *Go Concurrency Patterns: Pipelines and cancellation* (`golang/website`
  `_content/blog/pipelines.md`); *Go Concurrency Patterns: Context* (`_content/blog/context.md`)
- [v8.dev: Faster async functions and promises](https://v8.dev/blog/fast-async)
- [MessageChannel usage in React's scheduler](https://dev.to/ramunarasinga-11/messagechannel-usage-in-react-source-code-3771)
- [Chrome: scheduler.yield / postTask](https://developer.chrome.com/blog/use-scheduler-yield?hl=en) ·
  [Yielding to the main thread (Safari support)](https://corewebvitals.io/pagespeed/yield-to-main-thread)
- [setImmediate polyfill (postMessage / MessageChannel)](https://github.com/NobleJS/setImmediate)
- [Effection Channel](https://jsr.io/@effection/effection@4.1.0/doc/~/Channel) ·
  [createChannel](https://jsr.io/@effection/effection@4.1.0/doc/~/createChannel)
- [redux-saga: Declarative Effects](https://redux-saga.js.org/docs/basics/DeclarativeEffects) ·
  [effect types](https://app.unpkg.com/@redux-saga/core@1.5.0/files/types/effects.d.ts)
- [James Long: Taming the Asynchronous Beast with CSP](https://archive.jlongster.com/Taming-the-Asynchronous-Beast-with-CSP-in-JavaScript) ·
  [2ality: CSP vs async generators](https://2ality-com.onrender.com/2017/03/csp-vs-async-generators.html)
- Channel libraries with `for await`/`select`: [@harnyk/chan](https://dev.to/panic_err/implementing-golangs-chan-in-typescript-with-harnykchan-187h),
  [golikejs](https://jsr.io/@okdaichi/golikejs/doc/~/Channel), [f5io/csp](https://github.com/f5io/csp),
  [@blowater/csp](https://jsr.io/@blowater/csp/doc/~/select), [@ggoodman/channels](https://npmjs.com/package/@ggoodman/channels)
- [RxJS: pipeable operators (5.5 rationale)](https://github.com/ReactiveX/rxjs/blob/6.2.2/doc/pipeable-operators.md) ·
  [Ben Lesh on operator count (W3C list, Dec 2023)](https://lists.w3.org/Archives/Public/public-webapps-github/2023Dec/0486.html) ·
  [To RxJS or not to RxJS](https://dev.to/walkingriver/to-rxjs-or-not-to-rxjs-4ao6)
- Go proverbs: [go-proverbs (Pike, Gopherfest 2015)](https://speakerdeck.com/ajstarks/go-proverbs) ·
  METR study coverage: [eWeek](https://eweek.com/news/news-ai-tools-slow-developer-productivity-study)
- TypeScript: [#17956 (TemplateStringsArray caching)](https://github.com/Microsoft/TypeScript/issues/17956),
  [PR #43376 (template literal typing)](https://github.com/microsoft/TypeScript/pull/43376)
