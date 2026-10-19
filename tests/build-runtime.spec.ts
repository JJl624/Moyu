import { _electron as electron, expect, test } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const project = path.resolve(import.meta.dirname, '..');
test('Packaged esbuild resolves its API and the offline font subsetters load separate Wasm assets', async () => {
  test.setTimeout(60000);
  const data = await fs.mkdtemp(path.resolve(project, '../../work/build-runtime-'));
  const env = { ...process.env, MOYU_USER_DATA: data, MOYU_TEST: '1', MOYU_DEMO: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch(process.env.MOYU_E2E_EXECUTABLE
    ? { executablePath: process.env.MOYU_E2E_EXECUTABLE, args: [], env }
    : { args: [project], env });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.ProseMirror')).toBeVisible();
    const build = await app.evaluate(async ({ app }) => {
      const path = process.getBuiltinModule('path'), { createRequire } = process.getBuiltinModule('module');
      const localRequire = createRequire(path.join(app.getAppPath(), 'electron/main.cjs'));
      const esbuild = localRequire('esbuild');
      const transformed = await esbuild.transform('const value: number = 42;', { loader: 'ts' });
      const bundled = await esbuild.build({
        stdin: { contents: 'import { value } from "example"; console.log(value);' },
        bundle: true, write: false, format: 'esm',
        plugins: [{ name: 'example', setup(builder: any) {
          builder.onResolve({ filter: /^example$/ }, () => ({ path: 'example', namespace: 'example' }));
          builder.onLoad({ filter: /.*/, namespace: 'example' }, () => ({ contents: 'export const value = 42;' }));
        } }],
      });
      return { api: localRequire.resolve('esbuild'), expected: path.join(app.getAppPath(), 'node_modules/esbuild/lib/main.js'), transformed: transformed.code, bundled: bundled.outputFiles[0].text };
    });
    expect(build.api).toBe(build.expected);
    expect(build.transformed).toContain('42');
    expect(build.transformed).not.toContain(': number');
    expect(build.bundled).toContain('42');

    const files = await app.evaluate(({ app }) => {
      const fs = process.getBuiltinModule('fs'), path = process.getBuiltinModule('path'), dist = path.join(app.getAppPath(), 'dist');
      const chunk = fs.readdirSync(path.join(dist, 'assets')).find((file: string) => {
        if (!file.endsWith('.js')) return false;
        const source = fs.readFileSync(path.join(dist, 'assets', file), 'utf8');
        return source.includes('excalidraw-woff2-') && source.includes('excalidraw-harfbuzz-');
      });
      const fontRoot = path.join(dist, 'excalidraw/fonts/Excalifont');
      const font = fs.readdirSync(fontRoot).filter((file: string) => file.endsWith('.woff2'))
        .sort((a: string, b: string) => fs.statSync(path.join(fontRoot, b)).size - fs.statSync(path.join(fontRoot, a)).size)[0];
      return { chunk, font };
    });
    expect(files.chunk).toBeTruthy();
    const requests: string[] = [];
    page.on('request', request => { if (/excalidraw-(woff2|harfbuzz)-.*\.wasm/.test(request.url())) requests.push(request.url()); });
    const subset = await page.evaluate(async ({ chunk, font }) => {
      const module = await import(new URL('./assets/' + chunk, location.href).href);
      const bytes = await (await fetch(new URL('./excalidraw/fonts/Excalifont/' + font, location.href))).arrayBuffer();
      const outputs = [];
      for (const value of Object.values(module)) {
        if (typeof value !== 'function') continue;
        const result = await value(bytes, [65, 66]);
        if (result instanceof ArrayBuffer) outputs.push({ size: result.byteLength, magic: String.fromCharCode(...new Uint8Array(result).slice(0, 4)) });
      }
      return { original: bytes.byteLength, outputs };
    }, files);
    expect(subset.outputs).toHaveLength(1);
    expect(subset.outputs[0].magic).toBe('wOF2');
    expect(subset.outputs[0].size).toBeLessThan(subset.original);
    expect(requests).toHaveLength(2);
  } finally { await app.evaluate(({ app }) => app.exit(0)); }
});
