# Plan: automatic typing and channel lifecycle for csp-with-ts

Status: **plan only**. Nothing below has been implemented. Written 2026-10-03 against `master` @ `b745c2f`
plus the uncommitted working tree (package version `0.7.0-alpha.2`).

Evidence levels used below:

- **Confirmed (run):** reproduced by compiling a scratch copy of `src/` (with the WIP `sleep` hunk
  reverted) and running a Node probe against it. The repo was not modified.
- **Confirmed (read):** follows directly from the code; not executed.
- **Suspected:** plausible from reading; needs the listed test to settle it.

---

## 0. First: resolve the uncommitted working tree

`git status` shows eight modified files. Two independent changes are mixed together:

| Change | Files | State |
|---|---|---|
| A. `setImmediate(f, ...)` → `setTimeout(f, 0, ...)` everywhere | channels, instructions, process, processQueue, loops | Compiles. Makes the library browser-safe (`setImmediate` is Node-only). |
| B. `sleep` rewritten as a generator of Promises | `src/impl/processEvents.ts:60-90` | **Fails `tsc`:** `processEvents.ts(77,27): Property 'then' does not exist on type 'void \| Promise<void>'`. |
| C. Version bump to `0.7.0-alpha.2`, `.aider*` in `.gitignore` | package.json, .gitignore | Harmless. |

**Recommendation: revert hunk B and commit A and C on their own.**

Hunk B has more problems than the type error:

- After the first timer fires, `proc.next()` runs the loop again. That sets `isDone = false` and arms a
  **second** `setTimeout` that nobody listens to. Every sleep leaves a stray timer behind and briefly
  flips `isDone` back to `false`. `createProcess`'s "all events done → kill" check reads `isDone`
  (`process.ts:111`, `:141`).
- `Process.kill` "cancels" a sleep by calling it with a no-op callback (`process.ts:68`). With
  hunk B that **starts** a new sleep loop instead of stopping anything.
- A cast such as `(proc.next().value as Promise<void>).then(...)` would make it compile, but it would
  keep both behaviour problems above.

Verified: with only the `sleep` hunk restored to `HEAD` (and its two `setImmediate` calls converted
per change A), `tsc --strict` compiles `src/index.ts` with no errors.

Steps (for a person to run; this plan changes nothing):

1. `git restore -p src/impl/processEvents.ts`. Restore the `sleep` hunk only, then hand-convert its
   `setImmediate(cb, msecs, someCb)` to `setTimeout(cb, msecs, someCb)`. Note that the `HEAD` version
   already uses `setTimeout` for the sleep itself, so this step may be a no-op. Check with `git diff`.
2. Fix the comment at `channels.ts:8-14`. After the replace-all it reads "change all instances of
   setTimeout to setTimeout".
3. Commit A+C as "Replace setImmediate with setTimeout for browser support".
4. A cancellable sleep is redone properly in §3.3. Don't patch it in now.

Note that `setTimeout(fn, 0)` is clamped: at least 1 ms in Node, and 4 ms once nested in browsers.
That makes every hop through the scheduler slower than `setImmediate` was. This is acceptable for UI
work. A later option is a `queueMicrotask`/`MessageChannel` scheduler behind a single `schedule()`
function. `scheduler.ts` is the natural home for it, and today ~20 call sites call `setTimeout`
directly.

---

## 1. Automatic typing for `chan`

### 1.1 What's wrong today

`channels.ts:175`:

```ts
export function chan<T extends IStream, Q extends IStream = T>(
  buf?: number | BufferType<Q extends T ? T : Q>,
  xform?: ITransducer<IChanValue<T>, IChanValue<Q>, BufferType<Q>>,
  exHandler?: Function
): IChan<T> | IChan<T, Q>
```

- The return type is a union. When `Q` is explicit and differs from `T`, the caller gets
  `IChan<T,T> | IChan<T,Q>`, so `takeAsync` yields `T | Q`. This causes the ~39 hand-written
  `as IChan<...>` casts.
- `Q` can never be inferred. Ramda's `R.map(fn)` is typed by `@types/ramda` as a list function, not as
  a transducer, so nothing flows into `ITransducer<…>`.
- `IChanValue<T> = T | IChan<T> | IChan<T, any> | Promise<T> | null` (`interfaces.ts:3`) leaks into
  every public result. `takeAsync<number>` returns `Promise<number | IChan<number> | Promise<number> | null>`.
