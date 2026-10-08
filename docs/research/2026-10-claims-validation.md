# Validation of earlier library claims (8 Oct 2026)

Status: **research only.** An export of earlier notes about this library (a 3 Oct read-only inventory, a 5 Oct
end-to-end assessment of an old demo app, and the follow-up plans) was checked against the code on `master` @
`b745c2f`. Non-library material from those notes is deliberately left out
of this public repo.

Verdicts: ✅ confirmed · ⚠️ partly true / needs a caveat · ❌ contradicted by measurement · ❔ can't be checked from
here. "Probe" refers to scripts in [`probes/`](probes/README.md).

## Repository facts

| Claim | Verdict | Evidence |
|---|---|---|
| 91 commits: 75 + 8 under the author's two names, 8 by dependabot | ✅ | `git rev-list --count` on the unshallowed clone |
| First commit 2020-02-11 (CRA scaffold); last human commit 2020-09-12 (`v0.6.9`); last commit 2022-03-05 (dependabot merge) | ✅ | `git log` |
| ~1,537 code lines in `src/` (1,809 raw); `processQueue.ts` 361 | ✅ (1,533 / 1,785 on `master`; the difference is the uncommitted local changes) | line counts |
| 0 runtime dependencies, 26 dev dependencies | ✅ | `package.json` |
| No LICENSE file (package says GPL-3.0); placeholder `homepage`; no CI | ✅ | file listing, `package.json` |
| `test/` holds only CRA boilerplate; `test/App.tsx` imports `../lib/bundle`, which the build doesn't emit | ✅ | `test/App.tsx`, `rollup.config.js` |
| ~36 `any`, ~120 ` as ` in `src/` | ⚠️ 69 and 135 by a plain grep (counting methods differ) | grep |
| Published on npm (`latest` 0.7.0-alpha.2, a stray 9.5.4) | ❔ the npm registry isn't reachable from this environment | — |
| `tsc` fails at `processEvents.ts:77` (uncommitted `sleep` rewrite) | ❔ local working tree only; `master` compiles under TS 6 with unrelated strict errors in `channels.ts`/`go.ts` | compile |

## Behaviour claims (3 Oct inventory)

| Claim | Verdict | Evidence |
|---|---|---|
| Default channel is `fixed(1)`; `chan(0)` builds a broken channel; no unbuffered/rendezvous channels | ✅ | `channels.ts:177`; earlier plan §4.5 |
| Dropping buffer drops the new item; sliding drops the oldest; neither makes puts wait | ✅ | `p18_claims.js`: `dropping(2)` keeps `[1,2]`, `sliding(2)` keeps `[4,5]`, all 5 puts acknowledged |
| Fixed buffer: puts wait when full (backpressure) | ✅ | `p16_bounded.js` |
| `takeAsync` on a closed, empty channel resolves `null` | ✅ | `p11.js`, `p18_claims.js` |
| A put on a closed channel is dropped silently and its callback still fires | ✅ | `p18_claims.js` |
| `timeout(ms)` "receives `true` after `ms`, then closes" | ⚠️ True when taken on time (`p18_claims.js`). **Not true when nobody is waiting:** still open after its deadline, and a late take waits a full extra duration (`p11.js`) | probes |
| Timeout backed by `setTimeout` "and a Promise" | ⚠️ The Promise exists only in the uncommitted rewrite; `master` uses `setTimeout` alone | `processEvents.ts:60-66` |
| Alts: "the first operation to complete flags it done, and the others are cancelled" | ❌ The winner is picked as the *last* finished event (`process.ts:161`); with both arms ready, **both values are consumed and one is lost** | `p14_alts.js` |
| Alts returns only the value, not the winning channel | ✅ | `go.ts:91`, `process.ts:169-181` |
| Workaround: tag each input channel's values with a transducer to identify the winner | ✅ works | `p18_claims.js` |
| Channel-of-channel: a taker re-attaches to the inner channel; "closed inner channels are drained into the outer one" | ⚠️ / ❌ Open inner channels are spliced in order ✅. **Already-closed inner channels lose their buffered values**, and takers get `null` while the outer channel is open ❌ | `p15_chanchan.js` |
| "Hard throw at 1,024 pending items in any RingBuffer" | ❌ for pending puts: 1,100 waiting puts raised no error. The `MAX_DIRTY` cleanup runs first and **silently drops** them (1,100 → 12 delivered) | `p16_bounded.js`, `p17_pending.js` |
| `MAX_DIRTY = 64` cleanup discards callback waiters | ✅ now reproduced (70 waiting puts → 5 delivered) | `p17_pending.js`; earlier plan §4.3 |
| Early-terminating transducer never closes the channel (`isReduced` on a boolean) | ✅ | code `channels.ts:155-158`; earlier plan §4.1 (run) |
| `FixedBuffer.isFull` uses `===` | ✅ | `buffers.ts:149-151`; earlier plan §4.4 (run) |
| `altFlag` is shared mutable state on the channel | ✅ | `instructions.ts:15,68`, `scheduler.ts:12` |
| `go` returns only a kill function; `loop*` return unstarted processes | ✅ | `index.ts:7-11`, `loops.ts` |
| Processes "can be cloned, composed and killed" | ⚠️ `clone()` shares generator objects between clones; killing nested processes throws (bug 2) | earlier plan; `p3.js` |
| "Every resume costs a macrotask (`setTimeout 0`) … ≈4 ms clamping" | ⚠️ `master` uses `setImmediate` (the `setTimeout` swap is local). Per-event latency measured at ~0.1 ms on every scheduler; the clamp doesn't bite in short chains | `bench2.js`, `bench3.js` |

