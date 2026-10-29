const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  Module = require('node:module'),
  esbuild = require('esbuild');
const source = esbuild.buildSync({
  entryPoints: [path.resolve(__dirname, '../scripts/stable-code-blocks.ts')],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
}).outputFiles[0].text;
const mod = new Module(__filename, module);
mod.filename = __filename;
mod.paths = module.paths;
mod._compile(source, __filename);
test('Milkdown block lifetime is identical in production and Vite development prebundling', async () => {
  const plugin = mod.exports.stableCodeBlocks(),
    entry = path.resolve(__dirname, '../node_modules/@milkdown/components/lib/code-block/index.js'),
    original = fs.readFileSync(entry, 'utf8');
  const production = plugin.transform(original, entry);
  assert.ok(!production.includes('visibilityCallbacks'));
  assert.ok(!production.includes('TEARDOWN_DELAY'));
  assert.ok(production.includes('this.initializeCodeMirror();'));
  const config = plugin.config(), { rolldown } = await import('rolldown');
  const build = await rolldown({
    input: entry,
    external: id => !path.isAbsolute(id) && !id.startsWith('.'),
    plugins: config.optimizeDeps.rolldownOptions.plugins,
  });
  try {
    const result = await build.generate({ format: 'esm' });
    assert.ok(!result.output[0].code.includes('visibilityCallbacks'));
    assert.ok(!result.output[0].code.includes('TEARDOWN_DELAY'));
  } finally {
    await build.close();
  }
  assert.throws(() => plugin.transform('unsupported upstream module', entry), /needs review/);
});

test('CodeMirror selection echoes avoid redundant focus and dispatch while genuine selection changes still apply',()=>{
  const entry=path.resolve(__dirname,'../node_modules/@milkdown/components/lib/code-block/index.js');
  const code=mod.exports.stableCodeBlocks().transform(fs.readFileSync(entry,'utf8'),entry);
  const body=code.match(/  setSelection\(anchor, head\) \{([\s\S]*?)\n  \}\n  update\(node\)/)[1];
  const setSelection=new Function('anchor','head',body);
  let focused=0,dispatched=0;
  const cm={hasFocus:true,dom:{isConnected:true},state:{selection:{main:{anchor:3,head:3}}},focus(){focused++;this.hasFocus=true;},dispatch(tr){dispatched++;this.state.selection.main=tr.selection;}};
  const block={initialized:true,cm};
  for(let i=0;i<100;i++)setSelection.call(block,3,3);
  assert.equal(focused,0);assert.equal(dispatched,0);
  setSelection.call(block,4,2);assert.equal(focused,0);assert.equal(dispatched,1);
  cm.hasFocus=false;setSelection.call(block,4,2);assert.equal(focused,1);assert.equal(dispatched,1);
  cm.dom.isConnected=false;setSelection.call(block,5,5);assert.equal(dispatched,1);
});

test('Closed stock language pickers never measure layout; opening still positions the popup',async()=>{
  const entry=path.resolve(__dirname,'../node_modules/@milkdown/components/lib/code-block/index.js');
  const code=mod.exports.stableCodeBlocks().transform(fs.readFileSync(entry,'utf8'),entry);
  const body=code.match(/watch\(\[showPicker, triggerRef, pickerRef\], \(\) => \{([\s\S]*?)\n    \}\);\n    const onTogglePicker/)[1];
  const position=new Function('showPicker','filter','triggerRef','pickerRef','computePosition',body);
  let measurements=0;const open={value:false},filter={value:'old'},trigger={value:{}},popup={value:{style:{}}};
  const measure=()=>{measurements++;return Promise.resolve({x:12,y:34});};
  for(let i=0;i<80;i++)position(open,filter,trigger,popup,measure);assert.equal(measurements,0);
  open.value=true;position(open,filter,trigger,popup,measure);await Promise.resolve();assert.equal(measurements,1);assert.equal(filter.value,'');assert.deepEqual(popup.value.style,{left:'12px',top:'34px'});
});
