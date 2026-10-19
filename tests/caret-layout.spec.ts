import { _electron as electron, expect, test } from "./helpers/test";
import fs from "node:fs/promises";
import path from "node:path";
const project = path.resolve(import.meta.dirname, ".."), work = path.resolve(project, "../../work");
async function fixture() {
  const data = await fs.mkdtemp(path.join(work, "caret-layout-")),
    env = { ...process.env, MOYU_USER_DATA: data, MOYU_TEST: "1", MOYU_DEMO: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch(
      process.env.MOYU_E2E_EXECUTABLE
        ? { executablePath: process.env.MOYU_E2E_EXECUTABLE, args: [], env }
        : { args: [project], env },
    ),
    page = await app.firstWindow();
  await (await app.browserWindow(page)).evaluate(w => {
    w.webContents.setBackgroundThrottling(false);
    w.show();
    w.focus();
    w.webContents.focus();
  });
  await expect(page.locator(".ProseMirror")).toBeVisible();
  return { app, page };
}

test("Ordinary wrapped text retains exact paragraph and line positions when the caret moves by mouse or keyboard", async () => {
  test.setTimeout(120000);
  const { app, page } = await fixture();
  try {
    const source = Array.from(
      { length: 3 },
      (_, i) => "段落" + i + "：普通文字的行间距应保持一致。".repeat(6) + " English text 123.",
    ).join("\n\n");
    await page.evaluate(s => window.moyu!.create("普通文字行高.md", "file", s), source);
    await page.locator('.tree-item[title="普通文字行高.md"]').dblclick();
    await page.locator(".ProseMirror").evaluate(el => (el as HTMLElement).style.width = "420px");
    const paragraphs = page.locator(".ProseMirror > p"),
      measure = () =>
        paragraphs.evaluateAll(nodes =>
          nodes.map(n => {
            const p = n.getBoundingClientRect(), r = document.createRange();
            r.selectNodeContents(n);
            return {
              height: p.height,
              lines: [...r.getClientRects()].map(line => ({ top: line.top - p.top, height: line.height })),
            };
          })
        );
    const report: any[] = [];
    for (const font of ["Microsoft YaHei", "Arial"]) {
      await page.locator(".ProseMirror").evaluate(
        (el, font) => (el as HTMLElement).style.fontFamily = font,
        font,
      );
      for (const spacing of ["1.25", "1.75"]) {
        await page.locator(".ProseMirror").evaluate(
          (el, value) => (el as HTMLElement).style.setProperty("--editor-line-height", value),
          spacing,
        );
        await paragraphs.first().click({ position: { x: 30, y: 10 } });
        const before = await measure();
        for (let i = 1; i < await paragraphs.count(); i++) {
          await paragraphs.nth(i).click({ position: { x: 30, y: 10 } });
          await page.keyboard.press("ArrowLeft");
          await page.keyboard.press("ArrowRight");
          expect(await measure(), font + " / " + spacing + " / " + i).toEqual(before);
        }
        report.push({ font, spacing, before });
      }
    }
    await fs.writeFile(path.join(work, "caret-plain-layout.json"), JSON.stringify(report, null, 2));
  } finally {
    await app.evaluate(({ app }) => app.exit(0));
  }
});

test("Inline code uses the same line box before, during and after source editing", async () => {
  test.setTimeout(120000);
  const { app, page } = await fixture();
  try {
    await page.evaluate(() =>
      window.moyu!.create(
        "行内代码行高.md",
        "file",
        "`行内代码`\n\n前`inline code`后\n\n**`粗体代码`**\n\n## `标题代码`\n\n> `引用代码`\n\n- `列表代码`\n\n末尾\n",
      )
    );
    await page.locator('.tree-item[title="行内代码行高.md"]').dblclick();

    const codes = page.locator(".ProseMirror .syntax-preview code"),
      last = page.locator(".ProseMirror > p").last();
    for (const theme of ["light", "dark"]) {
      if (await page.locator("html").getAttribute("data-theme") !== theme) {
        await page.getByRole("button", { name: "切换主题", exact: true }).click();
      }
      for (let i = 0; i < await codes.count(); i++) {
        await last.click();
        const code = codes.nth(i), container = code.locator("xpath=ancestor::*[self::p or self::h2][1]");
        const before = await container.evaluate(n => n.getBoundingClientRect().height);
        await code.click();
        await expect(container.locator(".inline-syntax.editing")).not.toHaveCount(0);
        expect(await container.evaluate(n => n.getBoundingClientRect().height)).toBe(before);
        await last.click();
        expect(await container.evaluate(n => n.getBoundingClientRect().height)).toBe(before);
      }
      await page.screenshot({ path: path.join(work, "caret-inline-layout-" + theme + ".png") });
    }
  } finally {
    await app.evaluate(({ app }) => app.exit(0));
  }
});

test("The Bash terminal guide keeps paragraph geometry stable through repeated native caret moves", async () => {
  test.setTimeout(120000);
  const { app, page } = await fixture();
  try {
    const source = await fs.readFile(
      path.join(project, "resources/workspace-guide/代码示例/终端.md"),
      "utf8",
    );
    await page.evaluate(source => window.moyu!.create("终端行距.md", "file", source), source);
    await page.locator('.tree-item[title="终端行距.md"]').dblclick();
    const report = await page.locator(".ProseMirror").evaluate(async root => {
      const blocks = [...root.querySelectorAll<HTMLElement>("h1,h2,p")];
      const geometry = () => {
        const top = root.getBoundingClientRect().top;
        return blocks.map(n => ({
          text: n.textContent,
          top: n.getBoundingClientRect().top - top,
          height: n.getBoundingClientRect().height,
        }));
      };
      const settle = () => new Promise<void>(resolve => setTimeout(resolve, 35));
      (root as HTMLElement).focus();
      await settle();
      const before = geometry(), shifts: any[] = [];
      for (let round = 0; round < 3; round++) {
        for (const block of blocks) {
          const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
          const texts: Node[] = [];
          while (walker.nextNode()) {
            if (
              walker.currentNode.textContent?.trim()
              && getComputedStyle(walker.currentNode.parentElement!).display !== "none"
            ) texts.push(walker.currentNode);
          }
          for (const text of texts.slice(0, 2)) {
            document.getSelection()!.collapse(
              text,
              round === 0
                ? 0
                : round === 1
                ? Math.floor(text.textContent!.length / 2)
                : text.textContent!.length,
            );
            document.dispatchEvent(new Event("selectionchange"));
            await settle();
            const after = geometry();
            for (let i = 0; i < after.length; i++) {
              if (after[i].height !== before[i].height || after[i].top !== before[i].top) {
                shifts.push({
                  round,
                  selected: block.textContent,
                  index: i,
                  before: before[i],
                  after: after[i],
                });
              }
            }
          }
        }
      }
      return { before, shifts };
    });
    await fs.writeFile(path.join(work, "caret-bash-layout.json"), JSON.stringify(report, null, 2));
    expect(report.shifts).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0));
  }
});

