/** Vitest config: node environment, longer timeout for real-Redis integration tests. */

import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        // integration files share one Redis queue and pub/sub channel; parallel files steal each other's jobs
        fileParallelism: false,
        hookTimeout: 30000,
        testTimeout: 30000,
    },
});
