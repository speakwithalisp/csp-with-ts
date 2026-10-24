// Start-up and exit cost of each scheduler in Node (handoff finding 5: MessageChannel starts slower and delays exit).
// Needs a build (`npm run build`). For each driver it spawns fresh Node processes that put one value through a
// channel, and reports the median time to the first value and the median wall time of the whole process, next to an
// empty-process baseline. Usage: node scripts/startup-cost.mjs [--runs 25] [--out docs/perf/file.md]
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : dflt; };
const runs = Number(arg('runs', '25'));
const out = arg('out', '');
const lib = join(process.cwd(), 'lib/index.js');
const child = driver => `
const t0 = process.hrtime.bigint();
const { configure, chan, putAsync, takeAsync } = require(${JSON.stringify(lib)});
configure({ scheduler: ${JSON.stringify(driver)} });
const c = chan(1);
takeAsync(c).then(() => { console.log(Number(process.hrtime.bigint() - t0) / 1e6); });
putAsync(c, 1);`;

const median = xs => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const drivers = ['immediate', 'messagechannel', 'timeout', 'microtask'];
const cases = [['(empty process)', '0'], ...drivers.map(d => [d, child(d)])];
const acc = new Map(cases.map(([name]) => [name, { first: [], wall: [] }]));
// One run of every case per round, so drift in machine load hits all of them equally.
for (let i = 0; i < runs; i++) {
    for (const [name, code] of cases) {
        const t = process.hrtime.bigint();
        const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8' });
        acc.get(name).wall.push(Number(process.hrtime.bigint() - t) / 1e6);
        if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
        const v = parseFloat(r.stdout); if (!Number.isNaN(v)) { acc.get(name).first.push(v); }
    }
}
const rows = cases.map(([name]) => { const a = acc.get(name); return [name, { first: a.first.length ? median(a.first) : NaN, wall: median(a.wall) }]; });
const base = rows[0][1].wall;
const lines = [`| driver | first value after load (ms) | whole process wall (ms) | wall minus empty process (ms) |`, `|---|---|---|---|`];
for (const [d, m] of rows) { lines.push(`| ${d} | ${Number.isNaN(m.first) ? '-' : m.first.toFixed(2)} | ${m.wall.toFixed(1)} | ${(m.wall - base).toFixed(1)} |`); }
const text = lines.join('\n') + `\n\nMedians of ${runs} fresh processes each, Node ${process.version}.`;
console.log(text);
if (out) { writeFileSync(out, text + '\n'); }
