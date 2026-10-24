# Decision workbook

Written 2026-10-25 by the cloud session. This is the one place to record open decisions. Each item has the
question, enough context to answer it without opening anything else, the options with their sources, a
recommendation, and what the answer unblocks. Write your answer on the **Answer:** line. Short answers are fine
("rec", "B", "later", or a sentence). The next Claude session reads the answers and turns them into specs, plans and
doc updates.

Where sources live:
- **[branch]**: this branch, `claude/testability-and-dispatcher`.
- **[research]**: branch `research/csp-inspection`. To read it locally:
  `git worktree add ../csp-research origin/research/csp-inspection`.

Item IDs start with `W-` so they don't clash with decision IDs D1-D10 and O1-O6 in `open-design-decisions.md`,
or with spec IDs. A recommendation is only a suggestion. Items marked **(blocks)** stop specific work until answered. Everything else
can wait.

## How to read this in under an hour

1. Section P (Phase 1 questions), 10 minutes. Answer what you can; none of it blocks starting Phase 1.
2. Section S (channel semantics), 20 minutes. These shape the specs for Phases 1-6.
3. Section A (alts), 20 minutes. Needed before Phase 3.
4. Sections D and R when you get to Phase 7 or release.

---

## P. Phase 1 questions (from `docs/plans/phase-1-plan.md` section 5 [branch])

### W-P1. C16: may user generator code run before the channel has room?
Today a put step on a full `fixed(1)` channel deadlocks when the same process takes from that channel next (C16).
The fix asks the source generator for its next value before waiting for room. That means the code between two
`yield`s in a put generator runs earlier than it does today.
- **A.** Accept it. One rule: the source is asked first, and the put waits holding the value.
- **B.** Keep today's timing for multi-yield generators, and add a fast path only for single-yield `>!` steps.
- **Recommendation: A.** Go and core.async evaluate the value before the send blocks, so A is the standard model and
  one code path. B keeps a special case alive.
- **Unblocks:** C16 fix (Phase 1 step 2).

**Answer:**

### W-P2. R1-R3 written against `chan(0)`. See W-S1.
**Answer:** (see W-S1)

### W-P3. Non-blocking alts (`default`) in the template syntax. See W-A4.
**Answer:** (see W-A4)

### W-P4. Closed alts arm. See W-A2.
**Answer:** (see W-A2)

### W-P5. Close with waiting puts (C17). See W-S3.
**Answer:** (see W-S3)

### W-P6. Playwright browser latency page in T6?
The throughput harness runs in Node only. A browser page would measure MessageChannel latency where it is the default.
- **Recommendation:** later, as part of the showcase app, which runs in a browser anyway.

**Answer:**

---

## S. Channel semantics

### W-S1. Rendezvous channels and the default channel (O3) (blocks R1-R3)
Hoare's and Go's basic channel is unbuffered: a put completes only when a taker takes it. Here `chan()` means
`fixed(1)`, and since T8 `chan(0)` throws (C12). R1-R3 currently fail on that size check, not on missing behaviour.
- **A.** `chan()` becomes unbuffered (Go, core.async). Breaking, and *silent*: existing code still compiles but
  behaves differently.
- **B.** Keep `chan()` as `fixed(1)`. `chan(0)` becomes the rendezvous channel; C12 then rejects only negative and
  non-integer sizes.
- **C.** A separate constructor (`rendezvous()` or `chan.sync()`), so `chan(0)` keeps throwing.
- **Recommendation: B.** It matches Go's spelling (`make(chan T, 0)`), avoids a silent behaviour change in code
  already using `chan()`, and changes R1-R3 and C12 by one line each. A could follow in a later major, with a lint or
  codemod.
- **Also decide:** how broadcast (W-S2) works on a rendezvous channel: does a put complete when one parked taker takes
  it, or all of them?
- **Unblocks:** R1-R3 rewritten to fail on behaviour; Phase 5.

**Answer:**

