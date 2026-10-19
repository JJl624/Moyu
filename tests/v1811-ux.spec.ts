import {selectPreference} from './helpers/runtime-ui';
import { _electron as electron, expect, test } from "./helpers/test";
import fs from "node:fs/promises";
import path from "node:path";

import { seedRuntimeCache } from "./helpers/runtime-cache";
const project = path.resolve(import.meta.dirname, ".."), work = path.resolve(project, "../../work");
test.setTimeout(120000);
async function fixture(seed = false) {
  const data = await fs.mkdtemp(path.join(work, "ux-v1811-"));
  if (seed) await seedRuntimeCache(data);
  const env = { ...process.env, MOYU_USER_DATA: data, MOYU_TEST: "1", MOYU_DEMO: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch(
    process.env.MOYU_E2E_EXECUTABLE
      ? { executablePath: process.env.MOYU_E2E_EXECUTABLE, args: [], env }
      : { args: [project], env },
  );
  const page = await app.firstWindow();
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await (await app.browserWindow(page)).evaluate(w => {
    w.show();
    w.focus();
    w.webContents.focus();
  });
  return { app, page, data, root: path.join(data, "示例知识库") };
}
test("Explorer creates documents and folders in place, keeps invalid names editable and creates blank documents and preserves text clipboard", async () => {
  const { app, page, root } = await fixture();
  try {
    await page.getByRole("button", { name: "新建文件夹", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByLabel("新文件夹名称").fill("资料");
    await page.getByLabel("新文件夹名称").press("Enter");
    await expect(page.locator(".tree-item[title=\"资料\"]")).toBeVisible();
    await page.getByRole("button", { name: "新建文档", exact: true }).click();
    const input = page.getByLabel("新文件名称");
    await input.fill("记录");
    await input.press("Control+a");
    await input.press("Control+c");
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe("记录");
    await input.press("Enter");
    await expect(page.locator(".tab.active .tab-name")).toHaveAttribute("title", "资料/记录.md");
    expect(await fs.readFile(path.join(root, "资料/记录.md"), "utf8")).toBe("");
    await page.getByRole("button", { name: "新建文档", exact: true }).click();
    await input.fill("记录");
    await input.press("Enter");
    await expect(page.locator(".file-name-form [role=alert]")).toContainText("存在");
    await expect(input).toBeFocused();
    await input.fill("会议");
    await expect(page.getByLabel("新文档模板")).toHaveCount(0);
    await input.press("Enter");
    await expect(page.locator(".tab.active .tab-name")).toHaveAttribute("title", "资料/会议.md");
    expect(await fs.readFile(path.join(root, "资料/会议.md"), "utf8")).toBe("");
    await page.getByRole("button", { name: "新建文档", exact: true }).click();
    await input.fill("不会创建");
    await input.press("Escape");
    await expect(input).toHaveCount(0);
    expect(await fs.stat(path.join(root, "资料/不会创建.md")).catch(() => null)).toBeNull();
    await page.screenshot({ path: path.join(work, "inline-create-v1811.png") });
  } finally {
    await app.evaluate(({ app }) => app.exit(0));
  }
});
test("Code data creates a named empty file and rejects duplicates without overwriting existing contents", async () => {
  const { app, page, root } = await fixture();
  try {
    await page.evaluate(() => window.moyu!.create("数据.md", "file", "```js {id=0001}\nconsole.log(42);\n```"));
    await page.locator(".tree-item[title=\"数据.md\"]").dblclick();
    if (await page.getByTitle("显示文档信息", { exact: true }).count()) {
      await page.getByTitle("显示文档信息", { exact: true }).click();
    }
    await page.getByRole("tab", { name: "数据", exact: true }).click();
    await page.getByLabel("按目录筛选代码数据").selectOption("all");
    await page.getByRole("button", { name: "新建数据文件 0001", exact: true }).click();
    const input = page.getByLabel("新文件名称");
    await input.fill("input.json");
    await input.press("Enter");
    const target = path.join(root, "数据.assets/code-data/0001/input.json");
    await expect.poll(() => fs.readFile(target, "utf8").catch(() => null)).toBe("");
    await expect(page.locator(".code-data-group")).toContainText("input.json");
    await fs.writeFile(target, "keep");
    await page.getByRole("button", { name: "新建数据文件 0001", exact: true }).click();
    await input.fill("input.json");
    await input.press("Enter");
    await expect(page.locator(".file-name-form [role=alert]")).toContainText("存在");
    expect(await fs.readFile(target, "utf8")).toBe("keep");
    await input.fill("other.csv");
    await input.press("Enter");
    await expect.poll(() => fs.readFile(path.join(path.dirname(target), "other.csv"), "utf8").catch(() => null)).toBe(
      "",
    );
  } finally {
    await app.evaluate(({ app }) => app.exit(0));
  }
});
test("HTML resizing keeps pointer capture across the iframe, supports repeated reversals and persists the final pinned height", async () => {
  const { app, page, root } = await fixture();
  try {
    await page.evaluate(() =>
      window.moyu!.create(
        "拖动.md",
        "file",
        "```js {id=0001}\ndisplayHTML(\"<button onclick=\\\"this.textContent=42\\\">点击</button>\");\n```",
      )
    );
    await page.locator(".tree-item[title=\"拖动.md\"]").dblclick();
    await page.getByRole("button", { name: "运行代码块", exact: true }).click();
    const frame = page.frameLocator("iframe[title=\"HTML 运行结果\"]");
    await expect(frame.getByRole("button", { name: "点击" })).toBeVisible();
    await page.getByRole("button", { name: "钉住 HTML", exact: true }).click();
    await expect(page.getByRole("button", { name: "取消钉住 HTML", exact: true })).toBeVisible();
    const handle = page.getByRole("separator", { name: "调整 HTML 预览高度" }),
      canvas = page.locator(".html-result-canvas");
    for (const delta of [-100, 150, -90, 120, -80, 60]) {
      await handle.scrollIntoViewIfNeeded();
      const start = await handle.boundingBox(),
        old = await canvas.evaluate(el => el.getBoundingClientRect().height);
      await page.mouse.move(start!.x + start!.width / 2, start!.y + 5);
      await page.mouse.down();
      await expect(page.locator("body")).toHaveClass(/moyu-html-resizing/);
      await page.mouse.move(start!.x + start!.width / 2, start!.y + 5 + delta, { steps: 12 });
      await page.mouse.up();
      await expect(canvas).toHaveCSS("height", Math.round(old + delta) + "px");
      await expect(page.locator("body")).not.toHaveClass(/moyu-html-resizing/);
    }
    await handle.focus();
    await page.keyboard.press("ArrowUp");
    const height = Number(await handle.getAttribute("aria-valuenow"));
    await expect(canvas).toHaveCSS("height", height + "px");
    await frame.getByRole("button", { name: "点击" }).click();
    await expect(frame.getByRole("button", { name: "42" })).toBeVisible();
    await expect.poll(async () =>
      JSON.parse(await fs.readFile(path.join(root, "拖动.assets/results/0001/results.json"), "utf8"))
    ).toMatchObject({});
    await page.locator(".tab.active .tab-close").click();
    await page.locator(".tree-item[title=\"拖动.md\"]").dblclick();
    await expect(canvas).toHaveCSS("height", height + "px");
    await expect(frame.getByRole("button", { name: "点击" })).toBeVisible();
  } finally {
    await app.evaluate(({ app }) => app.exit(0));
  }
});
test("Runtime management separates installed versions from adding files and explains exact SDK download directories", async () => {
  const { app, page } = await fixture(true);
  try {
    await page.getByRole("button", { name: "偏好设置", exact: true }).click();
    for (
      const [name] of [["C / C++", "clang"], ["C#", "csharp"], ["Java", "java"], ["Lua", "lua"], [
        "Ruby",
        "ruby",
      ], ["Bash", "bash"]] as const
    ) {
      await selectPreference(page,name);
      await expect(page.getByLabel(name + " 程序参数", {exact:true})).toHaveCount(0);
    }
    await selectPreference(page,"Java");
    await page.getByRole("tab", { name: "环境", exact: true }).click();
    await expect(page.locator(".runtime-installed")).toContainText("2026.10.12");
    await expect(page.getByRole("button", { name: "添加环境", exact: true })).toHaveCount(0);
    await expect(page.getByLabel("运行环境版本")).toBeVisible();
    await expect(page.locator(".runtime-download-source")).toContainText("格式化插件下载源");
    await page.getByLabel("编译器文件下载源").selectOption("custom");
    const input = page.getByLabel("运行文件目录地址");
    await input.fill("https://mirror.example.com/compiler.wasm");
    await input.press("Tab");
    await expect(page.locator(".runtime-asset-source [role=alert]")).toContainText("单个文件");
    await input.fill("https://mirror.example.com/teavm/");
    await input.press("Tab");
    await expect(page.locator(".runtime-asset-source [role=alert]")).toHaveCount(0);
    await page.getByRole("button", { name: "查看文件", exact: true }).click();
    await page.getByRole("dialog", { name: "编译器运行文件" }).getByRole("button",{name:"TeaVM/",exact:true}).click();
    await expect(page.getByRole("dialog", { name: "编译器运行文件" }).locator("[data-runtime-file]")).toHaveCount(4);
    await expect(page.getByRole("dialog", { name: "编译器运行文件" }).locator("a").first()).toHaveAttribute(
      "href",
      "https://mirror.example.com/teavm/compiler.wasm-runtime.js",
    );
    await page.getByRole("dialog", { name: "编译器运行文件" }).getByRole("button", { name: "关闭对话框" })
      .click();
    await page.getByRole("group", { name: "环境安装方式" }).getByRole("button", {
      name: "本地导入",
      exact: true,
    }).click();
    await expect(page.getByRole("button", { name: "读取清单" })).toHaveCount(0);
    await page.getByRole("button", { name: "文件要求", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "文件要求" })).toContainText("自动识别版本");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "偏好设置" })).toBeVisible();
    await page.screenshot({ path: path.join(work, "environment-ux-v1811.png") });
  } finally {
    await app.evaluate(({ app }) => app.exit(0));
  }
});
test("Explorer does not overflow short trees and retains scrolling when the actual content is long", async () => {
  const { app, page } = await fixture();
  try {
    const scroll = page.locator(".sidebar-scroll");
    await expect.poll(() => scroll.evaluate(el => el.scrollHeight - el.clientHeight)).toBe(0);
    expect(await scroll.evaluate(el => el.scrollWidth - el.clientWidth)).toBe(0);
    const initialRows = await page.locator(".tree-item").count();
    await page.evaluate(async () => {
      for (let i = 0; i < 50; i++) await window.moyu!.create("滚动" + i + ".md", "file", "");
    });
    await expect(page.locator(".tree-item")).toHaveCount(initialRows + 50);
    await expect.poll(() => scroll.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    await page.mouse.move(950, 40);
    await expect.poll(() => scroll.evaluate(el => el.matches(":hover"))).toBe(false);
    expect(await scroll.evaluate(el => getComputedStyle(el).getPropertyValue("--explorer-scrollbar-color").trim()))
      .toBe("transparent");
    await scroll.screenshot({ path: path.join(work, "explorer-scroll-idle-v1811.png") });
    // Electron element screenshots can clear hover; assert the live state before capturing.
    await scroll.hover();
    await expect.poll(() => scroll.evaluate(el => el.matches(":hover"))).toBe(true);
    expect(
      await scroll.evaluate(el => {
        const style = getComputedStyle(el);
        return style.getPropertyValue("--explorer-scrollbar-color").trim()
          === style.getPropertyValue("--border-strong").trim();
      }),
    ).toBe(true);
    await page.mouse.wheel(0, 800);
    await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await scroll.screenshot({ path: path.join(work, "explorer-scroll-scrolled-v1811.png") });
  } finally {
    await app.evaluate(({ app }) => app.exit(0));
  }
});

test("Local import identifies the environment version from a downloaded file without requiring a typed version", async () => {
  const { app, page } = await fixture();
  try {
    await page.getByRole("button", { name: "偏好设置", exact: true }).click();
    await selectPreference(page,"SQL");
    await page.getByRole("tab", { name: "环境", exact: true }).click();
    await page.getByRole("group", { name: "环境安装方式" }).getByRole("button", {
      name: "本地导入",
      exact: true,
    }).click();
    await app.evaluate(({ dialog }, file) => {
      globalThis.fetch = async () => {
        throw Error("unexpected network");
      };
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, path.join(work, "manual-downloads-v1810/sql.js-1.14.2.tgz"));
    await page.getByRole("button", { name: "选择文件", exact: true }).click();
    await expect(page.getByLabel("手动环境版本")).toHaveCount(0);
    await expect(page.getByLabel("手动添加环境")).toContainText("已验证");
    await expect(page.getByRole("button", { name: "添加并启用", exact: true })).toBeEnabled();
  } finally {
    await app.evaluate(({ app }) => app.exit(0));
  }
});

test("New files stay in the visible target when switching between document assets and workspace views", async () => {
  const { app, page, root } = await fixture();
  try {
    await page.evaluate(async () => {
      await window.moyu!.create("资料", "folder", "");
      await window.moyu!.create("资料/文档.md", "file", "```js {id=0001}\nconsole.log(1);\n```");
      const result = await window.moyu!.feature("code.data-create", {
        document: "资料/文档.md",
        language: "js",
        id: "0001",
        name: "input.txt",
      });
      if (!result.ok) throw Error(result.error);
    });
    await page.locator(".tree-item[title=\"资料\"]").click();
    await page.locator(".tree-item[title=\"资料/文档.md\"]").dblclick();
    await page.getByTitle("查看当前文档附属目录", { exact: true }).click();
    await page.getByRole("button", { name: "新建文件夹", exact: true }).click();
    await page.getByLabel("新文件夹名称").fill("输入文件");
    await page.getByLabel("新文件夹名称").press("Enter");
    await expect.poll(() =>
      fs.stat(path.join(root, "资料/文档.assets/输入文件")).then(s => s.isDirectory()).catch(() => false)
    ).toBe(true);
    await page.getByTitle("查看工作空间", { exact: true }).click();
    await expect(page.locator(".tree-item[title=\"资料/文档.assets\"]")).toHaveCount(0);
    await page.getByRole("button", { name: "新建文档", exact: true }).click();
    await expect(page.getByLabel("新文件名称")).toBeVisible();
    await page.getByLabel("新文件名称").fill("记录");
    await page.getByLabel("新文件名称").press("Enter");
    await expect.poll(() => fs.readFile(path.join(root, "资料/记录.md"), "utf8").catch(() => null)).toBe("");
    expect(await fs.stat(path.join(root, "资料/文档.assets/输入文件/记录.md")).catch(() => null)).toBeNull();
  } finally {
    await app.evaluate(({ app }) => app.exit(0));
  }
});
