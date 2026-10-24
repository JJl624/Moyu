import { _electron as electron, expect, test } from './helpers/test';
import { selectPreference } from './helpers/runtime-ui';
import fs from 'node:fs/promises';
import path from 'node:path';

const project = path.resolve(import.meta.dirname, '..'), work = path.resolve(project, '../../work');
async function fixture() {
  const data = await fs.mkdtemp(path.join(work, 'terminal-pref-bugs-'));
  const env = { ...process.env, MOYU_USER_DATA: data, MOYU_DEMO: '1', MOYU_TEST: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch(process.env.MOYU_E2E_EXECUTABLE
    ? { executablePath: process.env.MOYU_E2E_EXECUTABLE, args: [], env } : { args: [project], env });
  const page = await app.firstWindow();
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await (await app.browserWindow(page)).evaluate(w => { w.show(); w.focus(); });
  await page.getByRole('button', { name: '偏好设置', exact: true }).click();
  await selectPreference(page, '终端');
  return { app, page, data };
}

test('Resetting a custom terminal restores the system Shell without retaining a stale custom selection', async () => {
  const { app, page, data } = await fixture();
  try {
    await page.getByLabel('默认终端 Shell').selectOption('custom');
    await page.getByLabel('终端程序', { exact: true }).fill(await app.evaluate(() => process.env.ComSpec || process.env.SHELL || ''));
    await page.getByRole('button', { name: '恢复默认', exact: true }).click();
    await expect(page.getByLabel('默认终端 Shell')).toHaveValue('default');
    await expect(page.getByLabel('终端程序', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('终端程序参数')).toHaveValue('');
    await page.getByRole('button', { name: '关闭对话框', exact: true }).click();
    const saved = JSON.parse(await fs.readFile(path.join(data, 'settings.json'), 'utf8'));
    expect(JSON.parse(saved.values['moyu-terminal'])).toMatchObject({ shell: '', arguments: [] });
  } finally { await app.evaluate(({ app }) => app.exit(0)); }
});

test('Incomplete and out-of-range terminal numbers normalize on blur and do not block other preferences', async () => {
  const { app, page, data } = await fixture();
  try {
    for (const [label, input, expected] of [
      ['终端字号', '', '14'], ['终端字号', '37', '36'], ['终端字号', '14.5', '15'],
      ['终端行高', '', '1.2'], ['终端行高', '.5', '1'],
      ['终端回滚行数', '', '5000'], ['终端回滚行数', '20001', '20000'],
      ['终端回滚行数', '123.5', '124'],
    ]) {
      const field = page.getByLabel(label, { exact: true });
      await field.fill(input); await field.press('Tab');
      await expect(field).toHaveValue(expected);
      await expect(page.locator('.terminal-preferences [role=alert]')).toHaveCount(0);
    }
    await selectPreference(page, '编辑');
    await expect(page.getByLabel('保存方式', { exact: true })).toBeVisible();
    const saved = JSON.parse(await fs.readFile(path.join(data, 'settings.json'), 'utf8'));
    expect(JSON.parse(saved.values['moyu-terminal'])).toMatchObject({ fontSize: 15, lineHeight: 1, scrollback: 124 });
  } finally { await app.evaluate(({ app }) => app.exit(0)); }
});

test('A successful Shell detection clears the previous detection error', async () => {
  const { app, page } = await fixture();
  try {
    await app.evaluate(({ ipcMain }) => {
      const handlers = (ipcMain as any)._invokeHandlers;
      const original = handlers.get('moyu:feature');
      (globalThis as any).__restoreShellDetection = () => {
        ipcMain.removeHandler('moyu:feature'); ipcMain.handle('moyu:feature', original);
      };
      ipcMain.removeHandler('moyu:feature');
      ipcMain.handle('moyu:feature', (event, action, ...args) => action === 'terminal.shells'
        ? { ok: false, error: { message: 'Shell detection unavailable' } } : original(event, action, ...args));
    });
    await page.getByRole('button', { name: '重新检测 Shell' }).click();
    await expect(page.locator('.terminal-preferences [role=alert]')).toHaveText('Shell detection unavailable');
    await app.evaluate(() => (globalThis as any).__restoreShellDetection());
    await page.getByRole('button', { name: '重新检测 Shell' }).click();
    await expect(page.locator('.terminal-preferences [role=alert]')).toHaveCount(0);
    await expect.poll(() => page.getByLabel('默认终端 Shell').locator('option').count()).toBeGreaterThan(2);
  } finally { await app.evaluate(({ app }) => app.exit(0)); }
});
