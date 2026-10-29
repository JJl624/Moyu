import {selectPreference} from './helpers/runtime-ui';
import { _electron as electron, expect, test } from "./helpers/test";
import fs from "node:fs/promises";
import path from "node:path";
const project = path.resolve(import.meta.dirname, ".."), work = path.resolve(project, "../../work");
async function fixture(policy = "manual") {
  const data = await fs.mkdtemp(path.join(work, "history-v1817-"));
  await fs.writeFile(
    path.join(data, "settings.json"),
    JSON.stringify({ version: 1, values: { "moyu-save-policy": policy } }),
  );
  const env = { ...process.env, MOYU_USER_DATA: data, MOYU_TEST: "1", MOYU_DEMO: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch(
    process.env.MOYU_E2E_EXECUTABLE
      ? { executablePath: process.env.MOYU_E2E_EXECUTABLE, args: [], env }
      : { args: [project], env },
  );
  const page = await app.firstWindow();
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 30000 });
  await (await app.browserWindow(page)).evaluate(w => {
    w.show();
    w.focus();
    w.webContents.focus();
  });
  return { app, page, data };
}
test("History replaces Recent Changes, compares saved versions and preserves unsaved content before a reversible restoration", async () => {
  const { app, page, data } = await fixture();
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  try {
    const file = "历史.md",
      original = "# 原始版本\n\n原文\n",
      saved = "# 保存版本\n\n已保存修改\n",
      draft = "# 当前草稿\n\n尚未保存的修改\n";
    await page.evaluate(async ({ file, original, saved }) => {
      await window.moyu!.create(file, "file", original);
      const before: any = await window.moyu!.read(file);
      await window.moyu!.save(file, saved, before.data.version);
    }, { file, original, saved });
    await page.locator(".tree-item[title=\"历史.md\"]").dblclick();
    await page.getByRole("button", { name: "源码", exact: true }).click();
    const code = page.locator(".source-editor .cm-content");
    await code.click();
    await page.keyboard.press("Control+a");
    await page.keyboard.insertText(draft);
    await page.getByRole("button", { name: "文档历史", exact: true }).click();
    await expect(page.getByRole("button", { name: "最近修改", exact: true })).toHaveCount(0);
    const entries = page.locator(".history-entries button");
    await expect(entries).toHaveCount(2);
    await entries.last().click();
    const diff = page.getByRole("region", { name: "文档历史比较" });
    await expect(diff).toBeVisible();
    await expect(page.getByLabel("历史版本内容")).toContainText("原始版本");
    await expect(page.getByLabel("当前文档内容")).toContainText("当前草稿");
    await expect(diff.locator(".history-change-left")).not.toHaveCount(0);
    await expect(diff.locator(".history-change-right")).not.toHaveCount(0);
    await expect(page.getByLabel("当前文档内容")).toHaveAttribute("contenteditable", "false");
    await page.getByLabel("当前文档内容").click();
    await page.keyboard.press("Control+z");
    await expect(page.getByLabel("当前文档内容")).toContainText("当前草稿");
    await page.screenshot({ path: path.join(work, "document-history-v1817-dark.png") });
    await page.getByRole("button", { name: "切换主题", exact: true }).click();
    await page.screenshot({ path: path.join(work, "document-history-v1817-light.png") });
    await diff.getByRole("button", { name: "恢复此版本", exact: true }).click();
    await expect(diff).toHaveCount(0);
    await expect(code).toContainText("原始版本");
    await expect(page.locator(".tab.active .dirty-dot")).toBeVisible();
    await expect(entries).toHaveCount(3);
    await expect(entries.first()).toContainText("恢复前");
    await entries.first().click();
    await expect(page.getByLabel("历史版本内容")).toContainText("当前草稿");
    await diff.getByRole("button", { name: "恢复此版本", exact: true }).click();
    await expect(code).toContainText("当前草稿");
    await code.click();
    await app.evaluate(({ Menu, BrowserWindow }) => {
      const item = Menu.getApplicationMenu()!.items.flatMap(item => item.submenu?.items || []).find(item =>
        item.label === "保存"
      )!;
      item.click({}, BrowserWindow.getFocusedWindow(), undefined);
    });
    await expect.poll(() => fs.readFile(path.join(data, "示例知识库", file), "utf8")).toBe(draft);
    await expect(page.locator(".tab.active .dirty-dot")).toHaveCount(0);
    const info: any = await page.evaluate(() => window.moyu!.feature("data.list"));
    expect(info.data.some((entry: any) => entry.id === "document-history" && entry.exists)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0));
  }
});
test("History supports text files, stays scoped to the current document, refuses stale roots and clears comparisons on navigation", async () => {
  const { app, page, data } = await fixture();
  try {
    const root = path.join(data, "示例知识库");
    await fs.writeFile(path.join(root, "code.js"), "const oldValue = 1;\r\n");
    await page.evaluate(async () => {
      const before: any = await window.moyu!.read("code.js");
      await window.moyu!.save("code.js", "const newValue = 2;\r\n", before.data.version);
    });
    await page.locator(".tree-item[title=\"code.js\"]").dblclick();
    await page.getByRole("button", { name: "文档历史", exact: true }).click();
    await expect(page.locator(".history-entries button")).toHaveCount(2);
    await page.locator(".history-entries button").last().click();
    await expect(page.getByLabel("历史版本内容")).toContainText("oldValue");
    await expect(page.getByLabel("当前文档内容")).toContainText("newValue");
    await page.keyboard.press("Escape");
    await expect(page.locator(".document-history-view")).toHaveCount(0);
    const bad: any = await page.evaluate(() =>
      window.moyu!.feature("file.history-list", { root: "wrong", document: "code.js" })
    );
    expect(bad.ok).toBe(false);
    expect(bad.error.message).toContain("知识库已切换");
    await page.locator(".history-entries button").last().click();
    await page.getByRole("button", { name: "文件", exact: true }).click();
    await expect(page.locator(".document-history-view")).toHaveCount(0);
  } finally {
    await app.evaluate(({ app }) => app.exit(0));
  }
});

