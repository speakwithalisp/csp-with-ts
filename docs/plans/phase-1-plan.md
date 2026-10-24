# Phase 1 plan: channel core (guide for the owner) and Claude-side work

Written 2026-10-25 on branch `claude/testability-and-dispatcher` at `9dc9369`. Phase 1 is the owner's code; this
file is a reading of the code and a suggested order, not something Claude implements. Line numbers are for this
commit. "Observed" means I ran the built `lib/` against a small script (nothing in the repo was changed); "reading"
means I traced the code but did not run it.

Gates before this plan: `npm test`, `npm run test:drivers`, `npm run test:types`, `npm run build` all green
(51 passed + 15 expected failures on every driver). Use Node >= 22.12.

## 1. Findings that cut across items

1. **Waiting puts and parked takers share one ring buffer, and iterating it goes newest to oldest.**
   `RingBuffer[Symbol.iterator]` (`src/impl/buffers.ts:28-51`) starts at `head - 1` and walks down, while `pop()`
   takes from `tail` (oldest). Every `for (const other of buffer)` in `processQueue.ts` (lines 196, 251, 290, 314,
   323, 346) therefore serves the newest waiter first. `cleanup` (`buffers.ts:109-119`) numbers entries from
   `length - 1` for the oldest, and `othersDone` indices in `processQueue.ts` are iteration indices (newest = 0).
   The two conventions agree today; flipping the iterator means flipping one of them too.
2. **A waiting put only moves into the channel when a later take finds the channel empty** (the
   `NO_TAKE_CHAN_EMPTY` branch, `processQueue.ts:249-257`). A take that succeeds (`DONE`, line 242-244) frees a slot
   but does not refill it from the waiting puts.
3. **The registry entry doubles as a "finished" flag.** `flush` deletes it (`processQueue.ts:379`), and the code
   treats "no entry" as "closed and drained": `instructions.ts:17`, `process.ts:131` and `:158`, `scheduler.ts:45`,
   `channels.ts:32` and `:140` (close only schedules a flush if the entry exists), `loops.ts:39` and `:78`.
4. **`remove()` on a closed channel returns `CLOSED` for the last buffered value** (`channels.ts:45`, `:153`).
   Callers that discard the return value (most of `processQueue.ts`) are unaffected; callers that use it lose the
   value (C14, and `flush` at `processQueue.ts:310`).
5. **Unexpected pass fails the gate.** A spec registered with `it.fails` fails the suite when the fix makes it
   pass. Each fix must remove `knownBug` from the specs it flips in the same commit (CLAUDE.md rule).

## 2. Items

Each item: specs it flips, location, root-cause reading, suggested change, risks, specs that could break.

### C14: splicing an already-closed inner channel (do first)
- **Flips:** C14.
- **Where:** `processQueue.ts:41-59` (`takeFromChan`, chan-in-chan branch) and `channels.ts:45`, `:153`.
- **Root cause (observed + reading):** two defects. (a) `value.remove()` on a closed inner channel returns `null`
  for its last value (observed: a closed channel holding x, y returns `x, null, null` from three `remove()` calls),
  so `i2` becomes `CLOSED` at line 50. (b) the re-put closure `() => tempCBVal` (line 52) reads a `let` declared once
  outside the `do` loop, so by the time the dispatched callbacks run it holds the final value. Observed result:
  takers get `after, null, null`; the `null` is also a close marker in the outer buffer.
- **Suggested change:** make `remove()` return the removed value and signal "closed and empty" separately (the
  `last()`/`count()` pair already says that); give each re-put its own `const`. Re-put the inner values at the
  *front* of the waiting order so they arrive before `after` (K2 already pins that for an open inner channel).
- **Risks:** `remove()`'s closed-channel behaviour is used by `flush` (line 310), `takeFromChan` and the alts
  closed-arm path (`process.ts:170`), so Phase 3 touches the same lines.
- **Could break:** K2, K5, K7, C7, L-specs that read a closed channel.

### C16: put then take on the same buffered channel in one process
- **Flips:** C16.
- **Where:** `drainToChan`, `processQueue.ts:13-36`, with the park at `:150-153`.
- **Root cause (observed + reading):** a generator source reports `done` only on the *next* `next()` call.
  `drainToChan` refuses to call `next()` when `chan.isFull()` (lines 15 and 27). With `chan(1)`, the first value fills
  the buffer, line 31 returns `NOT_DONE`, the loop calls `drainToChan` again, which returns `NO_PUT_CHAN_FULL`, and the
  already-delivered put is parked as a waiting put. The process thread is only resumed when the put generator ends,
  so it never reaches its own `<!` and deadlocks. Observed: the same program with `chan(2)` works (`got = [1]`).
