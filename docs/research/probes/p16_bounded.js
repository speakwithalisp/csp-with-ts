const { chan, putAsync, takeAsync, go } = require('./out/index.js');
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  // fixed(1), no takers: do puts wait (backpressure) or pile up in the buffer?
  const c = chan(1); let acks = 0;
  for (let i = 0; i < 10; i++) putAsync(c, i, false, () => acks++);
  await wait(20);
  console.log(`chan(1), 10 putAsync, no taker -> buffer count=${c.count()} isFull=${c.isFull()} put callbacks fired=${acks}`);
  // go-block producer (generator source) into chan(1) with no taker: does it stop after 1?
  const d = chan(1); let produced = 0;
  go`>! ${d} ${function* () { for (let i = 0; i < 10; i++) { produced++; yield i; } }}`;
  await wait(20);
  console.log(`go producer of 10 into chan(1), no taker -> produced=${produced} buffer count=${d.count()}`);
  // >1024 pending puts
  const e = chan(1); let err = null;
  try { for (let i = 0; i < 1100; i++) putAsync(e, i); } catch (x) { err = x.message; }
  await wait(20); console.log(`1100 putAsync on chan(1) -> count=${e.count()} error=${err}`);
  process.exit(0);
})();
