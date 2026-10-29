import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import { excalidrawAdapter } from './scripts/excalidraw-adapter.ts';
import { stableCodeBlocks } from './scripts/stable-code-blocks.ts';
import {preparePreviewAssets} from './scripts/prepare-preview-assets.mjs';
preparePreviewAssets();

// Keep Excalidraw's fonts offline in both the development and packaged app.
const fontSource = path.resolve(
  'node_modules/@excalidraw/excalidraw/dist/prod/fonts',
);
const fontTarget = path.resolve('public/excalidraw/fonts');
const drawingDependencies = Object.keys(JSON.parse(fs.readFileSync(
  path.resolve('node_modules/@excalidraw/excalidraw/package.json'), 'utf8',
)).dependencies).filter(name => name !== 'cross-env');
fs.mkdirSync(fontTarget, { recursive: true });
fs.cpSync(fontSource, fontTarget, { recursive: true });


export default defineConfig({
  plugins: [stableCodeBlocks(), excalidrawAdapter(), react()],
  base: './',
  server: { host: '127.0.0.1', port: 5173, strictPort: true,
    watch:{ignored:['**/release/**','**/android/**','**/build-app/**','**/dist/**','**/test-results/**']},
  },
  // The adapted Excalidraw entry is outside Vite's initial dependency scan.
  optimizeDeps: { include: drawingDependencies },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1700 },
});