test("Restoration follows automatic saving, and long comparisons retain virtual rendering and linked scrolling", async () => {
  const { app, page, data } = await fixture("realtime");
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  try {
    const file = "长文档.md",
      original = Array.from({ length: 1800 }, (_, i) => "Line " + i).join("\n") + "\n",
      saved = original.replace("Line 900", "Changed line 900\nInserted line");
    await page.evaluate(async ({ file, original, saved }) => {
      await window.moyu!.create(file, "file", original);
      const before: any = await window.moyu!.read(file);
      await window.moyu!.save(file, saved, before.data.version);
    }, { file, original, saved });
    await page.locator(".tree-item[title=\"长文档.md\"]").dblclick();
    await page.getByRole("button", { name: "源码", exact: true }).click();
    await page.getByRole("button", { name: "文档历史", exact: true }).click();
    await expect(page.locator(".history-entries button")).toHaveCount(2);
    await page.locator(".history-entries button").last().click();
    const diff = page.locator(".document-history-view");
    await expect(diff).toBeVisible();
    await expect(page.getByLabel("当前文档内容")).toContainText("Changed line 900");
    expect(await diff.locator(".cm-line").count()).toBeLessThan(400);
    const left = diff.locator("[data-side=left] .cm-scroller"), right = diff.locator("[data-side=right] .cm-scroller");
    await left.evaluate(node => node.scrollTop = 0);
    await expect.poll(() => right.evaluate(node => node.scrollTop)).toBeLessThan(5);
    await right.evaluate(node => node.scrollTop = node.scrollHeight);
    await expect.poll(() => left.evaluate(node => node.scrollTop)).toBeGreaterThan(15000);
    await diff.getByRole("button", { name: "恢复此版本", exact: true }).click();
    await expect(diff).toHaveCount(0);
    await expect.poll(() => fs.readFile(path.join(data, "示例知识库", file), "utf8")).toBe(original);
    await expect(page.locator(".tab.active .dirty-dot")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0));
  }
});

