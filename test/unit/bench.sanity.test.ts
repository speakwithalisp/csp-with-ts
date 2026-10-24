// The benchmark scenarios must deliver every value, otherwise their timings measure a failure.
import { describe, expect, it } from 'vitest';
import { scenarios } from '../bench/scenarios';

describe('benchmark scenarios deliver every value', () => {
    for (const [name, run] of Object.entries(scenarios)) {
        it(name, async () => { expect(await run(40)).toBe(40); }, 10000);
    }
});
