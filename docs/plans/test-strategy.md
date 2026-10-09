# Test strategy (planning doc)

Status: **plan only.** Written 9 Oct 2026. It defines how every change in
[`docs/research/2026-10-roadmap.md`](../research/2026-10-roadmap.md) is preceded by tests that describe both the
correct behaviour and the wrong behaviour it replaces, and how performance and memory are kept from regressing.

## 1. Approach: characterise what exists, specify what changes

The library already exists, so a pure test-first or behaviour-driven process doesn't fit as a description. The
combination that does fit:

1. **Characterisation tests** (Michael Feathers, *Working Effectively with Legacy Code*) pin what the code does
   *today*, including behaviour that will be kept: broadcast to parked takers, channel splicing, `putAsync` firing
   its callback on a closed channel, generator sinks. Feathers' recipe: write an assertion you expect to fail, let the
   failure show the actual behaviour, then record it. These tests protect the things the owner wants to keep
   while the internals are rewritten. Characterisation also captures bugs, so each captured bug is labelled and
   paired with a specification test.
2. **Specification tests** describe the intended behaviour *before* the code changes: each roadmap acceptance test,
   and each decided item in [`open-design-decisions.md`](open-design-decisions.md). Every spec comes in pairs: what
   must happen, and what must not happen (the bug it replaces, or the misuse it rejects). A spec that the current code
   fails is written as `it.fails(...)`, so the suite stays green; the fix flips it to `it(...)`. A characterisation
   test that pinned the old wrong behaviour is deleted in the same commit.
3. **Property-based and model-based tests** check invariants over many generated sequences of operations, which
   is where the channel-queue bugs live (LIFO, lost puts, double consumption only show up under specific orderings).
4. **Performance and memory tests** guard the scheduler and queue rewrites (§6).

Test names read as specifications, grouped by CSP concept and citing the rule where there is one:

```ts
describe('channel: FIFO (Hoare 1985 BUFFER "behaves like a queue"; Go TestChan)', () => {
  it('delivers waiting puts to sequential takers in put order', …);
  it.fails('never drops a waiting put (today: second put lost, p17b)', …);   // flips in Phase 1
});
```

## 2. What the codebase needs to be testable

| Need | Why | Change |
|---|---|---|
| **Isolated global state** | `CSP()` is a module-level singleton; tests would leak queues into each other | Test-only reset hook, or `vi.resetModules()` per file |
| **A controllable scheduler** | Hops go through `setImmediate`/`setTimeout` directly, so ordering can't be controlled or replayed | The Phase 4 `dispatch(fn)` takes an injectable driver. Tests install (a) a manual driver (`step()`, `drainAll()`), and (b) a seeded random driver that permutes ready tasks, to explore interleavings reproducibly. Until Phase 4, Vitest fake timers fake `setTimeout`/`setImmediate` |
| **Observability** | Perf and leak tests need counts, not just timings | A debug hook reporting dispatches, parked handlers per channel, and live processes. The same hook can later drive a channel inspector |
| **Unhandled errors fail tests** | Bug 2 throws inside a timer, which a test can miss | Vitest's default (unhandled errors fail the run): keep it on |
| **GC access** | Leak tests need deterministic collection | Run the memory suite with `--expose-gc` (`poolOptions.forks.execArgv`) |

## 3. Tooling

- **Runner:** Vitest on Node 22. Native TypeScript (esbuild), fake timers, `it.fails`, type tests, and `bench`.
- **Property-based:** fast-check. `fc.commands` for model-based tests; `fc.scheduler` to control the order in which
  promises resolve (useful for `takeAsync`/`putAsync` interleavings).
- **Type tests:** `*.test-d.ts` with `expectTypeOf` and `// @ts-expect-error`. The DSL sketches in
  `docs/research/probes/dsl-*-sketch.ts` already have this shape: valid code plus planted mistakes.
