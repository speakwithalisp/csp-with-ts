const cnt = require('./count.js');
const { chan, go, loop, timeout, putAsync } = require(process.argv[2] || './out/index.js');
const wait = ms => new Promise(r => setTimeout(r, ms));
process.on('uncaughtException', e => console.log('  UNCAUGHT:', e.message));
(async () => {
  const t0 = Date.now(); const ticks = [];
  const p = loop`<! ${timeout(100)} ${function* () { const v = yield; ticks.push([Date.now() - t0, v]); }}`;
  p.run();
  cnt.si = 0; cnt.st = 0;
  await wait(500); 
  console.log('loop over timeout(100), 500ms: body got', JSON.stringify(ticks.slice(0, 6)), `total=${ticks.length}; timers scheduled=${cnt.si + cnt.st}`);
  p.kill(); cnt.si = 0; cnt.st = 0; await wait(300);
  console.log(`after kill: timers in 300ms=${cnt.si + cnt.st}, bodies since=${ticks.length}`);
  // thunk variant: does the DSL accept a function returning a channel? (no)
  process.exit(0);
})();