test("The reported Bash paragraphs keep line boxes stable under real clicks and fractional zoom", async () => {
  test.setTimeout(120000);
  const { app, page } = await fixture();
  try {
    const source = `## Bash (Wasm)
使用内置 Bash 环境，从新建终端下拉选择 Bash (Wasm)。当前目录是 /data；变量和文件在这个终端的会话内保留，关闭后清除，不与其他终端或代码块共享。
支持历史命令、左右移动、删除和多行循环、引号续行。输入未完成的语句时显示 > 提示符，补齐后执行。空输入时 Ctrl+D 或输入 exit 关闭当前会话。Ctrl+C 清除未执行的输入；执行期间 Ctrl+C 会关闭这个虚拟会话，随后可重新打开。
它是 Bashkit 解释器终端，支持内置命令、管道、重定向和脚本，不是主机 PTY，不能启动本机程序或全屏终端应用，也不能读取主机文件。每条命令遵循 Bash 设置中的时限、命令数、循环和内存限制。`;
    const win = await app.browserWindow(page), report: any[] = [];
    for (const separated of [false, true]) {
      const name = separated ? "Bash分段.md" : "Bash软换行.md";
      await page.evaluate(({ name, source }) => window.moyu!.create(name, "file", source), {
        name,
        source: separated ? source.replaceAll("\n", "\n\n") : source,
      });
      await page.locator(`.tree-item[title="${name}"]`).dblclick();
      for (const zoom of [1, 1.1, 1.25]) {
        await win.evaluate((w, value) => w.webContents.setZoomFactor(value), zoom);
        await page.waitForTimeout(60);
        const measure = () => page.locator(".ProseMirror").evaluate(root => {
          const top = root.getBoundingClientRect().top;
          return [...root.querySelectorAll("h2,p")].map(n => {
            const range = document.createRange(), box = n.getBoundingClientRect();
            range.selectNodeContents(n);
            return { top: box.top - top, height: box.height,
              lines: n.tagName === "P" ? [...range.getClientRects()].filter(r => r.width > 0).map(r => ({ top: r.top - top, height: r.height })) : [] };
          });
        });
        const before = await measure();
        const points = await page.locator(".ProseMirror p").evaluateAll(nodes => nodes.flatMap(n => {
          const range = document.createRange();
          range.selectNodeContents(n);
          return [...range.getClientRects()].filter(r => r.width > 10).map(r => ({ x: r.left + 8, y: r.top + r.height / 2 }));
        }));
        for (const point of [...points, ...points.toReversed()]) {
          await page.mouse.click(point.x, point.y);
          await page.keyboard.press("ArrowRight");
          await page.keyboard.press("ArrowLeft");
          expect(await measure(), name + " / " + zoom).toEqual(before);
        }
        report.push({ separated, zoom, geometry: before });
      }
    }
    await fs.writeFile(path.join(work, "caret-bash-click-layout.json"), JSON.stringify(report, null, 2));
  } finally {
    await app.evaluate(({ app }) => app.exit(0));
  }
});
