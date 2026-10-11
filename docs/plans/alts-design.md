# alts: correcting `altFlag`, semantics, and dynamic arms (planning doc)

Status: **open for review.** Written 11 Oct 2026. Nothing here is decided. It feeds roadmap Phase 3 and items O1/O5
in [`open-design-decisions.md`](open-design-decisions.md). Evidence from the research is in
[`docs/research/`](../research/).

## 1. How alts works today (summary)

From `go.ts:126-150` and `process.ts:149-201`, measured by `probes/p14_alts.js`:

1. Each arm becomes a put or take event driven by `pseudoSourceSink`, which writes into one shared `winVal`.
2. Every event sets `altFlag = true` **on the channel** (`ch.altFlag`). The same flag also changes how a closed
   channel behaves in `remove()`, `last()`, `flush()` and `createQ().add`.
3. `createAlts` registers every arm on its channel's queue, then yields.
4. On resume the winner is `events.filter(isDone).pop()`, i.e. the **last** finished, and the others get `.return()`.
5. Only the winning value is forwarded, on a fresh channel, to the `?:` callback.

Measured problems: with two ready arms **both values are consumed and one is lost**; the winner isn't the first to
commit; the caller can't tell which arm won; no `default`, no priority, no randomness. And because `altFlag` lives on
the channel, any other operation on that channel (a plain take, a second alts) overwrites it.

## 2. What alts must guarantee (from the sources)

| Property | Source |
|---|---|
| **Exactly one** arm completes; the others "have no effect" | Hoare 1978 (5); Hickey: "_One and only one op will complete_" |
| Choice among ready arms is **arbitrary/fair** by default; an implementation shouldn't pass a ready arm over "unreasonably often" | Hoare 7.6; Go `select` (uniform pseudo-random); tokio `select!` (random first branch) |
| Optional **priority** (try in order) | core.async `:priority`; tokio `biased;`; Kotlin `select` (biased) vs `selectUnbiased` |
| Optional **default** when nothing is ready | Go `default`; core.async `:default`; tokio `else` |
| Report **which arm won** | core.async `alts!` → `[val port]`; Go `reflect.Select` → index |
| A **closed** channel counts as ready, delivering null | Go (receive on closed proceeds with zero value); core.async (`[nil ch]`, which is how `merge` detects closes); Kotlin `onReceiveCatching` |

Correction to earlier notes (roadmap Phase 7 said "a closed arm drops out"): in Go, core.async and Kotlin the
library *delivers* the close (null) and the **user's loop** decides to drop that arm (core.async's `merge`:
`(recur (filterv #(not= c %) cs))`). tokio is the exception: a branch whose pattern doesn't match (`Some(v)` vs `None`)
is disabled for the rest of that call.

## 3. Correcting `altFlag`: options

