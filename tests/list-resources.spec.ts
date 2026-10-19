import { _electron as electron, expect, test } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { editAttachment } from './attachment-helper';
const project = path.resolve(import.meta.dirname, '..');
test('Image links indent and outdent in one step without escaping or losing their preview', async () => {
  test.setTimeout(100000);
  const base = path.resolve(project, '../../work/e2e');
  await fs.mkdir(base, { recursive: true });
  const data = await fs.mkdtemp(path.join(base, 'list-resources-'));
  await fs.writeFile(
    path.join(data, 'settings.json'),
    JSON.stringify({ version: 1, values: { 'moyu-save-policy': 'manual' } }),
  );
  const env = { ...process.env, MOYU_USER_DATA: data, MOYU_TEST: '1', MOYU_DEMO: '1' };
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
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false)
    );
    await expect(page.locator('.ProseMirror h1')).toBeVisible();
    const root = path.join(data, '示例知识库'), disk = path.join(root, '图片列表.md');
    await fs.writeFile(
      path.join(root, '中文 图.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="80"><rect width="180" height="80" fill="orange"/></svg>',
    );
    const raw = '![中文 图|180](<中文 图.svg>)';
    await page.evaluate(
      async content => window.moyu!.create('图片列表.md', 'file', content),
      '- 上一项\n- 正文\n\n  ' + raw + '\n- 下一项',
    );
    await page.locator('.tree-item[title="图片列表.md"]').dblclick();
    const source = page.locator('.visual-attachment'),
      preview = page.locator('.attachment-overlay img');
    await expect(preview).toBeVisible();
    const depth = () =>
      source.evaluate(el => {
        let depth = 0;
        for (
          let p = el.parentElement;
          p;
          p = p.parentElement
        ) if (p.classList.contains('list-item')) depth++;
        return depth;
      });
    const save = async () => {
      const previous = await fs.readFile(disk, 'utf8');
      await app.evaluate(({ Menu }) =>
        Menu.getApplicationMenu()!.items.flatMap(x => x.submenu?.items || []).find(x =>
          x.label === '保存'
        )!.click()
      );
      await expect.poll(() => fs.readFile(disk, 'utf8')).not.toBe(previous);
      await expect.poll(() => fs.readFile(disk, 'utf8')).toContain(raw);
      expect(await fs.readFile(disk, 'utf8')).not.toContain('\\!');
      expect(await fs.readFile(disk, 'utf8')).not.toContain('\\[');
    };
    for (let repeat = 0; repeat < 3; repeat++) {
      await editAttachment(page, source);
      await expect(source.locator('.syntax-raw')).toHaveText(raw);
      const beforeIndent = await source.evaluate(el => el.closest('p')!.getBoundingClientRect().x);
      await page.keyboard.press('Tab');
      await expect.poll(depth).toBe(2);
      await expect.poll(() => source.evaluate(el => el.closest('p')!.getBoundingClientRect().x))
        .toBeGreaterThan(
          beforeIndent + 10,
        );
      await save();
      await expect(preview).toBeHidden();
      await page.keyboard.press('Shift+Tab');
      await expect.poll(depth).toBe(1);
      await expect.poll(() => source.evaluate(el => el.closest('p')!.getBoundingClientRect().x))
        .toBe(beforeIndent);
      await save();
      await page.getByRole('button', { name: '源码', exact: true }).click();
      await expect(page.locator('.source-editor .cm-content')).toContainText(raw);
      await page.getByRole('button', { name: '预览编辑', exact: true }).click();
      await expect(preview).toBeHidden();
      await expect(source.locator('.syntax-raw')).toHaveText(raw);
    }
    // An unfinished URL remains editable Markdown through a mode round-trip.
    // Generic text serialization must not escape its image/link delimiters.
    await editAttachment(page, source);
    await page.keyboard.press('End');
    await page.keyboard.press('Backspace');
    const unfinished = raw.slice(0, -1);
    await page.getByRole('button', { name: '源码', exact: true }).click();
    await expect(page.locator('.source-editor .cm-content')).toContainText(unfinished);
    await page.getByRole('button', { name: '预览编辑', exact: true }).click();
    await page.locator('.ProseMirror p').filter({ hasText: unfinished }).click();
    await page.keyboard.press('Tab');
    const previous = await fs.readFile(disk, 'utf8');
    await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()!.items.flatMap(x => x.submenu?.items || []).find(x =>
        x.label === '保存'
      )!.click()
    );
    await expect.poll(() => fs.readFile(disk, 'utf8')).not.toBe(previous);
    await expect.poll(() => fs.readFile(disk, 'utf8')).toContain(unfinished);
    expect(await fs.readFile(disk, 'utf8')).not.toContain('\\[');
    await page.evaluate(
      async content => window.moyu!.create('未完成.md', 'file', content),
      '- 上一项\n- 正文\n\n  ' + unfinished + '\n- 下一项',
    );
    await page.locator('.tree-item[title="未完成.md"]').dblclick();
    await page.locator('.ProseMirror p').filter({ hasText: unfinished }).click();
    await page.keyboard.press('Tab');
    const incompleteDisk = path.join(root, '未完成.md'),
      initial = await fs.readFile(incompleteDisk, 'utf8');
    await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()!.items.flatMap(x => x.submenu?.items || []).find(x =>
        x.label === '保存'
      )!.click()
    );
    await expect.poll(() => fs.readFile(incompleteDisk, 'utf8')).not.toBe(initial);
    await expect.poll(() => fs.readFile(path.join(root, '未完成.md'), 'utf8')).toContain(
      unfinished,
    );
    expect(await fs.readFile(path.join(root, '未完成.md'), 'utf8')).not.toContain('\\[');
    await page.keyboard.press('End');
    await page.keyboard.insertText(')');
    await page.locator('.ProseMirror p').last().click();
    await expect(preview).toBeVisible();
    await editAttachment(page, source);
    await expect(source.locator('.syntax-raw')).toHaveText(raw);
    await expect.poll(depth).toBe(2);
    await page.keyboard.press('Shift+Tab');
    await expect.poll(depth).toBe(1);
    await page.getByRole('button', { name: '源码', exact: true }).click();
    await expect(page.locator('.source-editor .cm-content')).toContainText(raw);
    await page.getByRole('button', { name: '预览编辑', exact: true }).click();
    await expect(preview).toBeHidden();
    for (
      const [name, content] of [
        ['有序.md', '1. 上一项\n2. 正文\n\n   ' + raw + '\n3. 下一项'],
        ['任务.md', '- [ ] 上一项\n- [x] 正文\n\n  ' + raw + '\n- [ ] 下一项'],
      ]
    ) {
      await page.evaluate(async ({ name, content }) => window.moyu!.create(name, 'file', content), {
        name,
        content,
      });
      await page.locator('.tree-item[title="' + name + '"]').dblclick();
      await expect(preview).toBeVisible();
      await editAttachment(page, source);
      await page.keyboard.press('Tab');
      await expect.poll(depth).toBe(2);
      await expect(source.locator('.syntax-raw')).toHaveText(raw);
      await page.keyboard.press('Shift+Tab');
      await expect.poll(depth).toBe(1);
      await expect(source.locator('.syntax-raw')).toHaveText(raw);
      if (name === '任务.md') {
        await expect(
          source.locator('xpath=ancestor::li[1]').getByRole('checkbox', { name: '完成列表任务' }),
        ).toBeChecked();
      }
    }
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