- `exHandler?: Function` is untyped.

### 1.2 Proposed API

A new module, `src/xf.ts`, exported as `xf`, holds typed transducers that this library owns. They
also carry correct `reduced`/completion semantics; see §4.

```ts
// Phantom-typed transducer: A in, B out. Structurally still a normal transducer,
// so it interoperates with any @@transducer-protocol library.
export interface Transducer<A, B> {
  <R>(rf: IXForm<R, B>): IXForm<R, A>;
  readonly __in?: (a: A) => void;   // phantom, contravariant
  readonly __out?: () => B;         // phantom, covariant
}

export const xf: {
  map<A, B>(f: (a: A) => B): Transducer<A, B>;
  filter<A, S extends A>(p: (a: A) => a is S): Transducer<A, S>;
  filter<A>(p: (a: A) => boolean): Transducer<A, A>;
  remove<A>(p: (a: A) => boolean): Transducer<A, A>;
  take<A>(n: number): Transducer<A, A>;
  takeWhile<A>(p: (a: A) => boolean): Transducer<A, A>;
  drop<A>(n: number): Transducer<A, A>;
  dedupe<A>(eq?: (x: A, y: A) => boolean): Transducer<A, A>;
  mapcat<A, B>(f: (a: A) => Iterable<B>): Transducer<A, B>;
  partitionAll<A>(n: number): Transducer<A, A[]>;           // needs completion (§4.2)
  comp<A, B>(t1: Transducer<A, B>): Transducer<A, B>;
  comp<A, B, C>(t1: Transducer<A, B>, t2: Transducer<B, C>): Transducer<A, C>;
  // … overloads up to 6
  from<A, B>(t: (rf: any) => any): Transducer<A, B>;          // one-time cast for ramda/others
};
```

`chan` becomes a set of overloads with no union:

```ts
type ExHandler<Q> = (err: unknown) => Q | typeof CLOSED;

// 1. no transducer
export function chan<T extends IStream = IStream>(buf?: number | BufferType<T>): IChan<T>;
// 2. typed transducer: both T and Q inferred from it
export function chan<T extends IStream, Q extends IStream>(
  buf: number | BufferType<Q> | undefined,
  xform: Transducer<T, Q>,
  exHandler?: ExHandler<Q>
): IChan<T, Q>;
// 3. legacy: untyped transducer (ramda) with explicit type args. Kept for back-compat.
export function chan<T extends IStream, Q extends IStream = T>(
  buf: number | BufferType<Q> | undefined,
  xform: ITransducer,
  exHandler?: Function
): IChan<T, Q>;
```

Usage:

```ts
const a = chan<number>();                                     // IChan<number>
const b = chan(4, xf.map((n: number) => String(n)));          // IChan<number, string>
const c = chan(4, xf.comp(xf.filter((n: number) => n > 0),
                          xf.map(n => ({ n }))));             // IChan<number, { n: number }>
const d = chan<number, string>(4, R.map(String));             // legacy overload, still compiles
```

Public read results narrow from `IChanValue<Q>` to `Q | null`:

```ts
export function takeAsync<Q extends IStream>(ch: IChan<any, Q>): Promise<Q | null>;
export function putAsync<T extends IStream>(ch: IChan<T, any>, val: T, close?: boolean, cb?: () => void): boolean; // §3.1
```

This narrowing is sound for takers. When a channel is put as a value, `takeFromChan`
(`processQueue.ts:40-61`) forwards the taker into it instead of delivering it, so a taker never
receives a channel.

### 1.3 Trade-offs and decisions

- **Partial type-argument inference doesn't exist in TS.** `chan<number>(4, xf.map(...))` with one
  explicit argument fails overload 2, because both or neither must be given. The fix is to type the
  mapper parameter: `xf.map((n: number) => …)`. Document this.
- **Owning `xf` vs. wrapping ramda.** Wrapping ramda keeps its bugs-for-us: no completion, and
  `take` keeps stepping after it returns `reduced` (§4.1). It also keeps ramda as a de-facto peer
  dependency. Owning ~150 lines of `xf` is cheaper than fighting both. `xf.from` stays as the escape
  hatch.
