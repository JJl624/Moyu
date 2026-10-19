import { _electron as electron, expect, test } from "./helpers/test";
import fs from "node:fs/promises";
import path from "node:path";
const project = path.resolve(import.meta.dirname, ".."), work = path.resolve(project, "../../work");
async function fixture() {
  const data = await fs.mkdtemp(path.join(work, "close-position-"));
  await fs.writeFile(
    path.join(data, "settings.json"),
    JSON.stringify({ version: 1, values: { "moyu-save-policy": "manual" } }),
  );
  const env = { ...process.env, MOYU_USER_DATA: data, MOYU_TEST: "1", MOYU_DEMO: "1" };
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
  for (const name of ["位置A", "位置B"]) {
    await page.evaluate(name =>
      window.moyu!.create(
        name + ".md",
        "file",
        Array.from({ length: 80 }, (_, i) => "line " + i).join("\n\n"),
      ), name);
  }
  await page.locator('.tree-item[title="位置A.md"]').dblclick();
  await expect(page.locator(".tab.active .tab-name")).toHaveAttribute("title", "位置A.md");
  return { app, page };
}
async function sourceLine(page: import("@playwright/test").Page) {
  await page.locator(".source-editor .cm-content").focus();
  await page.keyboard.press("ArrowRight");
  return page.evaluate(() => {
    const node = document.getSelection()?.anchorNode;
    return (node instanceof Element ? node : node?.parentElement)?.closest(".cm-line")?.textContent;
  });
}

test("Switching tabs retains the caret, but closing either an active or inactive document discards all its view positions", async () => {
  const { app, page } = await fixture();
  try {
    await page.getByRole("button", { name: "源码", exact: true }).click();
    await page.locator(".source-editor .cm-content").focus();
    await page.keyboard.press("Control+End");
    await expect.poll(() => page.locator(".source-editor .cm-scroller").evaluate(n => n.scrollTop))
      .toBeGreaterThan(500);
    await page.locator('.tree-item[title="位置B.md"]').dblclick();
    await page.locator('.tab-name[title="位置A.md"]').click();
    expect(await sourceLine(page)).toBe("line 79");
    await page.getByRole("button", { name: "关闭 位置A", exact: true }).click();
    await expect(page.locator('.tab-name[title="位置A.md"]')).toHaveCount(0);
    await page.locator('.tree-item[title="位置A.md"]').dblclick();
    await expect(page.locator(".tab.active .tab-name")).toHaveAttribute("title", "位置A.md");
    await expect.poll(() => page.locator(".source-editor .cm-scroller").evaluate(n => n.scrollTop))
      .toBeLessThan(5);
    expect(await sourceLine(page)).toBe("line 0");
    await page.keyboard.press("Control+End");
    await page.locator('.tab-name[title="位置B.md"]').click();
    await page.getByRole("button", { name: "关闭 位置A", exact: true }).click();
    await page.locator('.tree-item[title="位置A.md"]').dblclick();
    await expect(page.locator(".tab.active .tab-name")).toHaveAttribute("title", "位置A.md");
    expect(await sourceLine(page)).toBe("line 0");
    await page.getByRole("button", { name: "预览编辑", exact: true }).click();
    await page.locator(".ProseMirror > p").last().click();
    await page.locator('.tab-name[title="位置B.md"]').click();
    await page.locator('.tab-name[title="位置A.md"]').click();
    await expect.poll(() => page.locator(".document-scroll").evaluate(n => n.scrollTop)).toBeGreaterThan(500);
    await page.getByRole("button", { name: "关闭 位置A", exact: true }).click();
    await page.locator('.tree-item[title="位置A.md"]').dblclick();
    await expect(page.locator(".tab.active .tab-name")).toHaveAttribute("title", "位置A.md");
    await expect.poll(() => page.locator(".document-scroll").evaluate(n => n.scrollTop)).toBeLessThan(5);
  } finally {
    await app.evaluate(({ app }) => app.exit(0));
  }
});

test("Cancelling a close keeps the current caret and unsaved changes", async () => {
  const { app, page } = await fixture();
  try {
    await page.getByRole("button", { name: "源码", exact: true }).click();
    await page.locator(".source-editor .cm-content").focus();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText(" draft");
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 2, checkboxChecked: false });
    });
    await page.getByRole("button", { name: "关闭 位置A", exact: true }).click();
    await expect(page.locator('.tab-name[title="位置A.md"]')).toBeVisible();
    expect(await sourceLine(page)).toBe("line 79 draft");
    await expect(page.locator(".tab.active .dirty-dot")).toBeVisible();
  } finally {
    await app.evaluate(({ app }) => app.exit(0));
  }
});
