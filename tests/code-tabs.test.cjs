const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path'), Module = require('node:module');
const source = require('esbuild').buildSync({ entryPoints: [path.resolve(__dirname, '../src/codeTabs.ts')], bundle: true, write: false, platform: 'node', format: 'cjs' }).outputFiles[0].text;
const mod = new Module(__filename, module); mod.filename = __filename; mod.paths = module.paths; mod._compile(source, __filename);
const { parseCodeTabs: parse, replaceTabCode: edit, appendCodeTab: add, createCodeTab: create, renameCodeTab: rename, removeCodeTab: remove, moveCodeTab: move, tabAtOffset, isTabbedCode } = mod.exports;

test('The first character after an EOF tab declaration uses the new body offset, including inserted LF/CRLF',()=>{
  for(const newline of ['\n','\r\n'])for(const trailing of ['',newline]){
    const source=':::js First'+newline+'one'+newline+':::text New'+trailing;
    const result=mod.exports.editCodeTab(source,1,'a');
    const tab=parse(result.source)[1];assert.equal(tab.code,'a');assert.equal(result.offset,tab.from);assert.equal(result.source.slice(result.offset,result.offset+1),'a');
    const again=mod.exports.editCodeTab(result.source,1,'ab');assert.equal(parse(again.source)[1].code,'ab');assert.equal(again.offset,result.offset);
  }
});
test('Tab declarations recognize column-zero language and optional title without parsing the code', () => {
  const tabs = parse(':::PY 第一页\nprint(":::js")\n  :::cpp 不声明\n:::c++\ncout << 1;\n');
  assert.deepEqual(tabs.map(t => [t.language, t.title, t.code]), [['PY', '第一页', 'print(":::js")\n  :::cpp 不声明'], ['c++', '', 'cout << 1;\n']]);
  assert(isTabbedCode('TaBs')); assert(!isTabbedCode('typescript')); assert.equal(parse('').length, 0);
  assert.equal(parse('plain code')[0].code, 'plain code');
  assert.equal(parse('before\n:::py\nx')[0].declarationFrom, null);
  assert.equal(tabAtOffset(tabs, tabs[1].from + 2), 1);
});
test('Tab body edits preserve neighboring declarations, blank lines, and LF/CRLF', () => {
  for (const nl of ['\n', '\r\n']) for (const original of [':::py'+nl+':::js'+nl+'x', ':::py'+nl+'a'+nl+':::js'+nl+'x', ':::py']) {
    for (const code of ['', 'a', 'a'+nl, nl+nl]) {
      const result = edit(original, 0, code), tabs = parse(result);
      assert.equal(tabs[0].code, code, JSON.stringify({ original, result, code }));
      if (parse(original).length > 1) assert.deepEqual(tabs.slice(1).map(t => [t.language,t.code]), [['js','x']]);
    }
  }
});
test('Append preserves the previous code including its trailing newlines', () => {
  for (const code of ['', 'x', 'x\n', 'x\n\n']) {
    const result = add(':::py\n' + code, 'JS', '下一页');
    assert.deepEqual(parse(result).map(t => [t.language,t.title,t.code]), [['py','',code], ['JS','下一页','']]);
  }
});
test('New tabs use plain text and unique neutral titles instead of inheriting the current language', () => {
  for (const nl of ['\n', '\r\n']) {
    const original = ':::latex' + nl + 'x^2' + nl;
    const result = create(original), tabs = parse(result);
    assert.deepEqual(tabs.map(t => [t.language, t.title, t.code]), [['latex', '', 'x^2' + nl], ['text', '标签页 1', '']]);
    assert.equal(parse(create(result)).at(-1).title, '标签页 2');
    assert.equal(parse(create(add(result, 'py', '标签页 3'))).at(-1).title, '标签页 2');
    assert.equal(parse(create(remove(create(result), 1))).at(-1).title, '标签页 1');
  }
  assert.deepEqual(parse(create('')).map(t => [t.language, t.title, t.code]), [['text', '标签页 1', '']]);
});
test('A bare delimiter is a real tab; language can be added, cleared, or omitted without losing code', () => {
  for (const nl of ['\n','\r\n']) {
    const original = ':::py'+nl+'print(1)'+nl+':::'+nl+'plain text';
    assert.deepEqual(parse(original).map(t=>[t.language,t.title,t.code]), [['py','','print(1)'],['','','plain text']]);
    const renamed = rename(original, 1, 'python', '');
    assert.equal(parse(renamed)[1].language, 'python');
    assert.equal(parse(rename(renamed,1,'',''))[1].code, 'plain text');
    assert.equal(parse(rename(renamed,1,'','标题'))[1].language, 'text');
    assert.equal(parse(edit(original,1,'next'))[1].code,'next');
    assert.equal(parse(move(original,1,-1))[0].language,'');
    assert.equal(parse(add(original,'',''))[2].language,'');
    assert.equal(parse(':::'+nl+'::: ')[1].language,'');
    assert.equal(parse('  :::').length,1);
    assert.equal(parse('  :::')[0].declarationFrom,null);
  }
});
test('An empty tab keeps its active selection at the position shared with the next declaration', () => {
  const tabs = parse(':::py\n:::JS\nx');
  assert.equal(tabs[0].from,tabs[1].declarationFrom);
  assert.equal(tabAtOffset(tabs,tabs[0].from),1);
  assert.equal(tabAtOffset(tabs,tabs[0].from,0),0);
  assert.equal(tabAtOffset(tabs,tabs[1].from,0),1);
});
test('Rename changes only the declaration; invalid language and ungrouped code are protected', () => {
  const original = 'before\n:::py 原名\r\na\r\n:::js\r\nb';
  assert.equal(rename(original,1,'PY','新名'), 'before\n:::PY 新名\r\na\r\n:::js\r\nb');
  assert.equal(rename(original,1,'bad language','x'),null); assert.equal(rename(original,0,'js','x'),null);
  assert.equal(remove(original,0),original); assert.equal(move(original,1,-1),original);
});
test('Reordering and deletion preserve every retained tab body, including empty and multiline tabs', () => {
  for (const nl of ['\n','\r\n']) for (const one of ['', 'x', 'x'+nl, nl+nl]) for (const two of ['', 'y', 'y'+nl]) {
    let original = ':::py'+nl+one; original = add(original,'js'); original = edit(original,1,two);
    const moved = move(original,0,1);
    assert.deepEqual(parse(moved).map(t=>[t.language,t.code]), [['js',two],['py',one]], JSON.stringify({original,moved}));
    assert.deepEqual(parse(move(moved,1,-1)).map(t=>[t.language,t.code]), [['py',one],['js',two]]);
    assert.deepEqual(parse(remove(original,0)).map(t=>[t.language,t.code]), [['js',two]]);
    assert.deepEqual(parse(remove(original,1)).map(t=>[t.language,t.code]), [['py',one]]);
  }
});
