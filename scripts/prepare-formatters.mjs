import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';import {createRequire} from 'node:module';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(path.join(root,'package.json')),target=path.join(root,'resources/formatters');
const {createFromBuffer}=require('@dprint/formatter');
await fs.mkdir(target,{recursive:true});const manifest={engine:'@dprint/formatter',version:JSON.parse(await fs.readFile(path.join(root,'node_modules/@dprint/formatter/package.json'),'utf8')).version,files:{}};
for(const [name,version] of [['typescript','0.96.1'],['ruff','0.9.1']]){
 const bytes=await fs.readFile(path.join(root,'node_modules/@dprint',name,'plugin.wasm')),formatter=createFromBuffer(bytes);
 if(formatter.getPluginInfo().version!==version)throw new Error('Unexpected dprint '+name+' version');
 await fs.writeFile(path.join(target,name+'.wasm'),bytes);await fs.writeFile(path.join(target,name+'-LICENSE'),formatter.getLicenseText());
 manifest.files[name+'.wasm']={version,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),source:'https://www.npmjs.com/package/@dprint/'+name+'/v/'+version};
}
await fs.copyFile(path.join(root,'node_modules/@dprint/formatter/LICENSE'),path.join(target,'dprint-formatter-LICENSE'));
const clangBytes=await fs.readFile(path.join(target,'clang-format.wasm')),receipt=JSON.parse(await fs.readFile(path.join(target,'clang-format-receipt.json'),'utf8'));
if(clangBytes.length!==receipt.bytes||crypto.createHash('sha256').update(clangBytes).digest('hex')!==receipt.sha256)throw new Error('Clang-format resource checksum mismatch');
const clang=createFromBuffer(clangBytes);if(clang.getPluginInfo().version!==receipt.version||WebAssembly.Module.imports(new WebAssembly.Module(clangBytes)).length)throw new Error('Unexpected clang-format plugin');
const llvmLicense=await fs.readFile(path.join(root,'node_modules/@wasm-idle/llvm-core/LICENSE.llvm.txt'),'utf8');
await fs.writeFile(path.join(target,'clang-format-LICENSE'),clang.getLicenseText()+'\n\nLLVM / Clang LibFormat\n'+llvmLicense);manifest.files['clang-format.wasm']=receipt;
const sqlBytes=await fs.readFile(path.join(root,'node_modules/lax-sql/plugin.wasm')),sql=createFromBuffer(sqlBytes);
if(sql.getPluginInfo().version!=='0.3.0')throw Error('Unexpected SQL formatter');
await fs.writeFile(path.join(target,'sql.wasm'),sqlBytes);await fs.writeFile(path.join(target,'sql-LICENSE'),sql.getLicenseText());
manifest.files['sql.wasm']={version:'0.3.0',bytes:sqlBytes.length,sha256:crypto.createHash('sha256').update(sqlBytes).digest('hex'),source:'https://www.npmjs.com/package/lax-sql/v/0.3.0'};
const luaBytes=await fs.readFile(path.join(target,'stylua.wasm')),luaReceipt=JSON.parse(await fs.readFile(path.join(target,'stylua-receipt.json'),'utf8')),lua=createFromBuffer(luaBytes);
if(lua.getPluginInfo().version!=='0.2.1'||luaBytes.length!==luaReceipt.bytes||crypto.createHash('sha256').update(luaBytes).digest('hex')!==luaReceipt.sha256)throw Error('Lua formatter checksum mismatch');
await fs.writeFile(path.join(target,'stylua-LICENSE'),lua.getLicenseText());manifest.files['stylua.wasm']=luaReceipt;
const sources=JSON.parse(await fs.readFile(path.join(target,'source/manifest.json'),'utf8'));
if(sources.length!==2)throw Error('Lua formatter sources missing');
for(const receipt of sources){
 if(!['dprint-plugin-stylua-0.2.1.crate','stylua-0.15.2.crate'].includes(receipt.file))throw Error('Unexpected Lua source archive');
 const bytes=await fs.readFile(path.join(target,'source',receipt.file));
 if(bytes.length!==receipt.bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==receipt.sha256)throw Error('Lua source archive checksum mismatch');
}
await fs.writeFile(path.join(target,'manifest.json'),JSON.stringify(manifest,null,2));
