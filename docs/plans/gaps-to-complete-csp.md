# Gaps between today's code and a complete CSP implementation

Written 2026-10-24 after T8. "Complete" here means the Hoare/Go/core.async core: you can build any
process network from channels, choice and termination, and the behaviour matches the model. Each gap names
the spec that will pin it (existing ID, or a proposed one to write first).

Status key: **bug** = spec exists and fails today; **missing** = no feature; **decide** = needs a design decision.

## A. Channel semantics

| # | Gap | Kind | Spec | Notes |
|---|---|---|---|---|
| A1 | Waiting puts/takers served LIFO, and puts dropped by the `MAX_DIRTY` cleanup | bug | C1, C2, C4, M1 | Phase 1. Queues must be FIFO and never drop. |
| A2 | No error at `MAX_QUEUE_SIZE` (1,024) | bug | C5 | Throw, as core.async does. |
| A3 | Values spliced from an already-closed inner channel are lost | bug | C14 | Phase 1. |
| A4 | A process cannot take back its own put on a buffered channel | bug | C16 | Phase 1. |
| A5 | **Rendezvous (unbuffered) channels do not exist.** `chan(0)` is now rejected (C12); `chan()` defaults to `fixed(1)`. A put must block until a taker arrives, and a take until a putter | missing | propose R1-R3 | The defining CSP primitive (Hoare 1978 input/output commands; Go `make(chan T)`). Needs a design note: how it interacts with broadcast (O4). |
| A6 | Broadcast to every parked taker vs single delivery | decide | K1, K13, O4 | Keep as the owner's design, but a "one taker gets it" mode (needed for work queues / worker pools) must be possible. Candidate: `chan` option or a `mult` vs plain-channel split like core.async. |
| A7 | Put on a closed channel silently drops the value and calls back | decide | K7 | core.async returns `false`; Go panics. Callers cannot tell. Cheapest: pass a boolean to the put callback / resolve `putAsync` with it. |
| A8 | Closing semantics for pending puts | decide | propose C17 | Corrected 2026-10-25: as far as I recall core.async's `close!`, puts already waiting when the channel closes are still delivered to later takers; only new puts are refused (`>!` returns `false`). Buffered values stay takeable (C7 holds). Ours drops waiting puts after calling their callbacks (`processQueue.ts:282-287`, per the Phase 1 plan). Not yet checked against the core.async source (the cloud container cannot reach GitHub): verify before writing C17. Decision W-S3 in `decision-workbook.md`. |

## B. Choice (alts / select)

| # | Gap | Kind | Spec | Notes |
|---|---|---|---|---|
| B1 | Both ready arms consume a value | bug | A1 | Phase 3: commit exactly one arm (altFlag A+B in `alts-design.md`). |
| B2 | Losing arms stay parked and steal later values | bug | A4 | Same fix. |
| B3 | No fairness; Go picks uniformly at random among ready arms | bug | A3 | core.async has `:priority` as an option; keep both (default random, `priority` opt-in). |
| B4 | No `default` / non-blocking choice (Go `select { default: }`, core.async `:default`) | missing | propose A5 | Needed for polling and for try-put/try-take. |
| B5 | Dynamic arms (arms decided at runtime) | decide | O1 | Open until you review `alts-design.md`. |
| B6 | Output guards (put arms) exist but are untested end to end | missing | propose A6 | Hoare 1978 allowed output guards; core.async supports them. |
| B7 | Closed-arm semantics: what does an alts take arm on a closed channel return, and does it count as "ready"? | decide | propose A7 | core.async returns `nil` with the channel; document and pin. |

## C. Process lifecycle and termination

| # | Gap | Kind | Spec | Notes |
|---|---|---|---|---|
| C1 | Loop stalls when its input closes | bug | L3 | Phase 2. core.async idiom `(when-some [v (<! c)] (recur))`. |
| C2 | Timeouts do not close if untaken; timeout inside a loop runs once | bug | L4, L5 | Phase 2. |
| C3 | A process has no result/completion value or error path | missing | propose L7 | Go `sync.WaitGroup`/`errgroup`; core.async go block returns a channel with the result. `proc.channel` already closes on end, but carries `true`, not a result. |
| C4 | Exceptions thrown inside a process step are swallowed or crash the dispatcher | decide | propose L8 | Decide: error channel, rethrow into the creator, or process `.catch`. |
| C5 | Distributed termination (Hoare 1985 §4.5): a network ends when all its sources are exhausted | missing | propose L9 | Falls out of C1 + closing propagation; needs a test of pipeline A -> B -> C closing cleanly end to end. |
| C6 | Kill propagation | done | L1 | Fixed in T8: killing a loop kills its current iteration; killing a parent kills eval'd children. |
| C7 | Timers after unmount (about 440/s observed in the old demo) | missing evidence | L2 passes | Needs the demo's traces. |

