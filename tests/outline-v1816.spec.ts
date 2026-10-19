import { _electron as electron, expect, test } from "./helpers/test";
import fs from "node:fs/promises";
import path from "node:path";
const project = path.resolve(import.meta.dirname, ".."), work = path.resolve(project, "../../work");
test("Outline displays a usable hierarchy, folds branches, navigates all views and follows the visible section", async () => {
  test.setTimeout(90000);
  const data = await fs.mkdtemp(path.join(work, "outline-v1816-")),
    env = { ...process.env, MOYU_USER_DATA: data, MOYU_TEST: "1", MOYU_DEMO: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch(
    process.env.MOYU_E2E_EXECUTABLE
      ? { executablePath: process.env.MOYU_E2E_EXECUTABLE, args: [], env }
      : { args: [project], env },
  );
  try {
    const page = await app.firstWindow();
    await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 30000 });
    await (await app.browserWindow(page)).evaluate(w => {
      w.show();
      w.focus();
      w.webContents.focus();
    });
    const text = "# 文档\n\n## 第一节\n\n正文\n\n### 子节\n\n" + ("内容\n\n".repeat(30))
      + "第二节\n======\n\n#### 跳级标题\n\n" + ("正文\n\n".repeat(25)) + "## 末节\n\n```md\n# 假标题\n```";
    await page.evaluate(text => window.moyu!.create("大纲.md", "file", text), text);
    await page.locator(".tree-item[title=\"大纲.md\"]").dblclick();
    if (await page.getByTitle("显示文档信息", { exact: true }).count()) {
      await page.getByTitle("显示文档信息", { exact: true }).click();
    }
    await page.getByRole("tab", { name: "大纲", exact: true }).click();
    const outline = page.locator(".document-outline");
    await expect(outline.getByRole("treeitem")).toHaveCount(6);
    await expect(outline.getByText("假标题", { exact: true })).toHaveCount(0);
    await expect(outline.getByRole("treeitem", { name: "子节", exact: true })).toHaveAttribute("aria-level", "3");
    await outline.getByRole("button", { name: "折叠 第一节", exact: true }).click();
    await expect(outline.getByRole("treeitem", { name: "子节", exact: true })).toHaveCount(0);
    await outline.getByRole("button", { name: "展开 第一节", exact: true }).click();
    await outline.getByRole("treeitem", { name: "末节", exact: true }).click();
    await expect(outline.getByRole("treeitem", { name: "末节", exact: true })).toHaveAttribute(
      "aria-current",
      "location",
    );
    await page.locator(".document-scroll").evaluate(node => node.scrollTo({ top: 0, behavior: "instant" }));
    await expect(outline.getByRole("treeitem", { name: "文档", exact: true })).toHaveAttribute(
      "aria-current",
      "location",
    );
    await page.locator(".document-scroll").evaluate(node =>
      node.scrollTo({ top: node.scrollHeight, behavior: "instant" })
    );
    await expect(outline.getByRole("treeitem", { name: "末节", exact: true })).toHaveAttribute(
      "aria-current",
      "location",
    );
    await page.getByRole("button", { name: "阅读", exact: true }).click();
    await outline.getByRole("treeitem", { name: "第二节", exact: true }).click();
    await expect(outline.getByRole("treeitem", { name: "第二节", exact: true })).toHaveAttribute(
      "aria-current",
      "location",
    );
    await page.getByRole("button", { name: "源码", exact: true }).click();
    await outline.getByRole("treeitem", { name: "第二节", exact: true }).click();
    await expect(page.locator(".source-editor .cm-content")).toContainText("第二节");
    await page.locator(".source-editor .cm-scroller").evaluate(node => node.scrollTo({ top: 0, behavior: "instant" }));
    await expect(outline.getByRole("treeitem", { name: "文档", exact: true })).toHaveAttribute(
      "aria-current",
      "location",
    );
    await page.getByRole("button", { name: "预览编辑", exact: true }).click();
    await outline.getByRole("button", { name: "折叠全部", exact: true }).click();
    await expect(outline.getByRole("treeitem")).toHaveCount(2);
    await outline.getByRole("button", { name: "展开全部", exact: true }).click();
    await expect(outline.getByRole("treeitem")).toHaveCount(6);
    await outline.getByRole("treeitem", { name: "文档", exact: true }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(outline.getByRole("treeitem", { name: "第一节", exact: true })).toBeFocused();
    await page.screenshot({ path: path.join(work, "outline-v1816-dark.png") });
    await page.getByRole("button", { name: "切换主题", exact: true }).click();
    await page.screenshot({ path: path.join(work, "outline-v1816-light.png") });
  } finally {
    await app.evaluate(({ app }) => app.exit(0));
  }
});
