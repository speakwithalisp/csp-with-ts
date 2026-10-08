# Probes

These are throwaway scripts used for `docs/research/2026-10-inspection.md`. They are evidence, not tests. Each
one ran against a **compiled scratch copy** of `src/` at `master` @ `b745c2f`. The repo source was never modified.

## Rebuilding the variants they expect

```sh
# 1. compile src/ to CommonJS (TypeScript 6 still emits despite a few strict-mode errors)
tsc --outDir out --module commonjs --target es2019 --downlevelIteration --skipLibCheck \
    --types node --lib esnext,dom --ignoreDeprecations 6.0 --noEmitOnError false src/index.ts

# 2. out_st: setImmediate → setTimeout(…, 0) everywhere (simulates the local WIP change)
cp -r out out_st && sed -i -E 's/setImmediate\(([^,()]+(\([^()]*\))?)(\)|,)/setTimeout(\1, 0\3/g' out_st/**/*.js
#    plus the two arrow-function calls in out_st/loops.js, converted by hand

# 3. out_map: registry is a Map instead of a WeakMap (service.js: new WeakMap() → new Map())
# 4. out_nodel: out_st with the `CSP().delete(chan)` block at the end of flush() removed (processQueue.js)
# 5. out_dbg: out_st with diagnostic logging around the deferred add in loops.js and the delete in flush()

# browser bundles for bench*.js
node bundle.js out lib_si.js && node bundle.js out_st lib_st.js
```

Run the GC probe (`p7.js`) with `node --expose-gc`. The `bench*.js` and `perfb.js` scripts use Playwright with the
preinstalled Chromium. `dsl-*-sketch.ts(x)` are type-only. Check them with `tsc --noEmit --strict --lib esnext,dom` (add
`--jsx react --jsxFactory h` for the `.tsx` one).

| Script | What it shows |
|---|---|
| `p1_broadcast.js`, `p1b.js` | Broadcast to parked takers, buffered value reaches only one taker, LIFO delivery order |
| `p2_pingpong.js`, `p12.js` | Macrotask hops per value for each consumer style |
| `bench.js` / `bench2.js` / `bench3.js` | Chromium: scheduling primitives; pipeline and `loop` latency per scheduler |
| `p4.js` | `loop` over `timeout()` fires once, then stalls |
| `p9.js`, `p11.js` | Concurrent timeouts work; an untaken timeout stays open past its deadline |
| `p5.js`, `p6.js` | Bug 1 (`loop` crash) reproduction and root-cause stack |
| `p13.js` | Value stranded in buffer while newer values bypass it (FIFO violation) |
| `p7.js` | GC: WeakMap vs Map registry |
| `p15_chanchan.js` | Channels put onto channels are spliced in order; already-closed inner channel loses values; request/reply via wrapper object |
| `p14_alts.js` | alts double-consumption when both arms are ready; loser cleanup; alts + plain take |
| `p16_bounded.js` | Buffers are bounded; puts wait when full |
| `p17_pending.js`, `p17b.js` | Waiting puts delivered LIFO, second put lost; >64 waiting puts mostly lost |
| `p18_claims.js` | Dropping/sliding semantics, put on closed channel, timeout taken on time, alts tagging workaround |
| `dsl-sink-source-sketch.ts` | Type-only: the owner's `take`/`put` + `sink`/`source` DSL inside React `useEffect`; mistakes caught |
| `dsl-state-loop-sketch.ts` | Type-only: state-threading `loop` DSL (rejected by owner, kept for reference) |
| `perf.js`, `perfb.js`, `mem.js` | async/await vs generators vs callbacks: time and retained memory |