### W-S2. Broadcast, one-taker delivery, `mult`/`tap`/pub-sub (O4; you lean towards needing one-taker)
Today one put reaches every parked taker (K1, decided to keep in D5). Go and core.async give each value to exactly
one taker, and broadcast through `mult`/`tap`. Work queues and worker pools need one-taker delivery.
- **A.** Keep broadcast as the default, made deterministic ("every taker parked at the delivery turn gets the value",
  FIFO). Add one-taker delivery as a mode chosen when the channel is created, e.g. `chan(n, { deliver: 'one' })`.
- **B.** Keep broadcast as the default. Add a separate one-taker constructor (`queue(n)`).
- **C.** Make one-taker the default (Go, core.async). Broadcast moves to an explicit `mult(ch)` with `tap`/`untap`
  (Hoare 1985 §7.7). Breaking, and silent for code that relies on broadcast.
- **D.** Registered membership: a broadcast channel whose put completes when every member has taken
  (Hoare-style), or with a buffer per member (Kahn-style).
- **Recommendation: A.** It keeps D5 and existing code, and makes the choice visible at the channel's creation.
  `mult`/`tap` and `pub`/`sub` then become library helpers built on one-taker channels (gap list D3, D5). C is the
  most standard, but its breakage is silent.
- **Unblocks:** Phase 6 specs (B1-B4); gap list A6, D3, D5; the M1 model test (it currently avoids parked takers
  because of broadcast).

**Answer:**

### W-S3. Closing a channel while puts are waiting (C17) (blocks C17)
A `fixed(1)` channel holds one value and has two more puts waiting; then it closes. Today `flush` calls the waiting
puts' callbacks and drops their values (`processQueue.ts:282-287`).
- **A.** Waiting puts are still delivered to later takers, in order; only new puts are refused. This is my
  recollection of core.async, not yet checked against its source; the cloud container can't reach GitHub, so the
  next local session should check `clojure/core/async/impl/channels.clj` (`close!`, `take!`).
- **B.** Waiting puts are dropped, and their callbacks are told the put failed (`false`).
- **Recommendation: A**, if the source check confirms it: no value that a put has handed over is lost.
  Either way, tell the callback whether the value was delivered (see W-S4).
- **Unblocks:** C17 spec; part of Phase 1/2 closing behaviour.

**Answer:**

### W-S4. What a put reports (O2, first part; gap list A7, E2)
A put on a closed channel today drops the value and calls the callback, which can't tell it failed (K7).
- **A.** The put callback receives `true` (accepted) or `false` (channel closed). `putAsync` also returns a promise
  of that boolean. In the new DSL, `put` reports the same boolean. This matches core.async's `>!`.
- **B.** Throw on a put to a closed channel (Go panics).
- **C.** Keep as is.
- **Recommendation: A.** Non-breaking for callbacks that ignore their argument, and it enables
  `pipe`-style loops (W-S7).

**Answer:**

### W-S5. Error policy (O6)
When a sink, source, transducer or generator step throws, today the error either escapes the dispatcher or is
swallowed, depending on where it happens.
- **A.** Close the affected channel and call the channel's `exHandler` if one was given (core.async: prints and
  closes).
- **B.** Put an `Error` value on the channel.
- **C.** Rethrow to whoever called `go`.
- **D.** A + a global `configure({ onError })`, defaulting to rethrowing asynchronously so errors stay visible.
- **Recommendation: D.** Errors are never silent, the default matches core.async, and apps can route errors
  centrally. B mixes errors with data, and C is impossible once the caller has returned.

**Answer:**

### W-S6. Channel splicing: default or opt-in? (O5; conflicts with D5)
Putting a channel onto a channel splices its values in (K2, C14). D5 (8 Oct) says keep it. Your local Claude memory
lists "keep or opt-in" as open, and O5 lists it too.
- **A.** Keep it as the default (D5).
- **B.** Opt-in, e.g. `put(ch, splice(inner))`. Plain channel values are then delivered as values, as in Go and
  core.async; request/reply (K14) already wraps the reply channel in an object for this reason.
- **Recommendation: A for this major** (C14 is in Phase 1, and code may rely on splicing). Revisit B with the new DSL,
  where `splice(...)` would read naturally.

**Answer:**

### W-S7. Does a loop end when a channel it *puts to* closes? (O2, second part)
D3 says a loop ends when a channel it takes from closes. The mirror case is core.async's `pipe`,
`(when (>! to v) (recur))`.
- **Recommendation: yes**, once S4 makes the closed-put result visible. Unblocks an L-spec (L10) and the `pipe`
  helper.