- **Browser:** Playwright with the preinstalled Chromium, for latency in a real event loop
  (`probes/bench*.js` are the starting point).
- **Note:** npm isn't reachable from the cloud container used for the research, so the suite is set up locally or
  after network access is enabled.

## 4. Test catalogue

IDs map to the roadmap's acceptance tests (A1–A7) and phases. "Today" is the expected result on `master`.

### 4.1 Channel core (Phase 1, acceptance A1, A2)

| ID | Spec (must) | And must not | Today | Kind |
|---|---|---|---|---|
| C1 | Waiting puts are delivered in put order | Reorder (LIFO) or drop the second put | ❌ `p17b` | spec + model |
| C2 | Parked takers are served in park order | Serve LIFO | ❌ `p1` | spec |
| C3 | A put never bypasses a non-empty buffer | Strand a buffered value while newer ones pass | ❌ `p13` | spec + model |
| C4 | Up to 1,024 waiting operations are kept | Silently drop any of them (`MAX_DIRTY`) | ❌ `p17` | spec |
| C5 | The 1,025th waiting operation throws a clear error (core.async `queue-limits`) | Accept and drop | ❌ | spec |
| C6 | `fixed(n)`: puts wait when full; `dropping(n)` keeps the first n; `sliding(n)` the last n | Block on dropping/sliding | ✅ `p16`, `p18` | characterisation |
| C7 | Closing wakes every parked taker with `null`; buffered values stay takeable first | Lose buffered values on close | ✅ partly | spec |
| C8 | A put on a closed channel reports `false` *(if O2 is adopted)* and leaves the channel empty | Put a value into a closed channel | ⚠️ callback fires (characterise) | char → spec |
| C9 | `null`/`undefined` puts throw (null is CLOSED) | Insert a close marker | ❌ | spec |
| C10 | Transducer `reduced` closes the channel; `@@transducer/result` runs on close | Keep accepting after `take(n)`; lose a partition's tail | ❌ | spec |
| C11 | `FixedBuffer.isFull` is true at `count >= n` (expanding transducers apply backpressure) | Report not-full after overflow | ❌ | spec |
| C12 | `chan(0)` / negative / non-integer sizes throw until Phase 5 | Build a broken channel | ❌ | spec |
| C13 | Splicing: an open inner channel's values arrive in order before the outer's next value | — | ✅ `p15` | characterisation |
| C14 | Splicing: an already-closed inner channel's buffered values are delivered | Lose them; give takers `null` while the outer is open | ❌ `p15` | spec |
| C15 | Bug 1: no `reading 'add'` crash with events 0–4 ms apart; every value delivered | Crash; lose values | ❌ `p5` | spec (fake timers + real timers) |

**Model-based test (the main guard for the Phase 1 rewrite).** A reference model is a plain array queue plus the
buffer policy (fixed/dropping/sliding of size n). fast-check generates random command sequences (`putAsync(v)`,
`takeAsync()`, `close()`, `tick()`) and runs them on both the model and the real channel through the controllable
scheduler. After each step it checks: same delivered sequence (FIFO, no loss, no duplication), same buffer
count, same closed state. Shrinking turns any failure into a minimal sequence, like the ones the probes found by hand.

### 4.2 Lifecycle (Phase 2, acceptance A4, A5, A7)

| ID | Spec (must) | And must not | Today |
|---|---|---|---|
| L1 | Killing a parent kills its children; no uncaught error | Throw `this._events is not iterable`; children keep consuming | ❌ `p3` |
| L2 | After kill, no timers or dispatches remain (`vi.getTimerCount() === 0`, debug hook) | Leave a sleep armed or a loop running | ❌ |
| L3 | A loop ends when a channel it takes from closes (D3) | Stall silently | ❌ `p3` |
| L4 | `timeout(ms)` closes at its deadline whether or not anyone waits; a late take gets `null` | Stay open; make a late taker wait again | ❌ `p11` |
| L5 | `sleep` inside a loop waits on every iteration | Fire once, then stall | ❌ `p4` |
| L6 | A sink calling `done()` synchronously ends its take; the next value isn't consumed | Swallow a value | new (D2) |
| L7 | A process body that throws follows the error policy (O6) | Surface as an uncaught timer error | open |

