# Next steps and work split (planning doc)

Status: **draft for the owner's review.** Written 11 Oct 2026. Nothing below starts until the interview questions in
§5 are answered. Related: [`../research/2026-10-roadmap.md`](../research/2026-10-roadmap.md),
[`test-strategy.md`](test-strategy.md), [`alts-design.md`](alts-design.md),
[`open-design-decisions.md`](open-design-decisions.md).

## 1. Immediate next steps

1. **Interview** (§5): settle the questions that block the Claude branch (branch name, toolchain, scheduler config,
   who fixes bug 2).
2. **Enable npm in the cloud environment** (or run the branch locally). The registry is blocked from this container,
   so nothing that needs `npm install` (Vitest, fast-check) can run here until network access is changed.
3. **Claude branch** (§2): testability hooks, dispatcher, tests, DSL type declarations, the small fixes. No behaviour
   change except the listed fixes and the scheduler swap.
4. **Owner review and sign-off** of the spec ledger (§4).
5. **Owner starts Phase 1** (channel core) against the failing specs.
6. **In parallel:** close open design items (O1–O6, `alts-design.md`) through the interview.

## 2. Claude tasks (deterministic, each with a done-when)

Order matters: tests that pin today's behaviour come **before** the scheduler swap, so the swap is checked by them.

| # | Task | Done when |
|---|---|---|
| T0 | **Test toolchain:** Vitest, fast-check, `@types/node`, a test `tsconfig`, scripts `test`, `test:types`, `test:mem` (`--expose-gc`), `bench`, `specs`. Mechanical type fixes in `src/` if the newer TypeScript needs them (e.g. `catch (e: unknown)`). | `npm test` runs on Node 22; `tsc --noEmit` passes |
| T1 | **Config + reset hook:** `configure({ scheduler, debug })` applied before first use (the "initial config passed to CSP"); a test-only `__resetCSP()` that replaces the registry. | A test proves queues don't leak between tests |
| T2 | **Characterisation suite** (`test-strategy.md` §4.5) written against today's behaviour, on the *current* scheduler. | All pass on `master` behaviour |
| T3 | **Specification suite** §4.1–4.3 as `it.fails` (C1–C15, L1–L7, A1–A7), plus the model-based queue test and the fairness test. | Suite green with the expected failures listed in the ledger |
| T4 | **Debug hook:** counts of dispatches, parked handlers per channel, live processes, armed timers; an optional event listener. | Count tests (perf §6.2.1) record baselines |
| T5 | **Dispatcher:** one `dispatch(fn, ...args)` replacing every `setImmediate`/`setTimeout(fn, 0)` call site (~20). Drivers: `messagechannel` (default), `timeout` (fallback), `immediate` (Node), `microtask` (A/B only), `manual` (tests: `step()`, `drainAll()`), `seeded` (tests: reproducible random order). `sleep`/`timeout` keep real `setTimeout`. Node: `unref` the port when idle so it doesn't keep the process alive. | T2 still passes on every driver; T3 expected failures unchanged; count baselines re-recorded |
| T6 | **A/B performance harness:** `vitest bench` scenarios (ping-pong, fan-in, 3-stage pipeline, `loop` + alts) run per driver and per build, interleaved; memory suite (bytes per channel/parked consumer, leak slope, `FinalizationRegistry`); Playwright latency page from `probes/bench*.js`. | A report comparing drivers, committed under `docs/perf/` |
| T7 | **DSL type declarations** (types only, no implementation): `src/dsl/types.ts` with the decided signatures (`go`, `loop`, `take` overloads, `put`, `sink`, `source`, `Kill`); open items (O1 dynamic arms, alts handler shape) left out. Type tests (`*.test-d.ts`) from the sketches, with planted mistakes as `@ts-expect-error`. | `npm run test:types` passes |
| T8 | **Small fixes with no learning value** (each flips one spec from `it.fails` to `it`): `FixedBuffer.isFull` uses `>=` (C11); `chan()` rejects 0/negative/non-integer sizes (C12); `XChannel.add` closes on `reduced` (C10, first half); `putAsync` rejects `null`/`undefined` (C9); remove dead code (`makeInfiniteThread` log, empty `Channel` class, the "setTimeout to setTimeout" comment); delete CRA leftovers in `test/`; add the GPL-3.0 `LICENSE`; fix `homepage`; drop React/CRA dev dependencies. | Ledger shows those specs passing |
| T9 | **Spec ledger and sign-off tooling** (§4). | `npm run specs` writes the ledger |

