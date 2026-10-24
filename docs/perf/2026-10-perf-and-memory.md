# Performance and memory baseline (T6)

Measured 2026-10-25 on branch `claude/testability-and-dispatcher` (base `0cd7701`, plus the harness in this commit).
Node v22.23.4, Intel Core i7-9750H (12 threads), macOS. All numbers are for the code **before** the Phase 1-3 fixes;
rerun after each phase and compare. How to rerun: `npm run bench:ab` (throughput), `npm run test:mem` (memory),
`npm run build && npm run perf:startup` (start-up and exit).

## What changed from the brief

`vitest bench` does not exist in Vitest 5.0.5 (the package no longer exports `bench`; the CLI command is left but
has nothing to call). The throughput harness therefore uses `tinybench` (already a dependency of Vitest, now declared
as a dev dependency) inside a normal Vitest project called `bench`. `scripts/bench-ab.mjs` runs it in rounds and
switches the driver each round (immediate, messagechannel, timeout, microtask, then again), so machine drift
affects every driver equally.

## Throughput (`docs/perf/ab-throughput.md`)

Each scenario moves 500 values with one to four values in flight (the known bugs, C1/C4, bug 1 and A4, make heavier
load unsafe to measure). Median of 7 rounds of the per-round mean, with the min-max in brackets, in ms per run.

| scenario | immediate | messagechannel | timeout | microtask |
|---|---|---|---|---|
| pingPong (takeAsync/putAsync) | 9.95 (9.71-11.08) | 10.15 (9.60-10.64) | 10.15 (9.45-11.77) | 10.37 (9.82-13.54) |
| fanIn (4 producers) | 4.67 (4.48-5.56) | 4.90 (4.65-5.17) | 4.85 (4.58-6.11) | 5.14 (4.95-6.39) |
| pipeline (3 `loop` stages) | 94.67 (89.40-109.43) | 99.52 (92.72-112.55) | 98.32 (95.91-113.36) | 89.60 (82.29-101.97) |
| loopAlts (`loop` + `?:`, one live arm) | 95.13 (85.84-113.74) | 102.75 (93.99-115.41) | 98.87 (98.10-134.58) | 86.74 (78.82-95.94) |
| goSink (one `go` per value) | 21.19 (19.32-25.50) | 20.06 (18.50-20.71) | 19.82 (18.63-23.97) | 24.65 (22.95-28.59) |

Reading: in lock step the choice of driver moves the result by less than the round-to-round spread, except that
microtask is about 10% faster on the loop scenarios and 20% slower on `goSink` (the microtask driver runs steps
before the promise callbacks that drive the test, so it changes the interleaving rather than the cost). The cost is
in the matching code, not the scheduling hop: the loop scenarios take about 190 microseconds per value against about
20 for `pingPong`, which agrees with the dispatch budgets (7 dispatches per loop iteration against 4 for a plain
round trip) and with the per-operation `Object.defineProperties` cost noted in `async-core-investigation.md` Q4.
These timings do not model latency under real I/O or a browser.

## Memory (`test/memory/memory.test.ts`)

Three runs gave the same numbers to within 1%.

| measure | value |
|---|---|
| bytes per bare `chan()` | about 218 |
| bytes per parked `takeAsync` (queue entry plus instruction plus promise) | about 3,225 |
| heap growth per round when 5,000 channels with a parked take and a put are created and dropped (8 rounds) | about 4 KB per round (noise) |
| share of dropped channels that were finalised | 99.998% |
| heap growth per round when 300 `loop` processes are started and killed (6 rounds) | about 35 KB per round (about 115 bytes per loop) |
| share of killed loop processes that were finalised | 99.94% |

Reading: the `WeakMap` registry does not keep dropped channels alive, and killed loops are collected, so there is no
leak slope on these paths. Two things worth a look in the Phase 1-2 rewrites: a parked take costs about 15 channels'
worth of memory (3.2 KB), and a killed loop leaves about 115 bytes behind per loop (small, but it is a slope, probably
a hook list or the debug record; not investigated).

## Node start-up and exit (`docs/perf/node-startup.md`)

Median of 40 fresh Node processes per case, one run of each case per round. "First value" is measured from just before
`require` of the built library, so it includes loading it.

| driver | first value (ms) | whole process wall (ms) | wall minus empty process (ms) |
|---|---|---|---|
| (empty process) | - | 52.6 | 0.0 |
| immediate | 3.37 | 61.0 | 8.4 |
| messagechannel | 5.57 | 84.8 | 32.2 |
| timeout | 3.44 | 59.1 | 6.6 |
| microtask | 3.53 | 60.1 | 7.5 |

Reading: `messagechannel` starts about 2 ms later and delays process exit by about 24 ms compared with `immediate`.
That confirms handoff finding 5 in direction, with smaller numbers than the cloud container showed (first message
about 8 ms vs 1 ms there). The driver already holds a ref on the port only while a flush is pending
(`src/impl/dispatch.ts`, the `ref`/`unref` code in `makeMessageChannelDriver`), so the delay is not an open handle
keeping the loop alive; I did not find the cause (creating and tearing down the channel is the obvious suspect). It
supports D9: keep `setImmediate` as the Node default and `MessageChannel` for browsers.

## Seeded exploration

See `docs/perf/seeded-exploration.md`: shuffling changes no outcome yet (bugs fail on every seed, controls pass on every seed).

## Not done

The browser latency page (Playwright, based on `docs/research/probes/bench*.js`) from the handoff was left out because
the brief does not list it and the question to the owner is open.
