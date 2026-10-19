import fs from 'node:fs/promises';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),source=path.join(root,'node_modules/node-pty'),target=path.join(root,'resources/terminal/node-pty'),platform=process.platform+'-'+process.arch;
if(!await fs.stat(path.join(source,'prebuilds',platform)).catch(()=>null)&&!await fs.stat(path.join(source,'build/Release')).catch(()=>null))throw Error('请先为当前平台编译 node-pty：npm rebuild node-pty');
if(!target.startsWith(root+path.sep))throw Error('Invalid terminal resource path');await fs.rm(target,{recursive:true,force:true});await fs.mkdir(target,{recursive:true});
for(const name of ['package.json','LICENSE','lib'])await fs.cp(path.join(source,name),path.join(target,name),{recursive:true,filter:file=>!file.endsWith('.map')&&!file.endsWith('.test.js')});
for(const directory of ['prebuilds/'+platform,'build/Release'])if(await fs.stat(path.join(source,directory)).catch(()=>null))await fs.cp(path.join(source,directory),path.join(target,directory),{recursive:true,filter:file=>!file.endsWith('.pdb')});
for(const name of ['README.md','third_party'])if(await fs.stat(path.join(source,name)).catch(()=>null))await fs.cp(path.join(source,name),path.join(target,name),{recursive:true});
console.log('Native terminal resources prepared: '+platform);