### 4.3 Choice (Phase 3, acceptance A3)

| ID | Spec (must) | And must not | Today |
|---|---|---|---|
| A1 | Exactly one arm completes; with two ready arms the other value stays in its channel | Consume both and lose one | ❌ `p14` |
| A2 | The first arm to commit wins | Pick the last finished | ❌ |
| A3 | Random choice is fair: over 10,000 trials with two always-ready arms, the split is within 10σ of 50/50 (Go `TestSelectFairness`) | Fixed order | ❌ |
| A4 | `priority: true` picks the first ready arm in order; `default` runs when none is ready | — | missing |
| A5 | The result identifies the winning arm | Return only the value | ❌ |
| A6 | 1,024 alts with `default` don't exhaust a channel's queue (core.async `cleanup`) | Leak parked alt handlers | unknown |
| A7 | An alts arm and a plain take on the same channel: behaviour follows the broadcast decision (O4) | — | characterise (`p14`: both get the value) |

### 4.4 Rendezvous, broadcast, DSL (Phases 5–7)

- **R1–R3 (rendezvous):** a put on an unbuffered channel completes only when a taker takes it; a take waits for a
  put; both directions work inside alts. Written once O3 is decided.
- **B1–B4 (broadcast):** characterise today's behaviour (`p1`, `p1b`), then spec the chosen model (O4): which takers
  receive a value, delivery order, buffered values, late subscribers.
- **D1–D6 (DSL):** `take(ch, sink(fn))` consumes until `done()` or close; bare `take(ch)` waits for one value;
  `put(ch, source(fn))` is backpressured and transduced; one operation list runs independently in two `go` blocks;
  the template sugar parses into the same operations; and type tests: the planted mistakes in
  `dsl-sink-source-sketch.ts` become `@ts-expect-error` cases.

### 4.5 Characterisation set (things that must keep working)

Broadcast to parked takers (until O4 changes it deliberately); splicing order (C13); dropping/sliding policies (C6);
`takeAsync` resolving `null` on close; `putAsync`'s close flag; `loopFor(n)` running exactly n times; all existing
template forms parsing (`<!`, `>!`, `?:`, `eval`, `;`). Each is a test before the Phase 1 rewrite starts.

## 5. Determinism rules (avoiding flaky tests)

- Prefer the manual scheduler driver or fake timers to real waits. Use real timers only in the dedicated timing
  tests (C15, L4) and the browser suite.
- Seed every randomised test, and print the seed on failure so it can be replayed.
- Statistical tests (A3) use wide bounds (10σ, as Go does).

## 6. Performance and memory

### 6.1 What to guard, and the current baselines

Measured during the research (`docs/research/probes/`), on `master`:

| Metric | Baseline | Source |
|---|---|---|
| Put→handler latency, Chromium, 3-stage go pipeline | ~0.1 ms median, ~0.2 ms p95 | `bench2.js` |
| Put→handler latency, Chromium, `loop` | ~0.1 ms median, ~0.2–0.3 ms p95 | `bench3.js` |
| `takeAsync`/`putAsync` round trip, Node | ~36 µs | `p2_pingpong.js` |
| Scheduler hops per value: go sink / `loop` / `loop` + alts / round trip | 1 / 7 / 14 / 4 | `p12.js`, `p2_pingpong.js` |
| Retained memory per parked consumer (suspended generator) | ~537 B | `mem.js` |
| Channels collected after drop (all five cases) | 100% | `p7.js` |

### 6.2 Three kinds of performance test

