import { defineConfig } from 'vite';

// Tauri shell frontend. The dev server port matches tauri.conf.json devUrl.
export default defineConfig({
  root: '.',
  server: { port: 5180, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
  clearScreen: false,
});
