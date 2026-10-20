import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import crypto from 'node:crypto';
import { esbuildName, esbuildSource as esbuildBinarySource } from '../shared/native-esbuild.cjs';
const root=path.resolve(import.meta.dirname,'..'), stage=path.join(root,'build-app');
await import('./prepare-workspace-guide.mjs');
await import('./prepare-terminal.mjs');
await import('./prepare-formatters.mjs');
await import('./prepare-clang.mjs');
await import('./prepare-sql-lua.mjs');
await import('./prepare-diagram-notices.mjs');
await import('./prepare-bundled-runtimes.mjs');
// Only remove this generated staging folder, never a user knowledge base.
if(path.dirname(stage)!==root || path.basename(stage)!=='build-app')throw new Error('Invalid staging directory');
await fs.rm(stage,{recursive:true,force:true});
await fs.mkdir(path.join(stage,'electron'),{recursive:true});
const pyFiles=['pyodide.mjs','pyodide.asm.mjs','pyodide.asm.wasm','python_stdlib.zip','pyodide-lock.json'];
const pyTarget=path.join(root,'resources/pyodide');
await fs.mkdir(pyTarget,{recursive:true});
const manifest={version:'314.0.7',files:{}};
for(const name of pyFiles){const bytes=await fs.readFile(path.join(root,'node_modules/pyodide',name));await fs.writeFile(path.join(pyTarget,name),bytes);manifest.files[name]={bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};}
await fs.writeFile(path.join(pyTarget,'manifest.json'),JSON.stringify(manifest,null,2));
await build({entryPoints:[path.join(root,'electron/main.cjs')],outfile:path.join(stage,'electron/main.cjs'),bundle:true,platform:'node',format:'cjs',target:'node24',external:['electron','node:*','esbuild'],minify:true,legalComments:'eof'});
// esbuild locates its own package and binary at runtime. Preserve its Node
// module boundary instead of compiling that self-resolution into main.cjs.
const esbuildSource=path.join(root,'node_modules/esbuild'),esbuildTarget=path.join(stage,'node_modules/esbuild');
await fs.mkdir(path.join(esbuildTarget,'lib'),{recursive:true});
for(const name of ['package.json','lib/main.js','LICENSE.md'])await fs.copyFile(path.join(esbuildSource,name),path.join(esbuildTarget,name));
await build({entryPoints:[path.join(root,'electron/format-worker.cjs')],outfile:path.join(stage,'electron/format-worker.cjs'),bundle:true,platform:'node',format:'cjs',target:'node24',external:['node:*'],minify:true,legalComments:'eof'});
for(const item of ['dist','resources','THIRD_PARTY_NOTICES.md'])await fs.cp(path.join(root,item),path.join(stage,item),{recursive:true});
// Keep only the small header catalogue before users install an engine.
for(const kind of ['clang','sql','lua']){
 const folder=path.join(stage,'resources',kind);
 for(const name of await fs.readdir(folder))if(!(kind==='clang'&&name==='headers.json'))await fs.rm(path.join(folder,name),{recursive:true,force:true});
}
await fs.mkdir(path.join(stage,'resources/tools'),{recursive:true});
const binary=path.join(stage,'resources/tools',esbuildName());
await fs.copyFile(path.join(root,'node_modules',esbuildBinarySource()),binary);
if(process.platform!=='win32')await fs.chmod(binary,0o755);
await fs.copyFile(path.join(root,'electron/history-database-worker.cjs'),path.join(stage,'electron/history-database-worker.cjs'));
await fs.copyFile(path.join(root,'electron/preload.cjs'),path.join(stage,'electron/preload.cjs'));
await fs.copyFile(path.join(root,'electron/managed-source.cjs'),path.join(stage,'electron/managed-source.cjs'));
await fs.copyFile(path.join(root,'electron/clang-source.cjs'),path.join(stage,'electron/clang-source.cjs'));
await fs.mkdir(path.join(stage,'electron/runner'),{recursive:true});
for(const name of ['runner.mjs','worker.mjs','run-files.mjs','clang-worker.mjs','clang-project.mjs','clang-lifetime.mjs','clang-workspace.mjs','sql-worker.mjs','sql-viewer.mjs','lua-worker.mjs','csharp-worker.mjs','java-worker.mjs','ruby-worker.mjs','bash-worker.mjs','bash-terminal.mjs','file-runtime.mjs'])await fs.copyFile(path.join(root,'electron/runner',name),path.join(stage,'electron/runner',name));
await fs.copyFile(path.join(root,'shared/sqlite-browser.mjs'),path.join(stage,'electron/runner/sqlite-browser.mjs'));
const original=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
await fs.writeFile(path.join(stage,'package.json'),JSON.stringify({name:original.name,version:original.version,description:original.description,desktopName:original.desktopName,author:original.author,license:original.license,main:'electron/main.cjs'},null,2));
console.log('Application staged with bundled language environments.');
