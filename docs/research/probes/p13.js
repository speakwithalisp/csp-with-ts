const { chan, loop, putAsync } = require(process.argv[2]);
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const c = chan(); const seen = []; let acks = 0;
  const p = loop`<! ${c} ${function* () { seen.push(yield); }}`; p.run();
  for (let i = 0; i < 100; i++) { putAsync(c, i, false, () => acks++); await wait(0); }
  await wait(200);
  const missing = []; for (let i = 0; i < 100; i++) if (!seen.includes(i)) missing.push(i);
  const dup = seen.filter((v, k) => seen.indexOf(v) !== k);
  console.log(`acked=${acks} delivered=${seen.length} missing=${JSON.stringify(missing)} dups=${JSON.stringify(dup)} buffered=${c.count()}`);
  process.exit(0);
})();
