import {selectPreference} from './helpers/runtime-ui';
import { _electron as electron, expect, test, type Page } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
const project = path.resolve(import.meta.dirname, '..'), base = path.resolve(project, '../../work/e2e');
async function fixture(name: string) {
  await fs.mkdir(base, { recursive: true }); const data = await fs.mkdtemp(path.join(base, name + '-'));
  const env = { ...process.env, MOYU_USER_DATA: data, MOYU_TEST: '1', MOYU_DEMO: '1', MOYU_TEST_OFFSCREEN: '1' }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ ...(process.env.MOYU_E2E_EXECUTABLE ? { executablePath: process.env.MOYU_E2E_EXECUTABLE, args: [] } : { args: [project] }), env });
  const page = await app.firstWindow(), errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.ProseMirror h1')).toBeVisible(); return { app, page, data, errors };
}
async function blockInput(page:Page,action:string,input:any){if(!input.document||input.id||!/^code\.(run|data-upload|data-delete)$/.test(action))return input;const response:any=await page.evaluate(document=>window.moyu!.read(document),input.document);const normalized:any=await page.evaluate(v=>window.moyu!.feature('code.normalize',v),{document:input.document,content:response.data.content});const canonical=(l:string)=>/^(cpp|c\+\+|cc|cxx)$/i.test(l)?'cpp':/^(sql|sqlite)$/i.test(l)?'sql':/^(py|python)$/i.test(l)?'python':l.toLowerCase();const block=normalized.data.blocks.filter((b:any)=>canonical(b.language)===canonical(input.language))[(input.index||1)-1];return {...input,id:block.id,markdown:normalized.data.content};}
async function feature(page: Page, action: string, input: any = {}) {
  input=await blockInput(page,action,input);
  const result: any = await page.evaluate(({ action, input }) => window.moyu!.feature(action, input), { action, input });
  expect(result.ok, JSON.stringify(result)).toBe(true); return result.data;
}
async function upload(page:Page,document:string,language:string,index:number,name:string,content:string){const input=await blockInput(page,'code.data-upload',{document,language,index,name});const r:any=await page.evaluate(v=>window.moyu!.feature('code.data-upload',{...v,bytes:new TextEncoder().encode(v.text)}),{...input,text:content});expect(r.ok,JSON.stringify(r)).toBe(true);}