- **Channels-as-values.** Because channels put as values are spliced, request/reply patterns
  (sending a reply channel) are impossible today. This plan **keeps** that semantic, but the typing
  should not pretend otherwise. `IStream` includes `object`, so `chan<IChan<number>>()` type-checks,
  yet the inner channel will be flattened. Option: a `T extends IChan<any> ? never : T` guard on the
  public `chan` overloads. **Decision for you:** keep the flattening, or make it opt-in.
- **`IChan` exposes internals** (`buffer`, `add`, `remove`, `altFlag`). Splitting it into
  read/write ports is attractive but out of scope. Revisit after 1.0.

### 1.4 Back-compat

| Change | Breaks? |
|---|---|
| `chan` returns `IChan<T,Q>`, not a union | No. Existing `as IChan<…>` casts become redundant but still compile. |
| Legacy `chan<T,Q>(buf, ramdaXf)` | No (overload 3). |
| `takeAsync` returns `Promise<Q \| null>` | Mostly no. Code that annotated the result as `IChanValue<…>` still accepts the narrower type. |
| `exHandler` typed | Only if a handler returns a wrongly typed value. Overload 3 keeps `Function`. |

Consumer migration: no forced change. Remove casts opportunistically.
A grep for `as IChan<` gives the worklist.

---

## 2. A typed alternative to the `go` DSL

The tagged template (`go.ts:19`) can't be typed: `IGoArgs` is a union of every operand kind, and the
template strings carry the semantics. Keep it as-is and add a promise layer beside it:

```ts
export function take<Q extends IStream>(ch: IChan<any, Q>): Promise<Q | null>;          // = typed takeAsync
export function put<T extends IStream>(ch: IChan<T, any>, v: T): Promise<boolean>;      // resolves when accepted; false if closed
export function iterate<Q extends IStream>(ch: IChan<any, Q>, s?: Scope): AsyncIterableIterator<Q>;
export function goLoop<Q extends IStream>(
  ch: IChan<any, Q>,
  body: (v: Q) => void | false | Promise<void | false>,   // return false to stop
  s?: Scope
): () => void;                                          // stop function, same shape as go() returns
```

```ts
for await (const v of iterate(chUsers)) { store.setUsers(v); }   // v: User[]
const stop = goLoop(clicks, e => { … });
```

The internal `put`/`take` in `processEvents.ts` aren't exported publicly, so the public names are
free. Consider renaming the internal ones (`putEvent`/`takeEvent`) to avoid confusion.

Trade-offs:

- **Scheduling.** `await` resumes on the microtask queue, while the engine hops via `setTimeout`.
  Ordering between DSL processes and async loops is not guaranteed relative to each other. That is
  fine for UI work but must be documented.
- **Cancellation.** `for await` with `break` is safe: the next `takeAsync` hasn't been issued yet.
  Cancelling a loop that is waiting on a channel it does not own is not safe. The pending
  `takeAsync` stays queued and swallows one future value. A correct fix needs cancellable handlers,
  which is the same per-handler "active" flag needed for `alts` and `altFlag` (§4.6). Until then,
  `iterate` should document that cancelling while it waits loses one value on a shared channel.
- **A `yield*` generator API** (`spawn(function* () { const v = yield* take(ch) })`, typed via
  delegation as in typed-redux-saga or effection) gives per-step types and synchronous scheduling.
  It's about 2× the effort. Defer it until the promise layer has been used in the consumer app.
- `iterate` needs async generators. With `target: es6` + `importHelpers`, tslib's `__asyncGenerator`
  covers it, but bump `tslib` together with TS (§7).

---

## 3. Lifecycle

### 3.1 `putAsync` on a closed channel

Today (**confirmed, run**): on a closed channel `putAsync` returns `undefined`, **does** fire `cb`, and
drops the value. It doesn't throw, which is good, but callers can't tell that it was dropped.

Proposal: `putAsync(...): boolean` returns `false` synchronously if `ch.closed`, and in that case does
**not** call `cb`. Not breaking: `void` → `boolean`.

Also reject `null`/`undefined` values. `null` is `CLOSED`, so a stray `putAsync(ch, null)` puts a
close marker into the buffer. Strict types already forbid it, so this is a runtime guard (throw a
`TypeError`) for JS callers and `any`-typed values.

### 3.2 Ownership: `scope()`

