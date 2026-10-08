const { timeout, takeAsync } = require('./out/index.js');
const t0 = Date.now();
const a = timeout(100), b = timeout(150), c = timeout(200);
console.log('active timers right after 3 timeout() calls:', process.getActiveResourcesInfo().filter(x => x === 'Timeout').length, '(+ immediates:', process.getActiveResourcesInfo().filter(x => x === 'Immediate').length, ')');
setTimeout(() => console.log('active timers at 5ms:', process.getActiveResourcesInfo().filter(x => x === 'Timeout').length), 5);
for (const [n, ch] of [['a100', a], ['b150', b], ['c200', c]]) takeAsync(ch).then(v => console.log(n, '->', v, 'at', Date.now() - t0, 'ms'));
setTimeout(() => { console.log('done 400ms'); process.exit(0); }, 400);
