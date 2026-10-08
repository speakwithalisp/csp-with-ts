const { chromium } = require('/opt/node-tools/node_modules/playwright');
const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('file://' + __dirname + '/bench.html');
  await p.evaluate(() => runPrims());
  // lib with setTimeout
  await p.addScriptTag({ content: fs.readFileSync(__dirname + '/lib_st.js', 'utf8') + ';window.L_ST=CSPLIB;' });
  await p.evaluate(() => runLib(window.L_ST, 'lib ping-pong, setTimeout(0) hops (your local WIP)', 100));
  // lib with setImmediate polyfilled by MessageChannel (what webpack4 / setimmediate pkg effectively did)
  await p.addScriptTag({ content: `(function(){var mc=new MessageChannel(),q=[];mc.port1.onmessage=function(){var t=q.shift();t[0].apply(null,t[1])};window.setImmediate=function(f){q.push([f,[].slice.call(arguments,1)]);mc.port2.postMessage(0)};})();` + fs.readFileSync(__dirname + '/lib_si.js', 'utf8') + ';window.L_SI=CSPLIB;' });
  await p.evaluate(() => runLib(window.L_SI, 'lib ping-pong, MessageChannel hops', 2000));
  console.log(JSON.stringify(await p.evaluate(() => results), null, 1));
  await b.close();
})();
