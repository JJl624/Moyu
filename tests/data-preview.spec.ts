import { _electron as electron, expect, type Page, test } from "./helpers/test";
import fs from "node:fs/promises";
import path from "node:path";
const project = path.resolve(import.meta.dirname, ".."),
  base = path.resolve(project, "../../work/e2e");
async function fixture(name: string, manual = false) {
  await fs.mkdir(base, { recursive: true });
  const data = await fs.mkdtemp(path.join(base, "data-preview-" + name + "-"));
  if (manual) {
    await fs.writeFile(
      path.join(data, "settings.json"),
      JSON.stringify({ version: 1, values: { "moyu-save-policy": "manual" } }),
    );
  }
  const env = {
    ...process.env,
    MOYU_USER_DATA: data,
    MOYU_TEST: "1",
    MOYU_DEMO: "1",
    MOYU_TEST_OFFSCREEN: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    ...process.env.MOYU_E2E_EXECUTABLE
      ? { executablePath: process.env.MOYU_E2E_EXECUTABLE, args: [] }
      : { args: [project] },
    env,
  });
  const page = await app.firstWindow(), errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await expect(page.locator(".ProseMirror h1")).toBeVisible();
  return { app, page, data, errors };
}
async function create(page: Page, document: string, content: string) {
  const result: any = await page.evaluate(v => window.moyu!.create(v.document, "file", v.content), {
    document,
    content,
  });
  expect(result.ok).toBe(true);
  await page.locator(".tree-item[title=\"" + document + "\"]").dblclick();
}