- **Suggested change:** separate "get the next value from the source" from "wait for room". Ask the source for its
  next value first; if it is done, the put is complete and the thread resumes; only if there is a value and no room
  does the put park, holding that pending value.
- **Risks:** this runs user generator code earlier than today (the code between two `yield`s runs before the slot
  is free). Decide whether that is acceptable or whether a single-yield `>!` needs its own fast path. The dispatch
  budgets in `test/unit/debug.test.ts` (1 / 7 / 4) must not rise.
- **Could break:** K4 (fixed(1) makes puts wait), L6, K14, the debug budgets.

### C2 then C1: FIFO takers and FIFO waiting puts
- **Flips:** C2 first (likely on the iterator change alone), then C1; M1 needs C4 as well.
- **Where:** `buffers.ts:28-51`, `:109-119`; `processQueue.ts:196`, `:249-269`, `:290-366`.
- **Root cause (observed + reading):** finding 1 gives LIFO takers (observed: `second` before `first`) and LIFO
  draining of waiting puts (observed: `0, 9, 8, ..., 2`). "Put 1 lost" is really "put 1 stranded": the last drain
  reaches `othersDone.length === buffer.length` and breaks at line 260 *before* the take retries, then the take is
  parked at lines 266-269 even though the drained value is now in the channel. Observed: put 1 entered the
  buffer only after the tenth take had already timed out.
- **Suggested change:** (1) iterate oldest first and keep `cleanup` indices consistent; (2) after a
  successful take, refill the freed slot from the oldest waiting put; (3) never park a take while the channel
  holds a value for it (retry the take after any drain). Roadmap invariants 1-3 describe exactly this; consider
  expressing them as two explicit FIFO queues (puts, takers) in place of the shared ring plus `currentEventType`.
- **Risks:** K1 (broadcast) depends on delivering to every parked taker in one pass; with FIFO order the
  callbacks fire oldest first, which is what C2 wants, but O4 (one-taker mode) is undecided, so keep the broadcast
  loop as it is. `othersDone`/`doneIndices` are index lists; any iteration change must keep them aligned.
- **Could break:** K1, K13, K3, K4, M1, A1-A4 (alts parks on the same queue), L-specs that use loops.

### C4 and C5: `MAX_DIRTY` and the 1,024 limit
- **Flips:** C4, C5 (and M1 together with the item above).
- **Where:** `processQueue.ts:108-124`; limit at `buffers.ts:76`; constants in `constants.ts:1-3`.
- **Root cause (reading + observed):** when 64 entries are queued, `cleanup` keeps only non-callback entries and
  non-stale generators, which drops every live `putAsync` callback (observed: no error in 1,100 puts). The 1,024
  limit already exists in `unboundedUnshift` but is unreachable because the cleanup fires at 64.
