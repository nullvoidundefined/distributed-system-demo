/** Vite config for the render-farm SPA: React plugin and a fixed dev-server port. */
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
export default defineConfig({ plugins: [react()], server: { port: 5173 } });
