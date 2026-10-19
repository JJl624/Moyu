// Maintainer-only refresh. Preferences read the generated, offline JSON.
import fs from 'node:fs/promises';import path from 'node:path';import {createRequire} from 'node:module';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url),{createFromBuffer}=require('@dprint/formatter');
const folder=path.join(root,'resources/formatters'),previous=JSON.parse(await fs.readFile(path.join(root,'src/formatting-reference.json'),'utf8')),output={roslyn:previous.roslyn,java:previous.java};
const globals=[['lineWidth','number','1–1000','最大行宽',120],['indentWidth','number','1–16','缩进空格数',2],['useTabs','boolean','true / false','使用 Tab 缩进',false],['newLineKind','string','lf / crlf / auto / system','换行符','lf']].map(([name,type,values,description,defaultValue])=>({name,type,values,description,default:defaultValue}));
output.global={name:'共同选项',version:'',configKey:'顶层',url:'https://dprint.dev/config/',rows:globals};
for(const key of ['typescript','ruff']){
 const {schema,info}=JSON.parse(await fs.readFile(path.join(folder,'reference',key+'.json'),'utf8'));
 const rows=[];
 const add=(properties,prefix='')=>{for(const [name,raw] of Object.entries(properties)){
   const ref=raw.$ref?raw.$ref.slice(2).split('/').reduce((v,k)=>v?.[k],schema):{};const field={...ref,...raw};
   rows.push({name:prefix+name,type:Array.isArray(field.type)?field.type.join(' | '):field.type||[...new Set((field.oneOf||field.anyOf||[]).flatMap(value=>value.type||('const'in value?typeof value.const:[])))].join(' | ')||'string',description:field.description||name,default:field.default,values:field.enum?.join(' / ')||field.oneOf?.filter(v=>Object.hasOwn(v,'const')).map(v=>String(v.const)).join(' / ')|| (field.type==='boolean'?'true / false':field.type==='array'?'数组':field.type==='object'?'对象':'')});
   if(field.properties)add(field.properties,prefix+name+'.');
 }};add(schema.properties);output[key]={...info,rows,url:info.helpUrl};
}
const clangText=await (await fetch('https://raw.githubusercontent.com/llvm/llvm-project/llvmorg-22.1.0/clang/docs/ClangFormatStyleOptions.rst')).text();
const anchors=[...clangText.matchAll(/^\*\*([\w]+)\*\* \(``([^`]+)``\)[^\n]*\n/gm)],clang=createFromBuffer(await fs.readFile(path.join(folder,'clang-format.wasm'))),clangRows=[];
for(let i=0;i<anchors.length;i++){
 const [whole,name,rawType]=anchors[i],section=clangText.slice(anchors[i].index+whole.length,anchors[i+1]?.index||clangText.length);
 const enumValues=[...section.matchAll(/in configuration: ``([^`]+)``/g)].map(m=>m[1]);
 const type=/Boolean/i.test(rawType)?'boolean':/Integer|Unsigned/i.test(rawType)?'number':/List/i.test(rawType)?'array':rawType==='String'||enumValues.length?'string':'object';
 const values=name==='BasedOnStyle'?['LLVM','Google','Chromium','Mozilla','WebKit','Microsoft','GNU']:enumValues;
 const sample=type==='boolean'?false:type==='number'?2:type==='array'?[]:type==='object'?{}:values[0]||'';
 clang.setConfig({},{[name]:sample});if(clang.getConfigDiagnostics().some(d=>d.message==='unsupported'||/unknown key/.test(d.message)))continue;
 let description=section.split(/\n\s*\n/)[0].replace(/:\w+:`([^`]+)`/g,'$1').replace(/``/g,'').replace(/\s+/g,' ').trim();
 clangRows.push({name,type,values:values.length?[...new Set(values)].join(' / '):type==='boolean'?'true / false':type==='object'?'JSON 对象':type==='array'?'JSON 数组':'',description});
}
output.clangFormat={name:'dprint-plugin-clang-format',version:'0.1.0',configKey:'clangFormat',url:'https://clang.llvm.org/docs/ClangFormatStyleOptions.html',rows:clangRows};
const row=(name,type,values,description,defaultValue)=>({name,type,values,description,default:defaultValue});
output.sql={name:'lax-sql',version:'0.3.0',configKey:'sql',url:'https://github.com/bartlomieju/lax/tree/main/crates/lax-sql',rows:[...globals,row('keywordCase','string','preserve / upper / lower','SQL 关键字大小写','preserve'),row('clauseStyle','string','fill / expanded','紧凑布局或逐项展开','fill'),row('ignoreNodeCommentText','string','','跳过下一条语句的注释标记','dprint-ignore'),row('ignoreFileCommentText','string','','跳过整个文件的注释标记','dprint-ignore-file')]};
output.stylua={name:'dprint-plugin-stylua',version:'0.2.1',configKey:'stylua',url:'https://github.com/RubixDev/dprint-plugin-stylua',rows:[...globals,row('verify','boolean','true / false','格式化后验证语法树',false),row('quoteStyle','string','AutoPreferDouble / AutoPreferSingle / ForceDouble / ForceSingle','字符串引号风格','AutoPreferDouble'),row('callParentheses','string','Always / NoSingleString / NoSingleTable / None','函数调用的括号保留规则','Always'),row('collapseSimpleStatement','string','Never / FunctionOnly / ConditionalOnly / Always','简单语句压缩为单行','Never')]};
for(const row of previous.typescript.rows.filter(row=>['fileIndentLevel','conditionalExpression.linePerExpression'].includes(row.name)))if(!output.typescript.rows.some(next=>next.name===row.name))output.typescript.rows.push(row);
const {extendReference}=await import('./extend-formatting-reference.mjs'),{localizeReference}=await import('./formatting-reference-zh.mjs');
await fs.writeFile(path.join(root,'src/formatting-reference.json'),JSON.stringify(localizeReference(extendReference(output,clangText)),null,2)+'\n');console.log(Object.entries(output).map(([k,v])=>k+': '+v.rows.length).join('\n'));