```ts
export interface Scope {
  chan: typeof chan;                       // creates + tracks
  go: typeof go;                           // runs + tracks the process
  timeout(ms: number): IChan<boolean>;
  goLoop: typeof goLoop;
  own<X extends IChan<any, any> | IProc | (() => void)>(x: X): X;  // adopt external resources/cleanup fns
  child(): Scope;
  close(): void;                           // idempotent: kills procs (children first), closes chans, runs cleanups, cancels sleeps
  readonly closed: boolean;
  onClose(cb: () => void): void;
}
export function scope(): Scope;
```

- Creating through a closed scope throws in dev, which catches use after unmount.
- No `AbortSignal`. It doesn't exist globally on Node 14, the current runtime. With Node ≥ 20 (§7)
  it could be added later as `scope.signal`.
- **Prerequisite:** process kill must actually work (§4.7), and sleep must be cancellable (§3.3).
  Otherwise `scope.close()` can't keep its promise.
- React: `useScope()` (create in `useRef`, `useEffect(() => () => s.close(), [])`) belongs in the
  consumer app, or in a tiny `csp-with-ts-react` package. **Not in core.** Core keeps zero React
  imports. Note that `package.json` still has React/CRA dev dependencies and `test/` is CRA leftovers.
  Remove both in §7.

### 3.3 Cancellable sleep

Replace `sleep` (`processEvents.ts:60`) with a version that keeps the timer id and exposes
`cancel()`. `Process.kill` calls `cancel()` instead of calling the sleep with a no-op callback
(`process.ts:68`). The current HEAD code arms a new timer at that point.

---

## 4. Suspected bugs: verification

| # | Bug | Where | Status | Probe result |
|---|---|---|---|---|
| 4.1 | Early-terminating transducer never closes the channel | `channels.ts:155-158` | **Confirmed (run)** | `chan(5, R.take(2))` after 3 puts: `closed=false, count=3` |
| 4.2 | No transducer completion on close | `channels.ts:145-152` | **Confirmed (read)** | `'@@transducer/result'` is defined in `handleException` but never called |
| 4.3 | `MAX_DIRTY` cleanup discards callback waiters | `processQueue.ts:107-122` | **Confirmed (run)** | 65 `takeAsync` + 65 `putAsync`: 0 resolved with values, 1 resolved with `undefined`, 64 hang forever |
| 4.4 | `FixedBuffer.isFull` uses `===` | `buffers.ts:149-151` | **Confirmed (run)** | `chan(1, R.chain(x=>[x,x]))` after 1 put: `count=2, isFull=false` |
| 4.5 | `chan(0)` builds a broken channel | `channels.ts:177,181` | **Confirmed (run)** | `buffer` is the number `0`; first use throws `this.buffer.count is not a function` |
| 4.6 | Shared mutable `altFlag` | `instructions.ts:15,68`, `scheduler.ts:12`, `process.ts:193` | **Confirmed (read)**; no failing repro yet | see below |
| 4.7 | **New:** nested `Process.kill` is called unbound and throws | `process.ts:63` | **Confirmed (run)** | `setTimeout(proc.kill)` → in Node, `this` is the `Timeout` object → `TypeError: this._events is not iterable` (uncaught, in a timer) |
| 4.8 | **New:** `kill` on a sleeping process arms another sleep | `process.ts:68` | Confirmed (read) | see §3.3 |
| 4.9 | **New, minor:** `RingBuffer` iterator yields nothing when the ring is exactly full (`tail === head`, `length > 0`) | `buffers.ts:28-51` | Suspected | Reachable for `dropping`/`sliding` at capacity. Only matters to code that iterates buffers. |

Details and fixes:

- **4.1** `const closed: boolean = isReduced(step(...)); if (isReduced(closed))`. This calls
  `isReduced(true)`, which is `undefined`. Fix: `const r = step(...); if (isReduced(r)) { this._reduced = true; this.close(); }`,
  and stop stepping once reduced. Ramda's `take` keeps calling the step function, which is why
  `count=3`.
- **4.2** Fix: on `close()`, for an `XChannel`, call `xform['@@transducer/result'](buffer)` once,
  before scheduling the flush. Any values it adds stay takeable, which needs `remove()` to keep
  draining after close (it already does while `count() > 0`). Required by `xf.partitionAll`.
