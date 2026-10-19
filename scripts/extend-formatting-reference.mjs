// Maintainer helper. Input is LLVM's pinned style-options RST and the installed
// prettier-plugin-java options source. Read source as data; never execute plugins.
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const children={AfterNot:'not 关键字之后、左圆括号之前加入空格。',Enabled:'启用此规则。',AcrossEmptyLines:'跨越空行对齐。',AcrossComments:'跨越注释对齐。',AlignCompound:'同时对齐 += 等复合赋值运算符。',AlignFunctionDeclarations:'对齐函数声明。',AlignFunctionPointers:'对齐函数指针声明。',PadOperators:'补齐较短运算符前的空格，使赋值运算符右侧对齐。',AlignCaseColons:'对齐 case 标签的冒号。',AlignCaseArrows:'对齐 case 的箭头。',AlignPPAndNotPP:'预处理指令后的注释与其他行尾注释一起对齐。',Kind:'行尾注释的对齐策略。',OverEmptyLines:'允许跨越多少个空行进行对齐。',IgnoreCase:'排序时忽略大小写。',IgnoreExtension:'排序时忽略文件扩展名。',Minimum:'最少空格数。',Maximum:'最多空格数。',AtStartOfFile:'保留文件开头空行。',AtStartOfBlock:'保留代码块开头空行。',AtEndOfFile:'保留文件末尾空行。',AfterControlStatements:'控制流关键字之后、左圆括号之前加入空格。',AfterForeachMacros:'循环宏之后加入空格。',AfterIfMacros:'if 宏之后加入空格。',AfterFunctionDeclarationName:'函数声明名与左圆括号之间加入空格。',AfterFunctionDefinitionName:'函数定义名与左圆括号之间加入空格。',AfterOverloadedOperator:'重载运算符与左圆括号之间加入空格。',AfterPlacementOperator:'placement new/delete 与左圆括号之间加入空格。',AfterRequiresInClause:'requires 子句关键字与左圆括号之间加入空格。',AfterRequiresInExpression:'requires 表达式关键字与左圆括号之间加入空格。',BeforeNonEmptyParentheses:'非空圆括号之前加入空格。',InCStyleCasts:'C 风格类型转换的圆括号内部加入空格。',InConditionalStatements:'控制条件的圆括号内部加入空格。',InEmptyParentheses:'空圆括号内部加入空格。',Other:'其他圆括号内部加入空格。',ExceptDoubleParentheses:'双层圆括号内不加入空格。'};
const fieldType=raw=>/bool|Boolean/i.test(raw)?'boolean':/Unsigned|Integer|unsigned|int$/i.test(raw)?'number':/^List|vector/i.test(raw)?'array':/^String|string$/.test(raw)?'string':null;
export function extendReference(data,rst,javaOptions=''){
 const formatter=require('@dprint/formatter').createFromBuffer(require('node:fs').readFileSync(new URL('../resources/formatters/clang-format.wasm',import.meta.url)));
 const missing=new Set();
 const anchors=[...rst.matchAll(/^\*\*([\w]+)\*\* \(``([^`]+)``\)[^\n]*\n/gm)],rows=[];
 for(const row of data.clangFormat.rows.filter(row=>!row.name.includes('.')&&!row.name.includes('[]'))){
  const index=anchors.findIndex(match=>match[1]===row.name);if(index<0)throw Error('LLVM 参考中不存在 '+row.name);
  const body=rst.slice(anchors[index].index,anchors[index+1]?.index||rst.length),fields=[...body.matchAll(/^\s*\*\s*``([\w:<>, ]+?)\s+(\w+)``/gm)];
  const type=fieldType(anchors[index][2]);if(type)row.type=type;else if(fields.length)row.type='object';
  if(row.type==='object')row.values='JSON 对象；兼容形式以插件校验为准。';
  rows.push(row);
  for(const [n,field] of fields.entries()){
   const name=field[2],type=fieldType(field[1])||'string',section=body.slice(field.index,fields[n+1]?.index||body.length),values=[...section.matchAll(/in configuration: ``([^`]+)``/g)].map(match=>match[1]);
   const sample=type==='boolean'?false:type==='number'?1:type==='array'?[]:values[0]||'';formatter.setConfig({}, {[row.name]:{[name]:sample}});if(formatter.getConfigDiagnostics().length)continue;
   if(!children[name])missing.add(name);
   rows.push({name:row.name+'.'+name,type,values:values.length?[...new Set(values)].join(' / '):type==='boolean'?'true / false':type==='array'?'数组':'',description:children[name]});
  }
 }
 const extra={IncludeCategories:[['Regex','string','头文件匹配的正则表达式。'],['Priority','number','分组优先级；越小越靠前。'],['SortPriority','number','排序优先级，未指定时跟随 Priority。'],['CaseSensitive','boolean','正则匹配是否区分大小写。']],RawStringFormats:[['Language','string','原始字符串内容的语言。'],['Delimiters','array','识别此规则的原始字符串分隔符数组。'],['EnclosingFunctions','array','可触发此规则的外层函数名数组。'],['CanonicalDelimiter','string','格式化后统一采用的分隔符。'],['BasedOnStyle','string','内容所用的基础风格。']]};
 for(const [parent,fields] of Object.entries(extra))for(const [name,type,description] of fields)rows.push({name:parent+'[].'+name,type,values:type==='boolean'?'true / false':type==='array'?'字符串数组':'',description});
 if(missing.size)throw Error('缺少嵌套选项中文说明：'+[...missing].join(', '));
 data.clangFormat.rows=rows;
 const entrypoints=javaOptions?[...javaOptions.matchAll(/\{ value: "([^"]+)"/g)].map(match=>match[1]).filter(value=>!['start','end'].includes(value)):(data.java.rows.find(row=>row.name==='entrypoint')?.values.split(' / ')||[]);
 data.java.note='使用 Prettier 3.6.2 与 prettier-plugin-java 2.8.1，Java 不经过 dprint。顶层 lineWidth、indentWidth、useTabs、newLineKind 分别映射为 printWidth、tabWidth、useTabs、endOfLine；java 对象中的同类选项优先。';
 data.java.rows=data.java.rows.filter(row=>!['entrypoint','experimentalOperatorPosition'].includes(row.name));
 data.java.rows.push({name:'entrypoint',type:'string',values:entrypoints.join(' / ')||data.java.rows.find(row=>row.name==='entrypoint')?.values||'compilationUnit / blockStatements / expression / statement / block',description:'Java 解析的起始语法规则。完整源码使用 compilationUnit；代码片段可选择 blockStatements、expression 等。',default:'compilationUnit'},{name:'experimentalOperatorPosition',type:'string',values:'start / end',description:'二元表达式换行时，运算符位于下一行开头还是上一行末尾。',default:'end'});
 for(const kind of ['ruby','bash'])data[kind]={name:'暂无格式化插件',version:'',configKey:'无',url:'',note:(kind==='ruby'?'Ruby':'Bash')+' 支持运行，目前不提供格式化。',rows:[]};
 return data;
}
if(process.argv[1]&&new URL('file:///'+process.argv[1].replaceAll('\\','/')).href===import.meta.url){
 const file=new URL('../src/formatting-reference.json',import.meta.url),data=JSON.parse(await fs.readFile(file,'utf8'));
 const rst=await fs.readFile(process.argv[2],'utf8'),java=process.argv[3]?await fs.readFile(process.argv[3],'utf8'):'';
 const {localizeReference}=await import('./formatting-reference-zh.mjs');await fs.writeFile(file,JSON.stringify(localizeReference(extendReference(data,rst,java)),null,2)+'\n');console.log('Reference rows:',Object.fromEntries(Object.entries(data).map(([key,value])=>[key,value.rows.length])));
}