## End-to-end assessment claims (5 Oct)

| Claim | Verdict | Evidence |
|---|---|---|
| Bug 1: `loop`/`loopUntil` crash `Cannot read properties of undefined (reading 'add')` with events 1–4 ms apart | ✅ reproduced (gaps 0–2 ms on `setTimeout`, 0–1 ms on `setImmediate`) | `p5.js` |
| Bug 1 cause "registry lookup vs `close()` race, unproven" | ✅ **now proven**, with a refinement: the delete comes from the inner process's own `kill()` → `putAsync` → `drainToChan` → `flush()` → `CSP().delete`, before `loops.ts:34`'s deferred `get()` | `p6.js` stack trace |
| Closure-over-reassigned-variable theory falsified | ✅ consistent (the generator is suspended at `yield`) | reading |
| Bug 2: `setTimeout(proc.kill)` loses `this`, `this._events is not iterable` | ✅ reproduced; the child keeps consuming values after the parent's kill | `p3.js` |
| ~440 timers/s forever after unmount | ❔ not reproduced; a `loop` over a closed channel stalls rather than spins | `p3.js` |
| "One put on a shared channel reached both takers" | ✅ (deliberate broadcast); but timing-dependent: a buffered value reaches only one taker | `p1_broadcast.js`, `p1b.js` |
| ~25 `setTimeout` calls per input event | ✅ consistent: 7 hops per value through `loop`, 14 through `loop` + alts | `p12.js` |
| "That confirms the scheduler is the performance problem" / explains the 21 ms input-to-paint | ❌ Scheduler choice doesn't change per-event latency (~0.1 ms everywhere). The 21 ms is most likely the wait for the next frame plus render. The hop count is a CPU cost, not the latency | `bench*.js` |

## Not in the earlier notes (found since)

- **Waiting puts are delivered LIFO and the second put is always lost** (sequential takers): `[0, 9, 8, 7, 6, 5,
  4, 3, 2]` ([`p17b.js`](probes/p17b.js)). See [`2026-10-csp-lens.md`](2026-10-csp-lens.md) C1.
- A value can be stranded in the buffer while newer values bypass it (`p13.js`).
- `loop` over a closed channel stalls silently instead of ending (`p3.js`).
- Alts double consumption (above).
