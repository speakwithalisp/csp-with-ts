// A/B throughput run: alternates schedulers round by round (immediate, messagechannel, timeout, microtask, then again)
// so machine drift hits every driver equally, then prints the median of each driver's per-round mean.
// Usage: node scripts/bench-ab.mjs [--rounds 5] [--drivers immediate,messagechannel,...] [--out docs/perf/file.md]
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : dflt; };
const rounds = Number(arg('rounds', '5'));
const drivers = arg('drivers', 'immediate,messagechannel,timeout,microtask').split(',');
const out = arg('out', '');
const dir = mkdtempSync(join(tmpdir(), 'csp-bench-'));
const vitest = join(process.cwd(), 'node_modules/vitest/vitest.mjs');

const samples = new Map(); // `${driver}|${scenario}` -> mean ms per round
for (let r = 1; r <= rounds; r++) {
    for (const d of drivers) {
        const file = join(dir, `${r}-${d}.json`);
        const res = spawnSync(process.execPath, [vitest, 'run', '--project', 'bench'], {
            env: { ...process.env, CSP_SCHEDULER: d, BENCH_OUT: file }, encoding: 'utf8',
        });
        if (res.status !== 0) { console.error(res.stdout, res.stderr); process.exit(res.status ?? 1); }
        for (const row of JSON.parse(readFileSync(file, 'utf8'))) {
            const key = `${d}|${row.scenario}`;
            (samples.get(key) ?? samples.set(key, []).get(key)).push(row.meanMs);
        }
        process.stderr.write(`round ${r}/${rounds} ${d} done\n`);
    }
}
const median = xs => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const scenarios = [...new Set([...samples.keys()].map(k => k.split('|')[1]))];
const lines = [`| scenario (ms per run of 500 values, median of ${rounds} rounds; min-max) | ${drivers.join(' | ')} |`, `|---|${drivers.map(() => '---').join('|')}|`];
for (const s of scenarios) {
    const cells = drivers.map(d => { const xs = samples.get(`${d}|${s}`) ?? []; return `${median(xs).toFixed(2)} (${Math.min(...xs).toFixed(2)}-${Math.max(...xs).toFixed(2)})`; });
    lines.push(`| ${s} | ${cells.join(' | ')} |`);
}
const text = lines.join('\n');
console.log(text);
if (out) { writeFileSync(out, text + '\n'); }
