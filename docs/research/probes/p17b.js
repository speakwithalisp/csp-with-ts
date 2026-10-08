const { chan, putAsync, takeAsync } = require('./out/index.js');
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  for (const N of [3, 10]) {
    const e = chan(1); for (let i = 0; i < N; i++) putAsync(e, i);
    await wait(10);
    // sequential takers (one at a time) -> no broadcast possible
    const seq = []; for (let i = 0; i < N; i++) { const v = await Promise.race([takeAsync(e), wait(30).then(() => 'TIMEOUT')]); seq.push(v); }
    console.log(`N=${N} pending puts, sequential takes ->`, JSON.stringify(seq));
  }
  process.exit(0);
})();