**Answer:**

---

## A. alts (source: `docs/plans/alts-design.md` [research])

### W-A1. Fixing `altFlag` (alts-design section 3)
Today the flag lives on the channel. With two ready arms both values are consumed (A1 spec), and a losing arm stays
parked and steals a later value (A4, A6).
- **A.** A per-operation commit flag (core.async `alt-flag`/`alt-handler`). Every queued operation has a handler
  `{ active, commit }`; one alts shares a single flag across its arms. Fixes double consumption by construction.
- **B.** Try-then-park: try each arm immediately and park only if none is ready. Complements A, and is how `default`
  works.
- **C.** Cancel losers afterwards. Not enough on its own: that is today's race.
- **Recommendation: A + B** (the doc's recommendation). A also gives Phase 2 cancellation and "remove inactive only"
  for `MAX_DIRTY`.

**Answer:**

### W-A2. A closed channel in an alts arm (O1 sub-question; Phase 1 plan question 3)
- **A.** The arm is ready and delivers `null`, with the channel, so the caller's loop drops that arm (Go,
  core.async, Kotlin; how core.async's `merge` works).
- **B.** The arm is disabled for that selection (tokio).
- **Recommendation: A.** It is the CSP and core.async convention, and needs W-A5's winner reporting so the loop knows
  which arm closed.

**Answer:**

### W-A3. Fairness and priority
- **Recommendation:** uniformly random choice among ready arms by default (Go `select`; A3 spec, 10-sigma test);
  `priority` as an opt-in that tries arms in order (core.async `:priority`, tokio `biased;`).

**Answer:**

### W-A4. Non-blocking choice (`default`)
Go `select { default: }`, core.async `:default`. The template syntax `?: ${[a, b]} ${handler}` has no slot for options.
- **A.** Add it to the template, e.g. a third interpolation `?: ${[a, b]} ${handler} ${{ default: v }}`.
- **B.** New DSL only, e.g. `alts([...], { default: v })`.
- **Recommendation: B**, since the template DSL is being replaced (W-D1). Keeps the template parser unchanged.

**Answer:**

### W-A5. What the alts handler receives (winner reporting)
- **A.** `(value, ch)`: a second argument with the winning channel. Existing handlers `(v) => ...` keep working.
- **B.** `{ value, ch }`, like core.async's `[val port]`. Breaking for existing handlers.
- **C.** Per-arm handlers only (Go `select`, core.async `alt!`), so each arm's own sink gets its value.
- **Recommendation: A** in the template DSL now (non-breaking); per-arm handlers (C) in the new DSL, where arms are
  `take(ch, sink(f))` already.

**Answer:**

### W-A6. Dynamic arms (O1; alts-design section 4). You asked to keep this open.
The need: loop logic changes which channels the next choice listens to (debounce, latest-wins typeahead, sources
joining at runtime).
- **A.** Static arms plus boolean guards: `guard(() => cond, op)` (Hoare, Go nil channels, tokio `if`).
- **B.** Recomputed list: `alts(() => [...])` (core.async `recur`, CML `guard`).
- **C.** Builder callback: `alts(sel => { sel.take(...); if (timer) sel.take(...) })` (Kotlin `select`).
- **D.** Mutable arm set: `armSet(...)` with add/remove (core.async `mix`).
- **E.** `onLose(fn)`: run a function when an arm is not selected, e.g. abort a losing `fetch` (CML `withNack`).
- **Recommendation (for later):** A + E first (smallest, and covers debounce and aborting losers), then C if
  computed sets are needed. Not required before Phase 3's core fixes.

**Answer:**

### W-A7. `done` inside an alts arm (alts-design section 5)
Inside alts exactly one arm completes per selection, so a sink there handles one value and `done` has nothing to end.
- **A.** Ignore `done` inside alts.
- **B.** `done` ends the enclosing loop (this would give the loop-level stop that D3 deferred).
- **C.** Type-level: alts arms take a plain `(value) => void` handler, not a `sink`.
- **Recommendation: C**: the types make the rule visible and nothing silently does nothing.

**Answer:**

---

## D. DSL (sources: `open-design-decisions.md` D2, O5 [research]; `src/dsl/types.ts` and
`test/types/dsl.test-d.ts` [branch]; sketches `docs/research/probes/dsl-*-sketch.ts` [research])

