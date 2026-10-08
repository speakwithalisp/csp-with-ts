const { chan, go, putAsync, takeAsync, isChan } = require('./out/index.js');
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  // A) put a channel onto a channel, then takers
  { const outer = chan(4), inner = chan(4);
    putAsync(inner, 'i1'); putAsync(inner, 'i2'); putAsync(outer, inner); putAsync(outer, 'after');
    const got = []; for (let k = 0; k < 3; k++) takeAsync(outer).then(v => got.push(isChan(v) ? '<chan>' : v));
    await wait(30); console.log('A  inner has i1,i2 (open) then "after": takers got', JSON.stringify(got));
    inner.close(); await wait(30); console.log('   after closing inner:', JSON.stringify(got)); }
  // B) same, inner closed before being put
  { const outer = chan(4), inner = chan(4);
    putAsync(inner, 'i1'); putAsync(inner, 'i2'); inner.close(); putAsync(outer, inner); putAsync(outer, 'after');
    const got = []; for (let k = 0; k < 3; k++) takeAsync(outer).then(v => got.push(isChan(v) ? '<chan>' : v));
    await wait(30); console.log('B  inner closed with i1,i2 then "after": takers got', JSON.stringify(got)); }
  // C) request/reply: channel wrapped in an object is delivered as a value
  { const reqs = chan(); const reply = chan();
    takeAsync(reqs).then(r => putAsync(r.reply, r.q.length));
    putAsync(reqs, { q: 'hello', reply });
    console.log('C  reply via {q, reply} object ->', await takeAsync(reply)); }
  process.exit(0);
})();
