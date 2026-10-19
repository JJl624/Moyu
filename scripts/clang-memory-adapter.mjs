import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';

// llvm-core caches both compiled modules and their decompressed input buffers.
// Moyu reuses the modules; retaining another copy of clang/lld/memfs bytes is
// unnecessary. Apply this narrow adapter during bundling, never in node_modules.
// Pin the source so upgrading the dependency requires reviewing its lifetime.
export function adaptCompilerAssetCache(source, assetSizes = {}) {
  const digest=createHash('sha256').update(source).digest('hex');
  if(digest!=='d8a9e909a8706a412ad1c5fe732f14ba7f2264eeeb78249e3cf2471d8bad586b') {
    throw Error('llvm-core asset loader changed; review the Clang memory adapter.');
  }
  const anchor='moduleFingerprints.set(module, fingerprintCompiledBytes(compileBytes));';
  for(const size of Object.values(assetSizes)) if(!Number.isSafeInteger(size)||size<=0||size>128*1024*1024) throw Error('Invalid Clang decoded asset size.');
  return source.replace(anchor,anchor+'\n        if (!signal) bufferStore.delete(cacheKey);')
    .replace('new Uint8Array(Math.min(DEFAULT_DECOMPRESSION_BUFFER_BYTES, maxOutputBytes))',
      `new Uint8Array(Math.min((${JSON.stringify(assetSizes)})[String(assetUrl)] || DEFAULT_DECOMPRESSION_BUFFER_BYTES, maxOutputBytes))`)
    .replace('return Uint8Array.from(data);',`if (String(name) === 'https://clang.moyu.invalid/clang/bin/sysroot.tar.gz') { bufferStore.delete(\`\${name}\\0\${maxOutputBytes}\`); return data; }\n    return Uint8Array.from(data);`);
}
export const compilerAssetCachePlugin=(assetSizes)=>({
  name:'moyu-clang-asset-lifetime',
  setup(build){
    build.onLoad({filter:/[\\/]@wasm-idle[\\/]llvm-core[\\/]dist[\\/]core[\\/]src[\\/]wasm\.js$/},async({path})=>({
      contents:adaptCompilerAssetCache(await fs.readFile(path,'utf8'),assetSizes),loader:'js',
    }));
    build.onLoad({filter:/[\\/]@wasm-idle[\\/]llvm-core[\\/]dist[\\/]clang[\\/]src[\\/]app\.js$/},async({path})=>({
      contents:adaptCompilerFileStats(await fs.readFile(path,'utf8')),loader:'js',
    }));
  },
});


// File stat needs only a length, not a snapshot of the entire header/archive.
// Keep snapshots for actual reads: MemFS growth can invalidate borrowed views.
export function adaptCompilerFileStats(source) {
  if(createHash('sha256').update(source).digest('hex')!=='aaf0de1ab99ffbfb4bf7c31f47768f70a9f0b0548a3decd1ec0df54d9eb15b7b') throw Error('llvm-core file host changed; review the Clang memory adapter.');
  return source.replace('readMemfsFile(path) {','readMemfsFile(path, snapshot = true) {')
    .replace('return Uint8Array.from(this.memfs.getFileContents(candidate));','const contents = this.memfs.getFileContents(candidate);\n                return snapshot ? Uint8Array.from(contents) : contents;')
    .replace('const contents = this.readMemfsFile(path);\n        if (!contents) {','const contents = this.readMemfsFile(path, false);\n        if (!contents) {')
    .replace("this.useJsReadOverlay = name === 'wasm-ld' || name === 'ld.lld' || name === 'lld';","this.useJsReadOverlay = name === 'clang' || name === 'clang++' || name === 'wasm-ld' || name === 'ld.lld' || name === 'lld';");
}
