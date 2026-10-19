import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { compilerAssetCachePlugin } from './clang-memory-adapter.mjs';
const root = path.resolve(import.meta.dirname, '..');
const pkg = path.join(root, 'node_modules/@live-codes/clang-wasm');
const { ASSET_RECEIPTS } = await import(pathToFileURL(path.join(pkg, 'src/asset-receipts.js')).href);
const target = path.join(root, 'resources/clang');
const files = ['runtime-manifest.v1.json', 'bin/memfs.wasm.gz', 'bin/clang.wasm.gz', 'bin/lld.wasm.gz', 'bin/sysroot.tar.gz'];
const manifest = { package: '@live-codes/clang-wasm', version: '0.3.0', files: {} };
const assetSizes = {};
for (const name of files) {
  const bytes = await fs.readFile(path.join(pkg, 'assets', name));
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (ASSET_RECEIPTS[name]?.sha256 !== digest || ASSET_RECEIPTS[name].bytes !== bytes.length) throw new Error('Clang asset hash mismatch: ' + name);
  await fs.mkdir(path.dirname(path.join(target, name)), { recursive: true });
  await fs.writeFile(path.join(target, name), bytes);
  manifest.files[name] = { bytes: bytes.length, sha256: digest };
  if(name.endsWith('.gz')) {
    const decoded=gunzipSync(bytes),decodedBytes=decoded.byteLength;
    manifest.files[name].decodedBytes=decodedBytes;
    assetSizes['https://clang.moyu.invalid/clang/'+name]=decodedBytes;
  }
}
await fs.writeFile(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await fs.copyFile(path.join(pkg, 'THIRD-PARTY-NOTICES.md'), path.join(target, 'THIRD-PARTY-NOTICES.md'));
const notices = [];
for (const name of ['@live-codes/clang-wasm', '@wasm-idle/llvm-core', '@bjorn3/browser_wasi_shim', 'fflate']) {
  const directory = path.join(root, 'node_modules', name);
  const info = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
  notices.push(info.name + ' ' + info.version + ' (' + info.license + ')');
  for (const file of (await fs.readdir(directory)).filter(file => /^(license|notice)(\..*)?$/i.test(file))) notices.push(await fs.readFile(path.join(directory, file), 'utf8'));
}
await fs.writeFile(path.join(target, 'LICENSES.txt'), notices.join('\n\n'));
await build({ entryPoints: [path.join(root, 'electron/runner/clang-worker.mjs')], outfile: path.join(root, 'electron/runner/clang-runtime.mjs'), bundle: true, platform: 'browser', format: 'esm', target: 'chrome144', minify: true, legalComments: 'eof', plugins: [compilerAssetCachePlugin(assetSizes)] });
console.log('Clang C/C++ resources prepared offline: ' + files.length + ' assets.');
