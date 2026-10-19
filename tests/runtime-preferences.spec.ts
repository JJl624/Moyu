import {selectPreference} from './helpers/runtime-ui';
import {seedRuntimeCache} from './helpers/runtime-cache';
import { _electron as electron, expect, test, type Page } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project = path.resolve(import.meta.dirname, '..'), base = path.resolve(project, '../../work/e2e');
async function launch(data: string) {
  if(!await fs.stat(path.join(data,'runtimes/clang')).catch(()=>null))await seedRuntimeCache(data);

  const env = { ...process.env, MOYU_USER_DATA: data, MOYU_TEST: '1', MOYU_DEMO: '1', MOYU_TEST_OFFSCREEN: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ ...(process.env.MOYU_E2E_EXECUTABLE ? { executablePath: process.env.MOYU_E2E_EXECUTABLE, args: [] } : { args: [project] }), env });
  const page = await app.firstWindow(); await expect(page.locator('.ProseMirror h1')).toBeVisible();
  return { app, page };
}
async function run(page: Page, language: string, code: string) {
  const result: any = await page.evaluate(({ language, code }) => window.moyu!.feature('code.run', { language, code }), { language, code });
  expect(result.ok, JSON.stringify(result)).toBe(true); return result.data;
}
async function configure(page: Page, language: string, settings: Record<string, unknown>) {
  const response: any = await page.evaluate(({ language, settings }) => window.moyu!.feature('code.runtime-configure', { language, settings }), { language, settings });
  expect(response.ok, JSON.stringify(response)).toBe(true); return response.data;
}
test('C/C++ snippets wrap main only when needed, honor separate headers and standards, preserve diagnostics, and never change Markdown', async () => {
  test.setTimeout(240000); await fs.mkdir(base, { recursive: true });
  const data = await fs.mkdtemp(path.join(base, 'runtime-snippets-')), { app, page } = await launch(data);
  try {
    expect((await run(page, 'c', 'printf("hello");')).output).toBe('hello');
    expect((await run(page, 'C++', 'std::cout << "CPP";')).output).toBe('CPP');
    expect((await run(page, 'c', 'int main(void) { puts("own main"); return 0; }')).output).toBe('own main\n');
    expect((await run(page, 'cpp', '// int main() {}\nstd::cout << R"tag(int main() { fake })tag";')).output).toBe('int main() { fake }');
    const helper = '#include <stdio.h>\n#define VALUE 4\nint twice(int x) { return x*2; }\n#if VALUE == 4\nprintf("%d", twice(VALUE));\n#else\n#error wrong branch\n#endif';
    expect((await run(page, 'c', helper)).output).toBe('8');
    expect((await run(page, 'c', 'puts("ok");\nmissing_symbol;')).error).toMatch(/main\.c:2/);
    await configure(page, 'clang', { autoMain: false });
    expect((await run(page, 'c', 'printf("no main");')).error).not.toBe('');
    expect((await run(page, 'c', 'int main(void) { puts("explicit"); }')).output).toBe('explicit\n');
    await configure(page, 'clang', { autoMain: true, cHeaders: [] });
    expect((await run(page, 'c', 'puts("missing header");')).error).toContain('puts');
    await configure(page, 'clang', { cHeaders: ['stdio.h'], cppHeaders: ['iostream', 'vector'], cStandard: 'c99', cppStandard: 'c++17' });
    expect((await run(page, 'c', 'printf("%ld", (long)__STDC_VERSION__);')).output).toBe('199901');
    expect((await run(page, 'cpp', 'std::vector<int> v{1,2,3}; std::cout << v.size();')).output).toBe('3');
    const versionCode = 'std::cout << __cplusplus;';
    expect((await run(page, 'cpp', versionCode)).output).toBe('201703');
    await configure(page, 'clang', { cppStandard: 'c++20' });
    expect((await run(page, 'cpp', versionCode)).output).toBe('202002');
    const source = '```c\nprintf("snippet UI");\n```\n';
    await page.evaluate(source => window.moyu!.create('代码片段.md', 'file', source), source);
    await page.locator('.tree-item[title="代码片段.md"]').dblclick();
    await page.getByRole('button', { name: '运行代码块', exact: true }).click();
    await expect(page.locator('.code-output')).toHaveText('snippet UI');
    expect(await fs.readFile(path.join(data, '示例知识库/代码片段.md'), 'utf8')).toBe(source.replace('```c','```c {id=0001}'));
    await page.getByRole('button', { name: '源码', exact: true }).click();
    await expect(page.locator('.code-result')).toHaveCount(0);
    expect(await fs.readFile(path.join(data, 'settings.json'), 'utf8')).toContain('"c++20"');
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); }
});
test('Runtime settings UI saves and validates, restarts persist, timeouts recover, and data paths remain visible', async () => {
  test.setTimeout(180000); await fs.mkdir(base, { recursive: true });
  const data = await fs.mkdtemp(path.join(base, 'runtime-settings-')); let { app, page } = await launch(data);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.getByRole('button', { name: '偏好设置', exact: true }).click();
    await selectPreference(page,'JavaScript');
    await expect(page.locator('.runtime-version')).toContainText('V8');
    await page.getByLabel('JavaScript / TypeScript 代码执行时限', { exact: true }).fill('0');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('alert')).toContainText('1 到 3600');
    await page.getByLabel('JavaScript / TypeScript 代码执行时限', { exact: true }).fill('1');
    await page.getByLabel('JavaScript / TypeScript 准备时限', { exact: true }).fill('30');
    await page.keyboard.press('Tab');
    
    await selectPreference(page,'C / C++');
    await expect(page.locator('.runtime-version')).toContainText('0.3.0');
    await expect(page.getByLabel('缺少 main 时自动包裹')).toBeChecked();
    await page.getByLabel('C 语言标准', { exact: true }).selectOption('c17');
    await page.locator('.runtime-header-picker summary').click();
    await page.getByLabel('C 可用头文件', { exact: true }).getByRole('checkbox', { name: 'math.h', exact: true }).check();
    await expect(page.getByLabel('C 默认头文件', { exact: true })).toHaveValue('stdio.h, stdlib.h, math.h');
    await page.getByRole('group',{name:'C/C++ 设置',exact:true}).getByRole('button',{name:'C++',exact:true}).click();
    await page.getByLabel('C++ 语言标准', { exact: true }).selectOption('c++17');
    await page.getByLabel('C++ 默认头文件', { exact: true }).fill('iostream, vector');
    await page.getByLabel('C / C++ 代码执行时限', { exact: true }).fill('1');
    await page.getByLabel('C / C++ 准备时限', { exact: true }).fill('45');
    await page.keyboard.press('Tab');
    
    await page.getByRole('button', { name: '重启运行环境', exact: true }).click();
    await page.screenshot({ path: path.join(base, 'runtime-settings-dark.png') });
    await selectPreference(page,'界面');
    await page.getByRole('button', { name: '浅色', exact: true }).click();
    await selectPreference(page,'C / C++');
    await page.getByRole('group',{name:'C/C++ 设置',exact:true}).getByRole('button',{name:'C++',exact:true}).click();
    await expect(page.getByLabel('C++ 默认头文件', { exact: true })).toHaveValue('iostream, vector');
    await page.screenshot({ path: path.join(base, 'runtime-settings-light.png') });
    await selectPreference(page,'数据与运行环境');
    await expect(page.locator('.pref-content')).toContainText('代码运行设置');
    await page.getByRole('button', { name: '关闭对话框', exact: true }).click();
    const jsTimeout = await run(page, 'js', 'while(true) {}'); expect(jsTimeout.error).toContain('超过 1 秒');
    expect((await run(page, 'ts', 'const n: number = 42; console.log(n);')).output).toBe('42\n');
    const cTimeout = await run(page, 'c', 'while(1) {}'); expect(cTimeout.error).toContain('超过 1 秒');
    expect((await run(page, 'c', 'printf("%.1f", sqrt(9.0));')).output).toBe('3.0');
    expect(errors).toEqual([]);
    await app.evaluate(({ app }) => app.exit(0));
    ({ app, page } = await launch(data));
    await page.getByRole('button', { name: '偏好设置', exact: true }).click();
    await selectPreference(page,'JavaScript');
    await expect(page.getByLabel('JavaScript / TypeScript 代码执行时限', { exact: true })).toHaveValue('1');
    await selectPreference(page,'C / C++');
    await expect(page.getByLabel('C 语言标准', { exact: true })).toHaveValue('c17');
    await expect(page.getByLabel('C / C++ 准备时限', { exact: true })).toHaveValue('45');
    await expect(page.getByLabel('C 默认头文件', { exact: true })).toHaveValue('stdio.h, stdlib.h, math.h');
    await page.getByRole('button', { name: '关闭对话框', exact: true }).click();
    expect((await run(page, 'cpp', 'std::vector<int> v{1,2,3}; std::cout << v.size();')).output).toBe('3');
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); }
});
