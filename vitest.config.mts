import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
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
