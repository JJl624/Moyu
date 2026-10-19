import {selectPreference} from './helpers/runtime-ui';
import { _electron as electron, expect, test } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project = path.resolve(import.meta.dirname, '..'), work = path.resolve(project, '../../work');
async function fixture() {
  const data = await fs.mkdtemp(path.join(work, 'optimization-'));
  await fs.writeFile(
    path.join(data, 'settings.json'),
    JSON.stringify({ version: 1, values: { 'moyu-save-policy': 'manual', 'moyu-theme': 'light' } }),
  );
  const env = { ...process.env, MOYU_USER_DATA: data, MOYU_TEST: '1', MOYU_DEMO: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch(
      process.env.MOYU_E2E_EXECUTABLE
        ? { executablePath: process.env.MOYU_E2E_EXECUTABLE, args: [], env }
        : { args: [project], env },
    ),
    page = await app.firstWindow(),
    errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await (await app.browserWindow(page)).evaluate(w => {
    w.show();
    w.focus();
    w.webContents.focus();
    w.webContents.setBackgroundThrottling(false);
  });
  await expect(page.locator('.ProseMirror')).toBeVisible();
  return { app, page, data, root: path.join(data, '示例知识库'), errors };
}

test('Typing again during a pending save and then closing drains the newest buffer', async () => {
  const { app, page, root, errors } = await fixture();
  try {
    await page.evaluate(() => window.moyu!.create('保存竞态.md', 'file', 'original'));
    await page.locator('.tree-item[title="保存竞态.md"]').dblclick();
    await page.getByRole('button', { name: '源码', exact: true }).click();
    const source = page.locator('.source-editor .cm-content');
    await source.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(' first');
    await app.evaluate(() => {
      const fs = process.getBuiltinModule('fs/promises'), write = fs.writeFile;
      let blocked = false;
      fs.writeFile = async (...args: Parameters<typeof write>) => {
        if (
          !blocked && String(args[0]).endsWith('.tmp') && typeof args[1] === 'string'
          && args[1].includes('original first')
        ) {
          blocked = true;
          await new Promise<void>(resolve => {
            (globalThis as any).__releasePendingSave = resolve;
          });
        }
        return write(...args);
      };
    });
    await page.locator('.save-status').click();
    await expect.poll(() => app.evaluate(() => !!(globalThis as any).__releasePendingSave)).toBe(true);
    await source.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(' latest');
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    });
    await page.getByRole('button', { name: '关闭 保存竞态', exact: true }).click();
    await app.evaluate(() => (globalThis as any).__releasePendingSave());
    await expect(page.getByRole('button', { name: '关闭 保存竞态', exact: true })).toHaveCount(0);
    expect(await fs.readFile(path.join(root, '保存竞态.md'), 'utf8')).toBe('original first latest');
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test('Closing the last document using a language releases its sandbox and preserves another open language', async () => {
  const { app, page, errors } = await fixture();
  const sandboxes = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().filter(w => w.webContents.getURL().startsWith('moyu-run:')).length
    );
  try {
    for (
      const [name, code] of [['空白', '正文'], ['SQL释放', '```sql\nSELECT 42 AS answer;\n```'], [
        'JS释放',
        '```js\nconsole.log(42);\n```',
      ]]
    ) {
      await page.evaluate(({ name, code }) => window.moyu!.create(name + '.md', 'file', code), {
        name,
        code,
      });
    }
    const initial = await page.locator('.tab-name').first().getAttribute('title');
    await page.locator('.tree-item[title="空白.md"]').dblclick();
    if (initial) {
      await page.locator('.tab').filter({ has: page.locator(`.tab-name[title="${initial}"]`) }).getByRole(
        'button',
        { name: /关闭/ },
      ).click();
    }
    await expect.poll(sandboxes).toBe(0);
    await page.locator('.tree-item[title="SQL释放.md"]').dblclick();
    await page.getByLabel('数据库范围', { exact: true }).selectOption('memory');
    await page.getByRole('button', { name: '运行代码块', exact: true }).click();
    await expect(page.locator('.run-artifact table')).toContainText('42');
    await page.locator('.tree-item[title="JS释放.md"]').dblclick();
    await page.getByRole('button', { name: '运行代码块', exact: true }).click();
    await expect(page.locator('.code-output')).toHaveText('42\n');
    await expect.poll(sandboxes).toBe(2);
    await page.getByRole('button', { name: '关闭 JS释放', exact: true }).click();
    await expect.poll(sandboxes).toBe(1);
    await expect(page.locator('.tab.active .tab-name')).toHaveAttribute('title', 'SQL释放.md');
    await expect(page.locator('.run-artifact table')).toContainText('42');
    await page.getByRole('button', { name: '运行代码块', exact: true }).click();
    await expect(page.locator('.run-artifact table')).toContainText('42');
    await page.getByRole('button', { name: '关闭 SQL释放', exact: true }).click();
    await expect.poll(sandboxes).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test('Environment panels load on demand, retain form state and share keyboard navigation and single error feedback', async () => {
  const { app, page, errors } = await fixture();
  try {
    await page.getByRole('button', { name: '偏好设置', exact: true }).click();
    for (const language of ['Python', 'C#', 'JavaScript']) {
      await selectPreference(page,language);
      await expect(page.getByRole('tab', { name: '运行设置', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(
        page.locator('.runtime-installer,.runtime-manager,.manual-runtime-import,.javascript-dependencies'),
      ).toHaveCount(0);
      await page.getByRole('tab', { name: '环境', exact: true }).click();
      await expect(page.getByRole('tabpanel', { name: '环境', exact: true })).toBeVisible();
      await page.getByRole('tab', { name: '环境', exact: true }).press('Home');
      await expect(page.getByRole('tab', { name: '运行设置', exact: true })).toBeFocused();
    }
    await selectPreference(page,'C#');
    await page.getByRole('tab', { name: '环境', exact: true }).click();
    await page.getByRole('button', { name: '本地导入', exact: true }).click();
    await expect(page.locator('.manual-runtime-import')).toBeVisible();
    await page.getByRole('tab', { name: '运行设置', exact: true }).click();
    await page.getByRole('tab', { name: '环境', exact: true }).click();
    await expect(page.getByRole('button', { name: '本地导入', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: '在线安装', exact: true }).click();
    await app.evaluate(() => {
      globalThis.fetch = async () => {
        throw Error('测试连接失败');
      };
    });
    await page.getByRole('button', { name: '刷新版本', exact: true }).click();
    await expect(page.locator('.runtime-notice[role=alert]')).toContainText('无法连接下载源');
    await expect(page.getByRole('alert')).toHaveCount(1);
    await page.screenshot({ path: path.join(work, 'optimization-settings-light.png') });
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test('Off-screen table results defer page loading and populate when scrolled into view', async () => {
  const { app, page, errors } = await fixture();
  try {
    await page.evaluate(() =>
      window.moyu!.create('延迟表格.md', 'file', '```sql {height=1400}\nSELECT 42 AS answer;\n```')
    );
    await page.locator('.tree-item[title="延迟表格.md"]').dblclick();
    await page.getByLabel('数据库范围', { exact: true }).selectOption('memory');
    await page.getByRole('button', { name: '运行代码块', exact: true }).click();
    await expect(page.locator('.run-table-pages')).toContainText('1 行');
    expect(await page.locator('.run-artifact tbody tr').count()).toBe(0);
    await page.locator('.run-artifact table').scrollIntoViewIfNeeded();
    await expect(page.locator('.run-artifact table')).toContainText('42');
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
