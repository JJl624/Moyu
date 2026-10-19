const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const data=require('../src/formatting-reference.json'),{createFromBuffer}=require('@dprint/formatter');
test('Offline references have unique translated names and cover the actual builtin formatter resolved options',()=>{
 for(const value of Object.values(data)){assert.equal(new Set(value.rows.map(row=>row.name)).size,value.rows.length);for(const row of value.rows)assert.match(row.description,/[\u3400-\u9fff]/);}
 for(const [key,file] of [['typescript','typescript'],['ruff','ruff'],['sql','sql'],['stylua','stylua']]){const f=createFromBuffer(fs.readFileSync(path.join(__dirname,'../resources/formatters',file+'.wasm')));f.setConfig({},{});for(const name of Object.keys(f.getResolvedConfig()))assert(data[key].rows.some(row=>row.name===name),key+':'+name);}
 for(const name of ['entrypoint','experimentalOperatorPosition'])assert(data.java.rows.some(row=>row.name===name));assert(data.roslyn.rows.some(row=>row.name==='csharp.indentationSize'));assert.equal(data.ruby.rows.length,0);assert.equal(data.bash.rows.length,0);
});
