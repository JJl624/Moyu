import { _electron as electron, expect, test } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project = path.resolve(import.meta.dirname, '..');
async function fixture() {
  const base = path.resolve(project, '../../work/e2e');
  await fs.mkdir(base, { recursive: true });
  const data = await fs.mkdtemp(path.join(base, 'stability-navigation-'));
  const existing = path.join(data, '已有知识库'), missing = path.join(data, '已移走知识库');
  await fs.mkdir(existing);
  await fs.writeFile(path.join(existing, '保留.md'), '用户文档');
  await fs.writeFile(
    path.join(data, 'settings.json'),
    JSON.stringify({version:1,workspace:{
      root: missing,
      recent: [{ root: existing, name: '已有知识库', opened: 1 }, {
        root: missing,
        name: '已移走知识库',
        opened: 0,
      }],
    }}),
  );
  const env = { ...process.env, MOYU_USER_DATA: data, MOYU_TEST: '1', MOYU_DEMO: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    ...(process.env.MOYU_E2E_EXECUTABLE
      ? { executablePath: process.env.MOYU_E2E_EXECUTABLE, args: [] }
      : { args: [project] }),
    env,
  });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false)
  );
  await expect(page.getByRole('region', { name: '知识库导航' })).toBeVisible();
  await expect(page.locator('.vault-entry')).toHaveCount(2);
  return { app, page, data, existing, missing };
}

test('Missing vaults stay grey and cannot recreate directories; removing recent vaults leaves files and persists', async () => {
  const { app, page, data, existing, missing } = await fixture();
  try {
    expect(await fs.stat(missing).catch(() => null)).toBe(null);
    const absent = page.locator('.vault-entry').filter({ hasText: '已移走知识库' });
    await expect(absent).toHaveClass(/missing/);
    await expect(absent.locator('.vault-open')).toBeDisabled();
    await expect(absent.locator('.vault-open')).toHaveCSS('opacity', '0.55');
    const response = await page.evaluate(
      async root =>
        (await window.moyu!.feature('navigation.open', { root }) as unknown as { ok: boolean }).ok,
      missing,
    );
    expect(response).toBe(false);
    expect(await fs.stat(missing).catch(() => null)).toBe(null);
    await page.getByRole('button', { name: '移除知识库 已移走知识库', exact: true }).click();
    await expect(absent).toHaveCount(0);
    await page.getByRole('button', { name: '移除知识库 已有知识库', exact: true }).click();
    await expect(page.locator('.vault-entry')).toHaveCount(0);
    expect(await fs.readFile(path.join(existing, '保留.md'), 'utf8')).toBe('用户文档');
    await expect.poll(async () =>
      JSON.parse(await fs.readFile(path.join(data, 'settings.json'), 'utf8')).workspace.recent
    ).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test('Formula/code example has stable code DOM, Enter frames, wheel geometry and idle last-line position', async () => {
  test.setTimeout(100000);
  const { app, page, existing } = await fixture();
  try {
    await page.locator('.vault-entry').filter({ hasText: '已有知识库' }).locator('.vault-open')
      .click();
    await expect(page.locator('.workspace-picker')).toContainText('已有知识库');
    await expect(page.locator('.tree-item[title="保留.md"]')).toBeVisible();
    const content = await fs.readFile(
      path.join(project, 'resources/workspace-guide/公式和代码示例.md'),
      'utf8',
    );
    await page.evaluate(
      content => window.moyu!.create('公式和代码示例.md', 'file', content + '\n\n最后一行'),
      content,
    );
    await page.locator('.tree-item[title="公式和代码示例.md"]').dblclick();
    const codes = (content.match(/^```\w+/gm) || []).length
      + (content.match(/^\$\$$/gm) || []).length / 2;
    await expect(page.locator('.milkdown-code-block .cm-editor')).toHaveCount(codes);
    await expect(page.locator('.milkdown-code-block-placeholder')).toHaveCount(0);
    await expect(page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending', 'true');
    await page.evaluate(() => {
      const scope = document.querySelector('.document-scroll') as HTMLElement;
      (window as any).stabilitySamples = [];
      (window as any).stabilityStop = false;
      const sample = () => {
        if ((window as any).stabilityStop) return;
        const host = document.querySelector('.editor-host') as HTMLElement;
        (window as any).stabilitySamples.push({
          top: scope.scrollTop,
          height: scope.scrollHeight,
          pending: host?.dataset.editorPending,
          opacity: host ? getComputedStyle(host).opacity : '',
        });
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.locator('.ProseMirror > p').last().click();
    await page.keyboard.press('End');
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Enter');
      await page.keyboard.insertText('新行 ' + i);
    }
    const last = page.locator('.ProseMirror > p').last();
    await last.click();
    await page.keyboard.press('End');
    await page.waitForTimeout(400);
    const idle = await page.evaluate(async () => {
      const scope = document.querySelector('.document-scroll') as HTMLElement;
      const positions: number[] = [];
      for (let i = 0; i < 70; i++) {
        positions.push(scope.scrollTop);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return positions;
    });
    expect(Math.max(...idle) - Math.min(...idle)).toBeLessThan(2);
    await page.evaluate(() => {
      (window as any).stableCodeElements = [
        ...document.querySelectorAll('.milkdown-code-block .cm-editor'),
      ];
    });
    const scope = page.locator('.document-scroll');
    await scope.hover();
    for (const delta of [-250, -300, -350, 200, 300, 300]) {
      await page.mouse.wheel(0, delta);
      await page.waitForTimeout(100);
    }
    await page.waitForTimeout(5600);
    expect(
      await page.evaluate(() =>
        (window as any).stableCodeElements.every((node: Element, i: number) =>
          node === document.querySelectorAll('.milkdown-code-block .cm-editor')[i]
        )
      ),
    ).toBe(true);
    const samples = await page.evaluate(() => {
      (window as any).stabilityStop = true;
      return (window as any).stabilitySamples;
    });
    expect(samples.length).toBeGreaterThan(10);
    expect(
      samples.every((s: { pending?: string; opacity: string }) =>
        s.pending !== 'true' && s.opacity === '1'
      ),
    ).toBe(true);
    await page.locator('.workspace-picker').click();
    await page.getByRole('button', { name: '移除知识库 已有知识库', exact: true }).click();
    await expect(page.locator('.vault-entry').filter({ hasText: '已有知识库' })).toHaveCount(0);
    expect(await fs.readFile(path.join(existing, '保留.md'), 'utf8')).toBe('用户文档');
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