1. **Deterministic counts (run in CI on every change).** Using the debug hook: dispatches per value for each
   consumer style, parked handlers after N operations, live processes after kill. These numbers are exact, so they
   can be asserted with fixed budgets (e.g. "`loop` uses ≤ 3 dispatches per value after Phase 4"). This is the
   primary regression guard, because timings are noisy on shared CI machines (CodSpeed's write-up on `vitest bench`
   reports that repeated runs on the same CI runner give different results).
2. **Timing benchmarks (A/B, same run).** `vitest bench` (tinybench) scenarios: ping-pong, fan-in from N
   producers, a 3-stage pipeline, `loop` + alts, put→handler latency. To compare against a baseline, bench the
   `master` build and the change in the **same process and run, interleaved**, and fail if the change is slower than
   the baseline by more than a threshold (e.g. 10% on the median of 10 rounds). This is how the research compared the
   `setImmediate` and `setTimeout` builds. For CI history, CodSpeed's Vitest plugin is an option (its CPU-simulation
   mode is designed for low variance). Check its Vitest-version support before adopting it.
3. **Memory and leaks (with `--expose-gc`).**
   - Retained bytes per channel, per parked consumer and per process: heap delta over 10,000 instances, median of
     runs, with a budget relative to the baseline.
   - Leak tests: run N create → use → close/kill cycles and assert the heap slope is about zero after warm-up.
     Use `FinalizationRegistry` to assert dropped channels and processes are collected (as `p7.js` does).
   - After kill: zero timers, zero parked handlers (debug hook).

### 6.3 Browser latency

A Playwright suite in Chromium (from `probes/bench*.js`): put→handler latency p50/p95 for the pipeline, `loop` and
alts scenarios, comparing the two builds in one page load. Run it before and after Phase 4 (scheduler) and Phase 1
(queue rewrite), not on every commit.

### 6.4 Budgets

Set after Phase 0 from the baselines above. Proposed starting rules:
- Latency p50/p95 not worse than baseline + 10% (A/B).
- Dispatches per value: never higher than baseline; Phase 4 should lower `loop` and alts.
- Retained memory per parked consumer: not worse than baseline + 10%.
- Leak tests: zero growth.

## 7. Order of work

1. **Phase 0 (Claude):** Vitest + fast-check + type tests; reset hook; fake-timer setup; the characterisation set
   (§4.5); all specs in §4.1–4.3 as `it.fails`; the deterministic count tests and the memory tests, recording
   baselines.
2. **Before Phase 1 starts:** the model-based queue test (§4.1) exists and fails on `master`.
3. **Before Phase 4 starts:** the A/B timing harness and the browser latency suite exist.
4. Each decided item in `open-design-decisions.md` gets its specs written before its code.

## 8. Sources

- core.async CLJS tests: `src/test/cljs/cljs/core/async/tests.cljs` (`queue-limits`, `cleanup`, `dispatch-bugs`,
  `test-promise-chan`, `test-transducers`), `buffer_tests.cljs`, `timers_test.cljs`.
- Go runtime: `src/runtime/chan_test.go` (`TestChan` across capacities, `TestSelectFairness` with a 10σ bound,
  `TestMultiConsumer`, `TestSelfSelect`, and benchmarks `BenchmarkChanProdCons*`, `BenchmarkSelect*`).
- [fast-check: race conditions and `fc.scheduler`](https://fast-check.dev/docs/advanced/race-conditions/);
  [time-queues cookbook: testing race conditions with fast-check](https://github.com/uhop/time-queues/wiki/Cookbook:-Testing-race-conditions)
- [Characterization test (Wikipedia)](https://en.wikipedia.org/wiki/Characterization_test);
  [ploeh: empirical characterization testing](https://blog.ploeh.dk/2025/11/03/empirical-characterization-testing/)
- [CodSpeed: tracking performance regressions with `vitest bench`](https://codspeed.io/blog/vitest-bench-performance-regressions)
- Hoare 1985, Go spec and docs, core.async rationale: see `docs/research/2026-10-csp-lens.md`.
