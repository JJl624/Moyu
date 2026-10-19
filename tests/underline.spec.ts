import { _electron as electron, expect, test } from "./helpers/test";
import fs from "node:fs/promises";
import path from "node:path";
const project = path.resolve(import.meta.dirname, ".."), work = path.resolve(project, "../../work");
async function fixture() {
  const data = await fs.mkdtemp(path.join(work, "underline-v1817-")),
    env = { ...process.env, MOYU_USER_DATA: data, MOYU_TEST: "1", MOYU_DEMO: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch(
      process.env.MOYU_E2E_EXECUTABLE
        ? { executablePath: process.env.MOYU_E2E_EXECUTABLE, args: [], env }
        : { args: [project], env },
    ),
    page = await app.firstWindow();
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 30000 });
  await (await app.browserWindow(page)).evaluate(w => {
    w.show();
    w.focus();
    w.webContents.focus();
  });
  return { app, page, data };
}
test("Underline renders in preview, reading, headings, tables and nested styles, and source editing remains exact", async () => {
  const { app, page } = await fixture(), errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  try {
    const markdown =
      "# __标题__\n\n前__文字__后 __**加粗**__ ==__高亮__== __[链接](https://example.com)__\n\n`__代码__` 与 \\__普通__\n\n| 格式 |\n| --- |\n| __表格__ |\n\n末尾\n";
    await page.evaluate(markdown => window.moyu!.create("下划线.md", "file", markdown), markdown);
    await page.locator(".tree-item[title=\"下划线.md\"]").dblclick();
    await expect(page.locator(".ProseMirror h1 u")).toHaveText("标题");
    await expect(page.locator(".ProseMirror u strong")).toHaveText("加粗");
    await expect(page.locator(".ProseMirror mark u")).toHaveText("高亮");
    await expect(page.locator(".ProseMirror td u")).toHaveText("表格");
    await page.locator(".ProseMirror p u").filter({ hasText: "文字" }).click();
    await expect(page.locator("[data-syntax=underline].editing .syntax-raw")).toHaveText("__文字__");
    await page.getByRole("button", { name: "源码", exact: true }).click();
    await expect(page.locator(".source-editor .cm-content")).toContainText("前__文字__后");
    await page.getByRole("button", { name: "阅读", exact: true }).click();
    await expect(page.locator(".reading-view u")).toHaveCount(6);
    await expect(page.locator(".reading-view code")).toHaveText("__代码__");
    await expect(page.locator(".reading-view")).toContainText("__普通__");
    await expect(page.locator(".reading-view a")).toHaveText("链接");
    await page.screenshot({ path: path.join(work, "underline-v1817.png") });
    await page.getByRole("button", { name: "预览编辑", exact: true }).click();
    await page.locator(".ProseMirror p").filter({ hasText: "末尾" }).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("__新增__");
    await page.locator(".ProseMirror h1").click();
    await expect(page.locator(".ProseMirror u").filter({ hasText: "新增" })).toHaveText("新增");
    await page.getByRole("button", { name: "源码", exact: true }).click();
    await expect(page.locator(".source-editor")).toContainText("__新增__");
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0));
  }
});
test("Pasted HTML underline becomes editable double-underscore source while strong remains asterisk bold", async () => {
  const { app, page } = await fixture();
  try {
    await page.evaluate(() => window.moyu!.create("粘贴下划线.md", "file", "开始\n"));
    await page.locator(".tree-item[title=\"粘贴下划线.md\"]").dblclick();
    await page.locator(".ProseMirror").click();
    await page.keyboard.press("Control+End");
    await app.evaluate(({ clipboard, ClipboardItem }) =>
      clipboard.write([
        new ClipboardItem({ "text/html": "<p><u>下划线 <strong>加粗</strong></u></p>", "text/plain": "下划线 加粗" }),
      ])
    );
    await page.keyboard.press("Control+v");
    await expect(page.locator(".ProseMirror")).toContainText("下划线");
    await page.getByRole("button", { name: "源码", exact: true }).click();
    await expect(page.locator(".source-editor")).toContainText("__下划线 **加粗**__");
    await page.getByRole("button", { name: "阅读", exact: true }).click();
    await expect(page.locator(".reading-view u strong")).toHaveText("加粗");
  } finally {
    await app.evaluate(({ app }) => app.exit(0));
  }
});

test('Underline remains visible during source reveal, typing, caret movement and nested formatting in both themes',async()=>{
  const {app,page}=await fixture(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.evaluate(()=>window.moyu!.create('下划线编辑.md','file','__文字__ __**粗体**__ __~~删线~~__\n\n段落一\n\n段落二\n\n后文\n'));
    await page.locator('.tree-item[title="下划线编辑.md"]').dblclick();
    const source=page.locator('.ProseMirror > p').first().locator('.inline-syntax').first();
    await page.locator('.ProseMirror > p').last().click();
    for(const theme of ['light','dark']){
      if(await page.locator('html').getAttribute('data-theme')!==theme)await page.getByRole('button',{name:'切换主题',exact:true}).click();
      await source.locator('.syntax-preview u').click();await expect(source).toHaveClass(/editing/);
      await expect(source.locator('.syntax-raw .moyu-source-underline')).toHaveText('文字');
      await expect(source.locator('.moyu-source-underline')).toHaveCSS('text-decoration-line','underline');
      await expect(source.locator('.moyu-source-marker')).toHaveCount(2);
      for(const marker of await source.locator('.moyu-source-marker').all())await expect(marker).toHaveCSS('text-decoration-line','none');
      await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowRight');await expect(source.locator('.moyu-source-underline')).toHaveCSS('text-decoration-line','underline');
      const paragraph=page.locator('.ProseMirror > p').first();
      await paragraph.locator('.syntax-preview u strong').click();await expect(paragraph.locator('.moyu-source-strong')).toHaveCSS('text-decoration-line','underline');
      await paragraph.locator('.syntax-preview u del,.syntax-preview u s').click();await expect(paragraph.locator('.moyu-source-delete')).toHaveCSS('text-decoration-line','underline line-through');
      await page.locator('.ProseMirror > p').last().click();await source.locator('.syntax-preview u').click();
      await page.screenshot({path:path.join(work,'underline-editing-v1818-'+theme+'.png')});
      await page.locator('.ProseMirror > p').last().click();
    }
    await source.locator('.syntax-preview u').click();
    await source.locator('.syntax-raw .moyu-source-underline').evaluate(el=>document.getSelection()!.collapse(el.firstChild,1));
    await page.keyboard.type('A');await expect(source.locator('.moyu-source-underline')).toHaveText('文A字');await expect(source.locator('.moyu-source-underline')).toHaveCSS('text-decoration-line','underline');
    await page.keyboard.press('Backspace');await expect(source.locator('.moyu-source-underline')).toHaveText('文字');
    await source.locator('.syntax-raw').evaluate(el=>{const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let last:Node|null=null;while(walker.nextNode())last=walker.currentNode;document.getSelection()!.collapse(last,last!.textContent!.length);});
    await page.keyboard.press('Backspace');await expect(source.locator('.syntax-raw')).toHaveText('__文字_');await expect(source.locator('.moyu-source-underline')).toHaveCount(0);
    await page.keyboard.type('_');await expect(source.locator('.moyu-source-underline')).toHaveCSS('text-decoration-line','underline');
    await page.getByRole('button',{name:'源码',exact:true}).click();await expect(page.locator('.source-editor')).toContainText('__文字__ __**粗体**__ __~~删线~~__');expect(errors).toEqual([]);
  }finally{await app.evaluate(({app})=>app.exit(0));}
});