- **4.3** The cleanup predicate `ev.INSTRUCTION !== CALLBACK && !stale` drops **every** callback
  instruction, i.e. every `putAsync`/`takeAsync`, not just inactive ones. Then the `case undefined`
  PUT branch (`processQueue.ts:142-144`) calls every queued instruction with no argument, which is
  how one taker resolves with `undefined`. Also, the threshold counts *all* pending ops, not dirty
  ones. Fix to match core.async: only remove instructions that are inactive (stale generals, and
  callbacks whose handler was cancelled, which needs the per-handler flag from 4.6). Keep the hard
  cap at `MAX_QUEUE_SIZE` (1024) with a thrown error, never a silent drop. Also fix the `case undefined`
  PUT branch to call only sleepers (`event === SLEEP`), not every instruction.
- **4.4** Use `>=`. That is behaviour-visible: expanding transducers will now apply backpressure.
- **4.5** Decision: either implement rendezvous (unbuffered) channels, which means queue work that
  doesn't exist today, or throw `RangeError('chan(0) is not supported; use chan() or chan(n>0)')`
  for `n <= 0`, non-integers and `NaN`. **Recommend throwing now** and treating rendezvous as a later
  feature. Default stays `fixed(1)`.
- **4.6** `altFlag` is one boolean per channel. It is overwritten by whichever instruction touched
  the channel last (`instruction()` line 15, `instructionCallback()` line 68, `queueRecursiveAdd`
  line 12, the alts kill hook). `remove()`, `last()`, `flush()` and `createQ.add`'s closed check all
  branch on it. A plain `takeAsync` on a channel that an `alts` is also waiting on rewrites the flag
  under the alts. Also, `altFlag = false` at `process.ts:165` only reassigns a local parameter. The fix
  is core.async's design: a per-*handler* `{ active: boolean; commit(): void }` object shared by all
  arms of one alts, with no channel-level flag. This is the largest change in the plan, and §2
  cancellation, §4.3 and §5 alts all depend on it.
- **4.7** `setTimeout(() => proc.kill())`. In browsers `this` would be `window` and it throws the same
  way. Every `go` with nested `eval` processes leaks its children on kill. It is the most likely root
  cause of the consumer's "puts after unmount".

---

## 5. Missing primitives, ranked by value ÷ effort

| Rank | Primitive | Value | Effort | Notes |
|---|---|---|---|---|
| 1 | `merge(chs, buf?)` | High | S (1.5h) | Built on `iterate`/`takeAsync`. Closes the output when all inputs close. |
| 2 | `alts` that reports the winning channel, plus `default` | High | L (4–6h after 4.6) | `createAlts` already computes `winner` (`process.ts:161`) but only forwards `winVal.val`. New signature: `alts(ops, { default?: D, priority?: boolean }): Promise<{ value: Q \| null; channel: IChan } \| { value: D; channel: 'default' }>`. A correct "loser doesn't consume" guarantee needs 4.6. Keep the DSL's `?:` working on top. |
| 3 | `mult(ch)` / `tap(m, ch, close?)` / `untap` | High (broadcast store events to several UI consumers) | M (3h) | Needs `put` returning `boolean` to drop closed taps. |
| 4 | `pub(ch, topicFn)` / `sub(p, topic, ch)` | Medium | M (2h on top of mult) | |
| 5 | `pipeline(n, to, xf, from)` | Low–medium for a UI app | M (3h) | Ordering-preserving with N workers. Mostly server-side value. |

---

## 6. Test plan (write before any fix)

### 6.1 Runner

**There is no test runner today.** No Vitest or Jest in `package.json` or `node_modules`, no `test`
script, and `test/` holds create-react-app leftovers (`App.test.tsx`, `setupTests.ts`) that test an app
that isn't here.

The machine runs **Node v14.10.0**. Current Vitest needs Node ≥ 18, and Jest 29 needs ≥ 14.15. So the
runner is blocked on a Node upgrade either way. Recommend:

- Node 22 LTS, pinned via `.nvmrc` and `"engines"`.
- **Vitest**: native TS via esbuild, so it runs regardless of the `tsc` version. It has fake timers,
  which matter for a `setTimeout`-driven scheduler, and `expectTypeOf` plus `vitest --typecheck` for
  type tests.