- **Suggested change:** delete the `case instr.event` cleanup branch; if stale entries must be pruned, prune only
  entries whose handler is inactive (this is where Phase 3's per-operation commit flag helps).
  C5 should then flip without more work, because `unboundedUnshift` throws before it changes the buffer. Check that
  `currentEventType` is not already changed when it throws (it is set just before the unshift at lines 151, 183,
  223).
- **Risks:** with no cleanup, stale generator entries (finished alts arms) accumulate until a flush; A4 is the same
  problem and belongs to Phase 3.
- **Could break:** A2, A4, C7, anything that relied on the cleanup to unclog a channel.

### C3 and C15: bug 1 (registry entry deleted in `flush`)
- **Flips:** C15, then re-check C3.
- **Where:** delete at `processQueue.ts:379`; reader at `loops.ts:39-42` (and the copy in `loopUntil`, `:78-81`).
- **Root cause (observed):** `loops.ts:39` checks `CSP().has(...)`, then dispatches a callback that does
  `CSP().get(...)!.add(...)` (line 40). A `flush` between the check and the callback deletes the entry, so `get`
  returns `undefined`. Observed with the built library: `n = 2`, then `Cannot read properties of undefined (reading
  'add')`.
- **Suggested change:** stop deleting the entry (the registry is a `WeakMap`, so it is collected with the channel),
  and replace "no entry means finished" with `closed && count() === 0` at every site in finding 3.
- **Risks (the main one in this phase):** today the missing entry is what ends a process that touches a closed
  channel: `process.ts:131` breaks out of the block, `instructions.ts:17` resumes the thread. Observed: a process
  that does `>! closedChan ...; <! other ...` never runs its second step, with or without the entry present. Once
  the entry stays, those paths go through `add`'s closed branch (`processQueue.ts:92-105`), which calls `.return()`
  on a generator that has not started; that does not run its `finally`, so the thread is never resumed. Decide the
  intended behaviour for "put on a closed channel" (A7 / O6) before changing these paths.
- **Could break:** L1, L2, L6, K5-K7, K9 (timeouts delete their channel entry the same way), the debug counters.

### M1
- **Flips:** M1 when C1 and C4 hold. It only issues a take when a value is owed because of broadcast (K1, O4), so
  it stays valid whichever way O4 goes. Its `settle(1)` is real time; if it flakes after the fixes, move it to the
  manual driver rather than raising the delay.

## 3. Suggested order

1. **C14** (self-contained, two small defects, warm-up).
2. **C16** (self-contained in `drainToChan`; one design question: when the generator body after a `yield` runs).
3. **Iterator order** (C2 expected to flip; C1 changes from reversed to in-order but still strands).
4. **Refill and no-park-with-value** (C1 flips).
5. **Remove `MAX_DIRTY` cleanup** (C4, C5 flip; M1 should flip).
6. **Bug 1 and the registry signal** (C15 flips, re-check C3). Last, because it needs the closed-channel path
   settled and benefits from steps 3-5 being in place.
7. Remove `knownBug` from each flipped spec in the commit that flips it; `npm run specs`; leave K1-K14 untouched.

Roadmap point 5 says to do bug 1 inside one rewrite of `createQ().add`; steps 3-6 can be that rewrite if you prefer
to do it in one go. I split it only so each step flips named specs and can be checked on its own.

## 4. Claude-side work proposed for step 5 (in order)

Only after "go". Work stays on this branch, one commit per item, all four gates before each commit,
`npm run specs` after each spec change. No owner-task source files change (Phase 1-3 behaviour in
`processQueue.ts`, `channels.ts`, `go.ts`, `process.ts`, `loops.ts`). No sign-off, no push of anything but this
branch, no PR.

1. **Specs for missing features** (`it.fails` with `knownBug: 'not implemented'` unless noted).
   Done when: each spec fails for the stated reason under `SPEC_SHOW_BUGS=1`, the suite stays green on all four
   drivers, and the ledger is regenerated.
   - **R1-R3 rendezvous.** Behaviour is decided (roadmap acceptance test 6): a put completes only when a taker
     takes, a take only when a putter puts, nothing is buffered. The spelling is O3 (`chan(0)` or a new default), so
     the specs go through one factory in the spec file. Question 1 below.
   - **A6 put arms in alts.** Behaviour follows "exactly one arm completes" (alts-design §2). Written against the
     existing `[chan, value]` arm syntax.
   - **Not written, question instead:** A5 non-blocking alts (the option has no home in the template syntax, see
     Question 2); A7 closed-arm semantics (open under O1, Question 3); C17 close with pending puts (Question 4).
   - **`loopUntil`:** characterisation specs (kind `characterisation`, passing) after I probe what the predicate
     hook does today. If the behaviour looks unintended I will write a question instead of pinning it.
2. **T6 performance harness.** `vitest bench` files (ping-pong, fan-in, 3-stage pipeline, loop + alts) per driver,
   interleaved runs; `test/memory/` with bytes per channel and per parked consumer and a leak slope using
   `FinalizationRegistry` (run with `--expose-gc`, the `memory` project already exists but has no files); report in
   `docs/perf/` including Node MessageChannel start-up and exit cost (handoff finding 5).
   Done when: `npm run bench` and `npm run test:mem` run clean and the report has numbers with the commit hash and
   Node version. The browser latency page from the handoff is not in the brief; skipped unless you say otherwise
   (Question 5).
3. **Seeded-driver exploration.** A script (not part of the gate) that runs C1-C4 and A1-A4 over many seeds and prints
   failing seeds. Done when: it runs in under a few minutes and the output is checked in as a table in `docs/perf/`
   or the report, clearly marked informational.

## 5. Questions for the owner

1. R1-R3: write them against `chan(0)` (C12 currently rejects it, so they fail either way), or wait for O3?
2. A5: how should a non-blocking choice be written in the template syntax (there is no options slot), or is it
   deferred to the new DSL?
3. A7: when an alts take arm sits on a closed channel, does the arm count as ready and deliver `null`
   (alts-design §2) or is it disabled (O1 sub-question)? Specs wait for the answer.
4. C17: the gap list says pending puts complete with `false` and buffered values stay takeable. Today `flush`
   calls pending put callbacks and drops their values (reading, `processQueue.ts:282-287`). Is "pending puts are
   delivered after close" (my recollection of core.async, not verified here) or "pending puts are dropped" the rule?
5. Include the Playwright latency page from the handoff in T6?
