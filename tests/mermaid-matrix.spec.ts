import { _electron as electron, expect, test } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const project = path.resolve(import.meta.dirname, '..');
// Offline samples from the pinned Mermaid release's MIT-licensed documentation.
// Each fixture records its source; no documentation or assets are fetched at test time.
const cases: { name: string; url: string; code: string; label: string }[] = JSON.parse(
  await fs.readFile(path.join(project, 'tests/fixtures/mermaid.json'), 'utf8'),
);
for (let part = 0; part < 4; part++) {
  test(`Mermaid diagram matrix ${part + 1}/4 renders in both themes, editing/reading and vector exports`, async () => {
    test.setTimeout(900000);
    const base = path.resolve(project, '../../work/e2e');
    await fs.mkdir(base, { recursive: true });
    const data = await fs.mkdtemp(path.join(base, 'mermaid-matrix-'));
    const env = { ...process.env, MOYU_USER_DATA: data, MOYU_TEST: '1', MOYU_DEMO: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    const app = await electron.launch({
      ...(process.env.MOYU_E2E_EXECUTABLE
        ? { executablePath: process.env.MOYU_E2E_EXECUTABLE, args: [] }
        : { args: [project] }),
      env,
    });
    const selected = cases.filter((c, index) => Math.floor(index / 9) === part).filter(c =>
      !process.env.MOYU_MERMAID_CASES || process.env.MOYU_MERMAID_CASES.split(',').includes(c.name)
    );
    const failures: string[] = [];
    const results: { name: string; theme: string; mode: string; svg: string }[] = [];
    try {
      const page = await app.firstWindow(), errors: string[] = [];
      page.on('pageerror', e => {
        errors.push(e.message);
        console.log('Renderer error:', e.stack);
      });
      await app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0];
        w.webContents.setBackgroundThrottling(false);
        w.setSize(1280, 1400);
      });
      await expect(page.locator('.ProseMirror h1')).toBeVisible();
      for (const { name, code, label } of selected) {
        try {
          await test.step(name, async () => {
            const file = 'Mermaid-' + name + '.md', markdown = '```mermaid {id=0001}\n' + code + '\n```\n';
            await page.evaluate(
              ({ file, markdown }) => window.moyu!.create(file, 'file', markdown),
              {
                file,
                markdown,
              },
            );
            await page.locator(`.tree-item[title="${file}"]`).dblclick();
            for (const mode of ['预览编辑', '阅读']) {
              await page.getByRole('button', { name: mode, exact: true }).click();
              const chart = page.locator('.mermaid-diagram');
              await expect(chart).toHaveAttribute('data-mermaid-source', encodeURIComponent(code), {
                timeout: 30000,
              });
              await expect.poll(
                async () =>
                  await chart.locator(':scope > svg').count() === 1
                  || (await chart.getAttribute('class'))?.includes('diagram-error'),
                { timeout: 30000 },
              ).toBe(true);
              expect(await chart.getAttribute('class'), await chart.textContent() || name).not
                .toContain('diagram-error');
              await expect(chart.locator(':scope > svg')).toHaveCount(1);
              for (const theme of ['light', 'dark']) {
                if (await page.locator('html').getAttribute('data-theme') !== theme) {
                  const old = await chart.locator(':scope > svg').getAttribute('id');
                  await page.getByRole('button', { name: '切换主题', exact: true }).click();
                  await expect.poll(async () => {
                    const svg = chart.locator(':scope > svg');
                    return await svg.count() === 1 && await svg.getAttribute('id') !== old;
                  }).toBe(true);
                }
                await expect(chart).not.toHaveClass(/diagram-error/);
                const geometry = await chart.locator(':scope > svg').evaluate(svg => {
                  const b = (svg as SVGSVGElement).viewBox.baseVal,
                    r = svg.getBoundingClientRect(),
                    host = svg.parentElement!.getBoundingClientRect();
                  return {
                    box: [b.x, b.y, b.width, b.height],
                    width: r.width,
                    height: r.height,
                    host: host.width,
                    text: Array.from(svg.querySelectorAll('text,tspan')).map(t => t.textContent)
                      .join(
                        ' ',
                      ),
                    unsafe: !!svg.querySelector('script,iframe,image[href^="http"]'),
                  };
                });
                expect(geometry.box.every(Number.isFinite)).toBe(true);
                expect(geometry.box[2]).toBeGreaterThan(0);
                expect(geometry.box[3]).toBeGreaterThan(0);
                expect(geometry.width).toBeGreaterThan(5);
                expect(geometry.height).toBeGreaterThan(5);
                expect(geometry.width).toBeLessThanOrEqual(geometry.host + 1);
                expect(geometry.unsafe).toBe(false);
                expect(geometry.text, `${name} ${mode} ${theme} labels`).toContain(label);
                const svg = await chart.locator(':scope > svg').evaluate(e => e.outerHTML);
                results.push({ name, theme, mode, svg });
              }
            }
            const output = path.join(data, '示例知识库', name + '.html');
            await app.evaluate(({ dialog }, file) => {
              dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
            }, output);
            await page.getByRole('button', { name: '更多文档操作', exact: true }).click();
            await page.getByRole('button', { name: '导出 HTML', exact: true }).click();
            await expect.poll(() => fs.readFile(output, 'utf8').catch(() => ''), { timeout: 30000 })
              .toContain('<svg');
            const exported = await fs.readFile(output, 'utf8');
            expect(exported).not.toContain('data:image/png');
            expect(await fs.readFile(path.join(data, '示例知识库', file), 'utf8')).toBe(markdown);
          });
        } catch (error) {
          failures.push(name + ': ' + String(error));
          console.log('Failed diagram:', name, String(error));
        }
      }
      // Keep inspectable vector contact sheets without putting images in the vault.
      for (const theme of ['light', 'dark']) {
        const drawings = results.filter(r => r.theme === theme && r.mode === '阅读');
        const escape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
        const html =
          `<!doctype html><meta charset="utf-8"><style>body{font-family:Arial;background:${
            theme === 'dark' ? '#1e2026' : '#fff'
          };color:${
            theme === 'dark' ? '#d5d7de' : '#263142'
          }}main{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}section{border:1px solid #667;padding:12px;height:330px;overflow:hidden}h2{font-size:16px;margin:0 0 8px}svg{width:100%!important;height:290px!important;max-width:100%!important;object-fit:contain}</style><main>${
            drawings.map(r => `<section><h2>${escape(r.name)}</h2>${r.svg}</section>`).join('')
          }</main>`;
        await fs.writeFile(
          path.resolve(project, `../../work/v166-mermaid-${theme}-part${part + 1}.html`),
          html,
        );
      }
      expect(errors).toEqual([]);
      expect(failures).toEqual([]);
      console.log(
        `Checked ${selected.length} Mermaid cases × 2 themes × 2 modes; ${selected.length} vector exports.`,
      );
    } finally {
      await fs.writeFile(
        path.resolve(project, `../../work/v166-mermaid-matrix-part${part + 1}.json`),
        JSON.stringify(results.map(({ svg, ...r }) => r), null, 2),
      );
      await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    }
  });
}
