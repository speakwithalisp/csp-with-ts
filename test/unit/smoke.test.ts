import { describe, expect, it } from 'vitest';
import { chan, putAsync, takeAsync } from '../../src/index';

describe('smoke', () => {
    it('a value put on a channel can be taken', async () => {
        const c = chan<number>();
        putAsync(c, 1);
        expect(await takeAsync(c)).toBe(1);
    });
});
