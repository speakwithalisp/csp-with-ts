// retained heap per parked consumer
const K = 100_000;
const kinds = {
  'suspended generator (parked at yield)': () => { const g = (function* () { let s = 0; for (;;) s += yield; })(); g.next(); return g; },
  'async fn awaiting a pending promise': () => { let r; const p = new Promise(x => r = x); (async () => { let s = 0; for (;;) s += await p; })(); return r; },
  'closure callback': () => { let s = 0; return v => { s += v; }; },
};
function measure(name, make) {
  global.gc(); const before = process.memoryUsage().heapUsed;
  const keep = new Array(K); for (let i = 0; i < K; i++) keep[i] = make();
  global.gc(); const after = process.memoryUsage().heapUsed;
  console.log(`${name}: ${((after - before) / K).toFixed(0)} bytes each`);
  return keep.length;
}
for (const [n, f] of Object.entries(kinds)) measure(n, f);
