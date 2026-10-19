import { _electron as electron, expect, test } from './helpers/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { performanceDocuments } from './fixtures/performance-documents.mjs';
const project = path.resolve(import.meta.dirname, '..'), work = path.resolve(project, '../../work');
for (const sample of performanceDocuments) {
  test(`${sample.name}: input, scrolling, idle work and retained memory`, async () => {
    test.setTimeout(120000);
    const data = await fs.mkdtemp(path.join(work, 'performance-baseline-'));
    await fs.writeFile(
      path.join(data, 'settings.json'),
      JSON.stringify({ version: 1, values: { 'moyu-save-policy': 'manual' } }),
    );
    const env = { ...process.env, MOYU_USER_DATA: data, MOYU_TEST: '1', MOYU_DEMO: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    const app = await electron.launch(
      process.env.MOYU_E2E_EXECUTABLE
        ? { executablePath: process.env.MOYU_E2E_EXECUTABLE, args: [], env }
        : { args: [project], env },
    );
    const page = await app.firstWindow(), errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    try {
      await (await app.browserWindow(page)).evaluate(w => {
        w.show();
        w.focus();
        w.webContents.focus();
        w.webContents.setBackgroundThrottling(false);
      });
      await expect(page.locator('.ProseMirror')).toBeVisible();
      await page.evaluate(() =>
        window.moyu!.create(
          '性能图片.svg',
          'file',
          '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="80"><rect width="220" height="80" fill="#89abc0"/></svg>',
        )
      );
      await page.evaluate(
        sample => window.moyu!.create(sample.name + '.md', 'file', sample.markdown),
        sample,
      );
      const opened = Date.now();
      await page.locator(`.tree-item[title="${sample.name}.md"]`).dblclick();
      await expect(page.locator('.ProseMirror h1')).toContainText(sample.name);
      await expect(page.locator('.editor-host')).not.toHaveAttribute('data-editor-pending', 'true');
      if (sample.name === '大量图片') await expect(page.locator('.attachment-overlay img')).toHaveCount(100);
      if (sample.name === '密集代码') await expect(page.locator('.code-actions')).toHaveCount(80);
      const openMs = Date.now() - opened;
      // Stay inside the paragraph: clicking its trailing edge alternates focus
      // between CodeMirror and ProseMirror rather than measuring body input.
      await page.locator('.ProseMirror > p').first().click({ position: { x: 10, y: 10 } });
      await page.waitForTimeout(2500);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Performance.enable');
      const metrics = async () =>
        Object.fromEntries(
          (await cdp.send('Performance.getMetrics')).metrics.map((
            m: { name: string; value: number; },
          ) => [m.name, m.value]),
        );
      await cdp.send('HeapProfiler.collectGarbage');
      const before = await metrics();
      await page.waitForTimeout(2000);
      const idle = await metrics(), latencies: number[] = [];
      await page.evaluate(() => {
        const audit = { frames: [] as number[], scans: 0 };
        (window as any).__inputFrames = audit;
        document.addEventListener('beforeinput', () => {
          const started = performance.now();
          requestAnimationFrame(() => audit.frames.push(performance.now() - started));
        }, true);
        const scope = document.querySelector('.document-scroll')!, query = scope.querySelectorAll;
        scope.querySelectorAll = function(selector: string) {
          if (selector.includes('milkdown-code-block') && selector.includes('reading-view .code-block-shell')) audit.scans++;
          return query.call(this, selector);
        } as typeof scope.querySelectorAll;
      });
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.start');
      for (let i = 0; i < 24; i++) {
        const started = Date.now();
        await page.keyboard.press(i % 2 ? 'ArrowLeft' : 'ArrowRight');
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
        latencies.push(Date.now() - started);
      }
      const edits: number[] = [];
      for (let i = 0; i < 12; i++) {
        const started = Date.now();
        await page.keyboard.insertText('x');
        await page.keyboard.press('Backspace');
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
        edits.push(Date.now() - started);
      }
      const codeScansDuringTransientInput = await page.evaluate(() => (window as any).__inputFrames.scans);
      // Also let real edits reach the document store; transient insert/delete
      // pairs can otherwise miss the debounced publication path entirely.
      for (let i = 0; i < 4; i++) {
        await page.keyboard.insertText('x');
        await expect(page.locator('.save-status')).toContainText('本地未保存');
        await page.keyboard.press('Backspace');
        await expect(page.locator('.save-status')).toContainText('已保存到本地');
      }
      const inputFrames: number[] = await page.evaluate(() => (window as any).__inputFrames.frames);
      inputFrames.sort((a, b) => a - b);
      expect(inputFrames).toHaveLength(32);
      const profile = await cdp.send('Profiler.stop');
      await fs.writeFile(
        path.join(work, `performance-${process.env.MOYU_AUDIT_LABEL || 'current'}-${sample.name}.cpuprofile`),
        JSON.stringify(profile.profile),
      );
      for (let i = 0; i < 8; i++) await page.mouse.wheel(0, i < 4 ? 600 : -600);
      await cdp.send('HeapProfiler.collectGarbage');
      const retained = await metrics();
      await page.evaluate(() => window.moyu!.create('性能短文.md', 'file', '# 短文\n\n内容'));
      for (let i = 0; i < 4; i++) {
        await page.locator('.tree-item[title="性能短文.md"]').dblclick();
        await expect(page.locator('.ProseMirror h1')).toContainText('短文');
        await page.locator(`.tab-name[title="${sample.name}.md"]`).click();
        await expect(page.locator('.ProseMirror h1')).toContainText(sample.name);
      }
      await page.waitForTimeout(500);
      await cdp.send('HeapProfiler.collectGarbage');
      const after = await metrics();
      latencies.sort((a, b) => a - b);
      edits.sort((a, b) => a - b);
      const report = {
        name: sample.name,
        version: await app.evaluate(({ app }) => app.getVersion()),
        deviceScale: await page.evaluate(() => window.devicePixelRatio),
        openMs,
        medianKeyMs: latencies[12],
        p95KeyMs: latencies[22],
        editP95Ms: edits[11],
        inputFrameP95Ms: inputFrames[Math.ceil(inputFrames.length * .95) - 1],
        codeScansDuringTransientInput,
        idleCPUSeconds: idle.TaskDuration - before.TaskDuration,
        idleLayouts: idle.LayoutCount - before.LayoutCount,
        retainedHeapMB: retained.JSHeapUsedSize / 1048576,
        memoryGrowthMB: (after.JSHeapUsedSize - retained.JSHeapUsedSize) / 1048576,
      };
      const label = process.env.MOYU_AUDIT_LABEL || 'current';
      await fs.writeFile(
        path.join(work, `performance-${label}-${sample.name}.json`),
        JSON.stringify(report, null, 2),
      );
      console.log(JSON.stringify(report));
      expect(report.idleCPUSeconds).toBeLessThan(.35);
      expect(report.idleLayouts).toBe(0);
      expect(report.p95KeyMs).toBeLessThan(300);
      // Keep the old Playwright round trip in reports for historical context.
      // Backspace acknowledgement includes driver/focus waits; assert latency
      // using browser beforeinput -> animation frame timestamps instead.
      expect(report.inputFrameP95Ms).toBeLessThan(100);
      if (sample.name === '密集代码') expect(report.codeScansDuringTransientInput).toBeLessThan(6);
      expect(report.memoryGrowthMB).toBeLessThan(10);
      expect(errors).toEqual([]);
      if (process.env.MOYU_PERF_COMPARE) {
        const baseline = JSON.parse(
          await fs.readFile(
            path.join(process.env.MOYU_PERF_COMPARE, `performance-${sample.name}.json`),
            'utf8',
          ),
        );
        expect(report.p95KeyMs, 'input regression').toBeLessThan(Math.max(75, baseline.p95KeyMs * 1.8));
        if (baseline.inputFrameP95Ms) {
          expect(report.inputFrameP95Ms, 'editing regression').toBeLessThan(
            Math.max(50, baseline.inputFrameP95Ms * 1.8),
          );
        }
        expect(report.retainedHeapMB, 'retained heap regression').toBeLessThan(
          Math.max(baseline.retainedHeapMB + 8, baseline.retainedHeapMB * 1.2),
        );
      }
    } finally {
      await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    }
  });
}
