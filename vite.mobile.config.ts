import { defineConfig, mergeConfig } from 'vite';
import desktop from './vite.config.ts';
export default mergeConfig(desktop, defineConfig({
  build: {
    copyPublicDir: false,
    outDir: 'android/app/src/main/assets/web',
    target: 'chrome100',
    rollupOptions: { input: 'mobile.html' },
  },
}));