- Delete `test/` CRA files. Put new tests in `test/*.test.ts` and type tests in `test/types/*.test-d.ts`.
- Mark known-failing tests with `it.fails(...)` so the suite is green. Each bug fix flips one to `it`.
- Reset the global `CSP()` singleton between tests (`service.ts` holds module state). Add a
  test-only `__resetCSP()` export, or use `vi.resetModules()`.

### 6.2 First 15 tests

"Today" = expected result against current code (with §0 applied).

| # | Test | Today |
|---|---|---|
| 1 | `putAsync` then `takeAsync` delivers the value | pass (baseline) |
| 2 | `takeAsync` on a closed empty channel resolves `null` | pass (confirmed) |
| 3 | `chan(2)`: two `putAsync` callbacks fire before any take; the third waits | pass (expected; establishes backpressure baseline) |
| 4 | `chan(0)` / `chan(-1)` / `chan(1.5)` throw `RangeError` at construction | **fail** (TypeError later) |
| 5 | `chan(5, R.take(2))`: after 3 puts, channel is closed and holds exactly 2 values | **fail** (4.1) |
| 6 | Completion: custom `partitionAll(3)` transducer, put 1..4, close → takes `[1,2,3]`, `[4]`, `null` | **fail** (4.2) |
| 7 | `chan(1, mapcat x=>[x,x])`: after one put, `isFull()` is true and the 2nd `putAsync` callback is deferred until a take | **fail** (4.4) |
| 8 | 65 pending `takeAsync` on one channel, then 65 puts → all 65 resolve with 1..65 in order | **fail** (4.3) |
| 9 | 65 pending `putAsync` on a full `chan(1)`, then 66 takes → all values in order, all callbacks fire | **fail** (4.3, PUT branch) |
| 10 | `putAsync` on a closed channel returns `false`, does not call `cb`, leaves `count()` at 0 | **fail** (returns `undefined`, calls `cb`) |
| 11 | Killing a parent process kills nested `eval` children (child `channel.closed === true`); no uncaught error | **fail** (4.7) |
| 12 | Killing a process during `sleep`/`timeout` leaves zero pending timers (`vi.getTimerCount() === 0`) | **fail** (4.8) |
| 13 | `alts` over two channels where only one has a value delivers that value; the other channel's later value isn't consumed | probably **fail** (4.6). If it passes, keep it as a regression test. |
| 14 | `loopFor(3)` over a `<!` take runs the body exactly 3 times then its channel closes | unknown (characterization test for the DSL, so the typed layer can't regress it) |
| 15 | Type test (`.test-d.ts`): `chan<number>()` is exactly `IChan<number>`; `chan(1, xf.map((n: number) => String(n)))` is `IChan<number, string>`; `takeAsync` of that is `Promise<string \| null>` | **fail** (union return; `xf` doesn't exist) |

Tests 8–9 need fake timers or generous real waits. The scheduler hops through `setTimeout(…, 0)`
repeatedly, so prefer `vi.useFakeTimers()` + `await vi.runAllTimersAsync()`.

---

## 7. Toolchain: before or after?

Current: TypeScript 3.8.3, Rollup 2 + `rollup-plugin-typescript2` 0.26 + `@tscc` (Closure) 0.4,
tslib 1.11, ESLint 6 with `react-app` config, Node 14.10.

**Before the feature work**, as a prerequisite:

1. Node 22 + Vitest (§6.1). Required to have tests at all.
2. TypeScript 5.x + tslib 2. Needed for the typing work: better overload resolution and inference,
   `NoInfer` (5.4) for the `chan` overloads, and `expectTypeOf` in Vitest needing TS ≥ 4.x. Expect
   some fallout in the heavily conditional types (`process.ts:19-22`, `:128`). Budget for it. Verify
   that `@types/ramda` 0.26 still compiles under TS 5, or bump it, since it's only used for overload 3
   of `chan`.

**After the feature work, before publishing:**

3. Build: replace Rollup 2 + rpt2 0.26 + tscc with something maintained (Rollup 4 +
   `@rollup/plugin-typescript`, or `tsup`). The build may break as soon as TS 5 is installed, since
   rpt2 0.26 is passed `require('typescript')`. That's acceptable while nothing is published. Emit
   ESM + CJS + `.d.ts`, and add an `"exports"` map.
4. Remove CRA/React dev dependencies and the ESLint 6 `react-app` config.

---

## 8. Effort and order (≈4-hour weekend sessions)

| Item | Estimate |
|---|---|
| §0 resolve WIP | 0.5h |
| Node 22 + Vitest + CSP reset hook | 1h |
| 15 tests | 2.5h |
| TS 5 + tslib 2 + fallout | 1–3h (uncertain) |
| 4.5 chan(0), 4.4 isFull, 4.1 reduced, 4.7 kill binding | 2h total |
| 4.2 completion | 1.5h |
| 4.3 MAX_DIRTY + `case undefined` PUT branch | 2–3h |
| 3.3 cancellable sleep, 3.1 putAsync boolean/null guard | 1.5h |
| 1 typed `chan` + `xf` | 3–4h |
| 2 `take`/`put`/`iterate`/`goLoop` | 2–3h |
| 3.2 `scope()` | 2–3h |
| 4.6 per-handler commit flag (replaces `altFlag`) | 4–8h (highest risk) |
| 5 merge / alts v2 / mult+tap / pub+sub / pipeline | 1.5 / 4–6 / 3 / 2 / 3h |
| 7 build modernisation | 2–4h |

Suggested sessions:

1. **Foundations:** §0, Node + Vitest, the 15 tests (all red ones as `it.fails`).
2. **TS 5 + cheap bugs:** TS upgrade, 4.5, 4.4, 4.1, 4.7. Flip tests 4, 5, 7, 11.
3. **Queue correctness:** 4.2, 4.3, 3.3, 3.1. Flip tests 6, 8, 9, 10, 12. Cut `0.7.0-alpha.3`
   (pre-1.0, so behavioural fixes are a minor bump).
4. **Typing:** typed `chan` + `xf` + `takeAsync` narrowing. Flip test 15. Try it on 2–3 consumer
   files to validate before going further.
5. **Typed async layer + lifecycle:** `take`/`put`/`iterate`/`goLoop`, `scope()`, `merge`. Consumer
   adds `useScope()` locally.
6. **(and maybe 7) `altFlag` → per-handler commit**, then alts v2 with winner/default. Flip test 13.
   This is the risky one, so keep it isolated on a branch.
7. **mult/tap, pub/sub** (pipeline only if the showcase needs it).
8. **Build modernisation + publish `0.7.0`.**

Sessions 1–5 deliver most of what the consumer asked for: no casts, typed loops, no leaks on unmount.
None of them depend on the risky session 6.

---

## Summary

- **Fix first:** revert the WIP `sleep` hunk. It fails `tsc`, leaves a stray timer per sleep, and
  makes `kill` start sleeps. Commit the `setImmediate`→`setTimeout` swap separately. With that
  revert, `tsc` passes.
- **Typing:** replace the union-returning `chan` with three overloads, add a library-owned, typed
  `xf` transducer module so `Q` is inferred, and narrow public results to `Q | null`. Fully
  backward-compatible. Casts become redundant, not wrong.
- **Typed `go` alternative:** promise-based `take`/`put`/`iterate`/`goLoop` beside the DSL. Cancelling
  a pending take on a shared channel loses one value until per-handler cancellation exists.
- **Lifecycle:** `putAsync` returns `boolean` and is a no-op on closed channels; add a `scope()`
  owner with a cancellable `sleep`. React hooks stay out of core.
- **Bugs:** four suspects confirmed by running a probe (reduced/close, isFull, MAX_DIRTY dropping
  waiters, chan(0)), and the other two by reading (no completion on close, shared `altFlag`). New:
  nested `kill` is invoked unbound and throws, so child processes leak. That is the likely source of
  the consumer's leaks.
- **Primitives:** merge > alts v2 (winner + default) > mult/tap > pub/sub > pipeline. Alts v2 depends
  on replacing `altFlag` with per-handler commit, the riskiest item.
- **Tests:** there is no runner and Node 14.10 is too old for both Vitest and Jest. Upgrade Node,
  add Vitest, write 15 tests: 3 baseline passes, 10 expected failures, 1 probable failure, 1 unknown.
- **Toolchain:** Node + Vitest + TS 5 before the work; build modernisation after, before publishing.
- **Order:** 8 sessions of about 4 hours; sessions 1–5 cover the consumer's needs without the risky
  `altFlag` rewrite.
