/** Vitest config for the web client: jsdom environment for React component tests. */

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [react()],
    test: { environment: 'jsdom', globals: true },
});
