const { chan, putAsync, takeAsync } = require('./out/index.js');
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  for (const N of [10, 64, 70, 1100]) {
    const e = chan(1); let acks = 0;
    for (let i = 0; i < N; i++) putAsync(e, i, false, () => acks++);
    await wait(10);
    const got = []; for (let i = 0; i < N; i++) takeAsync(e).then(v => got.push(v));
    await wait(100);
    const inOrder = got.every((v, k) => k === 0 || v > got[k - 1]);
    console.log(`N=${N} pending puts on chan(1): delivered ${got.filter(v => v !== null && v !== undefined).length}/${N}, nulls/undef=${got.filter(v => v == null).length}, in order=${inOrder}`);
  }
  process.exit(0);
})();
