import { _electron as electron, expect, test } from './helpers/test';
import { selectPreference } from './helpers/runtime-ui';
import fs from 'node:fs/promises';
import path from 'node:path';

const project = path.resolve(import.meta.dirname, '..'), work = path.resolve(project, '../../work');
for (const theme of ['light', 'dark']) test(`Typography and terminal forms fit, apply and retain settings (${theme})`, async () => {
  const data = await fs.mkdtemp(path.join(work, 'type-terminal-'));
  await fs.writeFile(path.join(data, 'settings.json'), JSON.stringify({ version: 1, values: { 'moyu-theme': theme } }));
  const env = { ...process.env, MOYU_USER_DATA: data, MOYU_DEMO: '1', MOYU_TEST: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch(process.env.MOYU_E2E_EXECUTABLE
    ? { executablePath: process.env.MOYU_E2E_EXECUTABLE, args: [], env } : { args: [project], env });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.ProseMirror')).toBeVisible();
    const win = await app.browserWindow(page);
    await win.evaluate(w => { w.setSize(980, 800); w.show(); w.focus(); });
    await page.getByRole('button', { name: '偏好设置', exact: true }).click();
    await selectPreference(page, '终端');
    await page.locator('.modal').screenshot({ path: path.join(work, `terminal-default-${theme}.png`) });
    const terminal = page.locator('.terminal-preferences');
    const size = page.getByLabel('终端字号', { exact: true }), height = page.getByLabel('终端行高', { exact: true });
    const sizeBox = (await size.boundingBox())!, heightBox = (await height.boundingBox())!;
    expect(sizeBox.width).toBeLessThanOrEqual(90);
    expect(sizeBox.y).toBe(heightBox.y);
    expect((await page.getByLabel('终端程序参数').boundingBox())!.height).toBeLessThan(100);
    await size.fill('18'); await height.fill('1.4');
    await page.getByLabel('终端光标样式').selectOption('bar');
    await page.getByRole('switch', { name: '终端光标闪烁' }).click();
    await page.getByLabel('终端回滚行数').fill('3000');
    await page.getByLabel('终端字体', { exact: true }).fill('Consolas');
    await page.keyboard.press('Tab');
    await page.getByLabel('默认终端 Shell').selectOption('custom');
    // Use a real executable path; this changes only the launch preferences, not a running shell.
    const shell = await app.evaluate(() => process.env.ComSpec || process.env.SHELL || '');
    await page.getByLabel('终端程序', { exact: true }).fill(shell);
    await page.getByLabel('终端程序参数').fill(process.platform === 'win32' ? '/Q\n/D' : '--noprofile\n--norc');
    await page.getByLabel('终端程序参数').blur();
    await page.locator('.modal').screenshot({ path: path.join(work, `terminal-preferences-${theme}.png`) });
    for (const width of [900, 1200]) {
      await win.evaluate((w, width) => w.setSize(width, 760), width);
      expect(await terminal.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      const starts = await Promise.all(['终端字体', '终端字号', '终端光标样式', '终端回滚行数',
        '默认终端 Shell', '终端程序', '终端程序参数'].map(async name => (await page.getByLabel(name, { exact: true }).boundingBox())!.x));
      expect(Math.max(...starts) - Math.min(...starts)).toBeLessThan(1);
      expect((await height.boundingBox())!.x).toBe((await page.getByRole('switch', { name: '终端光标闪烁' }).boundingBox())!.x);
      expect(await terminal.locator('.compact-inline-field').evaluateAll(fields => fields.every(field => {
        const box = field.getBoundingClientRect();
        return Array.from(field.children).every(child => {
          const rect = child.getBoundingClientRect();
          return rect.left >= box.left - 1 && rect.right <= box.right + 1;
        });
      }))).toBe(true);
    }
    await selectPreference(page, '字体与排版');
    await page.getByRole('button', { name: '源码界面', exact: true }).click();
    const region = page.locator('.regional-type-settings');
    await expect(region.getByRole('button', { name: '恢复继承' })).toBeDisabled();
    await win.evaluate(w => w.setSize(980, 800));
    await region.scrollIntoViewIfNeeded();
    await page.locator('.modal').screenshot({ path: path.join(work, `regional-default-${theme}.png`) });
    await page.getByLabel('源码界面字体', { exact: true }).fill('Consolas'); await page.keyboard.press('Tab');
    await page.getByLabel('源码界面字号', { exact: true }).fill('19');
    await page.getByLabel('源码界面行高', { exact: true }).fill('1.9');
    await expect(page.getByLabel('源码界面字体预览')).toHaveCSS('font-size', '19px');
    await expect(page.getByLabel('源码界面字体预览')).toHaveCSS('line-height', '36.1px');
    await page.getByRole('button', { name: '阅读正文', exact: true }).click();
    await expect(page.getByLabel('阅读正文字体', { exact: true })).toHaveValue('');
    await page.getByRole('button', { name: '源码界面', exact: true }).click();
    await expect(page.getByLabel('源码界面字号', { exact: true })).toHaveValue('19');
    await page.getByRole('button', { name: '选择源码界面字体', exact: true }).click();
    await page.getByRole('option', { name: /^继承默认/ }).click();
    await expect(page.getByLabel('源码界面字体', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('源码界面字号', { exact: true })).toHaveValue('19');
    await win.evaluate(w => w.setSize(980, 800));
    await region.scrollIntoViewIfNeeded();
    const fontStart = (await page.getByLabel('源码界面字体', { exact: true }).boundingBox())!.x;
    expect((await page.getByLabel('源码界面字号', { exact: true }).boundingBox())!.x).toBe(fontStart);
    expect((await page.getByLabel('源码界面行高', { exact: true }).boundingBox())!.y)
      .toBe((await page.getByLabel('源码界面字号', { exact: true }).boundingBox())!.y);
    await region.getByRole('heading', { name: '源码界面', exact: true }).click();
    await page.locator('.modal').screenshot({ path: path.join(work, `regional-fonts-${theme}.png`) });
    for (const name of ['阅读标题', '文件浏览器', '源码界面']) {
      await page.getByRole('button', { name, exact: true }).click();
      expect(await region.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    await page.getByRole('button', { name: '关闭对话框', exact: true }).click();
    await page.getByRole('button', { name: '偏好设置', exact: true }).click();
    await expect(page.getByLabel('源码界面字号', { exact: true })).toHaveValue('19');
    await page.getByRole('button', { name: '恢复继承', exact: true }).click();
    await expect(page.getByLabel('源码界面字体', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('源码界面字号', { exact: true })).toHaveValue('13');
    await selectPreference(page, '终端');
    await expect(size).toHaveValue('18'); await expect(height).toHaveValue('1.4');
    await expect(page.getByLabel('终端字体', { exact: true })).toHaveValue('Consolas');
    await expect(page.getByLabel('终端光标样式')).toHaveValue('bar');
    await expect(page.getByRole('switch', { name: '终端光标闪烁' })).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByLabel('终端程序', { exact: true })).toHaveValue(shell);
    await expect(page.getByLabel('终端程序参数')).toHaveValue(process.platform === 'win32' ? '/Q\n/D' : '--noprofile\n--norc');
    await page.getByRole('button', { name: '关闭对话框', exact: true }).click();
    const saved = JSON.parse(await fs.readFile(path.join(data, 'settings.json'), 'utf8'));
    expect(JSON.parse(saved.values['moyu-terminal'])).toMatchObject({ fontSize: 18, lineHeight: 1.4, scrollback: 3000, shell });
    expect(JSON.parse(saved.values['moyu-appearance']).roleFonts.source).toBeUndefined();
  } finally { await app.evaluate(({ app }) => app.exit(0)); }
});
