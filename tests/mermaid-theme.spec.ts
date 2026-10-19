import { _electron as electron, expect, test } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project = path.resolve(import.meta.dirname, '..');
const cases = JSON.parse(
  await fs.readFile(path.join(project, 'tests/fixtures/mermaid.json'), 'utf8'),
)
  .filter((item: { name: string }) =>
    [
      'packet',
      'timeline',
      'architecture',
      'wardley',
      'cynefin',
      'treeView',
      'railroad',
      'eventmodeling',
    ].includes(item.name)
  );

test('Diagram arrows, boundaries and labels remain legible in both themes, modes and vector exports', async () => {
  test.setTimeout(360000);
  const base = path.resolve(project, '../../work/e2e');
  const data = await fs.mkdtemp(path.join(base, 'mermaid-theme-'));
  const env = { ...process.env, MOYU_USER_DATA: data, MOYU_TEST: '1', MOYU_DEMO: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch(
    process.env.MOYU_E2E_EXECUTABLE
      ? { executablePath: process.env.MOYU_E2E_EXECUTABLE, args: [], env }
      : { args: [project], env },
  );
  try {
    const page = await app.firstWindow(), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.webContents.setBackgroundThrottling(false);
      window.setSize(1200, 1000);
    });
    await expect(page.locator('.ProseMirror h1')).toBeVisible();
    for (const { name, code } of cases) {
      const file = name + '-theme.md', markdown = '```mermaid {id=0001}\n' + code + '\n```\n';
      await page.evaluate(({ file, markdown }) => window.moyu!.create(file, 'file', markdown), {
        file,
        markdown,
      });
      await page.locator('.tree-item[title="' + file + '"]').dblclick();
      for (const mode of ['预览编辑', '阅读']) {
        await page.getByRole('button', { name: mode, exact: true }).click();
        const chart = page.locator('.mermaid-diagram');
        await expect(chart).toHaveAttribute('data-mermaid-source', encodeURIComponent(code));
        await expect(chart.locator(':scope > svg')).toHaveCount(1);
        for (const theme of ['light', 'dark']) {
          if (await page.locator('html').getAttribute('data-theme') !== theme) {
            const old = await chart.locator(':scope > svg').getAttribute('id');
            await page.getByRole('button', { name: '切换主题', exact: true }).click();
            await expect.poll(() => chart.locator(':scope > svg').getAttribute('id')).not.toBe(old);
          }
          const contrast = await chart.evaluate((element, name) => {
            const rgb = (value: string) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
            const luminance = (value: string) =>
              rgb(value).map(c => {
                c /= 255;
                return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
              }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
            const bg = getComputedStyle(document.querySelector('.app')!).getPropertyValue('--bg')
              .trim();
            const probe = document.createElement('span');
            probe.style.color = bg;
            element.append(probe);
            const background = luminance(getComputedStyle(probe).color);
            probe.remove();
            const selector = {
              packet: '.packetByte,.packetTitle,.packetLabel',
              timeline: '.lineWrapper line,marker path',
              architecture: '.edge,.node-bkg',
              wardley: '.wardley-node-label,.wardley-axis-label,.wardley-stage-label',
              cynefin: '.cynefinItemText',
              treeView: '.treeView-node-label',
              railroad: '.railroad-terminal text,.railroad-rule-name',
              eventmodeling: '.em-swimlane > text',
            }[name as string]!;
            return [...element.querySelectorAll(selector)].map(node => {
              const style = getComputedStyle(node);
              const foreground = luminance(
                node.tagName.toLowerCase() === 'line' || name === 'architecture'
                  ? style.stroke
                  : style.fill,
              );
              const backdrop = name === 'cynefin'
                ? luminance(getComputedStyle(node.parentElement!.querySelector('rect')!).fill)
                : background;
              return (Math.max(foreground, backdrop) + 0.05)
                / (Math.min(foreground, backdrop) + 0.05);
            });
          }, name);
          expect(contrast.length).toBeGreaterThan(0);
          expect(Math.min(...contrast), `${name} ${mode} ${theme} contrast`).toBeGreaterThanOrEqual(
            ['packet', 'wardley', 'cynefin', 'treeView', 'railroad', 'eventmodeling'].includes(name)
              ? 4.5
              : 3,
          );
          if (mode === '阅读') {
            // Preserve the actual vector DOM for visual inspection in a separate
            // gallery. Hidden Electron windows can stall native bitmap capture.
            const svg = await chart.locator(':scope > svg').evaluate(element => element.outerHTML);
            await fs.writeFile(
              path.resolve(project, `../../work/v166-theme-${name}-${theme}.html`),
              `<!doctype html><meta charset="utf-8"><style>body{background:${
                theme === 'dark' ? '#1e2026' : '#fff'
              };margin:24px}svg{max-width:100%;height:auto}</style>${svg}`,
            );
          }
        }
      }
      const output = path.join(data, '示例知识库', name + '.html');
      await app.evaluate(({ dialog }, file) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
      }, output);
      await page.getByRole('button', { name: '更多文档操作', exact: true }).click();
      await page.getByRole('button', { name: '导出 HTML', exact: true }).click();
      await expect.poll(() => fs.readFile(output, 'utf8').catch(() => '')).toContain('<svg');
      const exported = await fs.readFile(output, 'utf8');
      expect(exported).not.toContain('data:image/png');
      if (name === 'timeline') expect(exported).toContain('stroke:');
      expect(await fs.readFile(path.join(data, '示例知识库', file), 'utf8')).toBe(markdown);
    }
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
