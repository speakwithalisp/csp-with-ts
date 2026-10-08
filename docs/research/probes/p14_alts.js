const { chan, go, putAsync, takeAsync, timeout } = require('./out/index.js');
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  // 1) both arms ready: how many values are consumed? which wins?
  { const a = chan(), b = chan(); putAsync(a, 'A1'); putAsync(b, 'B1'); await wait(5);
    const got = []; go`?: ${[a, b]} ${v => got.push(v)}`; await wait(30);
    console.log(`both ready -> handler got ${JSON.stringify(got)}; left in a=${a.count()} b=${b.count()} (a value consumed but not delivered = lost)`); }
  // 2) loser arm later: does a value put on the loser after alts resolved get swallowed?
  { const a = chan(), b = chan(); const got = []; go`?: ${[a, b]} ${v => got.push(v)}`; await wait(5);
    putAsync(a, 'A1'); await wait(20); let other = 'none';
    takeAsync(b).then(v => other = v); putAsync(b, 'B-later'); await wait(20);
    console.log(`after a won: later put on loser b reached a normal taker? ${other}`); }
  // 3) alts + plain take on the same channel at the same time
  { const a = chan(), t = timeout(50); const got = []; let plain = 'none';
    go`?: ${[a, t]} ${v => got.push(['alts', v])}`; takeAsync(a).then(v => plain = v); await wait(5);
    putAsync(a, 'X'); await wait(80);
    console.log(`alts + plain takeAsync on same chan, one put -> alts got ${JSON.stringify(got)}, plain got ${JSON.stringify(plain)}`); }
  process.exit(0);
})();
