const { chan, loop, putAsync } = require('./out_dbg/index.js');
process.on('uncaughtException', e => { console.log('  UNCAUGHT:', e.message); process.exit(0); });
const c = chan(); const p = loop`<! ${c} ${function* () { yield; }}`; p.run();
setTimeout(() => { globalThis.__trace = true; putAsync(c, 1); putAsync(c, 2); putAsync(c, 3); }, 20);