| Option | How | Verdict |
|---|---|---|
| **A. Per-operation commit flag** | Every queued instruction carries a *handler* `{ active(): boolean; commit(): void }`. A plain put/take gets its own always-active handler. An alts creates **one shared flag** and gives each arm a handler that reads/clears it (core.async `alt-flag` + `alt-handler`). The queue checks `active()` before matching an instruction and calls `commit()` when it does; inactive instructions are skipped and removed by cleanup. | **Recommended.** It's the core.async design; it fixes double consumption and "first to commit wins" by construction; it's also what Phase 2 needs for cancelling a parked take (`done()` called later, kill) and what `MAX_DIRTY` cleanup should test ("remove inactive only"). |
| B. Try-then-park (two phase) | Before parking, try each arm immediately (in random or priority order); if one can complete now, complete it and don't park the others. Only park when none is ready. | **Complement to A**, not a replacement: core.async's `do-alts` does this, and it's how `default` works (nothing ready → default). |
| C. Cancel losers afterwards (AbortController-style) | Let arms run; when one finishes, cancel the rest. | **Insufficient alone:** between the first completion and the cancellations, another arm can complete in the same matching pass (exactly today's bug). |
| D. Keep a channel-level flag, add locking | — | **Rejected:** the flag belongs to the *operation*, not the channel; two alts on one channel can't share it. |

**Implementation sketch for A in this codebase** (for the owner; Phase 3):
- New internal type `Handler` (active/commit), stored on every instruction created in `instructions.ts` and
  `processEvents.ts`.
- `createQ().add` / `flush` / `takeFromChan` / `drainToChan`: skip and drop instructions whose handler is inactive;
  call `commit()` on match.
- `createAlts`: one flag per alts; winner = the arm whose `commit()` succeeded first; losers need no `.return()` race.
- Remove `altFlag` from `IChan`, `instructions.ts:15,68`, `scheduler.ts:12`, `process.ts:193`, and the closed-channel
  branches in `channels.ts` (`remove`/`last`). Closed-channel behaviour becomes uniform (close = ready with null).
- **Broadcast interplay:** when a put is delivered to every parked taker, each taker's handler is checked and
  committed individually. A plain taker always accepts; an alts arm accepts only if its alts hasn't committed yet.
  So a value can reach a plain taker *and* commit one alts, but never two arms of the same alts.

## 4. Dynamic arms: alternatives to `alts(() => arms)`

The need: loop logic decides which channels the next choice listens to (debounce timer present or not, latest
request only, sources joining at runtime, input disabled while a buffer is full, gesture phases).

| # | Approach | Prior art | Example in this DSL | Dynamic power | "No thunks" fit |
|---|---|---|---|---|---|
| A | **Static arms + boolean guards** | Hoare guarded commands; occam `ALT` with guards; Go nil channels; tokio `, if <precondition>` (evaluated on every entry; "re-entering `select!` due to a loop clears the disabled state") | `alts(guard(() => dragging, take(move, sink(f))), …)` | Enable/disable known arms only | Guard is a predicate, not a deferred argument |
| B | **Recomputed arm list** | core.async (`alts!` is a function over a runtime vector; `recur` rebinds it); Go `reflect.Select`; CML/OCaml `guard fn` ("when synchronized, computes `fn()` and behaves as the resulting event") | `alts(() => [take(input, …), ...(timer ? [take(timer, …)] : [])])` | Any set | A function returning arms (closest to a thunk) |
| C | **Builder callback** | Kotlin `select { a.onReceive { … }; b.onReceive { … } }`: the builder runs on every call, so plain `if`/`for` inside it add clauses | `alts(sel => { sel.take(input, …); if (timer) sel.take(timer, …); for (const s of sources) sel.take(s, …) })` | Any set | A callback, but it reads like statements |
| D | **Mutable arm set** | core.async `mix` (`admix`/`unmix` change the set; the loop recomputes it) | `const arms = armSet(take(control, sink(ch => arms.add(take(ch, sink(f))))))`; `loop(alts(arms))` | Add/remove at runtime | No function at all |
| E | **First-class events** (borrow parts) | Concurrent ML / OCaml `Event`: `choose`, `wrap` (post-process), `wrap_abort`/`withNack` (run a function **if this arm is not selected**), `always`, `poll` | `take(replicaA, sink(show)).onLose(() => abortA.abort())` | Composition and loser cleanup | Fits ops-as-descriptions directly |

Notes:
- **Naming clash:** Hoare's/tokio's "guard" is a boolean precondition (A). CML's `guard` is deferred event
  construction (B). If both ideas are adopted, they need different names.
- **tokio's warning applies to A:** "Avoid racy `if` preconditions": a guard that disables a timer arm can make the
  loop miss the timer's completion. Same risk here with `sleep`/`timeout` arms.
- **E's `onLose` (CML `withNack`/`wrap_abort`)** is the missing piece for the showcase: in "first replica wins" or
  latest-wins typeahead, the losing request can be *aborted* (e.g. `AbortController` on `fetch`), not just ignored.
  Ops are already descriptions, so `.onLose(fn)` (or `loses(op, fn)`) is a small addition.
- B and C have the same power; C reads better when arms are conditional or looped, B is shorter when the set is a
  simple expression.

**Possible combination (for discussion, not a recommendation yet):** A for the common case (enable/disable known
arms), C *or* D for computed sets, E's `onLose` for cancellation of losers. B only if the owner prefers it to C.

## 5. Sinks inside alts

Inside `alts`, exactly one arm completes per selection, so an arm's `sink` handles **one value** per pass; `done`
has nothing to end there. Options: (a) ignore `done` inside alts; (b) make `done` end the *enclosing* loop when called
inside alts (which would give the loop-level signal deferred in D3); (c) type-level: alts arms take a plain
`(value) => void` handler instead of a `sink`. Needs a decision.

## 6. Tests this adds (to [`test-strategy.md`](test-strategy.md) §4.3)

- Closed-channel arm: completes with `null` and reports which arm (per §2), or the chosen alternative.
- Guards (A): a disabled arm never consumes; re-entering the alts re-evaluates guards.
- Dynamic set (B/C/D): an arm added in iteration *n* participates from iteration *n+1*; a removed arm never consumes.
- `onLose` (E): called exactly once for every non-selected arm, never for the winner.
- Broadcast interplay: one put reaches a plain taker and commits at most one arm of a given alts.

## 7. Sources

- Hoare 1978, §1 (5) and §7.6; Rich Hickey, core.async talk (Strange Loop 2013); core.async `async.cljs`
  (`alt-flag`, `alt-handler`, `do-alts`, `merge`, `mix`): see `docs/research/2026-10-csp-lens.md`.
- OCaml `Event` module, `otherlibs/systhreads/event.mli` (CML-derived): `choose`, `wrap`, `wrap_abort`, `guard`, `sync`,
  `poll`. [Concurrent ML reference manual](https://web.mit.edu/~firebird/arch/sun4x_59/bin/sml/cml/doc/HTML/cml.html)
  (`guard`, `withNack`); [Princeton CS510 notes on `withNack`](https://www.cs.princeton.edu/courses/archive/fall00/cs510/crxw/guard.html).
- tokio `select!` docs, `tokio/src/macros/select.rs`: preconditions, lifecycle, fairness, `biased;`, "Avoid racy `if`
  preconditions"; [tokio select fairness](https://blog.mmf.moe/post/tokio-select-fairness).
- Kotlin: `docs/topics/select-expression.md` (`onReceive`, `onReceiveCatching`);
  [`select`](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.selects/select.html) (biased to first clause),
  [`selectUnbiased`](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.selects/select-unbiased.html).
- crossbeam `select!` / [`select_biased!`](https://doc.servo.org/crossbeam_channel/macro.select_biased.html).
- Go `runtime/chan_test.go` (`TestSelectFairness`).
