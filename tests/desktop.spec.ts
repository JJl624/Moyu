import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "./helpers/test";
import fs from "node:fs/promises";
import path from "node:path";

const project = path.resolve(import.meta.dirname, "..");
const work = path.resolve(project, "../../work/e2e");
let app: ElectronApplication, page: Page, userData: string;
const errors: string[] = [];
async function launch(directory: string) {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    MOYU_USER_DATA: directory,
    MOYU_TEST: "1", MOYU_DEMO: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const instance = await electron.launch({ args: [project], env });
  const window = await instance.firstWindow();
  window.on("pageerror", (error) => errors.push(error.message));
  window.on("console", (message) => {
    if (message.type() === "error") console.log("Renderer:", message.text());
  });
  await expect(window.locator(".ProseMirror h1")).toBeVisible();
  return { instance, window };
}
test.beforeAll(async () => {
  await fs.mkdir(work, { recursive: true });
  userData = await fs.mkdtemp(path.join(work, "desktop-"));
  const launched = await launch(userData);
  app = launched.instance;
  page = launched.window;
});
test.afterAll(async () => {
  if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
});
test("Desktop editing, persistence, search, theme and conflict handling", async () => {
  await expect(page.locator(".file-tree")).toContainText("开始使用");
  await expect(page.locator(".ProseMirror")).toContainText("你想做的事");
  await page.screenshot({ path: path.join(project, "preview-dark.png") });
  await page
    .getByRole("button", { name: "新建文档", exact: true })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "名称", exact: true })
    .fill("自动化验证");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("自动化验证");
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("local persistence test");
  await expect
    .poll(async () =>
      (
        await fs.readFile(
          path.join(userData, "示例知识库", "自动化验证.md"),
          "utf8",
        )
      ).includes("local persistence test"),
    )
    .toBeTruthy();
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect(page.locator(".source-editor .cm-content")).toContainText(
    "local persistence test",
  );
  await page.locator(".source-editor .cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("source round trip");
  await page.getByRole("button", { name: "预览编辑", exact: true }).click();
  await expect(page.locator(".ProseMirror")).toContainText("source round trip");
  await page.getByRole("button", { name: "收藏文档", exact: true }).click();
  await page.getByRole("button", { name: "收藏", exact: true }).click();
  await expect(page.locator(".sidebar-scroll")).toContainText("自动化验证");
  await page.getByRole("button", { name: "全文搜索", exact: true }).click();
  await page
    .getByRole("textbox", { name: "搜索文件名和内容" })
    .fill("persistence");
  await expect(page.locator(".search-result")).toContainText("自动化验证");
  await page.getByRole("button", { name: "偏好设置", exact: true }).click();
  await page.getByRole("button", { name: "界面", exact: true }).click();
  await page.getByRole("button", { name: "浅色", exact: true }).click();
  await page.getByRole("button", { name: "关闭对话框", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "文件", exact: true }).click();
  await page.locator(".tree-item").filter({ hasText: "开始使用" }).click();
  await page.screenshot({ path: path.join(project, "preview-light.png") });
  await page.locator(".tree-item").filter({ hasText: "自动化验证" }).click();
  await page.getByRole("button", { name: "自动保存开启", exact: true }).click();
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" my unsaved edit");
  const file = path.join(userData, "示例知识库", "自动化验证.md");
  await fs.writeFile(file, "# 自动化验证\n\nexternal edit\n");
  await page.getByRole("button", { name: "本地未保存" }).click();
  await expect(
    page.getByRole("dialog", { name: "保留哪个版本？" }),
  ).toBeVisible();
  await expect(page.locator(".conflict-compare")).toContainText(
    "external edit",
  );
  await page.getByRole("button", { name: "保留当前内容" }).click();
  await expect
    .poll(async () =>
      (await fs.readFile(file, "utf8")).includes("my unsaved edit"),
    )
    .toBeTruthy();
  await expect
    .poll(async () => page.locator(".save-status").innerText())
    .toBe("已保存到本地");
  expect(errors).toEqual([]);
  // Close immediately after typing, before Milkdown's 200 ms listener debounce.
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText(" close flush test");
  await app.close();
  expect(await fs.readFile(file, "utf8")).toContain("close flush test");
  const relaunched = await launch(userData);
  app = relaunched.instance;
  page = relaunched.window;
  await page.locator(".tab-name").filter({ hasText: "自动化验证" }).click();
  await expect(page.locator(".ProseMirror")).toContainText("my unsaved edit");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("Native workspace, rename, import, images and Markdown / HTML / PDF export", async () => {
  const directory = path.join(userData, "真实本地库");
  await fs.mkdir(directory);
  await fs.writeFile(
    path.join(directory, "原始文档.md"),
    "# 原始文档\n\n本地文件测试\n\n[第二篇](./第二篇.md)\n",
  );
  await fs.writeFile(
    path.join(directory, "第二篇.md"),
    "# 第二篇\n\n来自相对链接。\n",
  );
  await app.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [directory],
    });
  }, directory);
  await page.locator(".workspace-picker").click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("第二篇");
  await page.locator(".tree-item").filter({ hasText: "原始文档" }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("原始文档");
  await page.locator(".ProseMirror a").filter({ hasText: "第二篇" }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("第二篇");
  await page.getByRole("button", { name: "显示文档信息", exact: true }).click();
  await expect(page.locator(".right-sidebar")).toContainText("大纲");
  await expect(page.getByText("反向链接", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "更多文档操作" }).click();
  await page.getByRole("button", { name: "重命名文档", exact: true }).click();
  await page
    .getByRole("textbox", { name: "名称", exact: true })
    .fill("重命名后");
  await page.getByRole("button", { name: "保存名称", exact: true }).click();
  await expect(page.locator(".tab.active")).toContainText("重命名后");
  expect(
    await fs.readFile(path.join(directory, "重命名后.md"), "utf8"),
  ).toContain("来自相对链接");
  const imported = path.join(userData, "导入样本.md");
  await fs.writeFile(
    imported,
    "# 导入样本\n\n## 功能验证\n\n- [ ] 一个任务\n\n| 列一 | 列二 |\n| --- | --- |\n| A | B |\n\n```js\nconst answer = 42\n```\n\n$E = mc^2$\n",
  );
  await app.evaluate(({ dialog }, imported) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [imported],
    });
  }, imported);
  await page.getByRole("button", { name: "更多文档操作", exact: true }).click();
  await page
    .getByRole("button", { name: "导入 Markdown", exact: true })
    .click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("导入样本");
  await expect(page.locator(".ProseMirror .katex")).toBeVisible();
  await expect(page.locator(".ProseMirror .milkdown-code-block")).toBeVisible();
  const imageData = (await page.evaluate(async () => {
    const bytes = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBv8AAAAASUVORK5CYII=",
      ),
      (c) => c.charCodeAt(0),
    );
    return await window.moyu!.upload("导入样本.md", "test.png", bytes);
  })) as unknown as { ok: boolean; data: string };
  expect(imageData.ok).toBeTruthy();
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await page.locator(".source-editor .cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText(`\n\n![test](${imageData.data})\n`);
  await expect(page.locator(".source-editor .cm-content")).toContainText(
    imageData.data,
  );
  await page.getByRole("button", { name: "预览编辑", exact: true }).click();
  await expect(page.locator(".ProseMirror img[src]")).toHaveCount(1);
  await expect
    .poll(() =>
      page
        .locator(".ProseMirror img[src]")
        .evaluateAll((images) =>
          images.some(
            (image) => (image as HTMLImageElement).naturalWidth === 1,
          ),
        ),
    )
    .toBeTruthy();
  for (const [kind, label] of [
    ["md", "导出 Markdown"],
    ["html", "导出 HTML"],
    ["pdf", "导出 PDF"],
  ]) {
    const target = path.join(userData, "export." + kind);
    await app.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: target,
      });
    }, target);
    await page.getByRole("button", { name: "更多文档操作" }).click();
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect
      .poll(async () => (await fs.stat(target).catch(() => ({ size: 0 }))).size)
      .toBeGreaterThan(100);
    const data = await fs.readFile(target);
    if (kind === "pdf") expect(data.subarray(0, 4).toString()).toBe("%PDF");
    if (kind === "html") {
      expect(data.toString()).toContain("data:image/png;base64,");
      expect(data.toString()).toContain("const answer = 42");
    }
    if (kind === "md") expect(data.toString()).toContain("%E9%99%84%E4%BB%B6/test.png");
  }
  await page.emulateMedia({ media: "print" });
  await page.screenshot({
    path: path.join(work, "print-preview.png"),
    fullPage: true,
  });
  await page.emulateMedia({ media: "screen" });
  expect(errors).toEqual([]);
});
