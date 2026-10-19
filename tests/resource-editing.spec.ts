import { _electron as electron, expect, type Locator, type Page, test } from "./helpers/test";
import fs from "node:fs/promises";
import path from "node:path";
const project = path.resolve(import.meta.dirname, "..");
async function fixture() {
  const data = await fs.mkdtemp(path.resolve(project, "../../work/resource-editing-"));
  await fs.writeFile(
    path.join(data, "settings.json"),
    JSON.stringify({ version: 1, values: { "moyu-save-policy": "manual" } }),
  );
  const env = { ...process.env, MOYU_USER_DATA: data, MOYU_DEMO: "1", MOYU_TEST: "1", MOYU_TEST_OFFSCREEN: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch(
    process.env.MOYU_E2E_EXECUTABLE
      ? { executablePath: process.env.MOYU_E2E_EXECUTABLE, args: [], env }
      : { args: [project], env },
  );
  const page = await app.firstWindow(), errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await expect(page.locator(".ProseMirror h1")).toBeVisible();
  return { app, page, data, root: path.join(data, "示例知识库"), errors };
}
async function open(page: Page, file: string, content: string) {
  await page.evaluate(({ file, content }) => window.moyu!.create(file, "file", content), { file, content });
  await page.locator(`.tree-item[title="${file}"]`).dblclick();
  await expect(page.locator(".editor-host")).not.toHaveAttribute("data-editor-pending", "true");
}
async function caret(el: Locator, offset: number, to = offset) {
  await el.evaluate((el, { offset, to }) => {
    el.closest<HTMLElement>(".ProseMirror")!.focus();
    getSelection()!.setBaseAndExtent(el.firstChild!, offset, el.firstChild!, to);
  }, { offset, to });
}
async function save(page: Page) {
  await page.locator(".save-status").click();
}

test("Native active lines are visible only in the focused code editor, including tabs and source", async () => {
  const { app, page, errors } = await fixture();
  try {
    await open(page, "高亮.md", "正文\n\n```js\none\ntwo\n```\n\n```tabs\n:::js\nfirst\nsecond\n```\n\n末尾");
    for (const mode of ["light", "dark"]) {
      if (await page.locator("html").getAttribute("data-theme") !== mode) {
        await page.getByRole("button", { name: "切换主题", exact: true }).click();
      }
      for (const block of await page.locator(".milkdown-code-block").all()) {
        await expect(block.locator(".cm-activeLine")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
        await block.locator(".cm-content").click();
        await page.keyboard.press("Control+End");
        await expect(block.locator(".cm-activeLine")).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
        await page.locator(".ProseMirror > p").last().click();
        await expect(block.locator(".cm-activeLine")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
        await expect(block.locator(".cm-activeLineGutter").first()).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      }
    }
    await page.getByRole("button", { name: "源码", exact: true }).click();
    await page.locator(".source-editor .cm-content").click();
    await expect(page.locator(".source-editor .cm-activeLine")).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test("Quote and unquote context actions operate on the caret line or selected lines", async () => {
  const { app, page, root, errors } = await fixture();
  try {
    await open(page, "引用.md", "> 前一段\n>\n> 当前段\n>\n> 后一段\n\n普通一\n\n普通二\n");
    const middle = page.locator(".ProseMirror blockquote p").filter({ hasText: "当前段" });
    await middle.click();
    await caret(middle, 1);
    await middle.click({ button: "right", position: { x: 15, y: 12 } });
    await page.getByRole("menuitem", { name: "去除一层引用", exact: true }).click();
    await expect(page.locator(".ProseMirror > p").filter({ hasText: "当前段" })).toBeVisible();
    await expect(page.locator(".ProseMirror blockquote")).toHaveCount(2);
    const normal = page.locator(".ProseMirror > p").filter({ hasText: "普通一" });
    await normal.click();
    await caret(normal, 1);
    await normal.click({ button: "right", position: { x: 15, y: 12 } });
    await page.getByRole("menuitem", { name: "引用", exact: true }).click();
    await expect(page.locator(".ProseMirror blockquote p").filter({ hasText: "普通一" })).toBeVisible();
    await save(page);
    await expect.poll(() => fs.readFile(path.join(root, "引用.md"), "utf8")).toContain("> 普通一");
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test("Display math supports dollar fences, multiline input, reading and a source round trip", async () => {
  const { app, page, root, errors } = await fixture();
  try {
    await open(page, "公式.md", "前文\n\n$$\n\\begin{aligned}\na&=b+c\\\\\nd&=e\n\\end{aligned}\n$$\n\n末尾\n");
    await expect(page.locator(".math-block .katex")).toBeVisible();
    await expect(page.locator(".code-id")).toHaveCount(0);
    const tail = page.locator(".ProseMirror > p").last();
    await tail.click();
    await caret(tail, 0, 2);
    await page.keyboard.insertText("$$");
    await page.keyboard.press("Enter");
    await expect(page.locator(".math-block")).toHaveCount(2);
    const code = page.locator(".math-block .cm-content").last();
    await code.click();
    await page.keyboard.insertText("x^2\n+y^2");
    await page.keyboard.press("Control+Enter");
    await expect(page.locator(".math-block .katex")).toHaveCount(2);
    await save(page);
    await expect.poll(() => fs.readFile(path.join(root, "公式.md"), "utf8")).toContain("$$\nx^2\n+y^2\n$$");
    expect(await fs.readFile(path.join(root, "公式.md"), "utf8")).not.toContain("```latex");
    await page.getByRole("button", { name: "阅读", exact: true }).click();
    await expect(page.locator(".reading-view .katex-display")).toHaveCount(2);
    await page.getByRole("button", { name: "源码", exact: true }).click();
    await expect(page.locator(".source-editor .cm-content")).toContainText("$$");
    await page.getByRole("button", { name: "预览编辑", exact: true }).click();
    await expect(page.locator(".math-block .katex")).toHaveCount(2);
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test("Table, code, formula and image can become content of the preceding item without creating a new item", async () => {
  const { app, page, root, errors } = await fixture();
  try {
    await fs.writeFile(
      path.join(root, "图.svg"),
      "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"80\" height=\"40\"><rect width=\"80\" height=\"40\"/></svg>",
    );
    for (
      const [name, source, selector] of [
        ["代码", "```python\nprint(1)\n```", ".milkdown-code-block"],
        ["表格", "| a | b |\n| - | - |\n| 1 | 2 |", ".milkdown-table-block"],
        ["公式", "$$\nx^2\n$$", ".math-block"],
        ["图片", "![图](图.svg)", ".attachment-overlay"],
      ]
    ) {
      await open(page, name + ".md", "- 第一项\n- 当前项\n\n" + source + "\n\n末尾\n");
      const block = page.locator(selector).first();
      await expect(block).toBeVisible();
      await block.click({ button: "right" });
      await page.getByRole("menuitem", { name: "缩进至列表", exact: true }).click();
      await expect(page.locator(".ProseMirror > ul > .milkdown-list-item-block")).toHaveCount(2);
      await expect(
        page.locator(".ProseMirror > ul > .milkdown-list-item-block").last().locator(
          name === "图片" ? ".visual-attachment" : selector,
        ),
      ).toHaveCount(1);
      await save(page);
      await expect.poll(() => fs.readFile(path.join(root, name + ".md"), "utf8")).toMatch(/\n {2,}(?:```|\||\$\$|!\[)/);
      await page.locator(".ProseMirror").focus();
      await page.keyboard.press("Control+z");
      await expect(
        page.locator(".ProseMirror > ul > .milkdown-list-item-block").last().locator(
          name === "图片" ? ".visual-attachment" : selector,
        ),
      ).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test("Dragging across multiple attachments keeps geometry stable until release in either direction", async () => {
  const { app, page, root, errors } = await fixture();
  try {
    await fs.writeFile(
      path.join(root, "图.svg"),
      "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"100\" height=\"50\"><rect width=\"100\" height=\"50\"/></svg>",
    );
    await open(page, "多附件.md", "开始选择文本\n\n![一](图.svg)\n\n中间文本\n\n![二](图.svg)\n\n结束选择文本");
    for (const backwards of [false, true]) {
      await page.locator(".ProseMirror > p").last().click();
      const images = page.locator(".attachment-overlay");
      await expect(images).toHaveCount(2);
      await expect(images.first()).toBeVisible();
      const a = (await page.locator(".ProseMirror > p").first().boundingBox())!,
        z = (await page.locator(".ProseMirror > p").last().boundingBox())!,
        start = backwards ? z : a,
        end = backwards ? a : z;
      const before = await images.first().boundingBox();
      await page.mouse.move(start.x + 10, start.y + 10);
      await page.mouse.down();
      for (const image of backwards ? (await images.all()).reverse() : await images.all()) {
        const rect = (await image.boundingBox())!;
        await page.mouse.move(rect.x + 10, rect.y + 10, { steps: 10 });
        await expect(image).toBeVisible();
        await expect(image).toHaveClass(/drag-selected/);
        await expect(page.locator(".visual-attachment.editing")).toHaveCount(0);
      }
      // Reversing the gesture must shrink the range without unfolding previews.
      await page.mouse.move(start.x + 15, start.y + 10, { steps: 12 });
      await expect(page.locator('.attachment-overlay.drag-selected')).toHaveCount(0);
      const reentered = (await (backwards ? images.last() : images.first()).boundingBox())!;
      await page.mouse.move(reentered.x + 10, reentered.y + 10, { steps: 12 });
      await expect(backwards ? images.last() : images.first()).toHaveClass(/drag-selected/);
      await expect(page.locator('.visual-attachment.editing')).toHaveCount(0);
      await page.mouse.move(end.x + 80, end.y + 10, { steps: 15 });
      await expect(images.first()).toBeVisible();
      expect(await images.first().boundingBox()).toEqual(before);
      await page.mouse.up();
      await expect(page.locator(".visual-attachment.editing")).toHaveCount(2);
      await expect(images.first()).toBeHidden();
      expect(await page.evaluate(() => getSelection()?.toString())).toContain("中间");
    }
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
