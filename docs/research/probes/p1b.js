const { chan, go, putAsync, takeAsync } = require('./out/index.js');
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  // put BEFORE takers park: buffered value
  const a = chan(1); const got = [];
  putAsync(a, 'early');
  takeAsync(a).then(v => got.push(['t1', v])); takeAsync(a).then(v => got.push(['t2', v]));
  await wait(30);
  console.log('buffered then 2 takers ->', JSON.stringify(got), '(t2 still pending if missing)');
  // fast producer, 2 takers: do puts wait for both?
  const b = chan(1); const log = [];
  go`<! ${b} ${function* () { while (true) log.push('A' + (yield)); }}`;
  go`<! ${b} ${function* () { while (true) log.push('B' + (yield)); }}`;
  await wait(10);
  for (let i = 0; i < 5; i++) putAsync(b, i, false, () => log.push('ack' + i));
  await wait(50);
  console.log('5 rapid puts ->', log.join(' '));
})();
