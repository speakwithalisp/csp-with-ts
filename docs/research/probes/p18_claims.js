const { chan, go, putAsync, takeAsync, dropping, sliding, timeout } = require('./out/index.js');
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  // dropping(2): put 1..5 with no taker -> expect [1,2]; sliding(2) -> expect [4,5]
  for (const [name, buf] of [['dropping(2)', dropping(2)], ['sliding(2)', sliding(2)]]) {
    const c = chan(buf); let acks = 0; for (let i = 1; i <= 5; i++) putAsync(c, i, false, () => acks++);
    await wait(10); const got = []; for (let i = 0; i < c.count(); ) { got.push(await takeAsync(c)); if (!c.count()) break; }
    console.log(`${name}: puts never wait? acks=${acks}/5; contents taken in order = ${JSON.stringify(got)}`);
  }
  // putAsync on a closed channel: cb called? value dropped?
  { const c = chan(1); c.close(); await wait(5); let cb = false; putAsync(c, 7, false, () => cb = true); await wait(10);
    console.log(`putAsync on closed chan: callback called=${cb}, count=${c.count()}, take -> ${await takeAsync(c)}`); }
  // timeout: "receives true after msec ms, then closes" (taken on time)
  { const t = timeout(30); const v = await takeAsync(t); await wait(5); console.log(`timeout taken on time -> ${v}, closed afterwards=${t.closed}`); }
  // alts tagged-value workaround: transducer tags each input channel; does it identify the winner?
  { const tag = name => xf => ({ '@@transducer/init': xf['@@transducer/init'], '@@transducer/result': xf['@@transducer/result'], '@@transducer/step': (acc, v) => xf['@@transducer/step'](acc, { from: name, v }) });
    const a = chan(1, tag('a')), b = chan(1, tag('b')); const got = [];
    go`?: ${[a, b]} ${v => got.push(v)}`; await wait(5); putAsync(b, 42); await wait(30);
    console.log(`alts with tagging transducers, put on b -> handler got ${JSON.stringify(got)}`); }
  process.exit(0);
})();
