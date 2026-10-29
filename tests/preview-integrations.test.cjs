const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
test('Excalidraw build integration refuses missing transformation anchors and accepts the pinned upstream',async()=>{
  const {build}=require('esbuild');const result=await build({entryPoints:[path.join(root,'scripts/excalidraw-adapter.ts')],bundle:true,platform:'node',format:'esm',write:false,external:['vite']});
  const {excalidrawAdapter}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
  const plugin=excalidrawAdapter();plugin.configResolved({command:'build'});plugin.buildStart();
  assert.throws(()=>plugin.buildEnd(),/pinned integration missing/);
  const directory=path.join(root,'node_modules/@excalidraw/excalidraw/dist/dev');
  const emitted=[];for(const name of fs.readdirSync(directory).filter(n=>n.startsWith('chunk-')&&n.endsWith('.js')))plugin.transform.call({emitFile(asset){emitted.push(asset);return 'qa';}},fs.readFileSync(path.join(directory,name),'utf8'),path.join(directory,name));
  assert.doesNotThrow(()=>plugin.buildEnd());assert(emitted.length>=2);
});
test('Preview assets are pinned, workers stay local, and the direct PDF.js dependency is removed',()=>{
  const pkg=require('../package.json');assert.equal(pkg.dependencies['pdfjs-dist'],undefined);
  for(const [name,version]of [['@embedpdf/snippet','2.15.1'],['@embedpdf/engines','2.15.1'],['@coderline/alphatab','1.8.4']])assert.equal(pkg.dependencies[name],version);
  const alpha=path.join(root,'node_modules/@coderline/alphatab/dist');
  for(const name of ['alphaTab.min.mjs','alphaTab.worker.mjs','alphaTab.core.mjs','font/Bravura.woff2'])assert(fs.existsSync(path.join(alpha,name)),name);
  assert(fs.existsSync(path.join(root,'node_modules/@embedpdf/snippet/dist/pdfium.wasm')));
});