test("Preview editing restores historical text and preserves its unsaved draft", async () => {
  const { app, page } = await fixture();
  try {
    const file = "预览恢复.md";
    await page.evaluate(async (file) => {
      await window.moyu!.create(file, "file", "# Earlier\n\nOld text\n");
      const before: any = await window.moyu!.read(file);
      await window.moyu!.save(file, "# Latest\n\nNew text\n", before.data.version);
    }, file);
    await page.locator(".tree-item[title=\"预览恢复.md\"]").dblclick();
    await page.locator(".ProseMirror").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText(" unsaved");
    await page.getByRole("button", { name: "文档历史", exact: true }).click();
    await expect(page.locator(".history-entries button")).toHaveCount(2);
    await page.locator(".history-entries button").last().click();
    await expect(page.getByLabel("当前文档内容")).toContainText("unsaved");
    await page.getByRole("button", { name: "恢复此版本", exact: true }).click();
    await expect(page.locator(".document-history-view")).toHaveCount(0);
    await expect(page.locator(".ProseMirror")).toContainText("Earlier");
    await expect(page.locator(".ProseMirror")).not.toContainText("Latest");
    await page.locator(".history-entries button").first().click();
    await expect(page.getByLabel("历史版本内容")).toContainText("unsaved");
  } finally {
    await app.evaluate(({ app }) => app.exit(0));
  }
});

test("History preferences apply on blur, persist across reopening, and disable recording without deleting existing versions", async () => {
  const { app, page, data } = await fixture();
  try {
    await page.getByRole("button", { name: "偏好设置", exact: true }).click();
    await selectPreference(page,"编辑");
    const section = page.locator(".history-preferences");
    await section.getByLabel("历史记录间隔", { exact: true }).fill("5");
    await section.getByLabel("历史保留版本数", { exact: true }).fill("10");
    await section.getByLabel("历史保留天数", { exact: true }).fill("90");
    await section.getByLabel("历史保留天数", { exact: true }).press("Tab");
    await section.getByRole("switch", { name: "保存历史版本", exact: true }).click();
    await expect(section.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    await page.getByRole("button", { name: "关闭对话框", exact: true }).click();
    await expect.poll(async () =>
      JSON.parse((JSON.parse(await fs.readFile(path.join(data, "settings.json"), "utf8"))).values["moyu-history"])
    ).toEqual({ enabled: false, intervalMinutes: 5, maxEntries: 10, retentionDays: 90 });
    await page.evaluate(async () => {
      await window.moyu!.create("设置历史.md", "file", "old");
      const before: any = await window.moyu!.read("设置历史.md");
      await window.moyu!.save("设置历史.md", "new", before.data.version);
    });
    await page.locator(".tree-item[title=\"设置历史.md\"]").dblclick();
    await page.getByRole("button", { name: "文档历史", exact: true }).click();
    await expect(page.locator(".history-policy")).toHaveAttribute("title", /不记录保存版本/);
    await expect(page.locator(".history-entries button")).toHaveCount(0);
    await page.getByRole("button", { name: "偏好设置", exact: true }).click();
    await selectPreference(page,"编辑");
    await section.getByRole("switch").click();
    await expect(section.getByLabel("历史记录间隔")).toHaveValue("5");
    await expect(section.getByLabel("历史保留版本数")).toHaveValue("10");
    await expect(section.getByLabel("历史保留天数")).toHaveValue("90");
    await page.getByRole("button", { name: "关闭对话框", exact: true }).click();
    await page.evaluate(async () => {
      const before: any = await window.moyu!.read("设置历史.md");
      await window.moyu!.save("设置历史.md", "recorded", before.data.version);
    });
    await expect(page.locator(".history-entries button")).toHaveCount(2);
    await expect(page.locator(".history-policy")).toHaveAttribute("title", /5 分钟/);
  } finally {
    await app.evaluate(({ app }) => app.exit(0));
  }
});
