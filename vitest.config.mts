import { defineConfig } from 'vitest/config';

// KNOWN BUG 1 (spec C15; also hit by C3): when a loop's events arrive 0-2 ms apart, flush() deletes the registry
// entry before loops.ts looks it up, and the deferred callback throws "Cannot read properties of undefined
// (reading 'add')" outside any test. Those specs fail on their assertions (they are it.fails), but the stray
// throw would also fail the whole run. Ignore exactly that error, and only when it comes from src/loops.ts.
// REMOVE this filter when bug 1 is fixed (roadmap Phase 1): C15 then passes and nothing should throw.
function isKnownBug1(error: { message?: string; stack?: string; stacks?: { file: string }[] }): boolean {
    const fromLoops = (error.stack ?? '').includes('loops.ts') || (error.stacks ?? []).some(s => s.file.endsWith('src/loops.ts'));
    return /reading 'add'/.test(error.message ?? '') && fromLoops;
}

export default defineConfig({
    test: {
        onUnhandledError(error) {
            if (isKnownBug1(error)) {
                return false;
            }
        },
        projects: [
            {
                test: {
                    name: 'unit',
                    include: ['test/unit/**/*.test.ts'],
                    setupFiles: ['test/support/setup.ts'],
                    environment: 'node',
                    // Each file runs in its own module graph, so the CSP() singleton starts fresh per file.
                    isolate: true,
                },
            },
            {
                test: {
                    name: 'memory',
                    include: ['test/memory/**/*.test.ts'],
                    setupFiles: ['test/support/setup.ts'],
                    environment: 'node',
                    pool: 'forks',
                    execArgv: ['--expose-gc'],
                },
            },
        ],
    },
});
