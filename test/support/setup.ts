// Per-test-file setup: record spec metadata for the ledger, and reset the coordinator between tests.
import { afterAll, afterEach, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { __resetCSP, __setTestDefaults, DriverName } from '../../src/impl/service';

type Rec = { file: string };
const g = globalThis as unknown as { __specRegistry?: Rec[] };

// CSP_SCHEDULER=<driver> runs the whole suite on one driver (npm run test:drivers runs it on each).
const scheduler = process.env.CSP_SCHEDULER as DriverName | undefined;
if (scheduler) { __setTestDefaults({ scheduler }); }
__resetCSP();

afterEach(() => { __resetCSP(); });

afterAll(() => {
    const records = g.__specRegistry ?? [];
    g.__specRegistry = [];
    if (!records.length) { return; }
    const file = relative(process.cwd(), expect.getState().testPath ?? 'unknown');
    for (const r of records) { r.file = file; }
    const dir = join(process.cwd(), '.spec-meta');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${file.replace(/[^\w.-]+/g, '_')}.json`), JSON.stringify(records, null, 2));
});
