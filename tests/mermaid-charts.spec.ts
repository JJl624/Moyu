import { _electron as electron, expect, test } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project = path.resolve(import.meta.dirname, '..');
const gantt = `gantt
    title 项目排期：订单系统重构
    dateFormat YYYY-MM-DD
    axisFormat %m-%d
    excludes weekends
    section 需求与设计
    需求调研 :done, des1, 2026-01-05, 5d
    技术方案 :active, des2, after des1, 4d
    评审 :des3, after des2, 2d
    section 开发
    订单核心 :dev1, after des3, 10d
    支付对接 :dev2, after dev1, 6d
    库存与优惠 :dev3, after dev1, 8d
    section 测试与上线
    集成测试 :test1, after dev2, 7d
    压测 :test2, after test1, 3d
    灰度上线 :milestone, m1, after test2, 0d`;
const pie = `pie showData
    title 订单来源占比
    "App": 45
    "Web": 30
    "小程序": 20
    "开放API": 5`;
test('Reported Gantt dates remain separated and pie slices/labels distinguishable in both themes, modes and SVG export', async () => {
  test.setTimeout(120000);
  const base = path.resolve(project, '../../work/e2e');
  await fs.mkdir(base, { recursive: true });
  const data = await fs.mkdtemp(path.join(base, 'mermaid-charts-'));
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
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.webContents.setBackgroundThrottling(false); // Keep both code previews on screen; Milkdown tears down offscreen blocks.
      window.setSize(1200, 2000);
    });
    await expect(page.locator('.ProseMirror h1')).toBeVisible();
    const markdown = '```mermaid {id=0001}\n' + gantt + '\n```\n\n```mermaid {id=0002}\n' + pie + '\n```\n';
    await page.evaluate(md => window.moyu!.create('图表配色.md', 'file', md), markdown);
    await page.locator('.tree-item[title="图表配色.md"]').dblclick();
    const charts = page.locator('.mermaid-diagram svg');
    await expect(charts).toHaveCount(2, { timeout: 60000 });
    const check = async () => {
      await expect(charts).toHaveCount(2);
      await expect(page.locator('.diagram-error')).toHaveCount(0);
      const result = await charts.evaluateAll(svgs => {
        const ticks = Array.from(svgs[0].querySelectorAll<SVGTextElement>('.grid .tick text')),
          boxes = ticks.map(t => t.getBoundingClientRect()).sort((a, b) => a.left - b.left),
          rgb = (value: string) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number),
          fills = Array.from(svgs[1].querySelectorAll('.pieCircle')).map(p =>
            rgb(getComputedStyle(p).fill)
          ),
          labels = Array.from(svgs[1].querySelectorAll('.slice')).map(p =>
            rgb(getComputedStyle(p).fill)
          ),
          luminance = (color: number[]) =>
            color.map(c => {
              const s = c / 255;
              return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
            }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0),
          contrasts = fills.map((fill, i) => {
            const a = luminance(fill), b = luminance(labels[i]);
            return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          });
        const distances: number[] = [];
        fills.forEach((fill, i) =>
          fills.slice(i + 1).forEach(other =>
            distances.push(Math.hypot(...fill.map((c, k) => c - other[k])))
          )
        );
        return {
          tickCount: ticks.length,
          gap: Math.min(...boxes.slice(1).map((b, i) => b.left - boxes[i].right)),
          fills,
          distances,
          contrasts,
        };
      });
      expect(result.tickCount).toBeGreaterThan(3);
      expect(result.tickCount).toBeLessThan(17);
      expect(result.gap).toBeGreaterThan(2);
      expect(result.fills).toHaveLength(4);
      expect(Math.min(...result.distances)).toBeGreaterThan(60);
      expect(Math.min(...result.contrasts)).toBeGreaterThanOrEqual(4.5);
    };
    for (const mode of ['预览编辑', '阅读']) {
      await page.getByRole('button', { name: mode, exact: true }).click();
      await expect(charts).toHaveCount(2);
      for (const theme of ['light', 'dark']) {
        if (await page.locator('html').getAttribute('data-theme') !== theme) {
          const ids = await charts.evaluateAll(elements => elements.map(e => e.id));
          await page.getByRole('button', { name: '切换主题', exact: true }).click();
          await expect.poll(() =>
            charts.evaluateAll(
              (elements, old) => elements.length === 2 && elements.every((e, i) => e.id !== old[i]),
              ids,
            )
          ).toBe(true);
        }
        await check();
      }
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(980, 850));
    await check();
    const output = path.join(data, '示例知识库/图表导出.html');
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, output);
    await page.getByRole('button', { name: '更多文档操作', exact: true }).click();
    await page.getByRole('button', { name: '导出 HTML', exact: true }).click();
    await expect.poll(() => fs.readFile(output, 'utf8').catch(() => '')).toContain('<svg');
    const exported = await fs.readFile(output, 'utf8');
    expect((exported.match(/<svg/g) || []).length).toBe(2);
    expect(exported).toContain('订单来源占比');
    expect(exported).not.toContain('data:image/png');
    expect(await fs.readFile(path.join(data, '示例知识库/图表配色.md'), 'utf8')).toBe(markdown);
    await page.screenshot({ path: path.resolve(project, '../../work/v166-mermaid-reading.png') });
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
