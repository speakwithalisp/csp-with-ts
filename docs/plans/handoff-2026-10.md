# Handoff: state of the branch, findings, and next steps

Branch: `claude/testability-and-dispatcher` (from master `b745c2f`). Written 2026-10-24.
Design background, probes and decisions D1-D10 are on branch `research/csp-inspection`
(`docs/research/`, `docs/plans/`). To read them here:
`git fetch origin research/csp-inspection && git checkout origin/research/csp-inspection -- docs/research docs/plans`
(then do not commit that checkout onto this branch unless you want it there).

## 1. What is done on this branch

| Task | Commit | Result |
|---|---|---|
| T0 toolchain | earlier | TypeScript 6.0.3, Vitest 5, fast-check 4, Rollup 4 + rpt2, npm + lockfile, Node >= 22.12. tscc dropped (it emitted an IIFE with no CommonJS exports). |
| T1 config + reset | earlier | `configure({ scheduler, debug })` (throws if called after first use); test-only `__resetCSP()`. |
| T4 debug hook | 7f9c31c | `debugStats()`, `resetDebugStats()`, `onDebugEvent()`, `parked(ch)`. Counting is off unless `debug: true`. |
| T7 DSL types | earlier | `src/dsl/types.ts` + `test/types/dsl.test-d.ts`. Types only. |
| T9 spec ledger | 7806847 | `npm run specs` / `npm run signoff`. |
| T2/T3 tests | 0f2844c | 15 characterisation tests (K1-K14, L6), 22 specifications (C, L, A) and 1 model-based test (M1). |
| T5 dispatcher | 716e18c | One FIFO queue; drivers immediate / messagechannel / timeout / microtask, plus test-only manual and seeded. |

Suite status: 46 passed + 20 expected failures, identical on all four real schedulers (run twice each).
Typecheck and build are clean. The spec ledger has 38 specs, none signed off yet.

## 2. Findings from this session

1. **New bug (A4).** After `alts` commits one arm, the losing arm's handler stays parked on its channel and
   swallows the next value put there. Related to the altFlag work in `docs/plans/alts-design.md`.
2. **New bug (C16).** A process that puts to a buffered channel and then takes from the same channel never
   receives the value (`go\`>! ${a} ...; <! ${a} ...\``). Go: `c := make(chan int, 1); c <- 1; <-c` works.
3. **Bug 1 is about timing, not only code.** It crashes with `Cannot read properties of undefined (reading 'add')`
   (src/loops.ts) whenever puts arrive faster than one loop iteration (about 7 dispatch steps). With real timers
   it shows on `immediate`/`timeout` and is hidden on `messagechannel`/`microtask`, so switching to MessageChannel
   alone does not fix it. C3 and C15 reproduce it deterministically on the manual driver.
4. **Seeded driver exposes more.** Shuffling each batch triggers bug 1 in the lifecycle tests, and L1 becomes
   order-dependent. Seeded runs are not part of the pass/fail gate yet; use them after the Phase 1-2 fixes.
5. **MessageChannel in Node is slower to start.** First message about 8 ms vs about 1 ms for setImmediate, and the
   process took about 75 ms to exit vs 8 ms. Measure in T6 before deciding the default for Node; D9 keeps
   setImmediate as the Node default and MessageChannel for browsers.
6. **Model-based test limit (M1).** It only issues a take when a value is owed, because a parked taker receives the
   next put by broadcast (K1), which a plain queue model does not describe. Revisit when open decision O4
   (broadcast vs single delivery) is settled.
7. **Dispatch budgets are exact on the manual driver:** go sink 1, loop 7, takeAsync/putAsync round trip 4 per value.
8. **TypeScript quirks.** TS 6 reports TS5112 if a tsconfig exists and files are passed on the command line; use
   `--ignoreConfig` for ad-hoc checks. `IChan.add` uses method syntax (bivariant), so the DSL's `take`/`put`
   overloads use `NoInfer`; keep that.
