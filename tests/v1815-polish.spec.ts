import {selectPreference} from './helpers/runtime-ui';
import { _electron as electron, expect, test } from "./helpers/test";
import fs from "node:fs/promises";
import path from "node:path";
const project = path.resolve(import.meta.dirname, ".."), work = path.resolve(project, "../../work");
async function fixture() {
  const data = await fs.mkdtemp(path.join(work, "v1815-"));
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
  return { app, page, data, root: path.join(data, "示例知识库") };
}
test("A clean offline launch has every default environment and runs each language without installation", async () => {
  test.setTimeout(180000);
  const { app, page, data } = await fixture();
  try {
    await app.evaluate(() => {
      globalThis.fetch = async () => {
        throw Error("Unexpected network");
      };
    });
    for (const language of ["clang", "sql", "lua", "csharp", "java", "ruby", "bash"]) {
      const state: any = await page.evaluate(language => window.moyu!.feature("runtime.state", { language }), language);
      expect(state.data.installed.some(i => i.version === state.data.selected)).toBe(true);
    }
    for (
      const [language, code, output] of [
        ["js", "console.log(42)", "42"],
        ["ts", "const value:number=42; console.log(value)", "42"],
        ["py", "print(42)", "42"],
        ["c", "printf(\"42\\n\");", "42"],
        ["cpp", "std::cout << 42 << std::endl;", "42"],
        ["csharp", "Console.WriteLine(42);", "42"],
        ["java", "System.out.println(42);", "42"],
        ["lua", "print(42)", "42"],
        ["ruby", "puts 42", "42"],
        ["bash", "printf \"42\\n\"", "42"],
        ["sql", "SELECT 42 AS answer;", ""],
      ]
    ) {
      const result: any = await page.evaluate(input => window.moyu!.feature("code.run", input), {
        language,
        code,
        ...(language === "sql" ? { scope: "memory" } : {}),
      });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      expect(result.data.error, JSON.stringify(result)).toBe("");
      if (output) expect(result.data.output.trim()).toBe(output);
    }
    for (const language of ["csharp", "java"]) {
      const result: any = await page.evaluate(
        language =>
          window.moyu!.feature("code.format", {
            language,
            code: "class Demo{int n=1;}",
            config: { indentWidth: 2 },
            pluginConfig: {},
          }),
        language,
      );
      expect(result.ok, JSON.stringify(result)).toBe(true);
    }
    await fs.writeFile(path.join(work, "v1815-bundled-data.txt"), data);
  } finally {
    await app.evaluate(({ app }) => app.exit(0));
  }
});
test("File dragging accepts an immediate explicit folder target, preserves parent drops and cancels return", async () => {
  const { app, page, root } = await fixture();
  try {
    await page.evaluate(async () => {
      await window.moyu!.create("甲", "folder");
      await window.moyu!.create("乙", "folder");
      await window.moyu!.create("甲/原文.md", "file", "原文");
      await window.moyu!.create("甲/旁边.md", "file", "旁边");
      await window.moyu!.create("乙/子目录", "folder");
    });
    await page.locator(".tree-item[title=\"甲\"]").click();
    const source = page.locator(".tree-row[data-tree-path=\"甲/原文.md\"]");
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    await source.dispatchEvent("dragstart", { dataTransfer: transfer });
    await source.dispatchEvent("dragover", { dataTransfer: transfer });
    await source.dispatchEvent("drop", { dataTransfer: transfer });
    expect(await fs.readFile(path.join(root, "甲/原文.md"), "utf8")).toBe("原文");
    const beside = page.locator(".tree-row[data-tree-path=\"甲/旁边.md\"]");
    await source.dispatchEvent("dragstart", { dataTransfer: transfer });
    await beside.dispatchEvent("dragover", { dataTransfer: transfer });
    await beside.dispatchEvent("drop", { dataTransfer: transfer });
    expect(await fs.stat(path.join(root, "原文.md")).catch(() => null)).toBe(null);
    const folder = page.locator(".tree-row[data-tree-path=\"乙\"]"), box = (await folder.boundingBox())!;
    await source.dispatchEvent("dragstart", { dataTransfer: transfer });
    await folder.dispatchEvent("dragover", { dataTransfer: transfer, clientY: box.y + box.height / 2 });
    await expect(folder).toHaveClass(/drag-destination/);
    await page.screenshot({ path: path.join(work, "file-drag-v1815.png") });
    await folder.dispatchEvent("drop", { dataTransfer: transfer, clientY: box.y + box.height / 2 });
    await expect.poll(() => fs.readFile(path.join(root, "乙/原文.md"), "utf8").catch(() => null)).toBe("原文");
    expect(await fs.stat(path.join(root, "甲/原文.md")).catch(() => null)).toBe(null);
    const original = page.locator(".tree-row[data-tree-path=\"甲/旁边.md\"]"),
      origin = (await original.boundingBox())!,
      target = (await folder.boundingBox())!;
    await page.mouse.move(origin.x + 75, origin.y + origin.height / 2);
    await page.mouse.down();
    await page.mouse.move(origin.x + 90, origin.y + origin.height / 2, { steps: 4 });
    await page.mouse.move(target.x + 85, target.y + target.height / 2, { steps: 10 });
    await page.mouse.move(target.x + 85, target.y + target.height / 2, { steps: 2 });
    await page.waitForTimeout(550);
    await expect(folder).toHaveClass(/drag-destination/);
    await page.mouse.move(origin.x + 75, origin.y + origin.height / 2, { steps: 10 });
    await page.mouse.up();
    expect(await fs.readFile(path.join(root, "甲/旁边.md"), "utf8")).toBe("旁边");
    expect(await fs.stat(path.join(root, "乙/旁边.md")).catch(() => null)).toBe(null);
  } finally {
    await app.evaluate(({ app }) => app.exit(0));
  }
});
test("Environment refresh shares the installation toolbar and outline has no redundant caption", async () => {
  const { app, page } = await fixture();
  try {
    await page.getByRole("button", { name: "偏好设置", exact: true }).click();
    await selectPreference(page,"界面");
    await page.getByRole("button", { name: "浅色", exact: true }).click();
    await selectPreference(page,"Lua");
    await page.getByRole("tab", { name: "环境", exact: true }).click();
    const group = page.getByRole("group", { name: "环境安装方式" });
    await group.scrollIntoViewIfNeeded();
    const a = (await group.boundingBox())!,
      b = (await page.getByRole("button", { name: "刷新版本", exact: true }).boundingBox())!;
    expect(Math.abs((a.y + a.height / 2) - (b.y + b.height / 2))).toBeLessThan(3);
    await page.screenshot({ path: path.join(work, "settings-compact-v1815-light.png") });
    await page.getByRole("button", { name: "关闭对话框", exact: true }).click();
    await expect(page.getByText("文档结构", { exact: true })).toHaveCount(0);
  } finally {
    await app.evaluate(({ app }) => app.exit(0));
  }
});
