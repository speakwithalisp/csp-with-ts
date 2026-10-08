const N = 1_000_000;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const res = {};
async function bench(name, fn) { await fn(); /*warm*/ const t = now(); await fn(); const dt = now() - t; res[name] = +(dt / N * 1e6).toFixed(1) + ' ns/op'; }
const flush = () => new Promise(r => setTimeout(r, 0));
async function run() {
  // each "op" = suspend + resume with a value, driven from microtasks (how a CSP handoff resumes a consumer)
  await bench('callback via queueMicrotask', () => new Promise(done => { let i = 0, s = 0; const cb = v => { s += v; if (++i < N) queueMicrotask(() => cb(1)); else done(s); }; queueMicrotask(() => cb(1)); }));
  await bench('promise.then chain', () => { let p = Promise.resolve(0); for (let i = 0; i < N; i++) p = p.then(v => v + 1); return p; });
  await bench('async/await loop', async () => { let s = 0; for (let i = 0; i < N; i++) s += await 1; return s; });
  await bench('generator resumed via queueMicrotask', () => new Promise(done => { const g = (function* () { let s = 0; for (let i = 0; i < N; i++) s += yield; done(s); })(); g.next(); const step = () => { const r = g.next(1); if (!r.done) queueMicrotask(step); }; queueMicrotask(step); }));
  await bench('generator next() sync (no scheduling)', () => { const g = (function* () { let s = 0; for (;;) s += yield; })(); g.next(); for (let i = 0; i < N; i++) g.next(1); });
  await bench('for await over async generator', async () => { async function* src() { for (let i = 0; i < N; i++) yield 1; } let s = 0; for await (const v of src()) s += v; return s; });
  await bench('for await over hand-rolled async iterator', async () => { let i = 0; const it = { [Symbol.asyncIterator]() { return this; }, next() { return Promise.resolve(i++ < N ? { value: 1, done: false } : { value: undefined, done: true }); } }; let s = 0; for await (const v of it) s += v; return s; });
  return res;
}
if (typeof module !== 'undefined' && require.main === module) run().then(r => { console.log(JSON.stringify(r, null, 1)); });
else window.runPerf = run;
