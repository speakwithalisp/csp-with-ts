const { chan, loop, putAsync, CSP } = require(process.argv[2]);
const wait = ms => new Promise(r => setTimeout(r, ms));
let crashes = 0; process.on('uncaughtException', e => { crashes++; if (crashes < 3) console.log('  UNCAUGHT:', e.message); });
(async () => {
  for (const gap of [0, 1, 2, 4, 8, 16]) {
    crashes = 0; const c = chan(); let n = 0;
    const p = loop`<! ${c} ${function* () { yield; n++; }}`; p.run();
    for (let i = 0; i < 100; i++) { putAsync(c, i); await wait(gap); }
    await wait(100);
    console.log(`gap=${gap}ms: delivered ${n}/100, crashes=${crashes}`);
    p.kill(); await wait(20);
  }
  process.exit(0);
})();
