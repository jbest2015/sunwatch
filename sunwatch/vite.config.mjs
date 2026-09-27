import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { createBrowserViteConfig } from '../build/vite.js';
const root = fileURLToPath(new URL('../', import.meta.url));
export default defineConfig(() => {
  const config = createBrowserViteConfig({ command: 'build' });
  return {
    ...config,
    root,
    define: {
      ...config.define,
      'import.meta.env.CESIUM_ION_TOKEN':
        'window.__SUNWATCH_CONFIG__.cesiumToken',
      'import.meta.env.GOOGLE_MAPS_API_KEY': '""',
    },
    build: { ...config.build, outDir: 'sunwatch/dist', emptyOutDir: true },
  };
});