test('C/C++ compile block-local headers and mixed units, read stdin and files, invalidate headers, and do not reuse another block workspace', async () => {
  test.setTimeout(240000); const { app, page, data, errors } = await fixture('multi-file');
  try {
    const document = '多文件.md';
    await page.evaluate(document => window.moyu!.create(document, 'file', '```c\nputs("one");\n```\n\n```c\nputs("two");\n```\n\n```cpp\nstd::cout << 1;\n```\n'), document);
    const run = (language: string, index: number, code: string) => feature(page, 'code.run', { document, language, index, code });
    await upload(page, document, 'c', 1, 'util.h', 'int twice(int);');
    await upload(page, document, 'c', 1, 'util.c', '#include "util.h"\nint twice(int x) { return x*2; }');
    await upload(page, document, 'c', 1, 'stdin.txt', '21\n');
    await upload(page, document, 'c', 1, 'input.txt', 'file input');
    const cSource = '#include "util.h"\nint n=0; scanf("%d", &n); printf("answer=%d\\n", twice(n)); FILE *f=fopen("input.txt","r");char b[64];fgets(b,64,f);fclose(f);puts(b);f=fopen("output/result.txt","w");fputs("saved",f);fclose(f);';
    const c = await run('c', 1, cSource); expect(c.error, JSON.stringify(c)).toBe(''); expect(c.output).toBe('answer=42\nfile input\n'); expect(c.artifacts[0].name).toBe('result.txt');
    const groups = await feature(page, 'code.data-list', { document }), folder = groups.find((group: any) => group.key === '0001').path;
    expect(await fs.readFile(path.join(data, '示例知识库', folder, 'output/result.txt'), 'utf8')).toBe('saved');
    expect((await run('c', 2, '#include "util.h"\nprintf("%d", twice(3));')).error).toContain('util.h');
    await feature(page, 'code.data-delete', { document, language: 'c', index: 1, name: 'util.h' });
    expect((await run('c', 1, cSource)).error).toContain('util.h');
    await upload(page, document, 'c', 1, 'util.h', 'int twice(int);');
    await feature(page, 'code.data-delete', { document, language: 'c', index: 1, name: 'util.c' });
    await upload(page, document, 'c', 1, 'util.c', '#include "util.h"\nint twice(int x) { return x*3; }');
    expect((await run('c', 1, cSource)).output).toContain('answer=63');
    await feature(page, 'code.runtime-configure', { language: 'clang', settings: { cStandard: 'c99', cppStandard: 'c++20' } });
    await upload(page, document, 'cpp', 1, 'mixed.h', '#ifdef __cplusplus\nextern "C" {\n#endif\nint from_c(int);\n#ifdef __cplusplus\n}\n#endif\nint from_cpp(int);');
    await upload(page, document, 'cpp', 1, 'part.c', '#include "mixed.h"\nint from_c(int n){return __STDC_VERSION__==199901L?n*2:-1;}');
    await upload(page, document, 'cpp', 1, 'part.cpp', '#include "mixed.h"\nint from_cpp(int n){return __cplusplus==202002L?n+1:-1;}');
    await upload(page, document, 'cpp', 1, 'stdin.txt', '20');
    const cpp = await run('cpp', 1, '#include "mixed.h"\nint n;std::cin >> n;std::cout << from_cpp(from_c(n));');
    expect(cpp.error, JSON.stringify(cpp)).toBe(''); expect(cpp.output).toBe('41');
    await feature(page, 'code.runtime-configure', { language: 'clang', settings: { multiFile: false } });
    expect((await run('cpp', 1, '#include "mixed.h"\nstd::cout << from_c(2);')).error).not.toBe('');
    await upload(page, document, 'c', 2, '中文/常量.h', '#define ANSWER 42');
    await upload(page, document, 'c', 2, '输入.txt', '中文数据');
    const chinese = await run('c', 2, '#include "中文/常量.h"\nprintf("%d\\n",ANSWER);FILE *f=fopen("输入.txt","r");char b[64];fgets(b,64,f);fclose(f);puts(b);');
    expect(chinese.error, JSON.stringify(chinese)).toBe(''); expect(chinese.output).toBe('42\n中文数据\n');
    expect(errors).toEqual([]);
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); }
});
test('JS, Python and C/C++ cannot read host files, spawn host commands, or contact local services; own file I/O remains usable', async () => {
  test.setTimeout(180000); const { app, page, data, errors } = await fixture('runtime-isolation');
  const hostFile = path.join(data, 'host-only.txt'); await fs.writeFile(hostFile, 'HOST_SECRET');
  let requests = 0; const server = http.createServer((_request, response) => { requests++; response.end('HOST_SECRET'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const port = (server.address() as any).port;
  const run = (language: string, code: string) => feature(page, 'code.run', { language, code });
  try {
    const js = await run('js', `console.log(typeof process, typeof require, typeof window);try {await import('node:fs')} catch {console.log('node blocked')}try {await files.readFile(${JSON.stringify(hostFile)})} catch {console.log('host blocked')}try {await files.download('http://127.0.0.1:${port}/secret','secret.txt')} catch {console.log('network blocked')}await files.writeFile('ok.txt','own data');console.log(await files.readFile('ok.txt'));`);
    expect(js.output).toContain('undefined undefined undefined'); expect(js.output).toContain('node blocked'); expect(js.output).toContain('host blocked'); expect(js.output).toContain('network blocked'); expect(js.output).toContain('own data'); expect(js.output).not.toContain('HOST_SECRET');
    const py = await run('python', `import os, subprocess, js\ntry:\n    print(open(${JSON.stringify(hostFile)}).read())\nexcept Exception:\n    print("host blocked")\ntry:\n    subprocess.run(["cmd", "/c", "echo HOST_PROCESS"], check=True)\nexcept Exception:\n    print("process blocked")\ntry:\n    await download("http://127.0.0.1:${port}/secret", "secret.txt")\nexcept Exception:\n    print("network blocked")\nprint(js.eval("typeof process + ' ' + typeof require + ' ' + typeof window"))\nwith open("ok.txt", "w") as f:\n    f.write("own data")\nprint(open("ok.txt").read())`);
    expect(py.output).toContain('host blocked'); expect(py.output).toContain('process blocked'); expect(py.output).toContain('network blocked'); expect(py.output).toContain('undefined undefined undefined'); expect(py.output).toContain('own data'); expect(py.output).not.toContain('HOST_SECRET');
    const hostPath = hostFile.replaceAll('\\', '/');
    const c = await run('c', `FILE *f=fopen(${JSON.stringify(hostPath)},"r");printf("host blocked=%d\\n",f==NULL);printf("env blocked=%d\\n",getenv("MOYU_USER_DATA")==NULL);`);
    expect(c.error, JSON.stringify(c)).toBe(''); expect(c.output).toContain('host blocked=1'); expect(c.output).toContain('env blocked=1');
    const cpp = await run('cpp', `#include <fstream>\nstd::ifstream f(${JSON.stringify(hostPath)});std::cout << "host blocked=" << !f.is_open();`);
    expect(cpp.error, JSON.stringify(cpp)).toBe(''); expect(cpp.output).toBe('host blocked=1');
    const processCall = await run('c', 'printf("system=%d",system("echo HOST_PROCESS"));');
    expect(processCall.output).not.toContain('HOST_PROCESS'); expect(processCall.error || processCall.output).not.toBe('');
    expect(requests).toBe(0); expect(await fs.readFile(hostFile, 'utf8')).toBe('HOST_SECRET'); expect(errors).toEqual([]);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); }
});
test('Code indentation updates mounted regular and tabbed editors; C/C++ format from the menu using dprint JSON', async () => {
  test.setTimeout(120000); const { app, page, data, errors } = await fixture('format-indent');
  try {
    const source = '```c\nint main(){int x=1;return x;}\n```\n\n```tabs\n:::cpp C++\nint value(){return 42;}\n```\n';
    await page.evaluate(source => window.moyu!.create('缩进格式化.md', 'file', source), source); await page.locator('.tree-item[title="缩进格式化.md"]').dblclick();
    const regular = page.locator('.milkdown-code-block:not(.tabbed-code) .cm-content'), tabbed = page.locator('.tabbed-code .tabs-editor .cm-content');
    await regular.click(); await page.getByRole('button', { name: '偏好设置', exact: true }).click(); await selectPreference(page,'通用');
    await page.getByLabel('代码块默认缩进空格数', { exact: true }).fill('4'); await page.getByLabel('代码块默认缩进空格数', { exact: true }).press('Enter');
    const draft = JSON.parse(await page.getByLabel('dprint 配置 JSON').inputValue()); draft.clangFormat = { BasedOnStyle: 'LLVM', IndentWidth: 4, BreakBeforeBraces: 'Allman', AllowShortFunctionsOnASingleLine: 'None' };
    await page.getByLabel('dprint 配置 JSON').fill(JSON.stringify(draft)); await page.getByRole('button', { name: '应用', exact: true }).click(); await expect(page.locator('.code-formatting [role=status]')).toHaveText('已应用');
    await page.getByRole('button', { name: '关闭对话框' }).click(); await regular.click({ button: 'right' }); await page.getByRole('menuitem', { name: '格式化代码', exact: true }).click(); await expect(regular).toContainText('    int x = 1;');
    await tabbed.click({ button: 'right' }); await page.getByRole('menuitem', { name: '格式化代码', exact: true }).click(); await expect.poll(async () => (await tabbed.locator('.cm-line').allTextContents()).join('\n')).toBe('int value()\n{\n    return 42;\n}');
    for (const editor of [regular, tabbed]) { await editor.click(); await page.keyboard.press('Control+Home'); await page.keyboard.press('Tab'); await expect(editor).toContainText('    int'); await page.keyboard.press('Shift+Tab'); }
    await expect.poll(async () => JSON.parse(await fs.readFile(path.join(data, 'settings.json'), 'utf8')).values['moyu-code-indent']).toBe('4');
    expect(errors).toEqual([]);
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); }
});
test('Python packages required by another installed package have no uninstall button, including explicitly installed dependencies', async () => {
  test.setTimeout(60000); const { app, page, data, errors } = await fixture('package-ui');
  try {
    await feature(page, 'python.state');
    await fs.writeFile(path.join(data, 'Python/Runtime/314.0.7/packages.json'), JSON.stringify({ requested: ['numpy', 'matplotlib'], installed: ['numpy', 'matplotlib'] }));
    await page.getByRole('button', { name: '偏好设置', exact: true }).click(); await selectPreference(page,'Python');
    const numpy = page.locator('.python-package').filter({ has: page.locator('strong', { hasText: /^numpy$/ }) }), matplotlib = page.locator('.python-package').filter({ has: page.locator('strong', { hasText: /^matplotlib$/ }) });
    await expect(numpy).toContainText('依赖'); await expect(numpy.getByRole('button', { name: '卸载', exact: true })).toHaveCount(0); await expect(matplotlib.getByRole('button', { name: '卸载', exact: true })).toHaveCount(1); expect(errors).toEqual([]);
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); }
});