9. **Unexplained (needs the old demo's traces):** about 440 timers/s still firing after unmount.

## 3. Known-bug specs and who fixes them

The 15 remaining `it.fails` specs (C9-C12 and L1 were fixed in T8, see section 7). Remove `knownBug` from the spec in the same commit as the fix.

| Spec | Bug | Owner |
|---|---|---|
| C1, C2, C4, C5 | waiting puts LIFO and lost; parked takers LIFO; MAX_DIRTY drops; no error past 1,024 | Owner (Phase 1) |
| C3, C15 | bug 1: registry entry deleted in flush before loops.ts reads it | Owner (Phase 1) |
| C14 | values spliced from an already-closed inner channel are lost | Owner (Phase 1) |
| C16 | put then take on the same buffered channel in one process | Owner (Phase 1) |
| M1 | FIFO model; passes when C1/C4 are fixed | Owner (Phase 1) |
| L3 | loop stalls when its input closes | Owner (Phase 2) |
| L4, L5 | timeout does not close untaken; timeout in a loop runs once | Owner (Phase 2) |
| A1, A3, A4 | alts consumes both arms; unfair; stale losing arm | Owner (Phase 3) |

## 7. Update 2026-10-24: T8 done, coverage added

Fixed: `isFull` (C11), `chan()` size validation (C12), `reduced` closes the channel (C10), `putAsync` rejects
null/undefined (C9), bug 2 (unbound `kill`) and, found while fixing it, loops did not kill their current iteration
process when killed (L1). Process kill hooks now run with `this` = the process. Dead code removed (`makeInfiniteThread`),
`LICENSE` added (changed from GPL-3.0 to MIT on 2026-10-24, because the library is used in a closed-source product), `homepage` fixed. Suite: 51 passed + 15 expected failures on all four schedulers.
Note: a killed loop no longer registers its deferred take (`loops.ts`), which was exposing bug 1 on kill; the bug
itself (C15) is still the owner's Phase 1.
Coverage: `npm run test:coverage` (v8; report in `coverage/`, gitignored). Gap list for a complete CSP:
`docs/plans/gaps-to-complete-csp.md`.

## 4. Next steps for Claude Code (on your machine)

Do these on this branch, one commit each, running `npm test`, `npm run test:drivers`, `npm run test:types` and
`npm run build` before every commit.

1. **T8: small fixes: DONE (see section 7).** Original list, kept for reference:
   - `FixedBuffer.isFull` uses `>=` (C11).
   - `chan()` throws `RangeError` for 0, negative, non-integer sizes (C12).
   - `XChannel.add` closes the channel when the transducer returns `reduced` (C10). `isReduced` is currently
     called on a boolean.
   - `putAsync` throws on `null`/`undefined` (C9).
   - Bug 2: unbound `kill`; make `proc.kill()` run through `dispatch(() => proc.kill())` and ensure `eval` children
     are killed with their parent (L1). The `!this` early return was a stopgap.
   - Remove dead code (`makeInfiniteThread` log, empty `Channel` class, the "setTimeout to setTimeout" comment),
     the CRA leftovers in `test/`, and fix `homepage`. Add the `LICENSE` (MIT).
   - Finish by running `npm run specs` and committing the regenerated ledger.
2. **T6: A/B performance harness.** `vitest bench` scenarios (ping-pong, fan-in, 3-stage pipeline, loop + alts)
   per driver, interleaved; memory suite in `test/memory/` (bytes per channel / parked consumer, leak slope with
   `FinalizationRegistry`, run with `--expose-gc`); a short Playwright latency page based on
   `docs/research/probes/bench*.js` (Chromium is at `/opt/pw-browsers/chromium` in the cloud; locally use your own).
   Include the Node MessageChannel start-up and exit-time cost from finding 5. Commit a report under `docs/perf/`.
3. **Tests that need the owner's fixes first** (prepare, do not merge as passing): sketches for the seeded-driver
   suite (explore interleavings of C1-C4, A1-A4 over many seeds, print the failing seed), and the A3 fairness
   test with a 10-sigma bound once alts commits one arm.
4. **Ledger housekeeping.** After the owner signs off specs (`npm run signoff -- all`), commit
   `docs/tests/signoff.json`. A changed spec shows "needs re-review" and must not be signed by Claude.

## 5. Owner tasks (manual)

Order from the roadmap on `research/csp-inspection`; the specs above are the acceptance tests.

1. **Phase 1: channel core.** FIFO queues for waiting puts and parked takers, remove the `MAX_DIRTY` cleanup that
   drops puts, throw at `MAX_QUEUE_SIZE`, fix bug 1 (do not delete the registry entry in `flush` while loops
   still look it up), splice already-closed inner channels, same-channel put/take in one process (C16).
   Acceptance: C1-C5, C14, C15, C16, M1 lose `knownBug`. Delete nothing from K1-K14 (characterisation).
2. **Phase 2: lifecycle.** Loop ends when its input closes (L3); timeouts close at their deadline (L4) and are
   re-created per loop iteration (L5).
3. **Phase 3: alts.** Choose the altFlag correction (Q5-Q7 in `docs/plans/alts-design.md`), commit one arm only
   (A1), fair choice (A3), withdraw losing arms (A4).
4. **Decide:** O1 (dynamic alts arms), O2-O6 in `docs/plans/open-design-decisions.md`; O4 also affects M1 and K1/K13.
5. **Review and sign off** the ledger (`docs/tests/SPEC-LEDGER.md`).
6. **Later:** DSL implementation against `src/dsl/types.ts`; trace the post-unmount timers (finding 9);
   new major version when everything above is done.

## 6. Quick start

```
npm ci            # cloud container: NO_PROXY=localhost no_proxy=localhost npm ci --noproxy=localhost
npm test && npm run test:drivers && npm run test:types && npm run build
```

## 8. Owner's answers (after 2026-10-24)

- **Versioning:** no action on the npm `latest` tag or the `0.7.0-alpha.2` release (the owner believes it is a small
  unpushed fix on a local master). Every change until the next publish belongs to the new major version.
- **Licence:** MIT (done). No earlier GPL release matters.
- **Merge:** do not merge this branch to master yet.
- **Template DSL:** it does not stay indefinitely (supersedes D5's "template as sugar"). The new major either
  replaces it with the new function-call pattern as a breaking change, or removes it; a backwards-compatible
  transition is wanted. Which of the two is not decided.
- **Showcase app:** will be rebuilt in a separate new repository, after the Phase 1 MVP. Name and date not set.
- **Still open:** one-taker mode and `mult`/`tap`/pub-sub (owner leans yes, O4), rendezvous default (O3), put on a
  closed channel and error policy (O6), dynamic alts arms and the alts handler shape (O1), the typing plan.
- **Closure Compiler:** stays a possible goal for the final build step (release phase). The owner will A/B test
  build size and viability before choosing; see `docs/plans/gaps-to-complete-csp.md` section G.
- **Open decisions:** all in one place, with options and recommendations, in `docs/plans/decision-workbook.md`.
- **Next local session:** follow `docs/plans/local-session-brief.md`.

