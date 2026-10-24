import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: ['src/dsl/**'],
            reporter: ['text-summary', 'text', 'html', 'json-summary'],
            reportsDirectory: 'coverage',
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
                    name: 'bench',
                    setupFiles: ['test/support/bench-setup.ts'],
                    environment: 'node',
                    include: ['test/bench/**/*.perf.ts'],
                    testTimeout: 300000,
                },
            },
            {
                test: {
                    name: 'explore',
                    include: ['test/explore/**/*.explore.ts'],
                    environment: 'node',
                    testTimeout: 1800000,
                    // C3 and C15 crash with bug 1 on purpose; the script counts those, it must not fail the run.
                    dangerouslyIgnoreUnhandledErrors: true,
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
