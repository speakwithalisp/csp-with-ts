# Open design decisions (planning doc)

Status: **open. Nothing here is decided unless marked "Decided".** Collected 8–9 Oct 2026 from the research
session. Background, evidence and sources are in [`docs/research/2026-10-roadmap.md`](../research/2026-10-roadmap.md)
(Phases 3, 5, 6, 7) and the type-checked sketches in [`docs/research/probes/`](../research/probes/README.md).

## Decided

| # | Decision | Date |
|---|---|---|
| D1 | `go`/`loop` keep returning their kill (destructor) functions | 8 Oct |
| D2 | DSL shape: `go(...ops)`, `take(ch, sink(fn))`, `put(ch, source(fn))`, bare `take(ch)`; `sink`/`source` wrap repeating consumers/producers; effects allowed (React state, DOM). Sketch: `dsl-sink-source-sketch.ts` | 8 Oct |
| D3 | A loop ends when its kill function runs, or when a channel it takes from closes. No loop-level stop signal for now | 8 Oct |
| D4 | No state-threading `loop({ init, until })`; no `STOP` sentinel; no async/await inside go blocks; no thunks | 8 Oct |
| D5 | Keep: WeakMap side table, broadcast (made deterministic), generators internally, template as sugar, channel splicing, `putAsync`/`takeAsync` | 8 Oct |
| D6 | `pipe` is not for value transformation (transducers on channels do that); rename any threading helper so it isn't confused with Ramda/RxJS | 8 Oct |

## Open: to review

### O1. Dynamic choice (loop logic that changes the channel set)
Exploration only. Sketch: [`dsl-dynamic-alts-sketch.ts`](../research/probes/dsl-dynamic-alts-sketch.ts).
- Proposal: `guard(() => cond, op)` (Hoare's guarded alternative; Go's nil-channel case) and `alts(() => arms)` (arms
  recomputed each time the loop reaches them; Go's `select` evaluates its channels every time; core.async's `mix`
  recomputes its `alts!` set with `recur`).
- Patterns it enables: debounce, latest-wins typeahead, dynamic fan-in, bounded relay, gesture phases.
- Sub-questions:
  - Inside `alts`, does a sink handle exactly one value per selection (so `done` is redundant there)?
  - Does a closed arm drop out of the set (Go/core.async), with the loop ending only when no arms are left?
  - Is a function-valued `alts` acceptable, given the "no thunks" preference? (It's re-evaluation per pass, not a
    deferred argument, but it's still a function.)

### O2. `recur` follow-ups
- Should `put` report whether the channel was open (`true`/`false`, as core.async's `>!` does)?
- Should a loop end when a channel it *puts to* closes (the mirror of D3; core.async's `pipe` does
  `(when (>! to v) (recur))`)?

### O3. Default channel (roadmap Phase 5)
- `chan()` unbuffered by default (Go, core.async; breaking), or keep `fixed(1)` and add `chan(0)` as rendezvous?

### O4. Broadcast model (roadmap Phase 6)
- **A.** In-channel, "present at delivery": every taker parked at the delivery turn gets the value; buffered values go
  to all takers parked by the next turn; FIFO.
- **B.** Registered membership: an explicit broadcast channel or `mult`/`tap`, Hoare-style (put completes when every
  member has taken) or Kahn-style (a buffer per member).

### O5. DSL details
- Can an alts arm be a multi-step `seq(...)`?
- May a sink/source return a promise (wait before the next value)?
- Final names: `sink`, `source`, `guard`, `chain` (Hoare's `>>`), and the threading helper (if any).
- Channel splicing: stay the default, or become opt-in?

### O6. Error policy
- What happens when a sink, source or transducer throws: close the channel, put an `Error`, route to an `exHandler`,
  or rethrow to the caller of `go`? (core.async prints and closes.)

## How to use this doc
When an item is decided, move it to **Decided** with the date and a one-line reason, then update the roadmap phase
it belongs to. Tests for a decided item go into the specification suite (see
[`test-strategy.md`](test-strategy.md)) before the code changes.
