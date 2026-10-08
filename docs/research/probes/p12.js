const cnt = require('./count.js');
const { chan, go, loop, putAsync, takeAsync, timeout } = require('./out/index.js');
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const N = 200;
  { const c = chan(); go`<! ${c} ${function* () { while (true) yield; }}`; await wait(5); cnt.si = 0;
    for (let i = 0; i < N; i++) { putAsync(c, i); await wait(3); } console.log('go + looping generator sink:', (cnt.si / N).toFixed(1), 'setImmediate/value'); }
  { const c = chan(); const p = loop`<! ${c} ${function* () { yield; }}`; p.run(); await wait(5); cnt.si = 0;
    for (let i = 0; i < N; i++) { putAsync(c, i); await wait(3); } console.log('loop`<! ch fn*`           :', (cnt.si / N).toFixed(1), 'setImmediate/value'); p.kill(); }
  { const c = chan(); let n = 0; const p = loop`?: ${[timeout(10000), c]} ${v => n++}`; p.run(); await wait(5); cnt.si = 0;
    for (let i = 0; i < 50; i++) { putAsync(c, i); await wait(3); } console.log('loop`?: alts`             :', (cnt.si / 50).toFixed(1), 'setImmediate/value', 'handled', n, '/ 50'); }
  process.exit(0);
})();
