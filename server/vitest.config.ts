/** Vitest config: node environment, longer timeout for real-Redis integration tests. */

import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: { environment: 'node', testTimeout: 30000, hookTimeout: 30000 },
});
