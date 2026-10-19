const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path'), Module = require('node:module');
const source = require('esbuild').buildSync({ entryPoints: [path.resolve(__dirname, '../src/codeBlocks.ts')], bundle: true, write: false, platform: 'node', format: 'cjs' }).outputFiles[0].text;
const mod = new Module(__filename, module); mod.filename = __filename; mod.paths = module.paths; mod._compile(source, __filename);
const { runnable, formattable, canonicalLanguage, codeBlocks } = mod.exports;
const { canonical } = require('../electron/code-data.cjs');
test('C and C++ aliases share data identities and dprint support without executable tabs', () => {
  for (const name of ['c','C','cpp','CPP','c++','C++','cc','cxx']) {
    assert(runnable(name)); assert(formattable(name)); assert.equal(canonicalLanguage(name),canonical(name));
  }
  for (const name of ['py','python','js','javascript','ts','typescript','sql','SQL','sqlite','SQLite','lua','Lua','java','Java','cs','csharp','c#']) { assert(runnable(name)); assert(formattable(name)); assert.equal(canonicalLanguage(name),canonical(name)); }
  for (const name of ['tabs','mermaid','latex','clang']) { assert(!runnable(name)); assert(!formattable(name)); }
  const blocks=codeBlocks('```cpp\nint a;\n```\n\n```c++\nint b;\n```\n\n```tabs\n:::cpp\nint c;\n```');
  assert.deepEqual(blocks.map(b=>b.index),[1,2,1]); assert.equal(blocks.filter(b=>runnable(b.language)).length,2);
});
