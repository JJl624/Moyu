const {test}=require('node:test'),assert=require('node:assert/strict');
const {canonicalLanguage,runtimeKind,runnable,formattable,formatterLanguages}=require('../shared/code-languages.mjs');
test('Language aliases agree between display, execution and formatting without exposing the internal clang alias in the editor',()=>{
  const cases=[['python',['python','py'],'Python'],['javascript',['js','javascript'],'JavaScript'],['javascript',['ts','typescript'],'TypeScript'],['clang',['c'],'C'],['clang',['cpp','cc','cxx','c++'],'C++'],['csharp',['cs','csharp','c#'],'C#'],['java',['java'],'Java'],['sql',['sql','sqlite'],'SQL'],['lua',['lua'],'Lua'],['ruby',['ruby','rb'],'Ruby'],['bash',['bash','sh','shell'],'Bash']];
  for(const[kind,aliases,label]of cases)for(const alias of aliases)for(const value of[alias,alias.toUpperCase()]){
    assert.equal(runtimeKind(value),kind);assert.equal(canonicalLanguage(value),label);assert.equal(runnable(value),true);
    assert.equal(formattable(value),!['ruby','bash'].includes(kind));
    assert.equal(formatterLanguages.includes(alias),!['ruby','bash'].includes(kind));
  }
  assert.equal(runtimeKind('clang'),'clang');assert.equal(runnable('clang'),false);assert.equal(formattable('clang'),false);
  for(const value of['tabs','mermaid','markdown','unknown',' js','js ','js\n','cpp\r\n']){assert.equal(runtimeKind(value),undefined);assert.equal(runnable(value),false);assert.equal(formattable(value),false);}
  assert.equal(canonicalLanguage('Unknown'),'unknown');assert.equal(formatterLanguages.includes('JS'),false);
});
