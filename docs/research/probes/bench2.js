const { chromium } = require('/opt/node-tools/node_modules/playwright');
const fs = require('fs');
const pipe = `window.runPipe = (L, label, N) => new Promise(res => {
  // event -> go stage1 (map) -> chan -> go stage2 -> chan -> go sink ; measure latency per event
  const a = L.chan(), b = L.chan(), c = L.chan(); const lat = [];
  L.go\`<! \${a} \${function* () { while (true) { const v = yield; L.putAsync(b, v); } }}\`;
  L.go\`<! \${b} \${function* () { while (true) { const v = yield; L.putAsync(c, v); } }}\`;
  L.go\`<! \${c} \${function* () { while (true) { const t = yield; lat.push(performance.now() - t); if (lat.length === N) { lat.sort((x,y)=>x-y); window.results[label] = { events: N, medianMs: +lat[N>>1].toFixed(3), p95Ms: +lat[Math.floor(N*0.95)].toFixed(3) }; res(); } } }}\`;
  let i = 0; const fire = () => { L.putAsync(a, performance.now()); if (++i < N) setTimeout(fire, 8); }; setTimeout(fire, 20);
});`;
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('file://' + __dirname + '/bench.html');
  await p.addScriptTag({ content: pipe });
  await p.addScriptTag({ content: fs.readFileSync(__dirname + '/lib_st.js', 'utf8') + ';window.L_ST=CSPLIB;' });
  await p.evaluate(() => runPipe(window.L_ST, '3-stage go pipeline, setTimeout(0)', 60));
  await p.addScriptTag({ content: `(function(){var mc=new MessageChannel(),q=[];mc.port1.onmessage=function(){var t=q.shift();t[0].apply(null,t[1])};window.setImmediate=function(f){q.push([f,[].slice.call(arguments,1)]);mc.port2.postMessage(0)};})();` + fs.readFileSync(__dirname + '/lib_si.js', 'utf8') + ';window.L_SI=CSPLIB;' });
  await p.evaluate(() => runPipe(window.L_SI, '3-stage go pipeline, MessageChannel', 60));
  await p.addScriptTag({ content: `window.setImmediate=function(f){var a=[].slice.call(arguments,1);queueMicrotask(function(){f.apply(null,a)})};` + fs.readFileSync(__dirname + '/lib_si.js', 'utf8') + ';window.L_MT=CSPLIB;' });
  await p.evaluate(() => runPipe(window.L_MT, '3-stage go pipeline, queueMicrotask', 60));
  console.log(JSON.stringify(await p.evaluate(() => results), null, 1));
  await b.close();
})();
