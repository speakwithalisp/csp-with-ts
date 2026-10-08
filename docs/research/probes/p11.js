const { timeout, takeAsync, chan } = require('./out/index.js');
const n = () => process.getActiveResourcesInfo().filter(x => x === 'Timeout').length;
const t0 = Date.now();
const base = n();
const t = timeout(100);
setImmediate(() => setImmediate(() => console.log('untaken timeout(100): armed timers =', n() - base)));
setTimeout(() => console.log('at 150ms: closed=', t.closed, 'count=', t.count()), 150);
setTimeout(() => { const p = takeAsync(t); p.then(v => console.log('late take ->', v, 'at', Date.now() - t0)); }, 200);
// taken-on-time timeout, then a second take after expiry
const u = timeout(50);
takeAsync(u).then(v => { console.log('on-time take ->', v); setTimeout(() => takeAsync(u).then(v2 => console.log('second take after expiry ->', v2)), 20); });
setTimeout(() => { console.log('exit 400ms'); process.exit(0); }, 400);