### W-D1. Template DSL in the new major (handoff section 8 says "replace or remove, with a transition")
- **A.** The new major ships both. The template DSL is reimplemented on top of the new operations (so there is one
  runtime) and marked deprecated; it is removed in the following major.
- **B.** The new major removes it, and a codemod or migration guide covers the transition.
- **C.** The new major keeps it unchanged (old runtime) beside the new DSL; removed later.
- **Recommendation: A.** It gives the backwards compatibility you asked for without maintaining two runtimes, and
  the K-specs keep checking the template syntax while it exists.
- **Unblocks:** Phase 7 plan.

**Answer:**

### W-D2. Can an alts arm be a multi-step sequence (`seq(...)`)? (O5)
- **Recommendation: no, for now.** Go and core.async arms are single operations; follow-up steps run after the
  selection.

**Answer:**

### W-D3. May a sink or source return a promise and so delay the next value? (O5)
Useful for I/O and UI work: the next value waits until the promise settles.
- **Recommendation: yes, as backpressure only.** The sink still receives one value at a time. This does not bring
  `async/await` into `go` blocks (D4).

**Answer:**

### W-D4. Final names (O5)
`sink`, `source`, `guard` (clashes with CML's meaning, see W-A6), `chain` (Hoare's `>>`), and the threading helper,
which D6 says must not be called `pipe`.
- **Recommendation:** keep `sink`/`source`; decide `guard` and `chain` with W-A6; drop the threading helper unless a
  use appears.

**Answer:**

### W-D5. Typing plan (`docs/plans/typing-and-lifecycle.md` [research])
Typed `chan` overloads, a library-owned typed `xf` transducer module so the output type is inferred, and
`takeAsync` results narrowed to the output type or `null`. Changes type signatures only, not runtime behaviour.
- **Recommendation: adopt it for the new major.** Type-level breaks are acceptable in a major, and the CV claim
  "typed transducer channels" becomes accurate. Order: after Phase 1, alongside Phase 7.

**Answer:**

---

## R. Release and housekeeping

### W-R1. Closure Compiler. Decided: an A/B at the final build step (gap list section G [branch]).

### W-R2. Deprecate the stray npm version `9.5.4`?
It sorts above every real version, so `npm install csp-with-ts@^9` or tools that pick the highest version get it.
- **Recommendation: yes**, `npm deprecate csp-with-ts@9.5.4 "published by mistake; use the latest 0.x or the new
  major"`. This is a manual npm action for you; no code changes.

**Answer:**

### W-R3. Bring the research docs onto this branch?
Today the alts, decision and roadmap docs live only on `research/csp-inspection`.
- **Recommendation: yes**, as one commit copying `docs/research/` and the research `docs/plans/*.md` files here.
  Before pulling it locally, move your untracked local copies of `docs/plans/typing-and-lifecycle.md` and
  `docs/plans/async-core-investigation.md` aside: git won't overwrite untracked files, and the local
  `typing-and-lifecycle.md` contains a private detail that must not be committed.

**Answer:**

### W-R4. Local Claude memory edits (from the first local session's report)
Four proposed edits: rewrite the two project memories as superseded; add "Node >= 22.12 via a scratch prefix, keep
global Node 14"; add "the setImmediate/sleep commit is `828730e` on `obsolete/legacy-change-of-timer`"; scope the
"yarn only" and "docs stay untracked" lines in your global file to the product repos.
- **Recommendation:** apply all four. They are your memory files, so the local session won't edit them without a yes.

**Answer:**

---

## After you answer

Tell the next session (local or cloud): "read the answers in `docs/plans/decision-workbook.md` and turn them into
specs, plan updates and decision records". It will:
- move each answered item into `open-design-decisions.md` as a decided item (that file is on the research branch
  until W-R3 is done);
- write the specs each answer unblocks (R1-R3, C17, L10, alts specs);
- update the Phase 1 plan and the gap list;
- leave unanswered items untouched.
