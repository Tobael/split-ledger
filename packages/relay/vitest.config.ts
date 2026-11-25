import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
    resolve: {
        alias: {
            '@splitledger/core': path.resolve(__dirname, '../core/src/index.ts'),
        },
    },
    test: {
        include: ['src/**/*.test.ts'],
        testTimeout: 15000,
    },
});
