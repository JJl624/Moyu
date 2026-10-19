const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { RuntimeSettings, DEFAULTS, validate } = require('../electron/runtime-settings.cjs');
test('Compiler optimization accepts supported values while global program arguments are rejected',()=>{
 assert.equal(validate('clang',{optimizationLevel:'Oz'}).optimizationLevel,'Oz');
 assert.throws(()=>validate('clang',{optimizationLevel:'O2 -I/host'}));
 assert.throws(()=>validate('clang',{arguments:['a b','中文']}));
 assert.throws(()=>validate('lua',{arguments:['hello','42']}));
 assert.throws(()=>validate('lua',{arguments:['a\0b']}));
});
const { prepareClangSource, analyze } = require('../electron/clang-source.cjs');

test('Runtime defaults are offline and unwritten; settings serialize without losing the other language and deletion restores defaults', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moyu-runtime-'));
  try {
    const store = new RuntimeSettings(root);
    assert.deepEqual(await store.config('clang'), DEFAULTS.clang);
    assert.equal(await fs.stat(store.file).catch(() => null), null);
    await Promise.all([store.configure('clang', { autoMain: false, cHeaders: ['stdio.h', 'math.h', 'stdio.h'], cStandard: 'c99' }), store.configure('javascript', { executionTimeoutSeconds: 2 })]);
    const restored = new RuntimeSettings(root);
    assert.equal((await restored.config('javascript')).executionTimeoutSeconds, 2);
    assert.deepEqual((await restored.config('clang')).cHeaders, ['stdio.h', 'math.h']);
    assert.equal((await restored.config('clang')).autoMain, false);
    assert.equal((await restored.config('clang')).cStandard, 'c99');
    assert.equal((await restored.config('clang')).cppStandard, 'gnu++23');
    const before = await fs.readFile(store.file, 'utf8');
    await assert.rejects(store.configure('clang', { cHeaders: ['stdio.h>\n#error injected'] }));
    assert.equal(await fs.readFile(store.file, 'utf8'), before);
    await fs.unlink(store.file);
    assert.deepEqual(await restored.config('javascript'), DEFAULTS.javascript);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('Runtime settings reject invalid limits, standards, header paths, prototype keys and unsupported JS options', () => {
  for (const value of [null, 0, 3601, NaN, 1.5, '10']) assert.throws(() => validate('clang', { executionTimeoutSeconds: value }));
  for (const value of ['gnu++42', '-O3', 'gnu23\n']) assert.throws(() => validate('clang', { cppStandard: value }));
  for (const value of ['../stdio.h', '/stdio.h', 'foo//bar', '.', 'foo/../bar', '"stdio.h"', '<stdio.h>', 'a\0b', 'a b']) assert.throws(() => validate('clang', { cHeaders: [value] }));
  assert.throws(() => validate('clang', { autoMain: 'true' }));
  assert.throws(() => validate('javascript', { cHeaders: [] }));
  assert.throws(() => validate('clang', JSON.parse('{"__proto__":[]}')));
  assert.deepEqual(validate('clang', { cHeaders: [] }).cHeaders, []);
});

test('SQL/Lua settings validate block-relative file paths, switches, row limits and reject unrelated runtime options', () => {
  for (const language of ['sql','lua']) {
    assert.equal(validate(language, { executionTimeoutSeconds: 1 }).executionTimeoutSeconds, 1);
    assert.throws(() => validate(language, { cHeaders: [] }));
    for (const file of ['../host', '/host', 'C:/host', 'a/../host', 'a\\host', 'a\0b']) assert.throws(() => validate(language, { [language === 'sql' ? 'databaseFile' : 'stdinFile']: file }));
  }
  assert.equal(validate('sql', { databaseFile: '数据库/db.sqlite', foreignKeys: false, maxRows: 20 }).databaseFile, '数据库/db.sqlite');
  for (const maxRows of [0,1001,1.5,'20']) assert.throws(() => validate('sql', { maxRows }));
  assert.throws(() => validate('sql', { databaseFile: '' }));
  assert.throws(() => validate('sql', { foreignKeys: 'false' }));
  assert.throws(() => validate('lua', { enableModules: 'false' }));
  assert.equal(validate('lua', { stdinFile: '', enableModules: false }).stdinFile, '');
});
test('Snippet wrapping uses language-specific headers, keeps source line numbers, and can be disabled', () => {
  const c = prepareClangSource('printf("hello");', 'c', DEFAULTS.clang);
  assert.match(c, /^#include <stdio.h>\n#include <stdlib.h>/);
  assert.match(c, /int main\(void\) \{\n#line 1 "main.c"\nprintf\("hello"\);/);
  const cpp = prepareClangSource('std::cout << 42;', 'cpp', DEFAULTS.clang);
  assert.match(cpp, /^#include <iostream>/);
  assert.match(cpp, /int main\(\)/);
  assert.doesNotMatch(prepareClangSource('printf("hello");', 'c', { ...DEFAULTS.clang, autoMain: false }), /int main/);
  assert.equal(prepareClangSource('int main() { return 0; }', 'cpp', { ...DEFAULTS.clang, cppHeaders: [] }).match(/int main/g).length, 1);
});
test('Entry-point detection ignores comments, literals, raw strings, preprocessor macros, prototypes and nested functions', () => {
  for (const source of [
    '// int main() {}\nprintf("x");',
    '/* int main() {} */ puts("x");',
    'puts("int main() { } \\\" quote");',
    'std::cout << R"tag(int main() { })tag";',
    '#define WORD "int main() {}"\nputs(WORD);',
    'int main(void); puts("prototype");',
    '// comment \\\nint main() {}\nputs("not main");',
    'struct X { int main() { return 1; } }; X x;',
  ]) assert.equal(analyze(source).main, false, source);
  for (const source of [
    'int main(void) { return 0; }',
    'int\nmain /* hello */ (int argc, char **argv) { return argc; }',
    'int twice(int x) { return x*2; } int main() { return twice(2); }',
    "const int n=1'000; int main() { return 0; }",
    'auto main() -> int { return 0; }',
  ]) assert.equal(analyze(source).main, true, source);
});
test('Snippet includes and helper definitions remain at file scope while conditional statements retain their order', () => {
  const source = '#include <stdio.h>\n#define VALUE 4\nint twice(int x) { return x*2; }\n#if VALUE == 4\nprintf("%d", twice(VALUE));\n#else\n#error wrong branch\n#endif';
  const generated = prepareClangSource(source, 'c', { ...DEFAULTS.clang, cHeaders: [] });
  assert(generated.indexOf('#include <stdio.h>') < generated.indexOf('int main(void)'));
  assert(generated.indexOf('int twice(int x)') < generated.indexOf('int main(void)'));
  assert(generated.indexOf('#if VALUE == 4') > generated.indexOf('int main(void)'));
  assert(generated.indexOf('#else') > generated.indexOf('printf("%d"'));
  const conditionalHeaders = prepareClangSource('#if 1\n#include <stdio.h>\n#endif\nputs("yes");', 'c', { ...DEFAULTS.clang, cHeaders: [] });
  assert(conditionalHeaders.indexOf('#endif') < conditionalHeaders.indexOf('int main(void)'));
});
test('Multi-file projects include helpers and extensionless headers, reserve editor entry names, and ignore unrelated data in compile identity',async()=>{
 const {clangProject}=await import('../electron/runner/clang-project.mjs');
 const file=(name,text)=>({name,data:Buffer.from(text).toString('base64')});
 const input={project:'block-one',language:'cpp',code:'#include "config"\nstd::cout << twice(VALUE);',clangSettings:DEFAULTS.clang,files:[file('config','#define VALUE 4\nint twice(int);'),file('helper.cpp','int twice(int x){return x*2;}'),file('stdin.txt','42'),file('output/example.cpp','int ignored;')]};
 const p=clangProject(input);assert.deepEqual(p.workspaceFiles.map(f=>f.path),['workspace/config','workspace/helper.cpp']);assert.match(p.code,/int main\(\)/);assert.doesNotMatch(p.workspaceFiles[1].content,/int main\(\)/);assert.equal(new TextDecoder().decode(p.stdin),'42');
 assert.equal(typeof p.workspaceFiles[0].content,'string');
 assert.deepEqual(clangProject({...input,files:[...input.files,file('notes.txt','arbitrary data')]}),p);
 assert.deepEqual(clangProject({...input,project:'block-two'}),p);
 assert.notDeepEqual(clangProject({...input,files:input.files.filter(f=>f.name!=='config')}).workspaceFiles,p.workspaceFiles);
 const complete=clangProject({...input,code:'int helper(){return 1;}',files:[file('_moyu_entry.cpp','int main(){return helper();}')]});assert.doesNotMatch(complete.code,/int main\(\)/);assert.equal(complete.entry,'workspace/__moyu_entry.cpp');
 const disabled=clangProject({...input,clangSettings:{...DEFAULTS.clang,multiFile:false}});assert.deepEqual(disabled.workspaceFiles.map(f=>f.path),['workspace/config']);
 const raw='#include "config"',quoted=clangProject({...input,code:'std::cout << R"tag(\n'+raw+'\n)tag";',files:[file('config','#define VALUE 4')]});assert.deepEqual(quoted.workspaceFiles,[]);assert(quoted.code.includes(raw));
});

test('Old global arguments are ignored without rewriting the settings file',async()=>{const root=await fs.mkdtemp(path.resolve(__dirname,'../../../work/runtime-legacy-'));try{const store=new RuntimeSettings(root),old=JSON.stringify({version:1,code:{clang:{arguments:['leak'],optimizationLevel:'O2'},ruby:{arguments:['old']}}});await fs.writeFile(store.file,old);assert.equal((await store.config('clang')).optimizationLevel,'O2');assert.equal((await store.config('clang')).arguments,undefined);assert.equal((await store.config('ruby')).arguments,undefined);assert.equal(await fs.readFile(store.file,'utf8'),old);}finally{await fs.rm(root,{recursive:true,force:true});}});