**Not in the Claude branch:** anything in §3, the build modernisation (Rollup/tscc, roadmap Phase 8) unless T0 forces
it, and any open design item.

## 3. Owner tasks (manual features and fixes)

These carry the design and debugging work, so they stay with the owner:

| Phase | Work | Specs it flips |
|---|---|---|
| 1 | **Channel core rewrite** of `createQ().add`/`flush`: FIFO, no lost puts, no buffer bypass, `MAX_DIRTY` removes inactive only, overflow throws at 1,024; bug 1 (remove the registry `delete`, get-or-create helper); splicing of closed inner channels; transducer completion on close | C1–C5, C7, C10 (second half), C14, C15 |
| 2 | **Lifecycle:** loops end when an input closes; `timeout` closes at its deadline; cancellable sleep; error policy (O6); bug 2 *if the owner keeps it* (§5 Q4) | L1–L7 |
| 3 | **alts:** per-operation commit flag (`alts-design.md` §3 A+B), fairness, priority/default, winner reporting, closed-arm semantics; dynamic arms once O1 is decided | A1–A7 |
| 5 | Rendezvous channels (after O3) | R1–R3 |
| 6 | Deterministic broadcast (after O4) | B1–B4 |
| 7 | DSL runtime: operations as descriptions, `sink`/`source`, `take`/`put`, the template parsing into operations (implementing the T7 declarations) | D1–D6 |

## 4. Review and sign-off (simple version)

The owner reviews **sentences, not code**:

- Every test is declared with an ID and plain-language text: `spec('C1', 'delivers waiting puts in put order',
  { mustNot: 'reorder or drop the second put', source: 'Go TestChan; Hoare 1985 BUFFER' }, () => { … })`.
- `npm run specs` generates `docs/tests/SPEC-LEDGER.md`: one row per spec with ID, *must*, *must not*, source,
  status today (passing / expected failure / failing), and a sign-off column.
- **Sign-off:** run `npm run signoff C1 C2 …` (or edit `docs/tests/signoff.json`). It stores a hash of each signed
  spec's text and test body. If a test changes later, its row shows **needs re-review** until it's signed again.
- Review flow per batch: read the ledger rows; open the test only when a row is unclear; sign off or leave a comment
  in the PR. A spec that isn't signed off doesn't block the build, but the ledger shows it.

## 5. Interview queue

Asked a few at a time; answers get recorded in `open-design-decisions.md`.

**Blocking the Claude branch**
1. Branch name and shape: one branch with ordered commits, or separate branches (harness → dispatcher → fixes)?
2. Toolchain: bump TypeScript for tests now (may need small type fixes in `src/`, and the old Rollup/tscc build may
   need attention), or keep TS 3.8 for the build and use a newer TS only for type tests?
3. Scheduler config: default driver per environment (MessageChannel in browsers; in Node, MessageChannel or
   `setImmediate`?), and is `configure()` called once at startup acceptable?
4. Bug 2 (`setImmediate(proc.kill)` loses `this`): it's a one-line fix. Claude (T8), or yours?

**Design (any order)**
5. alts: `altFlag` correction A+B as proposed? Closed arm = ready with null (Go/core.async), or disabled (tokio)?
6. alts: dynamic arms: A guards / B recomputed list / C builder / D mutable set / E `onLose`, which combination?
7. alts: what does `done` mean inside an alts arm (§5 of `alts-design.md`)?
8. O2–O6 from `open-design-decisions.md`.
