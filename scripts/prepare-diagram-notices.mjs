import fs from 'node:fs/promises';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),seen=new Set(),notices=[];
async function locate(from,name){for(let directory=from;;directory=path.dirname(directory)){const target=path.join(directory,'node_modules',name);if(await fs.stat(path.join(target,'package.json')).catch(()=>null))return target;if(path.dirname(directory)===directory)throw new Error('Missing diagram dependency: '+name);}}
async function visit(directory){if(seen.has(directory))return;seen.add(directory);const pkg=JSON.parse(await fs.readFile(path.join(directory,'package.json'),'utf8'));
  const names=(await fs.readdir(directory)).filter(name=>/^(licen[cs]e|notice)(?:\..*)?$/i.test(name));
  const texts=await Promise.all(names.map(name=>fs.readFile(path.join(directory,name),'utf8')));
  notices.push(pkg.name+' '+pkg.version+' ('+(pkg.license||'see notice')+')\n'+(texts.join('\n')||'Source and license: '+(pkg.repository?.url||pkg.repository||pkg.homepage||'')));
  for(const name of Object.keys(pkg.dependencies||{}))await visit(await locate(directory,name));
}
for(const name of ['mermaid','@mermaid-js/layout-elk','@embedpdf/snippet','@coderline/alphatab','mathlive'])await visit(await locate(root,name));
await fs.mkdir(path.join(root,'resources/licenses'),{recursive:true});await fs.writeFile(path.join(root,'resources/licenses/DIAGRAM-DEPENDENCIES.txt'),notices.sort().join('\n\n----------------------------------------\n\n'));
console.log('Diagram dependency notices: '+seen.size+' packages.');
