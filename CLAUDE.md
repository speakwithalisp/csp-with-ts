# csp-with-ts: notes for Claude Code

TypeScript CSP library (channels, processes, alts) inspired by core.async and js-csp. The owner writes most
of the core by hand; Claude does scaffolding, mechanical sweeps, tests, and small fixes with no design content.
Ask before changing anything listed as an owner task in `docs/plans/handoff-2026-10.md`.

## Commands

- `npm test`: unit suite (Vitest). Expected failures (`it.fails`) count as passing.
- `npm run test:drivers`: the unit suite on every scheduler (immediate, messagechannel, timeout, microtask).
- `npm run test:types`: type-checks `src` and `test`, including `test/types/*.test-d.ts`.
- `npm run test:mem`: memory suite (needs `--expose-gc`, set in the Vitest project).
- `npm run build`: Rollup, CommonJS to `lib/`.
- `npm run specs`: runs the tests and regenerates `docs/tests/SPEC-LEDGER.md`.
- `npm run signoff -- <IDs|all|--list>`: owner sign-off of specs (stores hashes in `docs/tests/signoff.json`).
- `SPEC_SHOW_BUGS=1 npx vitest run <file>`: run known-bug specs as normal tests to see how they fail.
- `CSP_SCHEDULER=<driver>`: run the whole suite on one driver (`manual` and `seeded` need tests written for them).

## Rules

- Every deferred step goes through `dispatch()` in `src/impl/dispatch.ts`. Never call `setImmediate` or
  `setTimeout(fn, 0)` directly in `src`. `sleep`/`timeout` keep real `setTimeout`.
- Specs live in `test/unit/*.spec.test.ts` and use `spec(id, title, meta, fn)` from `test/support/spec.ts`.
  `knownBug` registers the test with `it.fails`. When you fix a bug, remove `knownBug` from its spec in the same
  commit, then run `npm run specs`. Changing a spec's text or body flags it "needs re-review" for the owner.
- Tests that depend on interleaving use the manual driver (`__resetCSP({ scheduler: 'manual' })`, `__step`,
  `__drainAll`), not real time. Real-time versions hide races on fast schedulers.
- Dispatch budgets in `test/unit/debug.test.ts` (1 / 7 / 4 per value) must not rise.
- Do not commit `docs/private/` (gitignored) or `.spec-meta/`.
- Do not open pull requests unless asked.
- npm in the cloud container needs `NO_PROXY=localhost no_proxy=localhost npm <cmd> --noproxy=localhost`.
