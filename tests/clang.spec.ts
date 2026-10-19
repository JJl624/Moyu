import { _electron as electron, expect, test } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project = path.resolve(import.meta.dirname, '..');
test('Clang runs C and C++ offline with isolated files, bounded output, diagnostics, cancellation and warm reuse', async () => {
  test.setTimeout(240000);
  const base = path.resolve(project, '../../work/e2e');
  await fs.mkdir(base, { recursive: true });
  const data = await fs.mkdtemp(path.join(base, 'clang-'));
  const env = {
    ...process.env,
    MOYU_USER_DATA: data,
    MOYU_TEST: '1',
    MOYU_DEMO: '1',
    MOYU_TEST_OFFSCREEN: '1',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    ...(process.env.MOYU_E2E_EXECUTABLE
      ? { executablePath: process.env.MOYU_E2E_EXECUTABLE, args: [] }
      : { args: [project] }),
    env,
  });
  try {
    const page = await app.firstWindow(), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await expect(page.locator('.ProseMirror h1')).toBeVisible();
    const run = (language: string, code: string) =>
      page.evaluate(({ language, code }) => window.moyu!.feature('code.run', { language, code }), {
        language,
        code,
      }) as Promise<any>;
    const first = await run(
      'c',
      '#include <stdio.h>\nint main(void) { printf("C=%d\\n", 6*7); return 0; }',
    );
    expect(first.ok, JSON.stringify(first)).toBe(true);
    expect(first.data.error, JSON.stringify(first)).toBe('');
    expect(first.data.output).toBe('C=42\n');
    const cpp = await run(
      'C++',
      '#include <iostream>\n#include <vector>\nint main() { std::vector<int> v{1,2,3}; int s=0; for(int n:v) s+=n; std::cout << "CPP=" << s << "\\n"; }',
    );
    expect(cpp.ok, JSON.stringify(cpp)).toBe(true);
    expect(cpp.data.error, JSON.stringify(cpp)).toBe('');
    expect(cpp.data.output).toBe('CPP=6\n');
    const error = await run('cpp', 'int main() { missing_symbol; }');
    expect(error.data.error).toContain('missing_symbol');
    const document = 'C数据.md';
    await page.evaluate(
      document =>
        window.moyu!.create(
          document,
          'file',
          '```c\n#include <stdio.h>\nint main(void) { puts("UI C"); }\n```\n',
        ),
      document,
    );
    await page.locator('.tree-item[title="C数据.md"]').dblclick();
    await expect(page.getByRole('button', { name: '运行代码块', exact: true })).toHaveCount(1);
    const fileCode =
      '#include <stdio.h>\nint main(void) { FILE *f=fopen("result.txt","w"); fputs("file data",f); fclose(f); f=fopen("output/export.txt","w"); fputs("export",f); fclose(f); puts("files saved"); }';
    const saved: any = await page.evaluate(
      ({ document, code }) =>
        window.moyu!.feature('code.run', { language: 'c', document, id: '0001', code }),
      { document, code: fileCode },
    );
    expect(saved.ok, JSON.stringify(saved)).toBe(true);
    expect(saved.data.error, JSON.stringify(saved)).toBe('');
    expect(saved.data.artifacts[0].name).toBe('export.txt');
    const groups: any = await page.evaluate(
      document => window.moyu!.feature('code.data-list', { document }),
      document,
    );
    expect(groups.data[0].key).toBe('0001');
    expect(
      await fs.readFile(path.join(data, '示例知识库', groups.data[0].path, 'result.txt'), 'utf8'),
    ).toBe('file data');
    const read: any = await page.evaluate(
      document =>
        window.moyu!.feature('code.run', {
          language: 'c',
          document,
          id: '0001',
          code:
            '#include <stdio.h>\nint main(void) { FILE *f=fopen("result.txt","r"); char b[64]; fgets(b,64,f); fclose(f); puts(b); }',
        }),
      document,
    );
    expect(read.data.output).toBe('file data\n');
    const isolated = await run(
      'c',
      '#include <stdio.h>\nint main(void) { printf("isolated=%d\\n",fopen("result.txt","r")==NULL); }',
    );
    expect(isolated.data.output).toBe('isolated=1\n');
    const flood = await run(
      'c',
      '#include <stdio.h>\nint main(void) { while(1) puts("0123456789"); }',
    );
    expect(flood.data.output.length).toBeLessThanOrEqual(65536);
    expect(flood.data.error).toContain('64 KB');
    const pending = run('c', 'int main(void) { while(1) {} }');
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 1000)));
    await page.evaluate(() => window.moyu!.feature('code.stop'));
    const stopped = await pending;
    expect(JSON.stringify(stopped)).toContain('停止');
    const again = await run('c', '#include <stdio.h>\nint main(void) { puts("again"); }');
    expect(again.data.output).toBe('again\n');
    const global = '#include <stdio.h>\nint n=0; int main(void) { printf("global=%d\\n",++n); }';
    expect((await run('c', global)).data.output).toBe('global=1\n');
    expect((await run('c', global)).data.output).toBe('global=1\n');
    const js = await run('javascript', 'console.log(42)');
    expect(js.data.output).toBe('42\n');
    const py = await run('python', 'print(42)');
    expect(py.data.output).toBe('42\n');
    await page.getByRole('button', { name: '运行代码块', exact: true }).click();
    await expect(page.locator('.code-output')).toHaveText('UI C\n');
    await page.getByRole('button', { name: '阅读', exact: true }).click();
    await expect(page.getByRole('button', { name: '运行代码块', exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: '源码', exact: true }).click();
    await expect(page.locator('.code-result')).toHaveCount(0);
    expect(errors).toEqual([]);
    console.log(
      JSON.stringify({
        coldC: first.data.elapsed,
        warmCPP: cpp.data.elapsed,
        C: 'passed',
        CPP: 'passed',
        files: 'passed',
        cancellation: 'passed',
        JS: 'passed',
        Python: 'passed',
      }),
    );
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
