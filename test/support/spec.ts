// spec(): declare a test with an ID and plain-language text, so the owner can review and sign off sentences
// (see scripts/spec-ledger.mjs and docs/tests/SPEC-LEDGER.md).
import { createHash } from 'node:crypto';
import { it } from 'vitest';

export type SpecKind = 'spec' | 'characterisation';

export interface SpecMeta {
    /** What must happen. Defaults to the title. */
    must?: string;
    /** What must not happen (the bug being replaced, or a misuse that must be rejected). */
    mustNot?: string;
    /** Where the rule comes from (Hoare 1978, Go TestChan, core.async tests, a probe...). */
    source?: string;
    kind?: SpecKind;
    /** The current code is known to fail this spec: the test is registered with it.fails until fixed. */
    knownBug?: string;
    /** Roadmap phase or task that should flip it (e.g. 'Phase 1', 'T8'). */
    fixedBy?: string;
    timeout?: number;
}

export interface SpecRecord extends Required<Pick<SpecMeta, 'kind'>> {
    id: string;
    title: string;
    must: string;
    mustNot?: string;
    source?: string;
    knownBug?: string;
    fixedBy?: string;
    file: string;
    hash: string;
}

const g = globalThis as unknown as { __specRegistry?: SpecRecord[] };
g.__specRegistry ??= [];

export function spec(id: string, title: string, meta: SpecMeta, fn: () => unknown | Promise<unknown>): void {
    const kind = meta.kind ?? 'spec';
    const must = meta.must ?? title;
    const hash = createHash('sha256')
        .update([id, title, must, meta.mustNot ?? '', meta.source ?? '', fn.toString()].join('\u0000'))
        .digest('hex').slice(0, 12);
    g.__specRegistry!.push({
        id, title, must, mustNot: meta.mustNot, source: meta.source, kind,
        knownBug: meta.knownBug, fixedBy: meta.fixedBy, file: '', hash,
    });
    const name = `[${id}] ${title}`;
    // SPEC_SHOW_BUGS=1 runs known-bug specs as normal tests, to see HOW they fail (the failure should match knownBug).
    if (meta.knownBug && process.env.SPEC_SHOW_BUGS !== '1') {
        it.fails(name, fn, meta.timeout);
    } else {
        it(name, fn, meta.timeout);
    }
}
