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