## D. Combinators (core.async/Go library level)

None of these exist yet; each is small once A1, A5 and B1 are fixed. Write them as specs first.

| # | Combinator | Source |
|---|---|---|
| D1 | `pipe(from, to, closeTo?)` | core.async |
| D2 | `pipeline(n, to, xf, from)`, `pipelineAsync` (ordered, bounded parallelism) | core.async, Go pipelines |
| D3 | `mult` / `tap` / `untap` (broadcast fan-out) | core.async, Hoare 1985 §7.7 |
| D4 | `merge(chs)`, `split(pred, ch)` | core.async |
| D5 | `pub` / `sub` (topic routing) | core.async |
| D6 | `mix` (dynamic fan-in with mute/solo) | core.async |
| D7 | `onto-chan` / `to-chan` (collection to channel), `into` / `reduce` (channel to collection) | core.async |
| D8 | `timeout` as plain channel plus `sleep` helper; `ticker` | Go `time.After`, `time.Tick` |
| D9 | Promise channel (single value, delivered to all later takers) | core.async `promise-chan` |
| D10 | Async iteration: `for await (const v of ch)` | JS-specific, natural fit for takeAsync |
| D11 | Cancellation scope/context (cancel a tree of processes) | Go `context.Context` |

## E. API and DSL

| # | Gap | Kind | Notes |
|---|---|---|---|
| E1 | DSL implementation against `src/dsl/types.ts` (`go`, `loop`, `take`, `put`, `sink`, `source`) | missing | Owner task; types and type tests exist. The template-string DSL stays until the new one passes the same K-specs. |
| E2 | `putAsync` returns void; `takeAsync` promise is the only handle | decide | Promise-returning put (resolves true/false) fits A7. |
| E3 | `loopUntil`, loops with predicates are untested | missing | Coverage: `src/loops.ts` lines 61-96 are never run. |
| E4 | Typings of `go` args are loose (`IGoArgs` union) | missing | Subsumed by E1. |

## F. Test and tooling gaps (code coverage, 2026-10-24)

`npm run test:coverage`: statements 77.7%, branches 63.8%, functions 85.7%, lines 83.1% (unit project).
Weakest files, and what would cover them:

- `processQueue.ts` 62% (lines 307-365, 372-376 never run): the closed-channel/splice paths. C14 and the Phase 1
  rewrite will exercise these; write the specs before touching them.
- `loops.ts` 51%: `loopUntil` (E3). Add K-specs.
- `scheduler.ts` 67%, `instructions.ts` 79%, `go.ts` 79%: error and edge branches of the parser (malformed
  statements) and the alts path.
- Not measured: `test/memory` (T6) and the browser. Coverage counts lines, not interleavings; use the seeded driver
  for interleavings (see handoff doc, next steps 3).

## G. Release build: A/B of build size and viability (final build step)

At T0 the tscc (Closure Compiler) step was removed from the Rollup build. After the TypeScript 6 / Rollup 4 upgrade it
produced a browser-style bundle that Rollup warned might not expose its exports, and it did not minify. Closure stays
a candidate for the final build: the owner will A/B test it before choosing.

Baselines (`lib/index.js`):

| Build | Raw | gzip |
|---|---|---|
| Published 0.6.9 (Rollup + rpt2 + tscc; readable, not minified) | 68,377 B | 9,440 B |
| Current branch (Rollup + rpt2, CommonJS, not minified) | 66,579 B | 10,987 B |

Candidates to compare: the current build; the current build plus terser; Closure through tscc; Closure through
`google-closure-compiler` directly (simple and advanced optimisations); optionally esbuild minify.

For each, measure raw, gzip and brotli size. Check viability:
- `require()` and ESM import both expose every export;
- the unit suite passes when run against the built bundle instead of `src`;
- `.d.ts` output is unchanged;
- advanced-mode property renaming does not break the transducer protocol keys (`@@transducer/*`) or anything read by
  string name;
- the build runs on CI without extra system dependencies (Closure needs Java or its native binary).

## Suggested order

1. Phase 1 (A1-A4) with C-specs and M1; 2. Phase 3 (B1-B3, B4) so alts is trustworthy; 3. A5 rendezvous
(biggest missing primitive); 4. Phase 2 (C1-C2, C3-C5); 5. D1, D3, D4 (the three used by almost every program), then
the rest; 6. E1 DSL; decisions A6/A7/B5/B7/C4 as you reach the code they affect, one interview per group.
