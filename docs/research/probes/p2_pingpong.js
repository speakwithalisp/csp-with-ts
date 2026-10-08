const cnt = require('./count.js');
const { chan, go, putAsync, takeAsync } = require('./out/index.js');
// ping-pong: N round trips via takeAsync/putAsync (simplest path)
(async () => {
  const N = 2000; const ping = chan(), pong = chan();
  (async () => { for (;;) { const v = await takeAsync(ping); if (v === null) break; putAsync(pong, v + 1); } })();
  const t0 = performance.now(); cnt.si = 0; cnt.st = 0;
  let v = 0;
  for (let i = 0; i < N; i++) { putAsync(ping, v); v = await takeAsync(pong); }
  const t1 = performance.now();
  console.log(`takeAsync/putAsync ping-pong: ${N} round trips in ${(t1 - t0).toFixed(1)}ms = ${((t1 - t0) / N * 1000).toFixed(1)}us/trip; setImmediate=${cnt.si} setTimeout=${cnt.st} (${(cnt.si / N).toFixed(1)} hops/trip)`);
  // go-block consumer: values through a looping generator sink
  const c = chan(); let n = 0, done;
  const fin = new Promise(r => done = r);
  go`<! ${c} ${function* () { while (true) { yield; if (++n === N) done(); } }}`;
  await new Promise(r => setTimeout(r, 5));
  cnt.si = 0; const t2 = performance.now();
  for (let i = 0; i < N; i++) await new Promise(r => putAsync(c, i, false, r));
  await fin; const t3 = performance.now();
  console.log(`go-sink: ${N} values in ${(t3 - t2).toFixed(1)}ms; setImmediate=${cnt.si} (${(cnt.si / N).toFixed(1)}/value)`);
  process.exit(0);
})();
