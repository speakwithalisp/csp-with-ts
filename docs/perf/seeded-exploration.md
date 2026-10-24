# Seeded-driver exploration (informational, not a gate)

2026-10-25, 100 seeds, base `672476c` plus `test/explore/seeds.explore.ts`. Rerun with `SEEDS=200 EXPLORE_OUT=docs/perf/seeded-exploration.md npm run explore`
(about 1.7 s per seed). Each scenario runs under `__resetCSP({ scheduler: 'seeded', seed })`, where the driver shuffles
every dispatch batch with a PRNG started from the seed; a failing seed can be replayed by calling that line in a test.

| spec | note | seeds passing | first failing seeds | |
|---|---|---|---|---|
| C1 | known bug: waiting puts FIFO | 0/100 | 1, 2, 3, 4, 5, 6, 7, 8 |
| C2 | known bug: parked takers FIFO | 0/100 | 1, 2, 3, 4, 5, 6, 7, 8 |
| C3 | known bug: loop receives every put | 0/100 | 1, 2, 3, 4, 5, 6, 7, 8 | 100 uncaught errors (bug 1) |
| C4 | known bug: 70 waiting puts all delivered | 0/100 | 1, 2, 3, 4, 5, 6, 7, 8 |
| A1 | known bug: exactly one arm completes | 0/100 | 1, 2, 3, 4, 5, 6, 7, 8 |
| A3 | known bug: fair choice (40 trials, both orders seen) | 0/100 | 1, 2, 3, 4, 5, 6, 7, 8 |
| A4 | known bug: losing arm withdrawn | 0/100 | 1, 2, 3, 4, 5, 6, 7, 8 |
| K1 | control: broadcast to parked takers | 100/100 | - |
| K4 | control: fixed(1) makes puts wait | 100/100 | - |
| C7 | control: close keeps buffered values | 100/100 | - |
| A2 | control: alts handler runs once | 100/100 | - |

Reading: before the Phase 1-3 fixes, shuffling adds nothing. Every known-bug scenario fails on all 100 seeds (the
failures are deterministic, not interleaving-dependent), and the four controls (K1, K4, C7, A2) pass on all 100. The
handoff's note that the seeded driver "triggers bug 1 in the lifecycle tests" shows up here only as C3's uncaught
`reading 'add'` errors (every seed). The useful run is the one after each fix: a scenario that flips to passing on
some seeds but not others points at an order dependence in the fix. Rerun after Phase 1 and after Phase 3.
