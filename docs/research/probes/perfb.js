const { chromium } = require('/opt/node-tools/node_modules/playwright');
const fs = require('fs');
(async () => { const b = await chromium.launch(); const p = await b.newPage(); await p.goto('file://' + __dirname + '/bench.html');
  await p.addScriptTag({ content: fs.readFileSync(__dirname + '/perf.js', 'utf8') });
  console.log('== Chromium', b.version()); console.log(JSON.stringify(await p.evaluate(() => window.runPerf()), null, 1)); await b.close(); })();
