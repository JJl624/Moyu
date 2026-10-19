import { _electron as electron, expect, type Page, test } from "./helpers/test";
import fs from "node:fs/promises";
import path from "node:path";
import { seedRuntimeCache } from "./helpers/runtime-cache";
const project = path.resolve(import.meta.dirname, ".."),
  base = path.resolve(project, "../../work/e2e");
async function fixture(name: string) {
  await fs.mkdir(base, { recursive: true });
  const data = await fs.mkdtemp(path.join(base, "document-" + name + "-")),
    env = {
      ...process.env,
      MOYU_USER_DATA: data,
      MOYU_TEST: "1",
      MOYU_DEMO: "1",
      MOYU_TEST_OFFSCREEN: "1",
    };
  delete env.ELECTRON_RUN_AS_NODE;
  if (name === "sql") await seedRuntimeCache(data);
  const app = await electron.launch({
      ...process.env.MOYU_E2E_EXECUTABLE
        ? { executablePath: process.env.MOYU_E2E_EXECUTABLE, args: [] }
        : { args: [project] },
      env,
    }),
    page = await app.firstWindow(),
    errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await expect(page.locator(".ProseMirror h1")).toBeVisible();
  return { app, page, data, errors };
}
async function feature(page: Page, action: string, input: any = {}) {
  if (input.bytes) input = { ...input, bytes: Array.from(input.bytes) };
  const r: any = await page.evaluate(v => {
    if (Array.isArray(v.input.bytes)) v.input.bytes = Uint8Array.from(v.input.bytes);
    return window.moyu!.feature(v.action, v.input);
  }, { action, input });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.data;
}
async function create(page: Page, document: string, content: string) {
  const r: any = await page.evaluate(v => window.moyu!.create(v.document, "file", v.content), {
    document,
    content,
  });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  await page.locator(".tree-item").filter({ hasText: document.replace(/\.md$/, "") }).first()
    .dblclick();
}
test("SQL scope selector shares a document database, block database stays separate, table pages and result lifetimes are bounded", async () => {
  test.setTimeout(120000);
  const { app, page, data, errors } = await fixture("sql");
  try {
    const document = "共享数据库.md",
      source =
        "```sql\nCREATE TABLE items(id); INSERT INTO items VALUES(42); SELECT * FROM items;\n```\n\n```sql\nSELECT * FROM items;\n```\n\n```sql\nWITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<120) SELECT x FROM n;\n```";
    await create(page, document, source);
    const blocks = page.locator(".milkdown-code-block");
    await expect(blocks).toHaveCount(3);
    await blocks.nth(0).getByLabel("数据库范围").selectOption("global");
    await blocks.nth(1).getByLabel("数据库范围").selectOption("global");
    await expect(blocks.nth(0).getByLabel("数据库范围")).toHaveValue("global");
    await blocks.nth(0).getByRole("button", { name: "运行代码块", exact: true }).click();
    await expect(blocks.nth(0).locator(".run-artifact table")).toContainText("42");
    await blocks.nth(1).getByRole("button", { name: "运行代码块", exact: true }).click();
    await expect(blocks.nth(1).locator(".run-artifact table")).toContainText("42");
    await blocks.nth(2).getByRole("button", { name: "运行代码块", exact: true }).click();
    await expect(blocks.nth(2).locator(".run-table-pages")).toContainText("120 行");
    await expect(blocks.nth(2).locator("tbody tr")).toHaveCount(50);
    await blocks.nth(2).getByLabel("结果下一页").click();
    await expect(blocks.nth(2).locator("tbody tr").first()).toHaveText("51");
    await blocks.nth(2).getByLabel("结果下一页").click();
    await expect(blocks.nth(2).locator("tbody tr")).toHaveCount(20);
    await expect(blocks.nth(2).locator("tbody tr").last()).toHaveText("120");
    await blocks.nth(1).getByLabel("数据库范围").selectOption("block");
    await blocks.nth(1).getByRole("button", { name: "运行代码块", exact: true }).click();
    await expect(blocks.nth(1).locator(".code-output")).toContainText("items");
    await blocks.nth(0).locator(".cm-content").click({ button: "right" });
    await page.getByRole("menuitem", { name: "查看数据目录", exact: true }).click();
    await expect(page.locator(".code-data-group").filter({ hasText: "SQL_GLOBAL" })).toBeVisible();
    expect(await fs.readFile(path.join(data, "示例知识库", document), "utf8")).not.toContain(
      "scope=",
    );
    const disk = await fs.readFile(path.join(data, "示例知识库", document), "utf8");
    expect(disk).not.toContain("运行结果");
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
test("Data groups retain deleted IDs, reassociate by explicit ID, and file-tree copy and drag move carry attachments", async () => {
  test.setTimeout(120000);
  const { app, page, data, errors } = await fixture("files");
  try {
    const document = "文档.md";
    await create(page, document, "```python\nprint(1)\n```\n\n```python\nprint(2)\n```");
    await feature(page, "code.data-upload", {
      document,
      language: "py",
      id: "0001",
      name: "input.txt",
      bytes: new Uint8Array([49]),
    });
    await feature(page, "attachment.upload", {
      document,
      name: "图.png",
      bytes: new Uint8Array([1, 2]),
    });
    const first: any = await page.evaluate(document => window.moyu!.read(document), document);
    const content = "![图](文档.assets/attachments/图.png)\n\n```python {id=0002}\nprint(2)\n```";
    await page.evaluate(v => window.moyu!.save(v.document, v.content, v.version), {
      document,
      content,
      version: first.data.version,
    });
    await page.getByRole("button", { name: "显示文档信息", exact: true }).click();
    await page.getByRole("tab", { name: "数据", exact: true }).click();
    await expect(page.locator("[data-code-data-key=\"0001\"]")).toContainText("未关联");
    await page.getByLabel("重新关联 0001").click();
    await page.getByLabel("关联代码块 0001").selectOption("0002");
    await expect(page.locator("[data-code-data-key=\"0002\"]")).toContainText("input.txt");
    await expect(page.locator("[data-code-data-key=\"0001\"]")).toHaveCount(0);
    await page.locator(".tree-item[title=\"文档.md\"]").click({ button: "right" });
    await page.locator(".context-menu").getByRole("button", { name: "复制", exact: true }).click();
    await page.locator(".tree-item[title=\"文档.md\"]").click({ button: "right" });
    await page.locator(".context-menu").getByRole("button", { name: "粘贴", exact: true }).click();
    await expect(page.locator(".tree-item[title=\"文档 副本.md\"]")).toBeVisible();
    expect(await fs.readFile(path.join(data, "示例知识库/文档 副本.md"), "utf8")).toContain(
      "文档 副本.assets/attachments/图.png",
    );
    expect(
      await fs.readFile(
        path.join(data, "示例知识库/文档 副本.assets/code-data/0002/input.txt"),
        "utf8",
      ),
    ).toBe("1");
    await page.evaluate(() => window.moyu!.create("目标", "folder"));
    await expect(page.locator(".tree-item[title=\"目标\"]")).toBeVisible();
    const source = page.locator(".tree-row[data-tree-path=\"文档 副本.md\"]"),
      target = page.locator(".tree-row[data-tree-path=\"目标\"]");
    const origin = (await source.boundingBox())!, destination = (await target.boundingBox())!;
    await page.mouse.move(origin.x + origin.width / 2, origin.y + origin.height / 2);
    await page.mouse.down();
    await page.mouse.move(origin.x + origin.width / 2 + 15, origin.y + origin.height / 2, { steps: 4 });
    await page.mouse.move(destination.x + destination.width / 2, destination.y + destination.height / 2, { steps: 10 });
    await page.mouse.move(destination.x + destination.width / 2, destination.y + destination.height / 2, { steps: 2 });
    await expect(target).toHaveClass(/drag-destination/);
    await page.mouse.up();
    await expect.poll(() => fs.readFile(path.join(data, "示例知识库/目标/文档 副本.md"), "utf8").catch(() => ""))
      .toContain("文档 副本.assets/attachments/图.png");
    expect(
      await fs.readFile(
        path.join(data, "示例知识库/目标/文档 副本.assets/code-data/0002/input.txt"),
        "utf8",
      ),
    ).toBe("1");
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
test("Source fence typing preserves language caret, copied IDs deduplicate, and new IDs never reuse removed blocks", async () => {
  test.setTimeout(90000);
  const { app, page, data, errors } = await fixture("ids");
  try {
    await create(page, "ID测试.md", "text");
    await page.getByRole("button", { name: "源码", exact: true }).click();
    const cm = page.locator(".source-editor .cm-content");
    await cm.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText("\n\n```python");
    await expect(cm).toContainText("```python");
    await page.keyboard.press("Enter");
    await page.keyboard.insertText("print(1)\n```");
    await expect(cm).toContainText("```python {id=0001}");
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText("\n\n```js {id=0001}\nconsole.log(2);\n```");
    await expect(cm).toContainText("```js {id=0002}");
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText("\n\n```lua\nprint(3)\n```");
    await expect(cm).toContainText("```lua {id=0003}");
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText("\n\n```\nplain\n```");
    await expect(cm).toContainText("```text {id=0004}");
    await page.getByRole("button", { name: "预览编辑", exact: true }).click();
    await expect(page.getByRole("button", { name: "运行代码块", exact: true })).toHaveCount(3);
    await expect.poll(() => fs.readFile(path.join(data, "示例知识库/ID测试.md"), "utf8")).toContain(
      "id=0003",
    );
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test("Delete prompts name affected notes and support cancel or independent transfers", async () => {
  const { app, page, data } = await fixture("delete");
  try {
    await create(page, "原.md", "original");
    const attachment = await feature(page, "attachment.upload", {
      document: "原.md",
      name: "共享.png",
      bytes: new Uint8Array([1, 2, 3]),
    });
    for (const name of ["甲.md", "乙.md"]) {
      await page.evaluate(v => window.moyu!.create(v.name, "file", v.text), {
        name,
        text: "![共享](" + attachment.link + ")",
      });
    }
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (_window, options) => {
        (globalThis as any).deletePrompt = options;
        return { response: 2, checkboxChecked: false };
      };
    });
    expect((await feature(page, "file.trash", { path: "原.md" })).cancelled).toBe(true);
    const prompt: any = await app.evaluate(() => (globalThis as any).deletePrompt);
    expect(prompt.detail).toContain("甲.md");
    expect(prompt.detail).toContain("乙.md");
    expect(prompt.buttons).toEqual(["转移附件后删除", "直接删除", "取消"]);
    expect(await fs.readFile(path.join(data, "示例知识库/原.md"), "utf8")).toBe("original");
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    });
    const removed = await feature(page, "file.trash", { path: "原.md" });
    expect(removed.removed).toContain("原.assets");
    for (const name of ["甲", "乙"]) {
      expect(await fs.readFile(path.join(data, "示例知识库", name + ".md"), "utf8")).toContain(
        name + ".assets/attachments/共享.png",
      );
      expect(await fs.readFile(path.join(data, "示例知识库", name + ".assets", "attachments/共享.png"))).toEqual(
        Buffer.from([1, 2, 3]),
      );
    }
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
test("Restart reports externally moved note ownership and reconnects only matching notes", async () => {
  const first = await fixture("orphan"), data = first.data, root = path.join(data, "示例知识库");
  let app = first.app;
  try {
    await create(first.page, "原名.md", "```python\nprint(42)\n```");
    const asset = await feature(first.page, "attachment.upload", {
      document: "原名.md",
      name: "图.png",
      bytes: new Uint8Array([1]),
    });
    const disk: any = await first.page.evaluate(() => window.moyu!.read("原名.md"));
    await first.page.evaluate(v => window.moyu!.save("原名.md", v.content, v.version), {
      content: disk.data.content + "\n![图](" + asset.link + ")",
      version: disk.data.version,
    });
    await app.evaluate(({ app }) => app.exit(0));
    await fs.mkdir(path.join(root, "新目录"));
    await fs.rename(path.join(root, "原名.md"), path.join(root, "新目录/新名.md"));
    const env = {
      ...process.env,
      MOYU_USER_DATA: data,
      MOYU_TEST: "1",
      MOYU_DEMO: "1",
      MOYU_TEST_OFFSCREEN: "1",
    };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({
      ...process.env.MOYU_E2E_EXECUTABLE
        ? { executablePath: process.env.MOYU_E2E_EXECUTABLE, args: [] }
        : { args: [project] },
      env,
    });
    const page = await app.firstWindow();
    await expect(page.getByRole("heading", { name: "未关联的附属目录", exact: true }))
      .toBeVisible();
    const selector = page.getByLabel("关联文档 原名.md");
    await expect(selector.locator("option")).toHaveCount(2);
    await selector.selectOption("新目录/新名.md");
    await expect(page.getByRole("heading", { name: "未关联的附属目录", exact: true })).toHaveCount(
      0,
    );
    expect(await fs.readFile(path.join(root, "新目录/新名.md"), "utf8")).toContain(
      "新名.assets/attachments/图.png",
    );
    expect(await fs.readFile(path.join(root, "新目录/新名.assets/attachments/图.png"))).toEqual(
      Buffer.from([1]),
    );
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test("Temporary result images unload off screen without changing document height or scroll position", async () => {
  const { app, page, errors } = await fixture("result-image");
  try {
    await create(
      page,
      "图片结果.md",
      "```python\nfrom pathlib import Path\nPath(\"/output/chart.svg\").write_text('<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"200\" height=\"300\"><rect width=\"200\" height=\"300\" fill=\"blue\"/></svg>')\n```\n\n"
        + Array.from({ length: 60 }, (_, i) => "段落 " + i).join("\n\n"),
    );
    await page.getByRole("button", { name: "运行代码块", exact: true }).click();
    const image = page.locator(".run-image-preview img");
    await expect(image).toBeVisible({ timeout: 60000 });
    const before = await page.locator(".run-artifact").evaluate(el => el.getBoundingClientRect().height);
    await page.locator(".document-scroll").evaluate(el => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(image).toHaveCount(0);
    expect(await page.locator(".run-artifact").evaluate(el => el.getBoundingClientRect().height))
      .toBe(before);
    const top = await page.locator(".document-scroll").evaluate(el => el.scrollTop);
    await page.waitForTimeout(350);
    expect(await page.locator(".document-scroll").evaluate(el => el.scrollTop)).toBe(top);
    await page.locator(".document-scroll").evaluate(el => {
      el.scrollTop = 0;
    });
    await expect(image).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
