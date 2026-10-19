import { test, expect, _electron as electron } from "./helpers/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { davServer } = require("./helpers/dav-server.cjs");
const project = path.resolve(import.meta.dirname, "..");
test("Rail, typography, secure WebDAV, actual Excalidraw canvas work in Electron", async () => {
  test.setTimeout(120000);
  const work = path.resolve(project, "../../work/e2e");
  await fs.mkdir(work, { recursive: true });
  const userData = await fs.mkdtemp(path.join(work, "features-"));
  const env = { ...process.env, MOYU_USER_DATA: userData, MOYU_TEST: "1", MOYU_DEMO: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const server = await davServer();
  let app = await electron.launch({ args: [project], env });
  const errors: string[] = [];
  try {
    let page = await app.firstWindow();
    page.on("pageerror", (e) => errors.push(e.message));
    await expect(page.locator(".ProseMirror h1")).toBeVisible();
    await expect(page.locator(".activity-bar")).toBeVisible();
    await expect(page.locator(".titlebar, .global-search")).toHaveCount(0);
    await page.getByRole("button", { name: "偏好设置", exact: true }).click();
    await page.getByLabel("正文字体", { exact: true }).fill("Georgia");
    await page.getByLabel("标题字体", { exact: true }).fill("Georgia");
    await page.getByLabel("代码字体", { exact: true }).fill("Consolas");
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await page
      .getByRole("switch", { name: "常驻格式工具栏", exact: true })
      .click();
    await page.getByRole("button", { name: "关闭对话框", exact: true }).click();
    await expect(page.locator(".formatbar")).toBeVisible();
    expect(
      await page
        .locator(".ProseMirror")
        .evaluate((el) => getComputedStyle(el).fontFamily),
    ).toContain("Georgia");
    await page
      .getByRole("button", { name: "WebDAV 同步", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "WebDAV 地址", exact: true })
      .fill(server.url);
    await page
      .getByRole("textbox", { name: "用户名", exact: true })
      .fill("user");
    await page
      .getByRole("textbox", { name: "密码", exact: true })
      .fill("secret");
    await page.getByRole("button", { name: "测试连接", exact: true }).click();
    await expect(page.locator(".feature-message")).toHaveText("连接成功");
    await page.getByRole("button", { name: "立即同步", exact: true }).click();
    await expect(page.locator(".feature-message")).toContainText("已同步");
    expect(server.files.has("/Moyu/开始使用.md")).toBeTruthy();
    await page.getByRole('button',{name:'文件',exact:true}).click();
    await expect(page.getByLabel('开始使用.md，WebDAV：已同步',{exact:true})).toBeVisible();
    await page.screenshot({path:path.join(project,'preview-sync-status.png')});
    await page.getByRole('button',{name:'WebDAV 同步',exact:true}).click();
    const credentials = "settings.json";
    expect(
      await fs.readFile(path.join(userData, credentials), "utf8"),
    ).not.toContain('"password"');
    await page.getByRole("button", { name: "新建绘图", exact: true }).click();
    await expect(page.locator(".excalidraw")).toBeVisible();
    await page
      .locator("label")
      .filter({ has: page.getByTestId("toolbar-rectangle") })
      .click();
    const canvas = await page
      .locator("canvas.excalidraw__canvas.interactive")
      .boundingBox();
    expect(canvas).toBeTruthy();
    await page.mouse.move(canvas!.x + 300, canvas!.y + 190);
    await page.mouse.down();
    await page.mouse.move(canvas!.x + 520, canvas!.y + 320, { steps: 12 });
    await page.mouse.up();
    const root = path.join(userData, "示例知识库");
    await expect
      .poll(
        async () =>
          JSON.parse(
            await fs.readFile(path.join(root, "attachments/未命名绘图.excalidraw"), "utf8"),
          ).elements.length,
      )
      .toBe(1);
    await page.getByRole("button", { name: "导出 SVG", exact: true }).click();
    await expect(page.locator(".toast")).toContainText("已导出");
    expect(
      (await fs.readdir(path.join(root, "attachments"))).some((f) =>
        f.endsWith(".svg"),
      ),
    ).toBeTruthy();
    await page.screenshot({ path: path.join(project, "preview-drawing.png") });
    await page
      .getByRole("button", { name: "插入笔记", exact: true })
      .click();
    await expect(page.locator(".ProseMirror")).toBeVisible();
    const md = await fs.readFile(path.join(root, "开始使用.md"), "utf8");
    expect(md).not.toContain("[编辑绘图]");
    expect(md).toMatch(/!\[未命名绘图\]\([^)]*\.png\)/);
    expect(md).not.toContain("![[");
    await expect(page.locator(".ProseMirror img")).toBeVisible();
    await page.locator('.ProseMirror img').hover();
    await expect(page.locator('.milkdown-image-block[data-drawing=true] .operation')).toBeHidden();
    await page.locator(".ProseMirror img").click({button:"right"});
    await page.getByRole("menuitem", {name:"编辑绘图",exact:true}).click();
    await expect(page.locator(".excalidraw")).toBeVisible();
    await page.getByRole("button", { name: "关闭画布", exact: true }).click();
    await expect(page.locator(".ProseMirror")).toBeVisible();
    const imageMarkdown=md.match(/!\[未命名绘图\]\([^)]*\.png\)/)![0];
    await page.evaluate(async text=>{await window.moyu!.create('旧绘图.md','file',text);},'# 旧绘图\n\n'+imageMarkdown+'\n\n[编辑绘图](attachments/未命名绘图.excalidraw)\n');
    await page.getByRole('button',{name:'文件',exact:true}).click();
    await page.getByRole('button',{name:'旧绘图',exact:true}).click();
    await expect(page.locator('.ProseMirror a').filter({hasText:'编辑绘图'})).toBeHidden();
    await page.locator('.ProseMirror img').click({button:'right'});
    await expect(page.getByRole('menuitem',{name:'设为一级标题',exact:true})).toHaveCount(0);
    await page.getByRole('menuitem',{name:'编辑绘图',exact:true}).click();
    await expect(page.locator('.excalidraw')).toBeVisible();
    await page.getByRole('button',{name:'关闭画布',exact:true}).click();
    await page.getByRole("button", { name: "偏好设置", exact: true }).click();
    await page.getByRole("button", { name: "恢复默认", exact: true }).click();
    await page.screenshot({ path: path.join(project, "preview-settings.png") });
    await page.getByRole("button", { name: "关闭对话框", exact: true }).click();
    await app.evaluate(({ app }) => app.exit(0));
    app = await electron.launch({ args: [project], env });
    page = await app.firstWindow();
    await expect(page.locator(".ProseMirror h1")).toBeVisible();
    await expect(page.locator(".activity-bar")).toBeVisible();
    await page
      .getByRole("button", { name: "Excalidraw 绘图", exact: true })
      .click();
    await page
      .locator(".drawing-file")
      .filter({ hasText: "未命名绘图" })
      .click();
    await expect(page.locator(".excalidraw")).toBeVisible();
    expect(
      JSON.parse(
        await fs.readFile(path.join(root, "attachments/未命名绘图.excalidraw"), "utf8"),
      ).elements.length,
    ).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await server.close();
  }
});