test("Changing a code language preserves its ID directory, updates the separate label and locates by ID in every mode", async () => {
  const { app, page, data, errors } = await fixture("language-identity");
  try {
    const document = "语言身份.md";
    await create(page, document, "```py {id=0001}\nprint(1)\n```");
    const response: any = await page.evaluate(document => window.moyu!.feature("code.data-upload", {
      document, language: "py", id: "0001", name: "input.txt", bytes: new TextEncoder().encode("shared input"),
    }), document);
    expect(response.ok).toBe(true);
    const block = page.locator(".milkdown-code-block");
    await block.locator(".cm-content").click({ button: "right" });
    await page.getByRole("menuitem", { name: "查看数据目录", exact: true }).click();
    const group = page.locator('[data-code-data-key="0001"]');
    await expect(group.locator("h4")).toHaveText("Python");
    await expect(group.locator(".data-block-id")).toHaveText("0001");
    await expect(group).toContainText("语言身份.assets/code-data/0001");
    await block.locator(".language-button").click();
    await block.getByPlaceholder("搜索语言").fill("javascript");
    await block.locator(".language-list-item").first().click();
    await expect(group.locator("h4")).toHaveText("JavaScript");
    await expect(group.locator(".data-block-id")).toHaveText("0001");
    await expect(group).not.toContainText("未关联");
    await expect(group).toContainText("input.txt");
    await expect(page.locator(".code-data-group")).toHaveCount(1);
    await group.getByLabel("定位代码块 0001", { exact: true }).click();
    await expect(block.locator(".cm-editor")).toHaveClass(/cm-focused/);
    await page.getByRole("button", { name: "源码", exact: true }).click();
    await expect(page.locator(".source-editor .cm-content")).toContainText("id=0001");
    await group.getByLabel("定位代码块 0001", { exact: true }).click();
    expect(await page.evaluate(() => getSelection()?.anchorNode?.parentElement?.closest(".cm-line")?.textContent)).toMatch(/```javascript/i);
    await page.getByRole("button", { name: "阅读", exact: true }).click();
    await expect(page.locator(".reading-view .code-block-shell")).toBeVisible();
    await group.getByLabel("定位代码块 0001", { exact: true }).click();
    await expect(page.locator(".reading-view .code-block-shell")).toBeFocused();
    await page.getByRole("button", { name: "预览编辑", exact: true }).click();
    await block.locator(".language-button").click();
    await block.getByPlaceholder("搜索语言").fill("css");
    const css = block.locator(".language-list-item").filter({ hasText: /^CSS$/ });
    await expect(css).toBeVisible();
    await css.click();
    await expect(group.locator("h4")).toHaveText("css");
    await expect(group).not.toContainText("未关联");
    await group.getByLabel("定位代码块 0001", { exact: true }).click();
    await expect(block.locator(".cm-editor")).toHaveClass(/cm-focused/);
    expect(await fs.readFile(path.join(data, "示例知识库/语言身份.assets/code-data/0001/input.txt"), "utf8")).toBe("shared input");
    expect((await fs.readdir(path.join(data, "示例知识库/语言身份.assets/code-data")))).toEqual(["0001"]);
    expect(errors).toEqual([]);
    await page.screenshot({ path: path.join(base, "data-identity-v1710.png") });
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
test("Document info resizes; data filters combine and context navigation repeatedly reveals and highlights the target", async () => {
  const { app, page, data, errors } = await fixture("panel");
  try {
    await create(
      page,
      "数据筛选.md",
      "```py\nprint(1)\n```\n\n```js\nconsole.log(2)\n```\n\n```python\nprint(3)\n```\n\n```sql\nSELECT 4;\n```",
    );
    await expect(page.locator(".code-id")).toHaveText(["0001", "0002", "0003", "0004"]);
    const upload: any = await page.evaluate(() =>
      window.moyu!.feature("code.data-upload", {
        document: "数据筛选.md",
        language: "js",
        id: "0002",
        name: "input.txt",
        bytes: new TextEncoder().encode("data"),
      })
    );
    expect(upload.ok).toBe(true);
    const blocks = page.locator(".milkdown-code-block");
    await expect(blocks.nth(3).getByLabel("数据库范围").locator("option[value=\"global\"]"))
      .toHaveText("全局");
    await blocks.nth(0).locator(".cm-content").click({ button: "right" });
    await page.getByRole("menuitem", { name: "查看数据目录", exact: true }).click();
    const panel = page.locator(".right-sidebar"),
      divider = page.getByRole("separator", { name: "编辑器与文档信息分隔条" });
    await expect(panel.locator("[data-code-data-key=\"0001\"]")).toHaveClass(/selected/);
    const before = (await panel.boundingBox())!.width, box = (await divider.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 70, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBe(
      Math.round(before + 70),
    );
    await expect.poll(async () =>
      JSON.parse(
        JSON.parse(await fs.readFile(path.join(data, "settings.json"), "utf8"))
          .values["moyu-appearance"] || "{}",
      ).infoWidth
    ).toBe(Math.round(before + 70));
    await page.getByLabel("按语言筛选代码数据").selectOption("JavaScript");
    await page.getByLabel("按目录筛选代码数据").selectOption("existing");
    await expect(panel.locator(".code-data-group")).toHaveCount(1);
    await expect(panel.locator(".code-data-group")).toContainText("input.txt");
    const icons = await panel.locator(".code-data-heading>.icon-button").evaluateAll(elements =>
      elements.map(el => {
        const r = el.getBoundingClientRect();
        return { width: r.width, height: r.height, y: r.y + r.height / 2 };
      })
    );
    expect(icons).toHaveLength(3);
    for (const icon of icons) {
      expect(icon.width).toBe(24);
      expect(icon.height).toBe(24);
      expect(Math.abs(icon.y - icons[0].y)).toBeLessThan(0.5);
    }
    await page.getByLabel("按目录筛选代码数据").selectOption("missing");
    await expect(panel.locator(".code-data-group")).toHaveCount(0);
    await blocks.nth(0).locator(".cm-content").click({ button: "right" });
    await page.getByRole("menuitem", { name: "查看数据目录", exact: true }).click();
    await expect(page.getByLabel("按语言筛选代码数据")).toHaveValue("all");
    await expect(page.getByLabel("按目录筛选代码数据")).toHaveValue("all");
    await expect(panel.locator("[data-code-data-key=\"0001\"]")).toHaveClass(/selected/);
    await expect(panel.locator(".code-data-group")).toHaveCount(4);
    await blocks.nth(2).locator(".cm-content").click({ button: "right" });
    await page.getByRole("menuitem", { name: "查看数据目录", exact: true }).click();
    await expect(panel.locator("[data-code-data-key=\"0003\"]")).toHaveClass(/selected/);
    await expect(panel.locator("[data-code-data-key=\"0001\"]")).not.toHaveClass(/selected/);
    await divider.focus();
    await page.keyboard.press("ArrowLeft");
    await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBe(
      Math.round(before + 75),
    );
    expect(errors).toEqual([]);
    await page.screenshot({ path: path.join(base, "data-panel-v172.png") });
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test("Opening existing Markdown, changing selection, mode and SQL database choice never modifies the document", async () => {
  const { app, page, data, errors } = await fixture("clean", true);
  try {
    const file = path.join(data, "示例知识库/未编辑.md");
    const raw =
      "# 标题\n\n段落 [中文](%E9%99%84%E4%BB%B6/%E5%9B%BE.png)\n\n```sql {id=0001}\nSELECT 42;\n```\n\n```js\nconsole.log(1);\n```\n\n最后一行\n";
    await fs.writeFile(file, raw);
    const initial = (await fs.stat(file)).mtimeMs;
    await page.locator(".tree-item[title=\"未编辑.md\"]").dblclick();
    await expect(page.locator(".ProseMirror h1")).toContainText("标题");
    await expect(page.locator(".tab.active .dirty-dot")).toHaveCount(0);
    await page.getByLabel("数据库范围").selectOption("global");
    await expect(page.getByLabel("数据库范围")).toHaveValue("global");
    await page.locator(".ProseMirror p").last().click();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowUp");
    await page.mouse.wheel(0, 300);
    await page.getByRole("button", { name: "阅读", exact: true }).click();
    await expect(page.getByLabel("数据库范围")).toHaveValue("global");
    await page.getByRole("button", { name: "源码", exact: true }).click();
    await expect(page.locator(".source-editor .cm-content")).toContainText("```js");
    await page.getByRole("button", { name: "预览编辑", exact: true }).click();
    await expect(page.getByLabel("数据库范围")).toHaveValue("global");
    await page.locator(".ProseMirror p").last().click({ button: "right" });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1800);
    await expect(page.locator(".tab.active .dirty-dot")).toHaveCount(0);
    await expect(page.locator(".save-status")).not.toContainText("未保存");
    expect(await fs.readFile(file, "utf8")).toBe(raw);
    expect((await fs.stat(file)).mtimeMs).toBe(initial);
    await page.getByRole("button", { name: "源码", exact: true }).click();
    await expect(page.locator(".source-editor .cm-content")).toContainText("%E9%99%84%E4%BB%B6");
    await page.getByRole("button", { name: "关闭 未编辑", exact: true }).click();
    await page.locator(".tree-item[title=\"未编辑.md\"]").dblclick();
    await page.getByRole("button", { name: "预览编辑", exact: true }).click();
    await expect(page.getByLabel("数据库范围")).toHaveValue("block");
    await page.locator(".milkdown-code-block").nth(1).getByRole("button", {
      name: "运行代码块",
      exact: true,
    }).click();
    await expect(page.locator(".milkdown-code-block").nth(1).locator(".code-output")).toHaveText(
      "1\n",
    );
    await expect(page.locator(".code-id")).toHaveText(["0001", "0002"]);
    await expect(page.locator(".tab.active .dirty-dot")).toHaveCount(1);
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
test("Reading tabs match editing layout, preserve lines and previews, and output text previews read only 32 KB", async () => {
  test.setTimeout(120000);
  const { app, page, data, errors } = await fixture("reading");
  try {
    await create(
      page,
      "阅读标签.md",
      "```tabs {height=160}\n:::js JavaScript\nconst value = 42;\nconsole.log(value);\n:::python Python\nprint(42)\n```\n\n```text\nshort\n```",
    );
    await expect(page.locator(".ProseMirror .tabbed-code .code-id")).toHaveText("0001");
    await page.getByRole("button", { name: "阅读", exact: true }).click();
    const reading = page.locator(".reading-view .tabbed-code");
    await expect(reading.locator(".tabs-tools")).toContainText("Tabs0001");
    await expect(reading.getByRole("button", { name: "复制代码", exact: true })).toBeVisible();
    await expect(reading.getByRole("tab", { name: "JavaScript", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(reading.locator("[data-code-pane=\"0\"] .tabs-line-numbers")).toHaveText("1\n2");
    await expect(reading.locator("[data-code-pane=\"0\"] code")).toHaveText(
      "const value = 42;\nconsole.log(value);",
    );
    expect(
      await reading.locator(".tabs-frame").evaluate(el =>
        Math.round(el.getBoundingClientRect().height)
      ),
    ).toBe(160);
    await reading.getByRole("tab", { name: "Python", exact: true }).click();
    await expect(reading.locator("[data-code-pane=\"1\"] code")).toBeVisible();
    await expect(reading.locator("[data-code-pane=\"0\"]")).toBeHidden();
    await reading.getByRole("button", { name: "显示源码" }).click();
    await expect(reading.locator("[data-tabs-raw]")).toContainText(":::js JavaScript");
    await page.screenshot({ path: path.join(base, "reading-tabs-v172.png") });
    await page.getByRole("button", { name: "预览编辑", exact: true }).click();
    await create(
      page,
      "文件输出.md",
      "```python\nfrom pathlib import Path\nPath(\"/output/文本.txt\").write_text(\"中文🙂\\n\" * 20000, encoding=\"utf-8\")\nPath(\"/output/binary.bin\").write_bytes(bytes([1, 0, 255, 3]))\n```",
    );
    await page.getByRole("button", { name: "运行代码块", exact: true }).click();
    const text = page.getByLabel("文件内容预览");
    await expect(text).toBeVisible({ timeout: 60000 });
    await expect(page.locator(".run-file-preview")).toHaveCount(2);
    await expect(page.locator(".run-file-preview").filter({ has: text })).toContainText(
      "仅预览前 32 KB",
    );
    const shown = (await text.textContent())!;
    expect(shown.startsWith("中文🙂\n")).toBe(true);
    expect(Buffer.byteLength(shown)).toBeLessThanOrEqual(32768);
    expect(shown).not.toContain("\ufffd");
    expect(
      (await fs.stat(
        path.join(data, "示例知识库/文件输出.assets/code-data/0001/output/文本.txt"),
      )).size,
    ).toBe(Buffer.byteLength("中文🙂\n".repeat(20000)));
    const binary = page.locator(".run-artifact").filter({
      has: page.locator("input[value=\"binary.bin\"]"),
    });
    await expect(binary.locator(".run-text-preview")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test("Viewing unassigned code data is read-only; adding input files in source mode assigns consistent IDs and retains the SQL choice", async () => {
  const { app, page, data, errors } = await fixture("source-input", true);
  try {
    const file = path.join(data, "示例知识库/输入.md"),
      raw =
        "```sql\nSELECT 42;\n```\n\n```js\nconsole.log(await files.readFile(\"input.txt\"));\n```\n";
    await fs.writeFile(file, raw);
    await page.locator(".tree-item[title=\"输入.md\"]").dblclick();
    await page.getByLabel("数据库范围").selectOption("global");
    await page.locator(".milkdown-code-block").nth(1).locator(".cm-content").click({
      button: "right",
    });
    await page.getByRole("menuitem", { name: "查看数据目录", exact: true }).click();
    await expect(page.locator(".code-data-group.selected")).toContainText("JavaScript");
    await expect(page.locator(".tab.active .dirty-dot")).toHaveCount(0);
    expect(await fs.readFile(file, "utf8")).toBe(raw);
    await page.getByRole("button", { name: "源码", exact: true }).click();
    const js = page.locator(".code-data-group").filter({
      has: page.locator("h4", { hasText: "JavaScript" }),
    });
    await js.locator("input[type=file]").setInputFiles({
      name: "input.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("source input"),
    });
    await expect(page.locator("[data-code-data-key=\"0002\"]")).toContainText(
      "input.txt",
    );
    await expect(page.locator(".source-editor .cm-content")).toContainText("id=0002");
    await page.getByRole("button", { name: "预览编辑", exact: true }).click();
    await expect(page.getByLabel("数据库范围")).toHaveValue("global");
    await page.locator(".milkdown-code-block").nth(1).getByRole("button", {
      name: "运行代码块",
      exact: true,
    }).click();
    await expect(page.locator(".milkdown-code-block").nth(1).locator(".code-output")).toHaveText(
      "source input\n",
    );
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test("Imported duplicate IDs stay unchanged on open, then running repairs only identity and keeps block data separate", async () => {
  const { app, page, data, errors } = await fixture("duplicate", true);
  try {
    const file = path.join(data, "示例知识库/重复ID.md"),
      raw =
        "```js {id=0001}\nconsole.log(1);\n```\n\n```js {id=0001}\nawait files.writeFile(\"result.txt\", \"second\"); console.log(2);\n```\n";
    await fs.writeFile(file, raw);
    await page.locator(".tree-item[title=\"重复ID.md\"]").dblclick();
    await expect(page.locator(".tab.active .dirty-dot")).toHaveCount(0);
    expect(await fs.readFile(file, "utf8")).toBe(raw);
    await page.locator(".milkdown-code-block").nth(1).getByRole("button", {
      name: "运行代码块",
      exact: true,
    }).click();
    await expect(page.locator(".milkdown-code-block").nth(1).locator(".code-output")).toHaveText(
      "2\n",
    );
    await expect(page.locator(".code-id")).toHaveText(["0001", "0002"]);
    expect(
      await fs.readFile(
        path.join(data, "示例知识库/重复ID.assets/code-data/0002/result.txt"),
        "utf8",
      ),
    ).toBe("second");
    expect(
      await fs.stat(path.join(data, "示例知识库/重复ID.assets/code-data/0001")).catch(() =>
        null
      ),
    ).toBe(null);
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
