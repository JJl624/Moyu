const {test}=require('node:test'),assert=require('node:assert/strict');
const {formatCode,closeFormatter}=require('../electron/format.cjs');
const config={lineWidth:88,indentWidth:4,useTabs:false,newLineKind:'lf'};
const typescript={quoteStyle:'alwaysSingle',semiColons:'asi','objectExpression.trailingCommas':'never','module.sortImportDeclarations':'maintain','module.sortExportDeclarations':'maintain','importDeclaration.sortNamedImports':'maintain'},ruff={quoteStyle:'single',indentWidth:4,lineLength:88};
const format=(language,code,pluginConfig=language==='python'?ruff:typescript)=>formatCode({language,code,config,pluginConfig});
test('Official dprint plugins format JS/TS and Python offline without executing source',async t=>{
 t.after(closeFormatter);
 const [ts,py]=await Promise.all([format('ts','const x:string="中文";console.log(x);'),format('python','if True:\n  print( 1+2 )\nraise RuntimeError("do not execute")')]);
 assert.match(ts,/const x: string = '中文'/);assert.doesNotMatch(ts,/;/);assert.match(py,/    print\(1 \+ 2\)/);assert.match(py,/raise RuntimeError\('do not execute'\)/);assert.equal(await format('python',py),py);
 const imports=await format('ts','import "z";\nimport "a";\nconst a=1;');assert.ok(imports.indexOf("'z'")<imports.indexOf("'a'"));
});
test('dprint rejects invalid syntax/options and remains usable after a failed request',async t=>{
 t.after(closeFormatter);await assert.rejects(format('python','def :'));await assert.rejects(format('ts','const ='));await assert.rejects(formatCode({language:'python',code:'x=1',config:{...config,indentWidth:0},pluginConfig:ruff}));await assert.rejects(format('ts','const a=1',{quoteStyle:'invented'}));await assert.rejects(format('python','x=1',{unknownOption:true}));assert.equal(await format('python','x=1'),'x = 1');
});
test('Native dprint option values control multiline commas, quotes, Ruff indentation and line endings',async t=>{
 t.after(closeFormatter);
 const ts=await format('ts','const data={x:"a",y:"b"}',{...typescript,'objectExpression.preferSingleLine':false,'objectExpression.trailingCommas':'always'});assert.match(ts,/y: 'b',/);assert.equal(await format('ts',ts,{...typescript,'objectExpression.preferSingleLine':false,'objectExpression.trailingCommas':'always'}),ts);
 const py=await format('python','if True:\n    print("a")',{quoteStyle:'double',indentWidth:2,indentStyle:'space',lineEnding:'cr-lf'});assert.match(py,/\r\n  print\("a"\)/);
});
test('C and C++ use the offline dprint clang-format Wasm plugin, honor native styles, and reject filesystem style discovery',async t=>{
 t.after(closeFormatter);
 for(const language of ['c','cpp','c++','cc','cxx']){
  const code=await formatCode({language,code:'int main(){int x=1;if(x){x++;}return x;}',config,pluginConfig:{BasedOnStyle:'LLVM',IndentWidth:4,BreakBeforeBraces:'Allman'}});
  assert.match(code,/int main\(\)\n\{/);assert.match(code,/    int x = 1;/);assert.equal(await formatCode({language,code,config,pluginConfig:{BasedOnStyle:'LLVM',IndentWidth:4,BreakBeforeBraces:'Allman'}}),code);
 }
 await assert.rejects(formatCode({language:'c',code:'int x;',config,pluginConfig:{BasedOnStyle:'file'}}));
 await assert.rejects(formatCode({language:'cpp',code:'int x;',config,pluginConfig:{MadeUpOption:1}}));
 const fs=require('node:fs'),path=require('node:path');assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(fs.readFileSync(path.join(__dirname,'../resources/formatters/clang-format.wasm')))),[]);
});

test('SQL and Lua use real offline dprint plugins, preserve quoted content and support native plugin configuration', async t => {
 t.after(closeFormatter);
 const sql = "select '中文; -- unchanged' as name from items where id > 1;";
 for (const language of ['sql','sqlite']) {
  const result = await format(language, sql, {});
  assert.match(result, /'中文; -- unchanged'/); assert.match(result, /\nfrom /); assert.equal(await format(language, result, {}), result);
  await assert.rejects(format(language, sql, {unknownOption:true}));
 }
 const lua = 'local x <const> = "中文"; if true then print( x ) end';
 const result = await format('lua', lua, {quoteStyle:'ForceSingle',verify:true});
 assert.match(result, /x <const> = '中文'/); assert.match(result, /    print\(x\)/); assert.equal(await format('lua', result, {quoteStyle:'ForceSingle',verify:true}), result);
 await assert.rejects(format('lua', 'local =', {})); await assert.rejects(format('lua', 'local x=1', {unknownOption:true}));
 const fs=require('node:fs'),path=require('node:path');
 for(const name of ['sql','stylua'])assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(fs.readFileSync(path.join(__dirname,'../resources/formatters/'+name+'.wasm')))),[]);
});
