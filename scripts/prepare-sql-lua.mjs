import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire, isBuiltin } from 'node:module';
import { build } from 'esbuild';
const root = path.resolve(import.meta.dirname, '..'), require = createRequire(path.join(root, 'package.json'));
const SQL = await require('sql.js')(), probe = new SQL.Database();
const sqlite = probe.exec('SELECT sqlite_version()')[0].values[0][0]; probe.close();
const packageVersion = async pkg => JSON.parse(await fs.readFile(path.join(root,'node_modules',pkg,'package.json'),'utf8')).version;
const versions = { sql: { name: 'sql.js / SQLite', version: await packageVersion('sql.js') + ' / ' + sqlite }, lua: { name: 'Wasmoon / Lua 5.4', version: await packageVersion('wasmoon') } };
for (const [kind, pkg, file, version] of [['sql','sql.js','sql-wasm.wasm','1.14.2'],['lua','wasmoon','glue.wasm','1.16.0']]) {
  if (await packageVersion(pkg) !== version) throw Error('Unexpected ' + pkg + ' version');
  const dir = path.join(root,'resources',kind), bytes = await fs.readFile(path.join(root,'node_modules',pkg,'dist',file));
  await fs.mkdir(dir,{recursive:true}); await fs.writeFile(path.join(dir,file),bytes);
  const manifest = { package: pkg, version, runtime: versions[kind], files: { [file]: { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } } };
  await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2));
  const source = path.join(root,'node_modules',pkg), licenses = (await fs.readdir(source)).filter(name => /^license/i.test(name));
  await fs.writeFile(path.join(dir,'LICENSES.txt'),(await Promise.all(licenses.map(name => fs.readFile(path.join(source,name),'utf8')))).join('\n\n'));
  await build({ entryPoints:[path.join(root,'electron/runner',kind+'-worker.mjs')],outfile:path.join(root,'electron/runner',kind+'-runtime.mjs'),bundle:true,platform:'browser',format:'esm',target:'chrome144',minify:true,legalComments:'eof',plugins:[{name:'no-host-modules',setup(builder){builder.onResolve({filter:/.*/},args=>isBuiltin(args.path)?{path:args.path,namespace:'no-host'}:undefined);builder.onLoad({filter:/.*/,namespace:'no-host'},()=>({contents:'module.exports={};',loader:'js'}));}}] });
}
console.log('SQL / Lua runtimes prepared offline.');
