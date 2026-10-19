import { _electron as electron, expect, test } from "./helpers/test";
import fs from "node:fs/promises";
import path from "node:path";

const project = path.resolve(import.meta.dirname, "..");
async function fixture() {
  const base = path.resolve(project, "../../work/e2e");
  await fs.mkdir(base, { recursive: true });
  const data = await fs.mkdtemp(path.join(base, "drawing-insert-"));
  const env = {
    ...process.env,
    MOYU_USER_DATA: data,
    MOYU_TEST: "1",
    MOYU_DEMO: "1",
    MOYU_TEST_OFFSCREEN: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    ...(process.env.MOYU_E2E_EXECUTABLE
      ? { executablePath: process.env.MOYU_E2E_EXECUTABLE, args: [] }
      : { args: [project] }),
    env,
  });
  const page = await app.firstWindow(), errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await expect(page.locator(".ProseMirror h1")).toBeVisible();
  return { app, page, data, errors };
}

test("Context drawing insertion stays responsive in permitted text positions and is absent from table cells", async () => {
  test.setTimeout(120000);
  const { app, page, data, errors } = await fixture();
  try {
    const cases = [
      ["普通段落", "前后\n", ".ProseMirror > p"],
      [
        "段落行尾",
        "前后中文段落，包含 **加粗** 和 $x^2$，在这一行的末尾插入绘图。\n",
        ".ProseMirror > p",
      ],
      ["空段落", "\n", ".ProseMirror > p"],
      ["列表", "- 前后\n", ".list-item p"],
      ["嵌套列表", "- 外层\n  - 前后\n", ".list-item p"],
      ["空列表", "- \n", ".list-item p"],
      ["引用", "> 前后\n", "blockquote p"],
      ["表格", "| 表头 |\n| --- |\n| 前后 |\n", "td p"],
      ["代码之后", "```js\nconsole.log(1);\n```\n\n前后\n", ".ProseMirror > p"],
      ["图片之前", "前后\n\n![图](缺失图片.png)\n", ".ProseMirror > p"],
    ];
    for (const [label, content, selector] of cases) {
      const file = label + ".md";
      console.log("Context insertion:", label);
      const created: any = await page.evaluate(
        v => window.moyu!.create(v.file, "file", v.content),
        { file, content },
      );
      expect(created.ok).toBe(true);
      await page.locator(".tree-item[title=\"" + file + "\"]").dblclick();
      await expect(page.locator(".tab.active .tab-name")).toHaveAttribute("title", file);
      const paragraph = page.locator(selector).filter({ hasText: /前后/ });
      const target = ["空段落", "空列表"].includes(label)
        ? page.locator(selector).first()
        : paragraph.first();
      await expect(target).toBeVisible();
      let box: Awaited<ReturnType<typeof target.boundingBox>> = null;
      await expect.poll(async () => {
        box = await target.boundingBox();
        return !!box;
      }).toBe(true);
      await page.mouse.click(box!.x + box!.width - 4, box!.y + Math.min(15, box!.height / 2), {
        button: "right",
      });
      if (label === "表格") {
        await expect(page.getByRole("menuitem", { name: "插入空白 Excalidraw 绘图", exact: true })).toHaveCount(0);
        await page.keyboard.press("Escape");
        continue;
      }
      await page.getByRole("menuitem", { name: "插入空白 Excalidraw 绘图", exact: true }).click();
      await expect(page.locator(".drawing-editor canvas").first()).toBeVisible({ timeout: 20000 });
      // Main and renderer must both answer; merely opening an empty shell is insufficient.
      expect(await page.evaluate(() => 42)).toBe(42);
      await page.locator(".tab-name[title=\"" + file + "\"]").dblclick();
      await expect(page.locator(".ProseMirror")).toBeVisible();
      await page.keyboard.press("Control+s");
      await expect.poll(() => fs.readFile(path.join(data, "示例知识库", file), "utf8")).toMatch(
        /!\[绘图\]\(.*\.excalidraw\)/,
      );
      if (label === "普通段落") {
        expect(await fs.readFile(path.join(data, "示例知识库", file), "utf8")).toMatch(
          /^前后!\[绘图\]/,
        );
      }
      if (label === "段落行尾") {
        expect(await fs.readFile(path.join(data, "示例知识库", file), "utf8")).toMatch(
          /在这一行的末尾插入绘图。!\[绘图\]/,
        );
      }
      expect(await page.evaluate(() => 42)).toBe(42);
    }
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test("A stale file-tree scan cannot discard a newly opened drawing; an actual disk deletion still closes its tab", async () => {
  const { app, page, data, errors } = await fixture();
  try {
    const created: any = await page.evaluate(() =>
      window.moyu!.feature("drawing.create", { path: "新建绘图.excalidraw" })
    );
    expect(created.ok).toBe(true);
    await page.locator(".tree-item[title=\"新建绘图.excalidraw\"]").dblclick();
    await expect(page.locator(".drawing-editor canvas").first()).toBeVisible({ timeout: 20000 });
    const snapshot: any = await page.evaluate(() => window.moyu!.list());
    expect(snapshot.ok).toBe(true);
    snapshot.data.tree = snapshot.data.tree.filter((node: any) =>
      node.path !== "新建绘图.excalidraw"
    );
    await app.evaluate(
      ({ BrowserWindow }, state) =>
        BrowserWindow.getAllWindows()[0].webContents.send("moyu:changed", state),
      snapshot.data,
    );
    await page.waitForTimeout(500);
    await expect(page.locator(".tab.active .tab-name")).toHaveAttribute(
      "title",
      "新建绘图.excalidraw",
    );
    await expect(page.locator(".drawing-editor canvas").first()).toBeVisible();
    await fs.unlink(path.join(data, "示例知识库/新建绘图.excalidraw"));
    await expect(page.locator(".tab-name[title=\"新建绘图.excalidraw\"]")).toHaveCount(0, {
      timeout: 10000,
    });
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test("Detached code controls do not starve the event loop while the old editor awaits disposal", async () => {
  test.setTimeout(15000);
  const { app, page, errors } = await fixture();
  try {
    const created: any = await page.evaluate(() =>
      window.moyu!.create("控件生命周期.md", "file", "```js\nconsole.log(1);\n```\n")
    );
    expect(created.ok).toBe(true);
    await page.locator(".tree-item[title=\"控件生命周期.md\"]").dblclick();
    await expect(page.locator(".tab.active .tab-name")).toHaveAttribute("title", "控件生命周期.md");
    await expect(page.locator(".ProseMirror .cm-content")).toContainText("console.log(1)");
    await expect(page.getByLabel("代码块自定义属性")).toBeVisible();
    expect(
      await page.evaluate(async () => {
        const host = document.querySelector<HTMLElement>(".editor-host")!,
          parent = host.parentNode!;
        const next = host.nextSibling, block = host.querySelector(".milkdown-code-block")!;
        host.remove();
        // A delayed node-view mutation arrives between React detach and Crepe disposal.
        block.querySelector(".code-resize")!.remove();
        await new Promise(resolve => setTimeout(resolve, 50));
        parent.insertBefore(host, next?.parentNode === parent ? next : null);
        block.append(document.createElement("span"));
        await new Promise(resolve => setTimeout(resolve, 50));
        return block.querySelectorAll(".code-attributes").length;
      }),
    ).toBe(1);
    await expect(page.getByLabel("代码块自定义属性")).toBeVisible();
    expect(await page.evaluate(() => 42)).toBe(42);
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test("Drawing filename can be edited in its toolbar and updates every referencing note without losing the scene", async () => {
  const { app, page, data, errors } = await fixture();
  try {
    const created: any = await page.evaluate(() =>
      window.moyu!.create("命名笔记.md", "file", "正文\n")
    );
    expect(created.ok).toBe(true);
    await page.locator(".tree-item[title=\"命名笔记.md\"]").dblclick();
    await page.locator(".ProseMirror > p").first().click({ button: "right" });
    await page.getByRole("menuitem", { name: "插入空白 Excalidraw 绘图", exact: true }).click();
    await expect(page.locator(".drawing-editor canvas").first()).toBeVisible({ timeout: 20000 });
    const original = await page.locator(".tab.active .tab-name").getAttribute("title");
    const drawing: any = await page.evaluate(
      path => window.moyu!.feature("drawing.read", { path }),
      original,
    );
    expect(drawing.ok).toBe(true);
    await page.evaluate(
      v => window.moyu!.create("其他引用.md", "file", "![" + "引用" + "](" + v + ")\n"),
      original,
    );
    await page.getByLabel("绘图文件名").fill("新的中文名称");
    await page.getByLabel("绘图文件名").press("Enter");
    const renamed = original!.replace(/[^/]+$/, "新的中文名称.excalidraw");
    await expect(page.locator(".tab.active .tab-name")).toHaveAttribute("title", renamed);
    await expect(page.getByLabel("绘图文件名")).toHaveValue("新的中文名称");
    await expect(page.locator(".drawing-editor canvas").first()).toBeVisible();
    expect(JSON.parse(await fs.readFile(path.join(data, "示例知识库", renamed), "utf8")).elements)
      .toEqual([]);
    await expect.poll(() => fs.readFile(path.join(data, "示例知识库/其他引用.md"), "utf8"))
      .toContain(renamed);
    await page.locator(".tab-name[title=\"命名笔记.md\"]").dblclick();
    await page.keyboard.press("Control+s");
    await expect.poll(() => fs.readFile(path.join(data, "示例知识库/命名笔记.md"), "utf8"))
      .toContain("新的中文名称.excalidraw");
    await page.getByLabel("偏好设置").click();
    await expect(page.getByRole("button", { name: "文件与附件", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "版本管理", exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});
