const L = require('./out/index.js');
const { chan, go, putAsync, takeAsync } = L;
(async () => {
  // A: two go-block takers (generator sinks) on one channel
  const a = chan(); const got = [];
  go`<! ${a} ${function* () { got.push(['g1', yield]); }}`;
  go`<! ${a} ${function* () { got.push(['g2', yield]); }}`;
  await new Promise(r => setTimeout(r, 20));
  putAsync(a, 42);
  await new Promise(r => setTimeout(r, 50));
  console.log('go-takers, one put ->', JSON.stringify(got));
  // B: two takeAsync on one channel
  const b = chan(); const got2 = [];
  takeAsync(b).then(v => got2.push(['t1', v])); takeAsync(b).then(v => got2.push(['t2', v]));
  putAsync(b, 7);
  await new Promise(r => setTimeout(r, 50));
  console.log('takeAsync x2, one put ->', JSON.stringify(got2));
  // C: go-takers, two puts
  const c = chan(); const got3 = [];
  go`<! ${c} ${function* () { while (true) got3.push(['g1', yield]); }}`;
  go`<! ${c} ${function* () { while (true) got3.push(['g2', yield]); }}`;
  await new Promise(r => setTimeout(r, 20));
  putAsync(c, 1); putAsync(c, 2);
  await new Promise(r => setTimeout(r, 50));
  console.log('looping go-takers, puts 1,2 ->', JSON.stringify(got3));
})();
