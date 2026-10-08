const { chan, go, putAsync, takeAsync, timeout } = require(process.argv[2]);
const wait = ms => new Promise(r => setTimeout(r, ms));
let collected = 0; const fr = new FinalizationRegistry(() => collected++);
async function gcRound(label, make, N = 2000) {
  collected = 0;
  for (let i = 0; i < N; i++) fr.register(make(), null);
  for (let k = 0; k < 6; k++) { await wait(30); global.gc(); }
  console.log(`  ${label}: ${collected}/${N} channels collected`);
}
(async () => {
  await gcRound('closed after use (put, take, close)', () => { const c = chan(); putAsync(c, 1); takeAsync(c); c.close(); return c; });
  await gcRound('never closed, idle, unreferenced', () => chan());
  await gcRound('abandoned: go-block parked on take, nobody puts', () => { const c = chan(); go`<! ${c} ${function* () { yield; }}`; return c; });
  await gcRound('abandoned: takeAsync pending, nobody puts', () => { const c = chan(); takeAsync(c); return c; });
  await gcRound('pending timeout(60000)', () => timeout(60000), 300);
  process.exit(0);
})();
